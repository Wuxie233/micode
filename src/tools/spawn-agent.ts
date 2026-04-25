import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { type ToolContext, tool } from "@opencode-ai/plugin/tool";
import { type AgentTask, normalizeSpawnAgentArgs } from "@/tools/spawn-agent-args";
import { extractErrorMessage } from "@/utils/errors";

// Extended context with metadata (available but not typed in plugin API)
// Using intersection to add optional metadata without type conflict
type ExtendedContext = ToolContext & {
  metadata?: (input: { title?: string; metadata?: Record<string, unknown> }) => void;
};

const MS_PER_SECOND = 1000;
const FAILURE_HEADER = "## spawn_agent Failed";

const TOOL_DESCRIPTION = `Spawn subagents to execute tasks in PARALLEL.
All agents in the array run concurrently via Promise.all.

Canonical shape: { agents: [{ agent, prompt, description }, ...] }.
For LLM-call compatibility, the tool also accepts a top-level single task
object { agent, prompt, description }, a top-level task array
[{ agent, prompt, description }, ...], or a wrapped single task
{ agents: { agent, prompt, description } }. Invalid or empty inputs return
a stable failure message instead of throwing.

Example:
spawn_agent({
  agents: [
    {agent: "mm-stack-detector", prompt: "...", description: "Detect stack"},
    {agent: "mm-dependency-mapper", prompt: "...", description: "Map deps"}
  ]
})`;

interface SessionCreateResponse {
  readonly data?: { readonly id?: string };
}

interface MessagePart {
  readonly type: string;
  readonly text?: string;
}

interface SessionMessage {
  readonly info?: { readonly role?: "user" | "assistant" };
  readonly parts?: MessagePart[];
}

interface SessionMessagesResponse {
  readonly data?: SessionMessage[];
}

function updateProgress(
  toolCtx: ExtendedContext,
  progressState: { completed: number; total: number; startTime: number } | undefined,
  status: string,
): void {
  if (toolCtx.metadata && progressState) {
    const elapsed = ((Date.now() - progressState.startTime) / MS_PER_SECOND).toFixed(0);
    toolCtx.metadata({
      title: `[${progressState.completed}/${progressState.total}] ${status} (${elapsed}s)`,
    });
  }
}

async function executeAgentSession(ctx: PluginInput, task: AgentTask): Promise<string> {
  const sessionResp = (await ctx.client.session.create({
    body: {},
    query: { directory: ctx.directory },
  })) as SessionCreateResponse;

  const sessionID = sessionResp.data?.id;
  if (!sessionID) {
    return `## ${task.description}\n\n**Agent**: ${task.agent}\n**Error**: Failed to create session`;
  }

  await ctx.client.session.prompt({
    path: { id: sessionID },
    body: {
      parts: [{ type: "text", text: task.prompt }],
      agent: task.agent,
    },
    query: { directory: ctx.directory },
  });

  const messagesResp = (await ctx.client.session.messages({
    path: { id: sessionID },
    query: { directory: ctx.directory },
  })) as SessionMessagesResponse;

  const messages = messagesResp.data || [];
  const lastAssistant = messages.filter((m) => m.info?.role === "assistant").pop();
  const agentResponse =
    lastAssistant?.parts
      ?.filter((p) => p.type === "text" && p.text)
      .map((p) => p.text)
      .join("\n") || "(No response from agent)";

  await ctx.client.session
    .delete({ path: { id: sessionID }, query: { directory: ctx.directory } })
    .catch((_e: unknown) => {
      /* fire-and-forget */
    });

  return agentResponse;
}

async function runAgent(
  ctx: PluginInput,
  task: AgentTask,
  toolCtx: ExtendedContext,
  progressState?: { completed: number; total: number; startTime: number },
): Promise<string> {
  const agentStartTime = Date.now();
  updateProgress(toolCtx, progressState, `Running ${task.agent}...`);

  try {
    const agentOutput = await executeAgentSession(ctx, task);
    const agentTime = ((Date.now() - agentStartTime) / MS_PER_SECOND).toFixed(1);
    return `## ${task.description} (${agentTime}s)\n\n**Agent**: ${task.agent}\n\n### Result\n\n${agentOutput}`;
  } catch (error) {
    const errorMsg = extractErrorMessage(error);
    return `## ${task.description}\n\n**Agent**: ${task.agent}\n**Error**: ${errorMsg}`;
  }
}

async function runParallelAgents(
  ctx: PluginInput,
  agents: readonly AgentTask[],
  extCtx: ExtendedContext,
): Promise<string> {
  const startTime = Date.now();
  const progressState = { completed: 0, total: agents.length, startTime };

  extCtx.metadata?.({ title: `Running ${agents.length} agents in parallel...` });

  const runWithProgress = async (task: AgentTask): Promise<string> => {
    const agentOutput = await runAgent(ctx, task, extCtx, progressState);
    progressState.completed++;
    const elapsed = ((Date.now() - startTime) / MS_PER_SECOND).toFixed(0);
    extCtx.metadata?.({
      title: `[${progressState.completed}/${agents.length}] ${task.agent} done (${elapsed}s)`,
    });
    return agentOutput;
  };

  const outputs = await Promise.all(agents.map(runWithProgress));
  const totalTime = ((Date.now() - startTime) / MS_PER_SECOND).toFixed(1);

  extCtx.metadata?.({ title: `${agents.length} agents completed in ${totalTime}s` });

  return `# ${agents.length} agents completed in ${totalTime}s (parallel)\n\n${outputs.join("\n\n---\n\n")}`;
}

function buildAgentsSchema(): ReturnType<typeof tool.schema.array> {
  return tool.schema
    .array(
      tool.schema.object({
        agent: tool.schema.string().describe("Agent to spawn"),
        prompt: tool.schema.string().describe("Full prompt/instructions"),
        description: tool.schema.string().describe("Short description"),
      }),
    )
    .describe("Agents to spawn in parallel");
}

const dispatchTasks = async (
  ctx: PluginInput,
  tasks: readonly AgentTask[],
  extCtx: ExtendedContext,
): Promise<string> => {
  if (tasks.length === 1) {
    const onlyTask = tasks[0];
    extCtx.metadata?.({ title: `Running ${onlyTask.agent}...` });
    return runAgent(ctx, onlyTask, extCtx);
  }
  return runParallelAgents(ctx, tasks, extCtx);
};

export function createSpawnAgentTool(ctx: PluginInput): ToolDefinition {
  return tool({
    description: TOOL_DESCRIPTION,
    args: { agents: buildAgentsSchema() },
    execute: async (args, toolCtx) => {
      const extCtx = toolCtx as ExtendedContext;
      const outcome = normalizeSpawnAgentArgs(args);
      if (!outcome.ok) {
        return `${FAILURE_HEADER}\n\n${outcome.message}`;
      }
      return dispatchTasks(ctx, outcome.tasks, extCtx);
    },
  });
}
