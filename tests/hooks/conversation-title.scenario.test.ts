import { beforeEach, describe, expect, it } from "bun:test";
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
const SESSION_CHILD = "ses_child";
const THROTTLE_BUFFER_MS = 1100;

const TOOL_NAMES = {
  WRITE: "write",
  LIFECYCLE_START: "lifecycle_start_request",
  LIFECYCLE_COMMIT: "lifecycle_commit",
  LIFECYCLE_FINISH: "lifecycle_finish",
} as const;

const ISSUE_NUMBER = 13;
const USER_ISSUE_TITLE = "想让主对话标题在有 issue 时显示中文需求和编号";
const ISSUE_TOPIC = "优化主会话标题生成";
const LOGIN_TOPIC = "登录注册页面";
const ISSUE_TABLE_OUTPUT = "| 13 | `issue/13-main-agent-title` | `/tmp/wt-13` | `planning` |";
const FINISH_OUTPUT = "merged and closed";
const MANUAL_TITLE = "我自己起的名字";
const LOGIN_PLAN_PATH = "thoughts/shared/plans/2026-04-30-login-signup.md";
const ISSUE_TITLES = {
  planning: "#13 规划中：优化主会话标题生成",
  executing: "#13 执行中：优化主会话标题生成",
  done: "#13 已完成：优化主会话标题生成",
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
          const session = sessions.get(path.id);
          if (session) sessions.set(path.id, { ...session, title: body.title });
          return { data: { id: path.id } };
        },
      },
    },
  } as unknown as PluginInput;

  return { ctx, sessions, updates };
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const sleepPastThrottle = (): Promise<void> => wait(THROTTLE_BUFFER_MS);

const createHook = (harness: Harness): ConversationTitleHook => {
  return createConversationTitleHook(harness.ctx, { chatFallbackEnabled: true });
};

const sendMessage = (hook: ConversationTitleHook, sessionID: string, text: string): Promise<void> => {
  return hook["chat.message"]({ sessionID }, { parts: [{ type: "text", text }] });
};

const runTool = (
  hook: ConversationTitleHook,
  sessionID: string,
  tool: string,
  args: Record<string, unknown>,
  output = "",
): Promise<void> => {
  return hook["tool.execute.after"]({ tool, sessionID, args }, { output });
};

const setMainTitle = (harness: Harness, title: string): void => {
  const session = harness.sessions.get(SESSION_MAIN);
  if (!session) throw new Error("missing main session");
  harness.sessions.set(SESSION_MAIN, { ...session, title });
};

describe("conversation-title scenario - full lifecycle", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
    harness.sessions.set(SESSION_MAIN, { id: SESSION_MAIN, title: null, parentID: null });
    harness.sessions.set(SESSION_CHILD, { id: SESSION_CHILD, title: null, parentID: SESSION_MAIN });
  });

  it("applies the user, planning, executing, and done titles for an issue lifecycle", async () => {
    const hook = createHook(harness);

    await sendMessage(hook, SESSION_MAIN, USER_ISSUE_TITLE);
    await sleepPastThrottle();

    await runTool(
      hook,
      SESSION_MAIN,
      TOOL_NAMES.LIFECYCLE_START,
      { summary: ISSUE_TOPIC, goals: [], constraints: [] },
      ISSUE_TABLE_OUTPUT,
    );
    await sleepPastThrottle();

    await runTool(hook, SESSION_MAIN, TOOL_NAMES.LIFECYCLE_COMMIT, {
      issue_number: ISSUE_NUMBER,
      scope: "title",
      summary: "wire hook",
    });
    await sleepPastThrottle();

    await runTool(hook, SESSION_MAIN, TOOL_NAMES.LIFECYCLE_FINISH, { issue_number: ISSUE_NUMBER }, FINISH_OUTPUT);

    expect(harness.updates.map((update) => update.title)).toEqual([
      USER_ISSUE_TITLE,
      ISSUE_TITLES.planning,
      ISSUE_TITLES.executing,
      ISSUE_TITLES.done,
    ]);
  });

  it("keeps a defined no-issue title when a plan path is written", async () => {
    const hook = createHook(harness);

    await sendMessage(hook, SESSION_MAIN, LOGIN_TOPIC);
    await sleepPastThrottle();
    await runTool(hook, SESSION_MAIN, TOOL_NAMES.WRITE, { filePath: LOGIN_PLAN_PATH });

    const title = harness.updates.at(-1)?.title;
    expect(title).toBeDefined();
    expect(title).not.toContain("#");
  });

  it("preserves the user topic when a lifecycle commit has a tool-like summary", async () => {
    const hook = createHook(harness);

    await sendMessage(hook, SESSION_MAIN, LOGIN_TOPIC);
    await sleepPastThrottle();

    await runTool(hook, SESSION_MAIN, TOOL_NAMES.LIFECYCLE_COMMIT, {
      issue_number: ISSUE_NUMBER,
      scope: "title",
      summary: "executor",
    });

    expect(harness.updates.at(-1)?.title).toBe("#13 执行中：登录注册页面");
  });

  it("does not write titles when a lifecycle starts on a child session", async () => {
    const hook = createHook(harness);

    await runTool(
      hook,
      SESSION_CHILD,
      TOOL_NAMES.LIFECYCLE_START,
      { summary: ISSUE_TOPIC, goals: [], constraints: [] },
      ISSUE_TABLE_OUTPUT,
    );

    expect(harness.updates).toHaveLength(0);
  });

  it("preserves opt-out semantics after the user manually edits the title", async () => {
    const hook = createHook(harness);

    await runTool(
      hook,
      SESSION_MAIN,
      TOOL_NAMES.LIFECYCLE_START,
      { summary: ISSUE_TOPIC, goals: [], constraints: [] },
      ISSUE_TABLE_OUTPUT,
    );
    await sleepPastThrottle();

    await runTool(hook, SESSION_MAIN, TOOL_NAMES.LIFECYCLE_COMMIT, {
      issue_number: ISSUE_NUMBER,
      scope: "title",
      summary: "wire hook",
    });
    await sleepPastThrottle();

    setMainTitle(harness, MANUAL_TITLE);
    const updates = harness.updates.length;

    await runTool(hook, SESSION_MAIN, TOOL_NAMES.LIFECYCLE_FINISH, { issue_number: ISSUE_NUMBER }, FINISH_OUTPUT);

    expect(harness.updates).toHaveLength(updates);
    expect(harness.sessions.get(SESSION_MAIN)?.title).toBe(MANUAL_TITLE);
  });
});
