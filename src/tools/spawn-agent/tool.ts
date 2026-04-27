import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { type ToolContext, tool } from "@opencode-ai/plugin/tool";

import { dumpRawArgs, isDebugDumpEnabled } from "@/tools/diagnostics";
import { sequenceSchema } from "@/tools/sequence";
import { type AgentTask, normalizeSpawnAgentArgs } from "@/tools/spawn-agent-args";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { classifySpawnError, INTERNAL_CLASSES, type InternalClass } from "./classify";
import { formatSpawnResults } from "./format";
import type { PreservedRegistry } from "./registry";
import { retryOnTransient } from "./retry";
import { SPAWN_OUTCOMES, type SpawnResult } from "./types";

type ExtendedContext = ToolContext & {
  metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void;
};

interface SessionCreateResponse {
  readonly data?: { readonly id?: string };
}

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

interface SessionDeleteClient {
  readonly delete: (input: {
    readonly path: { readonly id: string };
    readonly query: { readonly directory: string };
  }) => Promise<unknown>;
}

export interface AgentSessionResult {
  readonly sessionId: string;
  readonly output: string;
}

export type ExecuteAgentSession = (ctx: PluginInput, task: AgentTask) => Promise<AgentSessionResult>;

export interface SpawnAgentToolOptions {
  readonly registry: PreservedRegistry;
  readonly executeAgentSession?: ExecuteAgentSession;
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
}

const MS_PER_SECOND = 1000;
const FAILURE_HEADER = "## spawn_agent Failed";
const TOOL_NAME = "spawn-agent";
const SESSION_CREATE_ERROR = "Failed to create session";

const TOOL_DESCRIPTION = `Spawn subagents to execute tasks in PARALLEL.
All agents in the array run concurrently via Promise.allSettled.

Canonical shape: { agents: [{ agent, prompt, description }, ...] }.
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
})`;

const taskObjectSchema = tool.schema.object({
  agent: tool.schema.string().describe("Agent name to spawn"),
  prompt: tool.schema.string().describe("Full prompt/instructions for the agent"),
  description: tool.schema.string().describe("Short human-readable description"),
});

type AgentsSchema = ReturnType<typeof sequenceSchema>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasSessionDelete(value: unknown): value is SessionDeleteClient {
  return isRecord(value) && typeof value.delete === "function";
}

function updateProgress(toolCtx: ExtendedContext, progress: ProgressState | undefined, status: string): void {
  if (!toolCtx.metadata || !progress) return;
  const elapsed = ((Date.now() - progress.startTime) / MS_PER_SECOND).toFixed(0);
  toolCtx.metadata({
    title: `[${progress.completed}/${progress.total}] ${status} (${elapsed}s)`,
  });
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

async function deleteSession(ctx: PluginInput, sessionId: string | null): Promise<void> {
  if (sessionId === null) return;
  const session = ctx.client.session;
  if (!hasSessionDelete(session)) return;
  await session.delete({ path: { id: sessionId }, query: { directory: ctx.directory } }).catch((_e: unknown) => {
    /* cleanup should not hide the primary spawn result */
  });
}

async function executeAgentSession(ctx: PluginInput, task: AgentTask): Promise<AgentSessionResult> {
  let sessionId: string | null = null;
  try {
    const sessionResp = (await ctx.client.session.create({
      body: {},
      query: { directory: ctx.directory },
    })) as SessionCreateResponse;

    sessionId = sessionResp.data?.id ?? null;
    if (sessionId === null) throw new Error(SESSION_CREATE_ERROR);

    await ctx.client.session.prompt({
      path: { id: sessionId },
      body: { parts: [{ type: "text", text: task.prompt }], agent: task.agent },
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

function toPublicResult(task: AgentTask, elapsedMs: number, kind: InternalClass, value: AttemptValue): SpawnResult {
  if (kind === INTERNAL_CLASSES.SUCCESS) {
    return {
      outcome: SPAWN_OUTCOMES.SUCCESS,
      description: task.description,
      agent: task.agent,
      elapsedMs,
      output: value.output,
    };
  }

  if ((kind === INTERNAL_CLASSES.TASK_ERROR || kind === INTERNAL_CLASSES.BLOCKED) && value.sessionId !== null) {
    return {
      outcome: kind,
      description: task.description,
      agent: task.agent,
      elapsedMs,
      sessionId: value.sessionId,
      output: value.output,
      resumeCount: 0,
    };
  }

  return {
    outcome: SPAWN_OUTCOMES.HARD_FAILURE,
    description: task.description,
    agent: task.agent,
    elapsedMs,
    error: value.error ?? value.output,
  };
}

async function classifyThrown(
  ctx: PluginInput,
  error: unknown,
): Promise<{ readonly class: InternalClass; readonly value: AttemptValue }> {
  const sessionId = getSessionId(error);
  const classification = classifySpawnError({ thrown: error, httpStatus: getStatus(error) });
  if (classification.class === INTERNAL_CLASSES.TRANSIENT) await deleteSession(ctx, sessionId);
  return { class: classification.class, value: { sessionId, output: "", error: classification.reason } };
}

async function runAttempt(
  ctx: PluginInput,
  task: AgentTask,
  runSession: ExecuteAgentSession,
): Promise<{ readonly class: InternalClass; readonly value: AttemptValue }> {
  try {
    const session = await runSession(ctx, task);
    const classification = classifySpawnError({ assistantText: session.output });
    return { class: classification.class, value: { ...session, error: classification.reason } };
  } catch (error) {
    return classifyThrown(ctx, error);
  }
}

function preserveIfNeeded(registry: PreservedRegistry, result: SpawnResult): SpawnResult {
  if (result.outcome !== SPAWN_OUTCOMES.TASK_ERROR && result.outcome !== SPAWN_OUTCOMES.BLOCKED) return result;
  const preserved = registry.preserve({
    sessionId: result.sessionId,
    agent: result.agent,
    description: result.description,
    outcome: result.outcome,
  });
  return { ...result, resumeCount: preserved.resumeCount };
}

async function runAgent(
  ctx: PluginInput,
  task: AgentTask,
  toolCtx: ExtendedContext,
  options: SpawnAgentToolOptions,
  progress?: ProgressState,
): Promise<SpawnResult> {
  const started = Date.now();
  updateProgress(toolCtx, progress, `Running ${task.agent}...`);
  const runSession = options.executeAgentSession ?? executeAgentSession;
  const settled = await retryOnTransient(() => runAttempt(ctx, task, runSession), {
    retries: config.subagent.transientRetries,
    backoffMs: config.subagent.transientBackoffMs,
  });
  const elapsedMs = Date.now() - started;
  const result = toPublicResult(task, elapsedMs, settled.class, settled.value);
  if (result.outcome === SPAWN_OUTCOMES.SUCCESS || result.outcome === SPAWN_OUTCOMES.HARD_FAILURE) {
    await deleteSession(ctx, settled.value.sessionId);
    return result;
  }
  return preserveIfNeeded(options.registry, result);
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
  options: SpawnAgentToolOptions,
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
  options: SpawnAgentToolOptions,
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
      return dispatchTasks(ctx, outcome.tasks, extCtx, options);
    },
  });
}
