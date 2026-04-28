import { beforeEach, describe, expect, it } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { createConversationTitleHook } from "@/hooks";

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
const SESSION_INTERNAL = "ses_internal";

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

describe("conversation-title hook", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
    harness.sessions.set(SESSION_MAIN, { id: SESSION_MAIN, title: null, parentID: null });
    harness.sessions.set(SESSION_CHILD, { id: SESSION_CHILD, title: null, parentID: SESSION_MAIN });
    harness.sessions.set(SESSION_INTERNAL, { id: SESSION_INTERNAL, title: null, parentID: null });
  });

  it("renames the main session when a plan file is written", async () => {
    const hook = createConversationTitleHook(harness.ctx);

    await hook["tool.execute.after"](
      {
        tool: "write",
        sessionID: SESSION_MAIN,
        args: { filePath: "thoughts/shared/plans/2026-04-27-foo-design.md" },
      },
      { output: "" },
    );

    expect(harness.updates).toHaveLength(1);
    expect(harness.updates[0]?.id).toBe(SESSION_MAIN);
    expect(harness.updates[0]?.title).toBe("foo");
  });

  it("ignores non-milestone tool events", async () => {
    const hook = createConversationTitleHook(harness.ctx);

    await hook["tool.execute.after"](
      { tool: "read", sessionID: SESSION_MAIN, args: { filePath: "src/index.ts" } },
      { output: "" },
    );

    expect(harness.updates).toHaveLength(0);
  });

  it("never renames a child session that has parentID set", async () => {
    const hook = createConversationTitleHook(harness.ctx);

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_start_request",
        sessionID: SESSION_CHILD,
        args: { summary: "child work", goals: [], constraints: [] },
      },
      { output: "" },
    );

    expect(harness.updates).toHaveLength(0);
  });

  it("respects the isInternalSession predicate from the host", async () => {
    const hook = createConversationTitleHook(harness.ctx, {
      isInternalSession: (id) => id === SESSION_INTERNAL,
    });

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_start_request",
        sessionID: SESSION_INTERNAL,
        args: { summary: "internal work", goals: [], constraints: [] },
      },
      { output: "" },
    );

    expect(harness.updates).toHaveLength(0);
  });

  it("does NOT rename on chat messages by default (chat fallback disabled)", async () => {
    const hook = createConversationTitleHook(harness.ctx);

    await hook["chat.message"](
      { sessionID: SESSION_MAIN },
      { parts: [{ type: "text", text: "  设计 对话名 自动更新  " }] },
    );

    expect(harness.updates).toHaveLength(0);
  });

  it("renames on the first user message when chatFallbackEnabled opt-in is set", async () => {
    const hook = createConversationTitleHook(harness.ctx, { chatFallbackEnabled: true });

    await hook["chat.message"](
      { sessionID: SESSION_MAIN },
      { parts: [{ type: "text", text: "  设计 对话名 自动更新  " }] },
    );

    expect(harness.updates).toHaveLength(1);
    expect(harness.updates[0]?.title).toBe("设计 对话名 自动更新");
  });

  it("ignores '重启了' chat message even when chatFallbackEnabled is on", async () => {
    const hook = createConversationTitleHook(harness.ctx, { chatFallbackEnabled: true });

    await hook["chat.message"]({ sessionID: SESSION_MAIN }, { parts: [{ type: "text", text: "重启了" }] });

    expect(harness.updates).toHaveLength(0);
  });

  it("ignores '继续' / 'ok' / '这是符合预期吗' chat messages even when chatFallbackEnabled is on", async () => {
    const hook = createConversationTitleHook(harness.ctx, { chatFallbackEnabled: true });
    const messages = ["继续", "ok", "这是符合预期吗"] as const;

    for (const message of messages) {
      await hook["chat.message"]({ sessionID: SESSION_MAIN }, { parts: [{ type: "text", text: message }] });
    }

    expect(harness.updates).toHaveLength(0);
  });

  it("uses the first lifecycle_start_request as the topic", async () => {
    const hook = createConversationTitleHook(harness.ctx);

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_start_request",
        sessionID: SESSION_MAIN,
        args: { summary: "修复 fork 检测", goals: [], constraints: [] },
      },
      { output: "" },
    );

    expect(harness.updates).toHaveLength(1);
    expect(harness.updates[0]?.title).toBe("修复 fork 检测");
  });

  it("keeps a lifecycle topic when a later non-low-info chat message arrives (chat fallback off)", async () => {
    const hook = createConversationTitleHook(harness.ctx);

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_start_request",
        sessionID: SESSION_MAIN,
        args: { summary: "修复 fork 检测", goals: [], constraints: [] },
      },
      { output: "" },
    );
    await hook["chat.message"]({ sessionID: SESSION_MAIN }, { parts: [{ type: "text", text: "加个按钮" }] });

    expect(harness.updates).toHaveLength(1);
    expect(harness.updates.at(-1)?.title).toBe("修复 fork 检测");
  });

  it("does not call session.get for chat messages when chat fallback is disabled", async () => {
    let getCalls = 0;
    const ctx = {
      directory: "/tmp/fake-project",
      client: {
        session: {
          get: async () => {
            getCalls += 1;
            return { data: { id: SESSION_MAIN, title: null, parentID: null } };
          },
          update: async () => ({ data: { id: SESSION_MAIN } }),
        },
      },
    } as unknown as PluginInput;

    const hook = createConversationTitleHook(ctx);
    await hook["chat.message"]({ sessionID: SESSION_MAIN }, { parts: [{ type: "text", text: "anything" }] });

    expect(getCalls).toBe(0);
  });

  it("appends done suffix when lifecycle_finish closes the work", async () => {
    const hook = createConversationTitleHook(harness.ctx);

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_start_request",
        sessionID: SESSION_MAIN,
        args: { summary: "修复 fork 检测", goals: [], constraints: [] },
      },
      { output: "" },
    );
    await hook["tool.execute.after"](
      {
        tool: "lifecycle_finish",
        sessionID: SESSION_MAIN,
        args: { issue_number: 1 },
      },
      { output: "merged and closed" },
    );

    expect(harness.updates.at(-1)?.title).toBe("修复 fork 检测 · 已完成");
  });

  it("opts out after the confirmed system title is manually edited and freezes further updates", async () => {
    const hook = createConversationTitleHook(harness.ctx);

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_start_request",
        sessionID: SESSION_MAIN,
        args: { summary: "auto rename", goals: [], constraints: [] },
      },
      { output: "" },
    );
    expect(harness.updates).toHaveLength(1);

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_commit",
        sessionID: SESSION_MAIN,
        args: { issue_number: 1, scope: "x", summary: "confirm-readback" },
      },
      { output: "" },
    );
    expect(hook.registry.isOptedOut(SESSION_MAIN)).toBe(false);
    const updatesAfterConfirmation = harness.updates.length;

    harness.sessions.set(SESSION_MAIN, { id: SESSION_MAIN, title: "我自己取的名字", parentID: null });
    await Bun.sleep(2);

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_commit",
        sessionID: SESSION_MAIN,
        args: { issue_number: 1, scope: "x", summary: "should-not-write" },
      },
      { output: "" },
    );

    expect(harness.updates).toHaveLength(updatesAfterConfirmation);
    expect(hook.registry.isOptedOut(SESSION_MAIN)).toBe(true);

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_finish",
        sessionID: SESSION_MAIN,
        args: { issue_number: 1 },
      },
      { output: "merged and closed" },
    );

    expect(harness.updates).toHaveLength(updatesAfterConfirmation);
  });

  it("forgets per-session state on session.deleted event", async () => {
    const hook = createConversationTitleHook(harness.ctx);

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_start_request",
        sessionID: SESSION_MAIN,
        args: { summary: "x", goals: [], constraints: [] },
      },
      { output: "" },
    );
    expect(hook.registry.size()).toBe(1);

    await hook.event({ event: { type: "session.deleted", properties: { info: { id: SESSION_MAIN } } } });
    expect(hook.registry.size()).toBe(0);
  });

  it("swallows session.update errors and never throws", async () => {
    const ctx = {
      directory: "/tmp/fake-project",
      client: {
        session: {
          get: async () => ({ data: { id: SESSION_MAIN, title: null, parentID: null } }),
          update: async () => {
            throw new Error("network down");
          },
        },
      },
    } as unknown as PluginInput;

    const hook = createConversationTitleHook(ctx);

    await expect(
      hook["tool.execute.after"](
        {
          tool: "lifecycle_start_request",
          sessionID: SESSION_MAIN,
          args: { summary: "x", goals: [], constraints: [] },
        },
        { output: "" },
      ),
    ).resolves.toBeUndefined();
  });
});
