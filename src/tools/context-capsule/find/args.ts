import { tool } from "@opencode-ai/plugin/tool";

/**
 * Zod schema for the `find_reusable_context_capsule` tool.
 *
 * All fields are optional because the tool's `execute` defaults `lifecycle_issue`
 * to null, derives `conversation_anchor` from `toolCtx.sessionID` via the v2
 * `resolveConversationAnchor` helper, and reads `branch` / `worktree` from the
 * current git environment. `topic_hint` is reserved for future ranking; v3 only
 * uses it to surface the topic in the result markdown so the agent can decide
 * relevance.
 */
export const findReusableContextCapsuleArgs = {
  lifecycle_issue: tool.schema
    .number()
    .int()
    .nullable()
    .optional()
    .describe("Lifecycle issue number to scope the search. Omit to search by conversation_anchor only."),
  topic_hint: tool.schema
    .string()
    .optional()
    .describe(
      "Short topic phrase used purely as a relevance hint in the returned markdown summary. Does not filter results.",
    ),
  since: tool.schema
    .string()
    .optional()
    .describe("ISO-8601 timestamp; if provided, capsules created before this are ignored. Optional."),
} as const;

export interface FindReusableContextCapsuleArgs {
  readonly lifecycle_issue?: number | null;
  readonly topic_hint?: string;
  readonly since?: string;
}
