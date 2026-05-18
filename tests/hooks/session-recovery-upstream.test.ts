import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createSessionRecoveryHook } from "../../src/hooks/session-recovery";

interface PromptCapture {
  readonly path: { readonly id: string };
  readonly body: {
    readonly parts: Array<{ readonly text?: string }>;
    readonly providerID?: string;
    readonly modelID?: string;
    readonly agent?: string;
  };
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
  const initialLength = timers.length;
  for (let i = 0; i < timers.length; i++) {
    const timer = timers[i];
    if (!timer || timer.cleared || timer.runAt > nowMs) continue;
    timer.cleared = true;
    timer.callback();
    await Promise.resolve();
    if (i + 1 >= initialLength) break;
  }
}

function makeCtx(): {
  ctx: any;
  captures: PromptCapture[];
  abortCalls: string[];
  toastCalls: Array<{ title: string; variant: string }>;
} {
  const captures: PromptCapture[] = [];
  const abortCalls: string[] = [];
  const toastCalls: Array<{ title: string; variant: string }> = [];
  const ctx = {
    directory: "/tmp/test",
    client: {
      session: {
        messages: async () => ({
          data: [
            {
              info: { role: "user" },
              parts: [{ type: "text", text: "do something side-effecting" }],
            },
          ],
        }),
        prompt: async (req: PromptCapture) => {
          captures.push(req);
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
  return { ctx, captures, abortCalls, toastCalls };
}

function upstreamErrorEvent(sessionID: string) {
  return {
    event: {
      type: "session.error",
      properties: {
        sessionID,
        error: "upstream_error: Upstream request failed",
      },
    },
  };
}

describe("session-recovery upstream_error bounded continuation", () => {
  beforeEach(() => {
    installFakeTimers();
  });

  afterEach(() => {
    restoreTimers();
  });

  it("first upstream_error schedules a delayed same-session resume without abort", async () => {
    const { ctx, captures, abortCalls } = makeCtx();
    const hook = createSessionRecoveryHook(ctx);
    await hook.event(upstreamErrorEvent("ses_1"));

    expect(captures).toHaveLength(0);
    expect(abortCalls).toHaveLength(0);

    await advanceTimersByTime(29_000);
    expect(captures).toHaveLength(0);

    await advanceTimersByTime(30_000);
    expect(captures).toHaveLength(1);
    expect(captures[0].path.id).toBe("ses_1");
    const txt = captures[0].body.parts[0]?.text ?? "";
    expect(txt.toLowerCase()).toContain("upstream");
    expect(txt.toLowerCase()).toContain("check current state");
    expect(txt.toLowerCase()).toContain("do not repeat");
  });

  it("duplicate upstream_error events in flight are deduplicated", async () => {
    const { ctx, captures } = makeCtx();
    const hook = createSessionRecoveryHook(ctx);
    await hook.event(upstreamErrorEvent("ses_1"));
    await hook.event(upstreamErrorEvent("ses_1"));
    await hook.event(upstreamErrorEvent("ses_1"));

    await advanceTimersByTime(30_000);
    expect(captures).toHaveLength(1);
  });

  it("caps auto-retry at the bounded upstream attempt limit", async () => {
    const { ctx, captures, toastCalls } = makeCtx();
    const hook = createSessionRecoveryHook(ctx);

    for (let i = 0; i < 25; i++) {
      await hook.event(upstreamErrorEvent("ses_1"));
      await advanceTimersByTime(30_000);
    }

    expect(captures).toHaveLength(20);
    expect(toastCalls.some((t) => t.title.toLowerCase().includes("exhaust"))).toBe(true);
  });

  it("session.deleted cancels a pending upstream resume timer", async () => {
    const { ctx, captures } = makeCtx();
    const hook = createSessionRecoveryHook(ctx);

    await hook.event(upstreamErrorEvent("ses_1"));
    await hook.event({
      event: { type: "session.deleted", properties: { info: { id: "ses_1" } } },
    });
    await advanceTimersByTime(30_000);

    expect(captures).toHaveLength(0);
  });

  it("non-recoverable upstream-like error (auth) is NOT auto-retried", async () => {
    const { ctx, captures } = makeCtx();
    const hook = createSessionRecoveryHook(ctx);
    await hook.event({
      event: {
        type: "session.error",
        properties: { sessionID: "ses_1", error: "401 unauthorized" },
      },
    });

    await advanceTimersByTime(60_000);
    expect(captures).toHaveLength(0);
  });

  it("preserves provider, model, and agent when upstream message info supplies them", async () => {
    const { ctx, captures } = makeCtx();
    const hook = createSessionRecoveryHook(ctx);
    await hook.event({
      event: {
        type: "message.updated",
        properties: {
          info: {
            sessionID: "ses_1",
            error: "upstream_error: Upstream request failed",
            providerID: "anthropic",
            modelID: "claude-sonnet",
            agent: "build",
          },
        },
      },
    });

    await advanceTimersByTime(30_000);
    expect(captures[0].body.providerID).toBe("anthropic");
    expect(captures[0].body.modelID).toBe("claude-sonnet");
    expect(captures[0].body.agent).toBe("build");
  });

  it("existing protocol error recovery still aborts and resumes without 30s delay", async () => {
    restoreTimers();
    const { ctx, captures, abortCalls } = makeCtx();
    const hook = createSessionRecoveryHook(ctx);
    await hook.event({
      event: {
        type: "session.error",
        properties: { sessionID: "ses_1", error: "tool_result block(s) missing" },
      },
    });

    expect(abortCalls).toContain("ses_1");
    expect(captures.length).toBeGreaterThanOrEqual(1);
  });

  it("session.deleted clears upstream attempt counters", async () => {
    const { ctx, captures } = makeCtx();
    const hook = createSessionRecoveryHook(ctx);
    for (let i = 0; i < 20; i++) {
      await hook.event(upstreamErrorEvent("ses_1"));
      await advanceTimersByTime(30_000);
    }
    const before = captures.length;

    await hook.event({
      event: { type: "session.deleted", properties: { info: { id: "ses_1" } } },
    });
    await hook.event(upstreamErrorEvent("ses_1"));
    await advanceTimersByTime(30_000);

    expect(captures.length).toBeGreaterThan(before);
  });
});
