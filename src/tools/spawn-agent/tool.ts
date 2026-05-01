import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { type ToolContext, tool } from "@opencode-ai/plugin/tool";

import { dumpRawArgs, isDebugDumpEnabled } from "@/tools/diagnostics";
import { sequenceSchema } from "@/tools/sequence";
import { type AgentTask, normalizeSpawnAgentArgs } from "@/tools/spawn-agent-args";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { createInternalSession, deleteInternalSession, updateInternalSession } from "@/utils/internal-session";
import { log } from "@/utils/logger";
import { type ModelReference, resolveModelReference } from "@/utils/model-selection";
import {
  type AmbiguousKind,
  type ClassifyResult,
  classifySpawnError,
  INTERNAL_CLASSES,
  type InternalClass,
} from "./classify";
import { buildDiagnosticLine, type DiagnosticFields } from "./diagnostics";
import { formatSpawnResults } from "./format";
import { evaluateFence, FENCE_DECISIONS, type FenceResult } from "./generation-fence";
import { buildSpawnCompletionTitle, buildSpawnRunningTitle } from "./naming";
import type { PreservedRegistry } from "./registry";
import { retryOnTransient } from "./retry";
import {
  createSpawnSessionRegistry,
  type SpawnPreservedRecord,
  type SpawnSessionRegistry,
} from "./spawn-session-registry";
import { deriveTaskIdentity, type TaskIdentity } from "./task-identity";
import { SPAWN_OUTCOMES, type SpawnResult } from "./types";
import type { VerifyMarkerInput } from "./verifier";
import { VERIFIER_DECISIONS, type VerifierResult } from "./verifier-types";

type ExtendedContext = ToolContext & {
  sessionID?: string;
  metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void;
};

interface MessagePart {
  readonly type: string;
  readonly text?: string;
}

interface SessionMessage {
  readonly info?: { readonly role?: "user" | "assistant" };
  readonly parts?: readonly MessagePart[];
}

interface SessionMessagesResponse {
  readonly data?: readonly SessionMessage[];
}

interface NamedAgent {
  readonly name?: string;
}

interface CallerSession {
  readonly agent?: string;
  readonly agentName?: string;
}

interface CallerContext {
  readonly agent?: string | NamedAgent;
  readonly agentName?: string;
  readonly session?: CallerSession;
  readonly sessionInfo?: CallerSession;
}

export interface AgentSessionResult {
  readonly sessionId: string;
  readonly output: string;
}

export type ExecuteAgentSession = (ctx: PluginInput, task: AgentTask) => Promise<AgentSessionResult>;

export interface SpawnAgentToolOptions {
  readonly registry: PreservedRegistry;
  readonly spawnRegistry?: SpawnSessionRegistry;
  readonly verifier?: (input: VerifyMarkerInput) => Promise<VerifierResult | null>;
  readonly executeAgentSession?: ExecuteAgentSession;
  readonly availableModels?: ReadonlySet<string>;
}

interface ResolvedSpawnAgentToolOptions extends SpawnAgentToolOptions {
  readonly spawnRegistry: SpawnSessionRegistry;
  readonly mirrorLegacyRegistry: boolean;
}

const EMPTY_MODELS: ReadonlySet<string> = new Set<string>();
const MODEL_UNAVAILABLE_PREFIX = "Model override is not available";

type ResolvedModel =
  | { readonly ok: true; readonly model: ModelReference | null }
  | { readonly ok: false; readonly message: string };

function resolveTaskModel(task: AgentTask, available: ReadonlySet<string>): ResolvedModel {
  if (!task.model) return { ok: true, model: null };
  const model = resolveModelReference(task.model, available);
  if (model) return { ok: true, model };
  return { ok: false, message: `${MODEL_UNAVAILABLE_PREFIX}: ${task.model}` };
}

function createDefaultSpawnRegistry(): SpawnSessionRegistry {
  return createSpawnSessionRegistry({
    maxResumes: config.subagent.maxResumesPerSession,
    ttlHours: config.subagent.failedSessionTtlHours,
    runningTtlMs: config.subagent.spawnRegistryRunningTtlMs,
  });
}

function resolveOptions(options: SpawnAgentToolOptions): ResolvedSpawnAgentToolOptions {
  if (options.spawnRegistry) return { ...options, spawnRegistry: options.spawnRegistry, mirrorLegacyRegistry: false };
  return { ...options, spawnRegistry: createDefaultSpawnRegistry(), mirrorLegacyRegistry: true };
}

interface ProgressState {
  completed: number;
  readonly total: number;
  readonly startTime: number;
}

interface AttemptValue {
  readonly sessionId: string | null;
  readonly output: string;
  readonly error: string | null;
  readonly classification: ClassifyResult;
}

interface AttemptResult {
  readonly class: InternalClass;
  readonly value: AttemptValue;
}

interface SettledAttempt extends AttemptResult {
  readonly retries: number;
}

const VERIFIER_VERDICTS = {
  FINAL: "final",
  NARRATIVE: "narrative",
  FALLBACK: "fallback",
} as const;

type VerifierVerdict = (typeof VERIFIER_VERDICTS)[keyof typeof VERIFIER_VERDICTS];

const MS_PER_SECOND = 1000;
const FAILURE_HEADER = "## spawn_agent Failed";
const TOOL_NAME = "spawn-agent";
const MODEL_OVERRIDE_EVENT = "spawn_agent.model_override";
const DIAGNOSTICS_EVENT = "spawn-agent.diagnostics";
const UNKNOWN_CALLER = "unknown";
const UNKNOWN_SESSION_ID = "unknown-session";
const DEFAULT_PARENT_SESSION_ID = "";

const TOOL_DESCRIPTION = `Spawn subagents to execute tasks in PARALLEL.
All agents in the array run concurrently via Promise.allSettled.

Canonical shape: { agents: [{ agent, prompt, description, model? }, ...] }.
Use model when the user asks to temporarily route a subagent to another model.
This is an explicit LLM-controlled per-call override, not a config rewrite.
model should be provider/model, or a configured model alias if unambiguous.
If model cannot be resolved, that spawned task fails before creating a subagent.
You SHOULD always use the canonical array form. As a fallback, the tool
also accepts a single task object under \`agents\`
({ agents: { agent, prompt, description } }), which will be wrapped into
an array of one. Invalid or empty inputs return a stable failure message
instead of throwing.

Example:
spawn_agent({
  agents: [
    {agent: "mm-stack-detector", prompt: "...", description: "Detect stack"},
    {agent: "mm-dependency-mapper", prompt: "...", description: "Map deps"}
  ]
})

Primary-agent caller policy:
Default primary agents (brainstormer/commander/octto) should use the Task tool.
brainstormer is the only primary caller currently allowed to use spawn_agent.
Call it only when the user's latest message contains a concrete model literal token such as claude, opus, sonnet, gpt, gemini, haiku, o1, or o3.
If that condition is not met, abort this tool call and use Task instead.
This is a transitional escape hatch and will be removed once Task supports a model parameter.`;

const TASK_MODEL_DESCRIPTION = "Optional provider/model override for this spawned agent";
const taskObjectSchema = tool.schema.object({
  agent: tool.schema.string().describe("Agent name to spawn"),
  prompt: tool.schema.string().describe("Full prompt/instructions for the agent"),
  description: tool.schema.string().describe("Short human-readable description"),
  model: tool.schema.string().optional().describe(TASK_MODEL_DESCRIPTION),
});

type AgentsSchema = ReturnType<typeof sequenceSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function updateProgress(toolCtx: ExtendedContext, progress: ProgressState | undefined, status: string): void {
  if (!toolCtx.metadata || !progress) return;
  const elapsed = ((Date.now() - progress.startTime) / MS_PER_SECOND).toFixed(0);
  toolCtx.metadata({
    title: `[${progress.completed}/${progress.total}] ${status} (${elapsed}s)`,
  });
}

function nonEmpty(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function getAgentName(value: string | NamedAgent | undefined): string | null {
  const direct = nonEmpty(value);
  if (direct !== null) return direct;
  if (typeof value !== "object" || value === null) return null;
  return nonEmpty(value.name);
}

function getCaller(ctx: PluginInput): string {
  const caller = ctx as CallerContext;
  return (
    nonEmpty(caller.agentName) ??
    getAgentName(caller.agent) ??
    nonEmpty(caller.session?.agentName) ??
    nonEmpty(caller.session?.agent) ??
    nonEmpty(caller.sessionInfo?.agentName) ??
    nonEmpty(caller.sessionInfo?.agent) ??
    UNKNOWN_CALLER
  );
}

function logModelOverride(ctx: PluginInput, task: AgentTask, model: ModelReference): void {
  try {
    log.info(
      MODEL_OVERRIDE_EVENT,
      JSON.stringify({
        caller: getCaller(ctx),
        target_agent: task.agent,
        provider_id: model.providerID,
        model_id: model.modelID,
      }),
    );
  } catch {
    // Logging must never change spawn execution.
  }
}

function readAssistantText(messages: readonly SessionMessage[]): string {
  const lastAssistant = messages.filter((message) => message.info?.role === "assistant").pop();
  return (
    lastAssistant?.parts
      ?.filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n") ?? ""
  );
}

function getStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  if (typeof error.status === "number") return error.status;
  if (typeof error.statusCode === "number") return error.statusCode;
  if (!isRecord(error.response)) return null;
  return typeof error.response.status === "number" ? error.response.status : null;
}

function getSessionId(error: unknown): string | null {
  if (!isRecord(error)) return null;
  return typeof error.sessionId === "string" ? error.sessionId : null;
}

function createSessionError(error: unknown, sessionId: string | null): Error & { sessionId?: string; status?: number } {
  const wrapped: Error & { sessionId?: string; status?: number } = new Error(extractErrorMessage(error));
  const status = getStatus(error);
  if (sessionId !== null) wrapped.sessionId = sessionId;
  if (status !== null) wrapped.status = status;
  return wrapped;
}

function buildPromptBody(
  task: AgentTask,
  model: ModelReference | null,
): { parts: { type: "text"; text: string }[]; agent: string; model?: ModelReference } {
  const base = { parts: [{ type: "text" as const, text: task.prompt }], agent: task.agent };
  return model ? { ...base, model } : base;
}

async function executeAgentSessionWith(
  ctx: PluginInput,
  task: AgentTask,
  available: ReadonlySet<string>,
  parentSessionId: string,
  onCreated: (sessionId: string) => void,
): Promise<AgentSessionResult> {
  const resolved = resolveTaskModel(task, available);
  if (!resolved.ok) throw new Error(resolved.message);
  if (resolved.model !== null) logModelOverride(ctx, task, resolved.model);

  let sessionId: string | null = null;
  try {
    const session = await createInternalSession({
      ctx,
      title: buildSpawnRunningTitle({ agent: task.agent, description: task.description }),
      parentSessionId,
    });
    sessionId = session.sessionId;
    onCreated(sessionId);

    await ctx.client.session.prompt({
      path: { id: sessionId },
      body: buildPromptBody(task, resolved.model),
      query: { directory: ctx.directory },
    });

    const messagesResp = (await ctx.client.session.messages({
      path: { id: sessionId },
      query: { directory: ctx.directory },
    })) as SessionMessagesResponse;

    return { sessionId, output: readAssistantText(messagesResp.data ?? []) };
  } catch (error) {
    throw createSessionError(error, sessionId);
  }
}

async function classifyThrown(
  ctx: PluginInput,
  task: AgentTask,
  error: unknown,
  onTransientSession: (sessionId: string) => void,
): Promise<AttemptResult> {
  const sessionId = getSessionId(error);
  const classification = classifySpawnError({ thrown: error, httpStatus: getStatus(error), agent: task.agent });
  if (classification.class === INTERNAL_CLASSES.TRANSIENT) {
    await deleteInternalSession({ ctx, sessionId, agent: "spawn-agent.transient" });
    if (sessionId !== null) onTransientSession(sessionId);
  }
  return {
    class: classification.class,
    value: { sessionId, output: "", error: classification.reason, classification },
  };
}

async function runAttempt(
  ctx: PluginInput,
  task: AgentTask,
  runSession: ExecuteAgentSession,
  onTransientSession: (sessionId: string) => void,
): Promise<AttemptResult> {
  try {
    const session = await runSession(ctx, task);
    const classification = classifySpawnError({ assistantText: session.output, agent: task.agent });
    return { class: classification.class, value: { ...session, error: classification.reason, classification } };
  } catch (error) {
    return classifyThrown(ctx, task, error, onTransientSession);
  }
}

function getParentSessionId(toolCtx: ExtendedContext): string {
  return nonEmpty(toolCtx.sessionID) ?? DEFAULT_PARENT_SESSION_ID;
}

function createSuccessResult(task: AgentTask, elapsedMs: number, output: string): SpawnResult {
  return { outcome: SPAWN_OUTCOMES.SUCCESS, description: task.description, agent: task.agent, elapsedMs, output };
}

function createHardFailureResult(task: AgentTask, elapsedMs: number, value: AttemptValue): SpawnResult {
  return {
    outcome: SPAWN_OUTCOMES.HARD_FAILURE,
    description: task.description,
    agent: task.agent,
    elapsedMs,
    error: value.error ?? value.output,
  };
}

function createReviewChangesResult(task: AgentTask, elapsedMs: number, output: string): SpawnResult {
  return {
    outcome: SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED,
    description: task.description,
    agent: task.agent,
    elapsedMs,
    output,
  };
}

function createPreservedResult(
  task: AgentTask,
  elapsedMs: number,
  sessionId: string,
  output: string,
  outcome: AmbiguousKind,
  record: SpawnPreservedRecord | null,
): SpawnResult {
  return {
    outcome,
    description: task.description,
    agent: task.agent,
    elapsedMs,
    sessionId,
    output,
    resumeCount: record?.resumeCount ?? 0,
  };
}

function buildIdentity(task: AgentTask, ownerSessionId: string): TaskIdentity {
  return deriveTaskIdentity({
    agent: task.agent,
    description: task.description,
    prompt: task.prompt,
    ownerSessionId,
  });
}

function buildClassifierField(settled: SettledAttempt): string {
  const retries = settled.retries > 0 ? ` retries=${settled.retries}` : "";
  return `${settled.class}: ${settled.value.classification.reason}${retries}`;
}

function buildFenceField(fence: FenceResult): string {
  if (fence.conflictSessionId === null) return fence.decision;
  return `${fence.decision}:${fence.conflictSessionId}`;
}

function attachDiagnostics(task: AgentTask, result: SpawnResult, fields: DiagnosticFields): SpawnResult {
  const diagnostics = buildDiagnosticLine(fields);
  const withDiagnostics: SpawnResult = diagnostics.length > 0 ? { ...result, diagnostics } : result;
  logSpawnDiagnostics(task, withDiagnostics, fields, diagnostics);
  return withDiagnostics;
}

function logSpawnDiagnostics(
  task: AgentTask,
  result: SpawnResult,
  fields: DiagnosticFields,
  diagnostics: string,
): void {
  try {
    log.info(
      DIAGNOSTICS_EVENT,
      JSON.stringify({ task: task.description, agent: task.agent, ...fields, diagnostics, outcome: result.outcome }),
    );
  } catch {
    // Diagnostics must never change spawn execution.
  }
}

function blockedFenceResult(task: AgentTask, fence: FenceResult, started: number): SpawnResult {
  const conflictSessionId = fence.conflictSessionId ?? UNKNOWN_SESSION_ID;
  return {
    outcome: SPAWN_OUTCOMES.BLOCKED,
    description: task.description,
    agent: task.agent,
    elapsedMs: Date.now() - started,
    sessionId: conflictSessionId,
    output: `Generation fence: ${fence.decision}; conflict session ${conflictSessionId}`,
    resumeCount: 0,
  };
}

function registerRunning(
  registry: SpawnSessionRegistry,
  task: AgentTask,
  sessionId: string,
  ownerSessionId: string,
  identity: TaskIdentity,
): void {
  registry.registerRunning({
    sessionId,
    agent: task.agent,
    description: task.description,
    ownerSessionId,
    runId: identity.runId,
    generation: identity.generation,
    taskIdentity: identity.taskIdentity,
  });
}

function mirrorLegacyPreserve(options: ResolvedSpawnAgentToolOptions, result: SpawnResult): void {
  if (!options.mirrorLegacyRegistry) return;
  if (result.outcome !== SPAWN_OUTCOMES.TASK_ERROR && result.outcome !== SPAWN_OUTCOMES.BLOCKED) return;
  options.registry.preserve({
    sessionId: result.sessionId,
    agent: result.agent,
    description: result.description,
    outcome: result.outcome,
  });
}

async function runVerifier(
  verifier: SpawnAgentToolOptions["verifier"],
  settled: { readonly value: AttemptValue },
  _ambiguousKind: AmbiguousKind,
): Promise<VerifierVerdict> {
  const marker = settled.value.classification.markerHit;
  if (!verifier || !marker) return VERIFIER_VERDICTS.FALLBACK;
  try {
    const verdict = await verifier({ assistantText: settled.value.output, marker });
    if (verdict === null) return VERIFIER_VERDICTS.FALLBACK;
    if (verdict.decision === VERIFIER_DECISIONS.FINAL) return VERIFIER_VERDICTS.FINAL;
    return VERIFIER_VERDICTS.NARRATIVE;
  } catch {
    return VERIFIER_VERDICTS.FALLBACK;
  }
}

async function updatePreservedTitle(
  ctx: PluginInput,
  task: AgentTask,
  sessionId: string,
  outcome: AmbiguousKind,
): Promise<void> {
  await updateInternalSession({
    ctx,
    sessionId,
    title: buildSpawnCompletionTitle({ agent: task.agent, description: task.description, outcome }),
  });
}

async function preserveSession(
  ctx: PluginInput,
  task: AgentTask,
  options: ResolvedSpawnAgentToolOptions,
  elapsedMs: number,
  value: AttemptValue,
  outcome: AmbiguousKind,
): Promise<SpawnResult> {
  if (value.sessionId === null) return createHardFailureResult(task, elapsedMs, value);
  const record = options.spawnRegistry.markPreserved(value.sessionId, outcome);
  const result = createPreservedResult(task, elapsedMs, value.sessionId, value.output, outcome, record);
  mirrorLegacyPreserve(options, result);
  await updatePreservedTitle(ctx, task, value.sessionId, outcome);
  return result;
}

async function handleVerification(
  ctx: PluginInput,
  task: AgentTask,
  options: ResolvedSpawnAgentToolOptions,
  settled: SettledAttempt,
  elapsedMs: number,
): Promise<{ readonly result: SpawnResult; readonly verifier: string }> {
  const ambiguousKind = settled.value.classification.ambiguousKind;
  if (!ambiguousKind) {
    options.spawnRegistry.complete(settled.value.sessionId ?? UNKNOWN_SESSION_ID);
    await deleteInternalSession({ ctx, sessionId: settled.value.sessionId, agent: task.agent });
    return { result: createSuccessResult(task, elapsedMs, settled.value.output), verifier: "fallback" };
  }
  const verifier = await runVerifier(options.verifier, settled, ambiguousKind);
  if (verifier === VERIFIER_VERDICTS.FINAL) {
    const result = await preserveSession(ctx, task, options, elapsedMs, settled.value, ambiguousKind);
    return { result, verifier };
  }
  options.spawnRegistry.complete(settled.value.sessionId ?? UNKNOWN_SESSION_ID);
  await deleteInternalSession({ ctx, sessionId: settled.value.sessionId, agent: task.agent });
  return { result: createSuccessResult(task, elapsedMs, settled.value.output), verifier };
}

function evaluateTaskFence(
  options: ResolvedSpawnAgentToolOptions,
  ownerSessionId: string,
  identity: TaskIdentity,
): FenceResult {
  return evaluateFence(options.spawnRegistry, {
    ownerSessionId,
    runId: identity.runId,
    generation: identity.generation,
    taskIdentity: identity.taskIdentity,
  });
}

async function runSpawnAttempt(
  ctx: PluginInput,
  task: AgentTask,
  options: ResolvedSpawnAgentToolOptions,
  ownerSessionId: string,
  identity: TaskIdentity,
): Promise<SettledAttempt> {
  let registeredSessionId: string | null = null;
  const onCreated = (sessionId: string): void => {
    if (registeredSessionId === sessionId) return;
    registerRunning(options.spawnRegistry, task, sessionId, ownerSessionId, identity);
    registeredSessionId = sessionId;
  };
  const onTransientSession = (sessionId: string): void => {
    options.spawnRegistry.complete(sessionId);
    if (registeredSessionId === sessionId) registeredSessionId = null;
  };
  const available = options.availableModels ?? EMPTY_MODELS;
  const runSession =
    options.executeAgentSession ??
    ((c: PluginInput, t: AgentTask) => executeAgentSessionWith(c, t, available, ownerSessionId, onCreated));
  const settled = await retryOnTransient(() => runAttempt(ctx, task, runSession, onTransientSession), {
    retries: config.subagent.transientRetries,
    backoffMs: config.subagent.transientBackoffMs,
  });
  if (settled.value.sessionId !== null && registeredSessionId !== settled.value.sessionId)
    onCreated(settled.value.sessionId);
  return settled;
}

async function cleanupSession(
  ctx: PluginInput,
  task: AgentTask,
  options: ResolvedSpawnAgentToolOptions,
  sessionId: string | null,
): Promise<void> {
  options.spawnRegistry.complete(sessionId ?? UNKNOWN_SESSION_ID);
  await deleteInternalSession({ ctx, sessionId, agent: task.agent });
}

async function finalizeReviewChanges(
  ctx: PluginInput,
  task: AgentTask,
  options: ResolvedSpawnAgentToolOptions,
  value: AttemptValue,
): Promise<void> {
  options.spawnRegistry.complete(value.sessionId ?? UNKNOWN_SESSION_ID);
  await updateInternalSession({
    ctx,
    sessionId: value.sessionId,
    title: buildSpawnCompletionTitle({
      agent: task.agent,
      description: task.description,
      outcome: SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED,
    }),
  });
}

async function finalizeSettled(
  ctx: PluginInput,
  task: AgentTask,
  options: ResolvedSpawnAgentToolOptions,
  settled: SettledAttempt,
  elapsedMs: number,
  fields: DiagnosticFields,
): Promise<SpawnResult> {
  if (settled.class === INTERNAL_CLASSES.NEEDS_VERIFICATION) {
    const verified = await handleVerification(ctx, task, options, settled, elapsedMs);
    return attachDiagnostics(task, verified.result, { ...fields, verifier: verified.verifier });
  }
  if (settled.class === INTERNAL_CLASSES.REVIEW_CHANGES_REQUESTED) {
    await finalizeReviewChanges(ctx, task, options, settled.value);
    return attachDiagnostics(task, createReviewChangesResult(task, elapsedMs, settled.value.output), fields);
  }
  if (settled.class === INTERNAL_CLASSES.SUCCESS) {
    await cleanupSession(ctx, task, options, settled.value.sessionId);
    return attachDiagnostics(task, createSuccessResult(task, elapsedMs, settled.value.output), fields);
  }
  if (settled.class === INTERNAL_CLASSES.TASK_ERROR || settled.class === INTERNAL_CLASSES.BLOCKED) {
    const result = await preserveSession(ctx, task, options, elapsedMs, settled.value, settled.class);
    return attachDiagnostics(task, result, fields);
  }
  await cleanupSession(ctx, task, options, settled.value.sessionId);
  return attachDiagnostics(task, createHardFailureResult(task, elapsedMs, settled.value), fields);
}

async function runAgent(
  ctx: PluginInput,
  task: AgentTask,
  toolCtx: ExtendedContext,
  options: ResolvedSpawnAgentToolOptions,
  progress?: ProgressState,
): Promise<SpawnResult> {
  const started = Date.now();
  updateProgress(toolCtx, progress, `Running ${task.agent}...`);
  const parentSessionId = getParentSessionId(toolCtx);
  const identity = buildIdentity(task, parentSessionId);
  const fence = evaluateTaskFence(options, parentSessionId, identity);
  if (fence.decision !== FENCE_DECISIONS.LAUNCH) {
    const result = blockedFenceResult(task, fence, started);
    return attachDiagnostics(task, result, { fence: buildFenceField(fence) });
  }
  const settled = await runSpawnAttempt(ctx, task, options, parentSessionId, identity);
  const elapsedMs = Date.now() - started;
  const fields: DiagnosticFields = { classifier: buildClassifierField(settled), fence: buildFenceField(fence) };
  return finalizeSettled(ctx, task, options, settled, elapsedMs, fields);
}

function createRejectedResult(task: AgentTask, started: number, error: unknown): SpawnResult {
  return {
    outcome: SPAWN_OUTCOMES.HARD_FAILURE,
    description: task.description,
    agent: task.agent,
    elapsedMs: Date.now() - started,
    error: extractErrorMessage(error),
  };
}

async function runParallelAgents(
  ctx: PluginInput,
  agents: readonly AgentTask[],
  extCtx: ExtendedContext,
  options: ResolvedSpawnAgentToolOptions,
): Promise<string> {
  const started = Date.now();
  const progress: ProgressState = { completed: 0, total: agents.length, startTime: started };

  extCtx.metadata?.({ title: `Running ${agents.length} agents in parallel...` });

  const runWithProgress = async (task: AgentTask): Promise<SpawnResult> => {
    try {
      return await runAgent(ctx, task, extCtx, options, progress);
    } finally {
      progress.completed += 1;
      const elapsed = ((Date.now() - started) / MS_PER_SECOND).toFixed(0);
      extCtx.metadata?.({ title: `[${progress.completed}/${agents.length}] ${task.agent} done (${elapsed}s)` });
    }
  };

  const settled = await Promise.allSettled(agents.map(runWithProgress));
  const results = settled.map((outcome, index) => {
    if (outcome.status === "fulfilled") return outcome.value;
    return createRejectedResult(agents[index], started, outcome.reason);
  });

  const totalTime = ((Date.now() - started) / MS_PER_SECOND).toFixed(1);
  extCtx.metadata?.({ title: `${agents.length} agents completed in ${totalTime}s` });
  return formatSpawnResults(results);
}

const dispatchTasks = async (
  ctx: PluginInput,
  tasks: readonly AgentTask[],
  extCtx: ExtendedContext,
  options: ResolvedSpawnAgentToolOptions,
): Promise<string> => {
  if (tasks.length === 1) {
    const onlyTask = tasks[0];
    extCtx.metadata?.({ title: `Running ${onlyTask.agent}...` });
    const result = await runAgent(ctx, onlyTask, extCtx, options);
    return formatSpawnResults([result]);
  }
  return runParallelAgents(ctx, tasks, extCtx, options);
};

function logDumpPath(path: string | null): string {
  return path === null ? "" : ` Raw args dumped to ${path}.`;
}

export function buildAgentsSchema(): AgentsSchema {
  return sequenceSchema(taskObjectSchema).describe(
    "Tasks to spawn. Canonical: array of {agent, prompt, description}. A single task object or an indexed record is also accepted.",
  );
}

export function buildArgsShape(): { agents: AgentsSchema } {
  return { agents: buildAgentsSchema() };
}

export function createSpawnAgentTool(ctx: PluginInput, options: SpawnAgentToolOptions): ToolDefinition {
  const resolvedOptions = resolveOptions(options);
  return tool({
    description: TOOL_DESCRIPTION,
    args: { agents: buildAgentsSchema() },
    execute: async (args, toolCtx) => {
      const extCtx = toolCtx as ExtendedContext;
      if (isDebugDumpEnabled()) dumpRawArgs(TOOL_NAME, args);
      const outcome = normalizeSpawnAgentArgs(args);
      if (!outcome.ok) {
        const dumped = dumpRawArgs(TOOL_NAME, args);
        return `${FAILURE_HEADER}\n\n${outcome.message}${logDumpPath(dumped)}`;
      }
      return dispatchTasks(ctx, outcome.tasks, extCtx, resolvedOptions);
    },
  });
}
