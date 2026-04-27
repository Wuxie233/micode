import { describe, expect, it } from "bun:test";

import { createTitleStateRegistry, TITLE_STATUS } from "@/utils/conversation-title";

const SESSION = "ses_main";
const NOW = 1_700_000_000_000;

describe("title state registry", () => {
  it("emits a write decision on the first milestone for a session", () => {
    const registry = createTitleStateRegistry();
    const decision = registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.PLANNING,
      summary: "foo",
      currentTitle: null,
      now: NOW,
    });
    expect(decision.kind).toBe("write");
    if (decision.kind === "write") {
      expect(decision.title).toBe("规划中: foo");
    }
  });

  it("throttles a second write of the same title within 1 second", () => {
    const registry = createTitleStateRegistry();
    const first = registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.PLANNING,
      summary: "foo",
      currentTitle: null,
      now: NOW,
    });
    expect(first.kind).toBe("write");

    const second = registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.PLANNING,
      summary: "foo",
      currentTitle: first.kind === "write" ? first.title : null,
      now: NOW + 200,
    });
    expect(second.kind).toBe("skip");
    if (second.kind === "skip") {
      expect(second.reason).toBe("throttled");
    }
  });

  it("allows a different title to be written even within throttle window", () => {
    const registry = createTitleStateRegistry();
    const first = registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.PLANNING,
      summary: "foo",
      currentTitle: null,
      now: NOW,
    });
    if (first.kind !== "write") throw new Error("expected first write");

    const next = registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.EXECUTING,
      summary: "foo",
      currentTitle: first.title,
      now: NOW + 200,
    });
    expect(next.kind).toBe("write");
    if (next.kind === "write") {
      expect(next.title).toBe("执行中: foo");
    }
  });

  it("opts out of further writes when the user manually edits the title", () => {
    const registry = createTitleStateRegistry();
    const first = registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.PLANNING,
      summary: "foo",
      currentTitle: null,
      now: NOW,
    });
    if (first.kind !== "write") throw new Error("expected first write");

    const userEdited = registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.EXECUTING,
      summary: "bar",
      currentTitle: "我的对话",
      now: NOW + 5000,
    });
    expect(userEdited.kind).toBe("skip");
    if (userEdited.kind === "skip") {
      expect(userEdited.reason).toBe("opted-out");
    }
    expect(registry.isOptedOut(SESSION)).toBe(true);

    const later = registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.EXECUTING,
      summary: "baz",
      currentTitle: "我的对话",
      now: NOW + 10_000,
    });
    expect(later.kind).toBe("skip");
  });

  it("freezes the title in done status for one minute", () => {
    const registry = createTitleStateRegistry();
    const finish = registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.DONE,
      summary: "all done",
      currentTitle: null,
      now: NOW,
    });
    if (finish.kind !== "write") throw new Error("expected write on done");

    const within = registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.EXECUTING,
      summary: "newer",
      currentTitle: finish.title,
      now: NOW + 30_000,
    });
    expect(within.kind).toBe("skip");
    if (within.kind === "skip") {
      expect(within.reason).toBe("done-frozen");
    }
  });

  it("releases the done freeze after 60 seconds", () => {
    const registry = createTitleStateRegistry();
    const finish = registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.DONE,
      summary: "done",
      currentTitle: null,
      now: NOW,
    });
    if (finish.kind !== "write") throw new Error("expected write on done");

    const after = registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.EXECUTING,
      summary: "next phase",
      currentTitle: finish.title,
      now: NOW + 70_000,
    });
    expect(after.kind).toBe("write");
  });

  it("forgets per-session state when forget() is called", () => {
    const registry = createTitleStateRegistry();
    registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.PLANNING,
      summary: "foo",
      currentTitle: null,
      now: NOW,
    });
    expect(registry.size()).toBe(1);
    registry.forget(SESSION);
    expect(registry.size()).toBe(0);
  });

  it("reuses the previous summary when a milestone has none", () => {
    const registry = createTitleStateRegistry();
    const first = registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.PLANNING,
      summary: "auto conversation title",
      currentTitle: null,
      now: NOW,
    });
    if (first.kind !== "write") throw new Error("expected first write");

    const next = registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.EXECUTING,
      summary: null,
      currentTitle: first.title,
      now: NOW + 5_000,
    });
    expect(next.kind).toBe("write");
    if (next.kind === "write") {
      expect(next.title).toBe("执行中: auto conversation title");
    }
  });
});
