import { createHash } from "node:crypto";

const CONVERSATION_ANCHOR_LENGTH = 16;

export function resolveConversationAnchor(sessionId: string | null | undefined): string | null {
  const trimmedSessionId = sessionId?.trim();

  if (!trimmedSessionId) {
    return null;
  }

  return createHash("sha256").update(trimmedSessionId).digest("hex").slice(0, CONVERSATION_ANCHOR_LENGTH);
}
