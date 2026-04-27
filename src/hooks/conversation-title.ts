// src/hooks/conversation-title.ts
import type { PluginInput } from "@opencode-ai/plugin";

import {
  classifyToolMilestone,
  createTitleStateRegistry,
  summaryFromUserMessage,
  TITLE_STATUS,
  type TitleStateRegistry,
} from "@/utils/conversation-title";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

const LOG_SCOPE = "conversation-title";

export interface ConversationTitleConfig {
  readonly enabled: boolean;
  readonly maxLength: number;
  readonly isInternalSession?: (sessionID: string) => boolean;
}

const DEFAULT_MAX_LENGTH = 50;

const defaultConfig = (): ConversationTitleConfig => ({
  enabled: true,
  maxLength: DEFAULT_MAX_LENGTH,
});

interface ToolAfterInput {
  readonly tool: string;
  readonly sessionID: string;
  readonly args?: Record<string, unknown>;
}

interface ToolAfterOutput {
  readonly output?: string;
}

interface ChatMessageInput {
  readonly sessionID: string;
}

interface ChatMessageOutput {
  readonly parts: readonly { readonly type: string; readonly text?: string }[];
}

interface SessionInfo {
  readonly title: string | null;
  readonly parentID: string | null;
}

const parentIdCache = new Map<string, string | null>();

const fetchSessionInfo = async (ctx: PluginInput, sessionID: string): Promise<SessionInfo | null> => {
  try {
    const response = await ctx.client.session.get({
      path: { id: sessionID },
      query: { directory: ctx.directory },
    });
    const data = response.data;
    if (!data) return null;
    const parentID =
      typeof (data as { parentID?: unknown }).parentID === "string" ? (data as { parentID: string }).parentID : null;
    parentIdCache.set(sessionID, parentID);
    return {
      title: typeof data.title === "string" ? data.title : null,
      parentID,
    };
  } catch (error) {
    log.warn(LOG_SCOPE, `session.get failed for ${sessionID}: ${extractErrorMessage(error)}`);
    return null;
  }
};

const isMainAgentSession = (info: SessionInfo | null): boolean => {
  if (!info) return false;
  return info.parentID === null;
};

const writeTitle = async (ctx: PluginInput, sessionID: string, title: string): Promise<void> => {
  try {
    await ctx.client.session.update({
      path: { id: sessionID },
      body: { title },
      query: { directory: ctx.directory },
    });
  } catch (error) {
    log.warn(LOG_SCOPE, `session.update failed for ${sessionID}: ${extractErrorMessage(error)}`);
  }
};

interface DispatchOptions {
  readonly status: import("@/utils/conversation-title").TitleStatus;
  readonly summary: string | null;
  readonly currentTitle: string | null;
}

interface ConversationTitleHookHandlers {
  "tool.execute.after": (input: ToolAfterInput, output: ToolAfterOutput) => Promise<void>;
  "chat.message": (input: ChatMessageInput, output: ChatMessageOutput) => Promise<void>;
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>;
}

const extractMessageText = (output: ChatMessageOutput): string => {
  return output.parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text ?? "")
    .join(" ");
};

interface ContextDeps {
  readonly ctx: PluginInput;
  readonly registry: TitleStateRegistry;
  readonly config: ConversationTitleConfig;
}

const dispatch = async (deps: ContextDeps, sessionID: string, options: DispatchOptions): Promise<void> => {
  if (deps.config.isInternalSession?.(sessionID)) return;

  const info = await fetchSessionInfo(deps.ctx, sessionID);
  if (!isMainAgentSession(info)) return;

  const decision = deps.registry.decide({
    sessionID,
    status: options.status,
    summary: options.summary,
    currentTitle: options.currentTitle,
    now: Date.now(),
    maxLength: deps.config.maxLength,
  });

  if (decision.kind === "skip") return;
  await writeTitle(deps.ctx, sessionID, decision.title);
};

export interface ConversationTitleHook extends ConversationTitleHookHandlers {
  registry: TitleStateRegistry;
}

const handleToolAfter = async (deps: ContextDeps, input: ToolAfterInput, output: ToolAfterOutput): Promise<void> => {
  if (!deps.config.enabled) return;
  const signal = classifyToolMilestone({ tool: input.tool, args: input.args, output: output.output });
  if (!signal) return;

  const info = await fetchSessionInfo(deps.ctx, input.sessionID);
  await dispatch(deps, input.sessionID, {
    status: signal.status,
    summary: signal.summary,
    currentTitle: info?.title ?? null,
  });
};

const handleChatMessage = async (
  deps: ContextDeps,
  input: ChatMessageInput,
  output: ChatMessageOutput,
): Promise<void> => {
  if (!deps.config.enabled) return;
  if (deps.registry.isOptedOut(input.sessionID)) return;

  const info = await fetchSessionInfo(deps.ctx, input.sessionID);
  if (!isMainAgentSession(info)) return;

  const summary = summaryFromUserMessage(extractMessageText(output));
  if (!summary) return;

  await dispatch(deps, input.sessionID, {
    status: TITLE_STATUS.INITIALIZING,
    summary,
    currentTitle: info?.title ?? null,
  });
};

const handleEvent = (registry: TitleStateRegistry, event: { type: string; properties?: unknown }): void => {
  if (event.type !== "session.deleted") return;
  const props = event.properties as { info?: { id?: string } } | undefined;
  const sessionID = props?.info?.id;
  if (!sessionID) return;
  registry.forget(sessionID);
  parentIdCache.delete(sessionID);
};

export function createConversationTitleHook(
  ctx: PluginInput,
  overrides?: Partial<ConversationTitleConfig>,
): ConversationTitleHook {
  const config: ConversationTitleConfig = { ...defaultConfig(), ...overrides };
  const registry = createTitleStateRegistry();
  const deps: ContextDeps = { ctx, registry, config };

  return {
    registry,
    "tool.execute.after": (input, output) => handleToolAfter(deps, input, output),
    "chat.message": (input, output) => handleChatMessage(deps, input, output),
    event: async ({ event }) => handleEvent(registry, event),
  };
}
