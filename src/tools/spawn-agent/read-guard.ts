export interface MessagePart {
  readonly type: string;
  readonly text?: string;
}

export interface SessionMessage {
  readonly info?: { readonly role?: "user" | "assistant" };
  readonly parts?: readonly MessagePart[];
}

export interface SessionMessagesResponse {
  readonly data?: readonly SessionMessage[];
}

/**
 * Returns the concatenated text of the latest assistant message that has at
 * least one non-empty text part, scanning the message list from newest to
 * oldest. Returns "" when no assistant message contains text content.
 *
 * Why reverse-scan instead of `.pop()`:
 *   A subagent can finish with a terminal tool-call-only or whitespace-only
 *   assistant message appended after the real substantive output. Picking the
 *   absolute last assistant message would silently drop the real text. The
 *   read-guard (`readAssistantTextWithRetry`) only fires when this function
 *   returns "", which now happens iff every assistant message is non-text —
 *   the genuine empty-result case.
 */
export function readAssistantText(messages: readonly SessionMessage[]): string {
  for (let i = messages.length - 1; i >= 0; i -= 1) {
    const message = messages[i];
    if (message.info?.role !== "assistant") continue;
    const textParts = (message.parts ?? []).filter(
      (part) => part.type === "text" && typeof part.text === "string" && part.text.trim().length > 0,
    );
    if (textParts.length > 0) {
      return textParts.map((part) => part.text ?? "").join("\n");
    }
  }
  return "";
}

export interface ReadGuardOptions {
  /** Number of extra reads after the first. Total attempts = 1 + maxExtraReads. */
  readonly maxExtraReads: number;
  /** Per-retry sleep durations (ms). If shorter than maxExtraReads, the last entry is reused. */
  readonly backoffMs: readonly number[];
  /** Optional sleep override for tests. Defaults to a setTimeout-based sleep. */
  readonly sleep?: (ms: number) => Promise<void>;
}

export interface ReadGuardResult {
  /** Trimmed-non-empty output if any read succeeded; "" if all reads were empty. */
  readonly output: string;
  /** Count of re-reads actually performed. 0 means the first read already had output. */
  readonly extraReads: number;
  /** True iff every read (first + all re-reads) returned empty/whitespace text. */
  readonly exhausted: boolean;
}

const DEFAULT_BACKOFF_FALLBACK_MS = 0;

function defaultSleep(ms: number): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, ms);
  });
}

function isNonEmpty(value: string): boolean {
  return value.trim().length > 0;
}

function pickBackoff(backoffMs: readonly number[], index: number): number {
  if (backoffMs.length === 0) return DEFAULT_BACKOFF_FALLBACK_MS;
  if (index < backoffMs.length) return backoffMs[index];
  return backoffMs[backoffMs.length - 1];
}

/**
 * Re-read guard: if firstOutput is empty/whitespace, sleep+reread up to maxExtraReads times.
 * Returns the first non-empty result, or { exhausted: true, output: "" } if all attempts fail.
 * Errors from reread() are NOT caught — they propagate to the caller's existing try/catch.
 */
export async function readAssistantTextWithRetry(
  firstOutput: string,
  reread: () => Promise<string>,
  options: ReadGuardOptions,
): Promise<ReadGuardResult> {
  if (isNonEmpty(firstOutput)) {
    return { output: firstOutput, extraReads: 0, exhausted: false };
  }

  const sleep = options.sleep ?? defaultSleep;
  const maxExtraReads = options.maxExtraReads;

  for (let i = 0; i < maxExtraReads; i += 1) {
    await sleep(pickBackoff(options.backoffMs, i));
    const next = await reread();
    if (isNonEmpty(next)) {
      return { output: next, extraReads: i + 1, exhausted: false };
    }
  }

  return { output: "", extraReads: maxExtraReads, exhausted: true };
}
