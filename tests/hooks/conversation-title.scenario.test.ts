import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { type ConversationTitleHook, createConversationTitleHook } from "@/hooks";

interface FakeSession {
  readonly id: string;
  readonly title: string | null;
  readonly parentID: string | null;
}

interface UpdateCall {
  readonly id: string;
  readonly title: string;
}

interface Harness {
  readonly ctx: PluginInput;
  readonly sessions: Map<string, FakeSession>;
  readonly updates: UpdateCall[];
}

const SESSION_MAIN = "ses_main";
const FIRST_USER_TITLE = "修复 lifecycle pre-flight";
const LIFECYCLE_TITLE = "修复 fork pre-flight 与会话标题 v2";
const NEXT_LIFECYCLE_TITLE = "修复会话标题完成态冻结";
const FINISHED_TITLE = `${LIFECYCLE_TITLE} · 已完成`;
const PLAN_PATH = "thoughts/shared/plans/2026-04-28-lifecycle-preflight-and-title-v2.md";
const ISSUE_NUMBER = 1;
const COMMIT_SCOPE = "lifecycle";
const COMMIT_SUMMARY = "relax parent schema";
const FINISH_OUTPUT = "merged and closed";
const LOW_INFO_MESSAGES = ["重启了", "继续"] as const;
const NOW = 1_700_000_000_000;
const FROZEN_NOW = NOW + 30_000;
const THAWED_NOW = NOW + 70_000;

const TOOL_NAMES = {
  WRITE: "write",
  LIFECYCLE_START: "lifecycle_start_request",
  LIFECYCLE_COMMIT: "lifecycle_commit",
  LIFECYCLE_FINISH: "lifecycle_finish",
} as const;

const createHarness = (): Harness => {
  const sessions = new Map<string, FakeSession>();
  const updates: UpdateCall[] = [];

  const ctx = {
    directory: "/tmp/fake-project",
    client: {
      session: {
        get: async ({ path }: { path: { id: string } }) => {
          const session = sessions.get(path.id);
          if (!session) return { data: undefined };
          return { data: { id: session.id, title: session.title, parentID: session.parentID } };
        },
        update: async ({ path, body }: { path: { id: string }; body: { title?: string } }) => {
          if (typeof body.title !== "string") return { data: undefined };
          updates.push({ id: path.id, title: body.title });
          const existing = sessions.get(path.id);
          if (existing) sessions.set(path.id, { ...existing, title: body.title });
          return { data: { id: path.id } };
        },
      },
    },
  } as unknown as PluginInput;

  return { ctx, sessions, updates };
};

const sendMessage = (hook: ConversationTitleHook, text: string): Promise<void> => {
  return hook["chat.message"]({ sessionID: SESSION_MAIN }, { parts: [{ type: "text", text }] });
};

const runTool = (
  hook: ConversationTitleHook,
  tool: string,
  args: Record<string, unknown>,
  output = "",
): Promise<void> => {
  return hook["tool.execute.after"]({ tool, sessionID: SESSION_MAIN, args }, { output });
};

const currentTitle = (harness: Harness): string | null => harness.sessions.get(SESSION_MAIN)?.title ?? null;

describe("conversation-title scenario", () => {
  let harness: Harness;
  let hook: ConversationTitleHook;
  let now = NOW;
  const originalNow = Date.now;

  beforeEach(() => {
    now = NOW;
    Date.now = () => now;
    harness = createHarness();
    harness.sessions.set(SESSION_MAIN, { id: SESSION_MAIN, title: null, parentID: null });
    hook = createConversationTitleHook(harness.ctx);
  });

  afterEach(() => {
    Date.now = originalNow;
  });

  it("keeps the lifecycle topic stable until the work is completed", async () => {
    await sendMessage(hook, FIRST_USER_TITLE);
    expect(currentTitle(harness)).toBe(FIRST_USER_TITLE);

    await runTool(hook, TOOL_NAMES.LIFECYCLE_START, {
      summary: LIFECYCLE_TITLE,
      goals: [],
      constraints: [],
    });
    expect(currentTitle(harness)).toBe(LIFECYCLE_TITLE);

    await runTool(hook, TOOL_NAMES.WRITE, { filePath: PLAN_PATH });
    expect(currentTitle(harness)).toBe(LIFECYCLE_TITLE);

    const updatesAfterPlan = harness.updates.length;
    for (const message of LOW_INFO_MESSAGES) {
      await sendMessage(hook, message);
    }
    expect(currentTitle(harness)).toBe(LIFECYCLE_TITLE);
    expect(harness.updates).toHaveLength(updatesAfterPlan);

    await runTool(hook, TOOL_NAMES.LIFECYCLE_COMMIT, {
      issue_number: ISSUE_NUMBER,
      scope: COMMIT_SCOPE,
      summary: COMMIT_SUMMARY,
    });
    expect(currentTitle(harness)).toBe(LIFECYCLE_TITLE);

    await runTool(hook, TOOL_NAMES.LIFECYCLE_FINISH, { issue_number: ISSUE_NUMBER }, FINISH_OUTPUT);
    expect(currentTitle(harness)).toBe(FINISHED_TITLE);
    expect(harness.updates.at(-1)).toEqual({ id: SESSION_MAIN, title: FINISHED_TITLE });
  });

  it("keeps done title frozen, then lets a new lifecycle_start_request replace it after expiry", async () => {
    await runTool(hook, TOOL_NAMES.LIFECYCLE_START, {
      summary: LIFECYCLE_TITLE,
      goals: [],
      constraints: [],
    });
    await runTool(hook, TOOL_NAMES.LIFECYCLE_FINISH, { issue_number: ISSUE_NUMBER }, FINISH_OUTPUT);
    expect(currentTitle(harness)).toBe(FINISHED_TITLE);

    const finishedUpdates = harness.updates.length;
    now = FROZEN_NOW;
    await runTool(hook, TOOL_NAMES.LIFECYCLE_START, {
      summary: NEXT_LIFECYCLE_TITLE,
      goals: [],
      constraints: [],
    });
    expect(currentTitle(harness)).toBe(FINISHED_TITLE);
    expect(harness.updates).toHaveLength(finishedUpdates);

    now = THAWED_NOW;
    await runTool(hook, TOOL_NAMES.LIFECYCLE_START, {
      summary: NEXT_LIFECYCLE_TITLE,
      goals: [],
      constraints: [],
    });
    expect(currentTitle(harness)).toBe(NEXT_LIFECYCLE_TITLE);
    expect(harness.updates.at(-1)).toEqual({ id: SESSION_MAIN, title: NEXT_LIFECYCLE_TITLE });
  });
});
