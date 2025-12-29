import type { PluginInput } from "@opencode-ai/plugin";

interface TokenLimitError {
  currentTokens?: number;
  maxTokens?: number;
  providerID?: string;
  modelID?: string;
}

// Parse Anthropic token limit errors
function parseTokenLimitError(error: unknown): TokenLimitError | null {
  if (!error) return null;

  const errorStr = typeof error === "string" ? error : JSON.stringify(error);

  // Check for Anthropic-specific token limit messages
  const patterns = [
    /prompt is too long.*?(\d+)\s*tokens.*?maximum.*?(\d+)/i,
    /context.*?(\d+).*?exceeds.*?(\d+)/i,
    /token limit.*?(\d+).*?max.*?(\d+)/i,
  ];

  for (const pattern of patterns) {
    const match = errorStr.match(pattern);
    if (match) {
      return {
        currentTokens: parseInt(match[1], 10),
        maxTokens: parseInt(match[2], 10),
      };
    }
  }

  // Check for generic rate limit / context errors
  if (
    errorStr.includes("context_length_exceeded") ||
    errorStr.includes("token") ||
    errorStr.includes("prompt is too long")
  ) {
    return {};
  }

  return null;
}

interface AutoCompactState {
  pendingCompact: Set<string>;
  errorData: Map<string, TokenLimitError>;
  retryCount: Map<string, number>;
  inProgress: Set<string>;
}

export function createAutoCompactHook(ctx: PluginInput) {
  const state: AutoCompactState = {
    pendingCompact: new Set(),
    errorData: new Map(),
    retryCount: new Map(),
    inProgress: new Set(),
  };

  const MAX_RETRIES = 3;

  async function attemptRecovery(sessionID: string, providerID?: string, modelID?: string): Promise<void> {
    if (state.inProgress.has(sessionID)) return;
    state.inProgress.add(sessionID);

    const retries = state.retryCount.get(sessionID) || 0;

    if (retries >= MAX_RETRIES) {
      await ctx.client.tui
        .showToast({
          body: {
            title: "Auto Compact Failed",
            message: "Max retries reached. Please start a new session or manually compact.",
            variant: "error",
            duration: 5000,
          },
        })
        .catch(() => {});
      state.inProgress.delete(sessionID);
      state.pendingCompact.delete(sessionID);
      return;
    }

    try {
      await ctx.client.tui
        .showToast({
          body: {
            title: "Context Limit Hit",
            message: `Attempting to summarize session (attempt ${retries + 1}/${MAX_RETRIES})...`,
            variant: "warning",
            duration: 3000,
          },
        })
        .catch(() => {});

      // Try to summarize the session
      if (providerID && modelID) {
        await ctx.client.session.summarize({
          path: { id: sessionID },
          body: { providerID, modelID },
          query: { directory: ctx.directory },
        });

        await ctx.client.tui
          .showToast({
            body: {
              title: "Session Compacted",
              message: "Context has been summarized. Continuing...",
              variant: "success",
              duration: 3000,
            },
          })
          .catch(() => {});

        // Clear state on success
        state.pendingCompact.delete(sessionID);
        state.errorData.delete(sessionID);
        state.retryCount.delete(sessionID);

        // Send continue prompt
        setTimeout(async () => {
          try {
            await ctx.client.session.prompt({
              path: { id: sessionID },
              body: { parts: [{ type: "text", text: "Continue" }] },
              query: { directory: ctx.directory },
            });
          } catch {}
        }, 500);
      } else {
        await ctx.client.tui
          .showToast({
            body: {
              title: "Cannot Auto-Compact",
              message: "Missing model info. Please compact manually with /compact.",
              variant: "error",
              duration: 5000,
            },
          })
          .catch(() => {});
      }
    } catch (_e) {
      state.retryCount.set(sessionID, retries + 1);

      // Exponential backoff
      const delay = Math.min(1000 * 2 ** retries, 10000);
      setTimeout(() => {
        state.inProgress.delete(sessionID);
        attemptRecovery(sessionID, providerID, modelID);
      }, delay);
      return;
    }

    state.inProgress.delete(sessionID);
  }

  return {
    event: async ({ event }: { event: { type: string; properties?: unknown } }) => {
      const props = event.properties as Record<string, unknown> | undefined;

      // Clean up on session delete
      if (event.type === "session.deleted") {
        const sessionInfo = props?.info as { id?: string } | undefined;
        if (sessionInfo?.id) {
          state.pendingCompact.delete(sessionInfo.id);
          state.errorData.delete(sessionInfo.id);
          state.retryCount.delete(sessionInfo.id);
          state.inProgress.delete(sessionInfo.id);
        }
        return;
      }

      // Detect token limit errors
      if (event.type === "session.error") {
        const sessionID = props?.sessionID as string | undefined;
        const error = props?.error;

        if (!sessionID) return;

        const parsed = parseTokenLimitError(error);
        if (parsed) {
          state.pendingCompact.add(sessionID);
          state.errorData.set(sessionID, parsed);

          // Get last assistant message for provider/model info
          const lastAssistant = await getLastAssistantInfo(sessionID);
          const providerID = parsed.providerID || lastAssistant?.providerID;
          const modelID = parsed.modelID || lastAssistant?.modelID;

          attemptRecovery(sessionID, providerID, modelID);
        }
      }

      // Also check message.updated for errors
      if (event.type === "message.updated") {
        const info = props?.info as Record<string, unknown> | undefined;
        const sessionID = info?.sessionID as string | undefined;

        if (sessionID && info?.role === "assistant" && info.error) {
          const parsed = parseTokenLimitError(info.error);
          if (parsed) {
            parsed.providerID = info.providerID as string | undefined;
            parsed.modelID = info.modelID as string | undefined;

            state.pendingCompact.add(sessionID);
            state.errorData.set(sessionID, parsed);

            attemptRecovery(sessionID, parsed.providerID, parsed.modelID);
          }
        }
      }
    },
  };

  async function getLastAssistantInfo(sessionID: string): Promise<{ providerID?: string; modelID?: string } | null> {
    try {
      const resp = await ctx.client.session.messages({
        path: { id: sessionID },
        query: { directory: ctx.directory },
      });

      const data = (resp as { data?: unknown[] }).data;
      if (!Array.isArray(data)) return null;

      const lastAssistant = [...data].reverse().find((m) => {
        const msg = m as Record<string, unknown>;
        const info = msg.info as Record<string, unknown> | undefined;
        return info?.role === "assistant";
      });

      if (!lastAssistant) return null;
      const info = (lastAssistant as { info?: Record<string, unknown> }).info;
      return {
        providerID: info?.providerID as string | undefined,
        modelID: info?.modelID as string | undefined,
      };
    } catch {
      return null;
    }
  }
}
