import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { createSessionRecoveryHook } from "../../src/hooks/session-recovery";
import { WORKFLOW_CONTINUATION_RETRY_POLICY } from "../../src/workflow-retry/policy";

interface PromptCall {
  readonly id: string;
  readonly text: string;
}

interface ToastCall {
  readonly title: string;
  readonly variant: string;
}

interface TimerEntry {
  readonly id: number;
  readonly runAt: number;
  readonly delay: number;
  readonly callback: () => void;
  cleared: boolean;
}

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let timers: TimerEntry[] = [];
let nextTimerId = 1;
let nowMs = 0;

function installFakeTimers(): void {
  timers = [];
  nextTimerId = 1;
  nowMs = 0;
  globalThis.setTimeout = ((callback: () => void, delay?: number) => {
    const id = nextTimerId++;
    const normalizedDelay = delay ?? 0;
    timers.push({ id, runAt: nowMs + normalizedDelay, delay: normalizedDelay, callback, cleared: false });
    return id;
  }) as typeof setTimeout;
  globalThis.clearTimeout = ((timer?: ReturnType<typeof setTimeout>) => {
    const id = Number(timer);
    const found = timers.find((t) => t.id === id);
    if (found) found.cleared = true;
  }) as typeof clearTimeout;
}

function restoreTimers(): void {
  globalThis.setTimeout = realSetTimeout;
  globalThis.clearTimeout = realClearTimeout;
  timers = [];
}

async function advanceTimersByTime(ms: number): Promise<void> {
  nowMs += ms;
  const dueTimers = timers.filter((timer) => !timer.cleared && timer.runAt <= nowMs);
  for (const timer of dueTimers) {
    timer.cleared = true;
    timer.callback();
    await Promise.resolve();
  }
}

function makeCtx(opts?: { lastUserMessage?: string }): {
  ctx: any;
  promptCalls: PromptCall[];
  abortCalls: string[];
  toastCalls: ToastCall[];
} {
  const promptCalls: PromptCall[] = [];
  const abortCalls: string[] = [];
  const toastCalls: ToastCall[] = [];
  const ctx = {
    directory: "/tmp/test",
    client: {
      session: {
        messages: async () => ({
          data: [
            {
              info: { role: "user" },
              parts: [{ type: "text", text: opts?.lastUserMessage ?? "ordinary work" }],
            },
          ],
        }),
        prompt: async (req: { path: { id: string }; body: { parts: Array<{ text?: string }> } }) => {
          promptCalls.push({ id: req.path.id, text: req.body.parts[0]?.text ?? "" });
          return {};
        },
        abort: async (req: { path: { id: string } }) => {
          abortCalls.push(req.path.id);
          return {};
        },
      },
      tui: {
        showToast: async (req: { body: { title: string; variant: string } }) => {
          toastCalls.push({ title: req.body.title, variant: req.body.variant });
          return {};
        },
      },
    },
  };
  return { ctx, promptCalls, abortCalls, toastCalls };
}

function upstreamErrorEvent(sessionID: string) {
  return {
    event: {
      type: "session.error",
      properties: { sessionID, error: "upstream_error: Upstream request failed" },
    },
  };
}

describe("session-recovery upstream retry integration", () => {
  beforeEach(() => {
    installFakeTimers();
  });

  afterEach(() => {
    restoreTimers();
  });

  test("Behavior 1+3: user does not see protocol abort; same-session resume prompt occurs", async () => {
    const { ctx, promptCalls, abortCalls } = makeCtx();
    const hook = createSessionRecoveryHook(ctx);

    await hook.event(upstreamErrorEvent("ses_x"));
    await advanceTimersByTime(WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs);

    expect(abortCalls).toHaveLength(0);
    expect(promptCalls).toEqual([
      expect.objectContaining({
        id: "ses_x",
      }),
    ]);
  });

  test("Behavior 2: fixed 30s interval is honored before same-session retry", async () => {
    const { ctx, promptCalls } = makeCtx();
    const hook = createSessionRecoveryHook(ctx);

    await hook.event(upstreamErrorEvent("ses_x"));

    const pendingRetryTimer = timers.find(
      (timer) => !timer.cleared && timer.delay === WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs,
    );
    expect(pendingRetryTimer?.delay).toBe(30_000);
    expect(WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs).toBe(30_000);

    await advanceTimersByTime(29_999);
    expect(promptCalls).toHaveLength(0);

    await advanceTimersByTime(1);
    expect(promptCalls).toHaveLength(1);
    expect(promptCalls[0]?.id).toBe("ses_x");
  });

  test("Behavior 4: retry budget is exactly 20 attempts, then exhaustion toast appears", async () => {
    const { ctx, promptCalls, toastCalls } = makeCtx();
    const hook = createSessionRecoveryHook(ctx);

    expect(WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts).toBe(20);

    for (let i = 0; i < WORKFLOW_CONTINUATION_RETRY_POLICY.maxAttempts + 5; i++) {
      await hook.event(upstreamErrorEvent("ses_x"));
      await advanceTimersByTime(WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs);
    }

    expect(promptCalls).toHaveLength(20);
    const exhaustionToast = toastCalls.find((toast) => toast.title.toLowerCase().includes("exhaust"));
    expect(exhaustionToast).toBeDefined();
    expect(exhaustionToast?.variant).toBe("error");
  });

  test("Behavior 5: retry prompt warns against repeating completed side effects", async () => {
    const { ctx, promptCalls } = makeCtx({ lastUserMessage: "deploy to production now" });
    const hook = createSessionRecoveryHook(ctx);

    await hook.event(upstreamErrorEvent("ses_x"));
    await advanceTimersByTime(WORKFLOW_CONTINUATION_RETRY_POLICY.intervalMs);

    const text = promptCalls[0]?.text.toLowerCase() ?? "";
    expect(text).toContain("check current state");
    expect(text).toContain("do not repeat");
    expect(text).toContain("already completed");
  });
});
