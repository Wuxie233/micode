import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { config } from "@/utils/config";
import { updateInternalSession } from "@/utils/internal-session";
import { classifySpawnError, INTERNAL_CLASSES, type InternalClass } from "./spawn-agent/classify";
import { buildSpawnCompletionTitle } from "./spawn-agent/naming";
import type { PreservedRecord, PreservedRegistry } from "./spawn-agent/registry";
import { buildSubagentResumePrompt } from "./spawn-agent/resume-prompt";
import { type ResumeSubagentResult, SPAWN_OUTCOMES, type SpawnOutcome } from "./spawn-agent/types";

export interface ResumeSubagentToolOptions {
  readonly registry: PreservedRegistry;
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

interface Attempt {
  readonly class: InternalClass;
  readonly output: string;
}

const TOOL_DESCRIPTION = `Resume a previously preserved subagent session after a task_error or blocked outcome.
Coordinator agents use this when spawn_agent reports a resumable SessionID.`;
const ABSENT_REASON = "Session not preserved or expired.";
const MAX_RESUMES_REASON = "Maximum resume count reached.";
const MISSING_SESSION = "-";
const RESULT_HEADER = "## resume_subagent Result";

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function hasSessionDelete(value: unknown): value is SessionDeleteClient {
  return isRecord(value) && typeof value.delete === "function";
}

function getStatus(error: unknown): number | null {
  if (!isRecord(error)) return null;
  if (typeof error.status === "number") return error.status;
  if (typeof error.statusCode === "number") return error.statusCode;
  if (!isRecord(error.response)) return null;
  return typeof error.response.status === "number" ? error.response.status : null;
}

function readAssistantText(messages: readonly SessionMessage[]): string {
  const assistant = messages.filter((message) => message.info?.role === "assistant").pop();
  return (
    assistant?.parts
      ?.filter((part) => part.type === "text" && part.text)
      .map((part) => part.text)
      .join("\n") ?? ""
  );
}

function toPublicOutcome(kind: InternalClass): SpawnOutcome {
  switch (kind) {
    case INTERNAL_CLASSES.SUCCESS:
      return SPAWN_OUTCOMES.SUCCESS;
    case INTERNAL_CLASSES.TASK_ERROR:
      return SPAWN_OUTCOMES.TASK_ERROR;
    case INTERNAL_CLASSES.BLOCKED:
      return SPAWN_OUTCOMES.BLOCKED;
    case INTERNAL_CLASSES.HARD_FAILURE:
    case INTERNAL_CLASSES.TRANSIENT:
      return SPAWN_OUTCOMES.HARD_FAILURE;
  }
}

function formatResumeResult(result: ResumeSubagentResult): string {
  const sessionId = result.sessionId ?? MISSING_SESSION;
  return [
    RESULT_HEADER,
    "",
    `**Outcome**: ${result.outcome}`,
    `**SessionID**: ${sessionId}`,
    `**Resume count**: ${result.resumeCount}`,
    "",
    "### Result",
    "",
    result.output,
  ].join("\n");
}

function hardFailure(output: string, sessionId: string | null, resumeCount: number): ResumeSubagentResult {
  return {
    outcome: SPAWN_OUTCOMES.HARD_FAILURE,
    sessionId,
    resumeCount,
    output,
  };
}

async function syncResumedTitle(ctx: PluginInput, record: PreservedRecord, outcome: SpawnOutcome): Promise<void> {
  await updateInternalSession({
    ctx,
    sessionId: record.sessionId,
    title: buildSpawnCompletionTitle({
      agent: record.agent,
      description: record.description,
      outcome,
    }),
  });
}

async function deleteSession(ctx: PluginInput, sessionId: string): Promise<void> {
  const session = ctx.client.session;
  if (!hasSessionDelete(session)) return;
  await session.delete({ path: { id: sessionId }, query: { directory: ctx.directory } }).catch((_error: unknown) => {
    /* cleanup should not hide the primary resume result */
  });
}

async function cleanup(ctx: PluginInput, registry: PreservedRegistry, sessionId: string): Promise<void> {
  registry.remove(sessionId);
  await deleteSession(ctx, sessionId);
}

async function resumeSession(ctx: PluginInput, sessionId: string, prompt: string): Promise<Attempt> {
  try {
    await ctx.client.session.prompt({ path: { id: sessionId }, body: { parts: [{ type: "text", text: prompt }] } });
    const response = (await ctx.client.session.messages({ path: { id: sessionId } })) as SessionMessagesResponse;
    const output = readAssistantText(response.data ?? []);
    const classification = classifySpawnError({ assistantText: output });
    return { class: classification.class, output: output || classification.reason };
  } catch (error) {
    const classification = classifySpawnError({ thrown: error, httpStatus: getStatus(error) });
    return { class: classification.class, output: classification.reason };
  }
}

async function handleMaxResumes(
  ctx: PluginInput,
  registry: PreservedRegistry,
  record: PreservedRecord,
): Promise<string> {
  await syncResumedTitle(ctx, record, SPAWN_OUTCOMES.HARD_FAILURE);
  await cleanup(ctx, registry, record.sessionId);
  return formatResumeResult(hardFailure(MAX_RESUMES_REASON, record.sessionId, record.resumeCount));
}

async function runResume(
  ctx: PluginInput,
  registry: PreservedRegistry,
  record: PreservedRecord,
  hint: string | undefined,
): Promise<string> {
  const prompt = buildSubagentResumePrompt({ errorType: record.outcome, hint });
  const attempt = await resumeSession(ctx, record.sessionId, prompt);
  const resumeCount = registry.incrementResume(record.sessionId);
  const result: ResumeSubagentResult = {
    outcome: toPublicOutcome(attempt.class),
    sessionId: record.sessionId,
    resumeCount,
    output: attempt.output,
  };
  await syncResumedTitle(ctx, record, result.outcome);
  if (result.outcome === SPAWN_OUTCOMES.SUCCESS || result.outcome === SPAWN_OUTCOMES.HARD_FAILURE) {
    await cleanup(ctx, registry, record.sessionId);
  }
  return formatResumeResult(result);
}

export function createResumeSubagentTool(ctx: PluginInput, options: ResumeSubagentToolOptions): ToolDefinition {
  // Coordinator-only use is a prompt contract, not a runtime ACL; the registry is the runtime guard.
  return tool({
    description: TOOL_DESCRIPTION,
    args: {
      session_id: tool.schema.string().min(1).describe("Preserved subagent session id"),
      hint: tool.schema.string().optional().describe("Optional coordinator hint for the resumed subagent"),
    },
    execute: async (args) => {
      const record = options.registry.get(args.session_id);
      if (record === null) return formatResumeResult(hardFailure(ABSENT_REASON, null, 0));
      if (record.resumeCount >= config.subagent.maxResumesPerSession)
        return handleMaxResumes(ctx, options.registry, record);
      return runResume(ctx, options.registry, record, args.hint);
    },
  });
}
