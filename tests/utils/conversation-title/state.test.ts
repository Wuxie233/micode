import { describe, expect, it } from "bun:test";

import {
  createTitleStateRegistry,
  type DecisionInput,
  TITLE_STATUS,
  type TitleDecision,
} from "@/utils/conversation-title";
import { TITLE_SOURCE } from "@/utils/conversation-title/source";

const SESSION = "ses_main";
const OTHER_SESSION = "ses_other";
const NOW = 1_700_000_000_000;
const THROTTLED_NOW = NOW + 200;
const NEXT_NOW = NOW + 2_000;
const FROZEN_NOW = NOW + 30_000;
const THAWED_NOW = NOW + 70_000;
const LIFECYCLE_TOPIC = "fix lifecycle pre-flight";
const NEXT_LIFECYCLE_TOPIC = "start follow-up title work";
const USER_TOPIC = "add settings button";
const PLAN_TOPIC = "lifecycle preflight title v2";
const MANUAL_TITLE = "我的对话";
const ISSUE_TOPIC = "优化主会话标题生成";
const RENAMED_ISSUE_TOPIC = "改进主会话标题命名";

type Registry = ReturnType<typeof createTitleStateRegistry>;

const input = (overrides: Partial<DecisionInput> = {}): DecisionInput => ({
  sessionID: SESSION,
  status: TITLE_STATUS.PLANNING,
  summary: LIFECYCLE_TOPIC,
  source: TITLE_SOURCE.LIFECYCLE_ISSUE,
  currentTitle: null,
  now: NOW,
  ...overrides,
});

const decide = (registry: Registry, overrides: Partial<DecisionInput> = {}): TitleDecision => {
  return registry.decide(input(overrides));
};

const writtenTitle = (decision: TitleDecision): string => {
  expect(decision.kind).toBe("write");
  if (decision.kind !== "write") throw new Error("expected write");
  return decision.title;
};

const skippedReason = (decision: TitleDecision): string => {
  expect(decision.kind).toBe("skip");
  if (decision.kind !== "skip") throw new Error("expected skip");
  return decision.reason;
};

describe("title state registry", () => {
  it("uses the first lifecycle issue summary as the topic", () => {
    const registry = createTitleStateRegistry();
    const title = writtenTitle(decide(registry));

    expect(title).toBe(LIFECYCLE_TOPIC);
    expect(registry.getTopic(SESSION)).toEqual({
      topic: LIFECYCLE_TOPIC,
      source: TITLE_SOURCE.LIFECYCLE_ISSUE,
      issueNumber: null,
    });
  });

  it("keeps the topic when a lower-confidence source arrives later", () => {
    const registry = createTitleStateRegistry();
    const title = writtenTitle(decide(registry));

    const next = decide(registry, {
      status: TITLE_STATUS.EXECUTING,
      summary: USER_TOPIC,
      source: TITLE_SOURCE.USER_MESSAGE,
      currentTitle: title,
      now: NEXT_NOW,
    });

    expect(writtenTitle(next)).toBe(LIFECYCLE_TOPIC);
    expect(registry.getTopic(SESSION)).toEqual({
      topic: LIFECYCLE_TOPIC,
      source: TITLE_SOURCE.LIFECYCLE_ISSUE,
      issueNumber: null,
    });
  });

  it("upgrades the topic when a higher-confidence source arrives", () => {
    const registry = createTitleStateRegistry();
    const title = writtenTitle(
      decide(registry, {
        summary: USER_TOPIC,
        source: TITLE_SOURCE.USER_MESSAGE,
      }),
    );

    const upgraded = decide(registry, {
      summary: LIFECYCLE_TOPIC,
      source: TITLE_SOURCE.LIFECYCLE_ISSUE,
      currentTitle: title,
      now: NEXT_NOW,
    });

    expect(writtenTitle(upgraded)).toBe(LIFECYCLE_TOPIC);
    expect(registry.getTopic(SESSION)).toEqual({
      topic: LIFECYCLE_TOPIC,
      source: TITLE_SOURCE.LIFECYCLE_ISSUE,
      issueNumber: null,
    });
  });

  it("keeps the topic when summary is null and appends a conclusive suffix", () => {
    const registry = createTitleStateRegistry();
    const title = writtenTitle(decide(registry));

    const done = decide(registry, {
      status: TITLE_STATUS.DONE,
      summary: null,
      source: TITLE_SOURCE.LIFECYCLE_FINISH,
      currentTitle: title,
      now: NEXT_NOW,
    });

    expect(writtenTitle(done)).toBe(`${LIFECYCLE_TOPIC} · 已完成`);
    expect(registry.getTopic(SESSION)).toEqual({
      topic: LIFECYCLE_TOPIC,
      source: TITLE_SOURCE.LIFECYCLE_ISSUE,
      issueNumber: null,
    });
  });

  it("returns the current topic without creating missing records", () => {
    const registry = createTitleStateRegistry();

    expect(registry.getTopic(OTHER_SESSION)).toEqual({
      topic: null,
      source: null,
      issueNumber: null,
    });
    expect(registry.size()).toBe(0);

    writtenTitle(
      decide(registry, {
        summary: PLAN_TOPIC,
        source: TITLE_SOURCE.PLAN_PATH,
      }),
    );
    expect(registry.getTopic(SESSION)).toEqual({
      topic: PLAN_TOPIC,
      source: TITLE_SOURCE.PLAN_PATH,
      issueNumber: null,
    });

    registry.forget(SESSION);
    expect(registry.getTopic(SESSION)).toEqual({
      topic: null,
      source: null,
      issueNumber: null,
    });
    expect(registry.size()).toBe(0);
  });

  it("throttles a second write of the same title within 1 second", () => {
    const registry = createTitleStateRegistry();
    const title = writtenTitle(decide(registry));

    const second = decide(registry, {
      currentTitle: title,
      now: THROTTLED_NOW,
    });

    expect(skippedReason(second)).toBe("throttled");
  });

  it("freezes conclusive titles for one minute and releases them after expiry", () => {
    const registry = createTitleStateRegistry();
    const finished = writtenTitle(
      decide(registry, {
        status: TITLE_STATUS.DONE,
      }),
    );

    const frozen = decide(registry, {
      status: TITLE_STATUS.EXECUTING,
      summary: PLAN_TOPIC,
      source: TITLE_SOURCE.PLAN_PATH,
      currentTitle: finished,
      now: FROZEN_NOW,
    });
    expect(skippedReason(frozen)).toBe("done-frozen");

    const thawed = decide(registry, {
      status: TITLE_STATUS.EXECUTING,
      summary: PLAN_TOPIC,
      source: TITLE_SOURCE.PLAN_PATH,
      currentTitle: finished,
      now: THAWED_NOW,
    });
    expect(writtenTitle(thawed)).toBe(LIFECYCLE_TOPIC);
  });

  it("does not replace the lifecycle topic with an equal-confidence topic inside the done freeze", () => {
    const registry = createTitleStateRegistry();
    const finished = writtenTitle(
      decide(registry, {
        status: TITLE_STATUS.DONE,
      }),
    );

    const frozen = decide(registry, {
      status: TITLE_STATUS.PLANNING,
      summary: NEXT_LIFECYCLE_TOPIC,
      source: TITLE_SOURCE.LIFECYCLE_ISSUE,
      currentTitle: finished,
      now: FROZEN_NOW,
    });

    expect(skippedReason(frozen)).toBe("done-frozen");
    expect(registry.getTopic(SESSION)).toEqual({
      topic: LIFECYCLE_TOPIC,
      source: TITLE_SOURCE.LIFECYCLE_ISSUE,
      issueNumber: null,
    });
  });

  it("replaces the lifecycle topic with an equal-confidence topic after the done freeze expires", () => {
    const registry = createTitleStateRegistry();
    const finished = writtenTitle(
      decide(registry, {
        status: TITLE_STATUS.DONE,
      }),
    );

    const thawed = decide(registry, {
      status: TITLE_STATUS.PLANNING,
      summary: NEXT_LIFECYCLE_TOPIC,
      source: TITLE_SOURCE.LIFECYCLE_ISSUE,
      currentTitle: finished,
      now: THAWED_NOW,
    });

    expect(writtenTitle(thawed)).toBe(NEXT_LIFECYCLE_TOPIC);
    expect(registry.getTopic(SESSION)).toEqual({
      topic: NEXT_LIFECYCLE_TOPIC,
      source: TITLE_SOURCE.LIFECYCLE_ISSUE,
      issueNumber: null,
    });
  });

  it("does not opt out when an early host title differs before system title is confirmed", () => {
    const registry = createTitleStateRegistry();
    const HOST_AUTO_TITLE = "New Conversation";

    // First decide: registry writes a system title. lastTitle gets set.
    const first = decide(registry);
    const systemTitle = writtenTitle(first);

    // Before micode ever observes its own title back, an OpenCode automatic
    // initial title shows up as currentTitle. This must NOT be treated as a
    // user opt-out: the system title has not been confirmed yet.
    const earlyMismatch = decide(registry, {
      status: TITLE_STATUS.EXECUTING,
      summary: USER_TOPIC,
      source: TITLE_SOURCE.USER_MESSAGE,
      currentTitle: HOST_AUTO_TITLE,
      now: NEXT_NOW,
    });

    expect(earlyMismatch.kind).toBe("write");
    expect(registry.isOptedOut(SESSION)).toBe(false);
    // Sanity: the previously written systemTitle exists; we just didn't see it
    // yet on the read path.
    expect(systemTitle.length).toBeGreaterThan(0);
  });

  it("opts out when a mismatch happens after the system title has been confirmed", () => {
    const registry = createTitleStateRegistry();
    const first = decide(registry);
    const systemTitle = writtenTitle(first);

    // A later decision observes the previously-written system title back.
    // This confirms that micode's writes are being read back. Throttled is OK;
    // confirmation should still happen.
    const confirmed = decide(registry, {
      currentTitle: systemTitle,
      now: THROTTLED_NOW,
    });
    expect(skippedReason(confirmed)).toBe("throttled");
    expect(registry.isOptedOut(SESSION)).toBe(false);

    // Now a mismatch arrives. Because the system title was confirmed at least
    // once, this is a real user edit and must opt out.
    const userEdit = decide(registry, {
      status: TITLE_STATUS.EXECUTING,
      summary: USER_TOPIC,
      source: TITLE_SOURCE.USER_MESSAGE,
      currentTitle: MANUAL_TITLE,
      now: NEXT_NOW,
    });
    expect(skippedReason(userEdit)).toBe("opted-out");
    expect(registry.isOptedOut(SESSION)).toBe(true);
  });

  it("renders #N status and topic when issueNumber is set", () => {
    const registry = createTitleStateRegistry();

    const title = writtenTitle(
      decide(registry, {
        summary: ISSUE_TOPIC,
        issueNumber: 13,
      }),
    );

    expect(title).toBe("#13 规划中：优化主会话标题生成");
    expect(registry.getTopic(SESSION)).toEqual({
      topic: ISSUE_TOPIC,
      source: TITLE_SOURCE.LIFECYCLE_ISSUE,
      issueNumber: 13,
    });
  });

  it("keeps issueNumber sticky across later null signals", () => {
    const registry = createTitleStateRegistry();
    const title = writtenTitle(
      decide(registry, {
        summary: ISSUE_TOPIC,
        issueNumber: 13,
      }),
    );

    const next = decide(registry, {
      status: TITLE_STATUS.EXECUTING,
      summary: null,
      source: TITLE_SOURCE.COMMIT_TITLE,
      currentTitle: title,
      now: NEXT_NOW,
      issueNumber: null,
    });

    expect(writtenTitle(next)).toBe("#13 执行中：优化主会话标题生成");
    expect(registry.getTopic(SESSION).issueNumber).toBe(13);
  });

  it("keeps issueNumber sticky across later invalid signals", () => {
    const registry = createTitleStateRegistry();
    const title = writtenTitle(
      decide(registry, {
        summary: ISSUE_TOPIC,
        issueNumber: 13,
      }),
    );

    const next = decide(registry, {
      status: TITLE_STATUS.EXECUTING,
      summary: null,
      source: TITLE_SOURCE.COMMIT_TITLE,
      currentTitle: title,
      now: NEXT_NOW,
      issueNumber: 0,
    });

    expect(writtenTitle(next)).toBe("#13 执行中：优化主会话标题生成");
    expect(registry.getTopic(SESSION).issueNumber).toBe(13);
  });

  it("formats DONE with full-width colon under issue prefix", () => {
    const registry = createTitleStateRegistry();
    const title = writtenTitle(
      decide(registry, {
        summary: ISSUE_TOPIC,
        issueNumber: 13,
      }),
    );

    const finished = decide(registry, {
      status: TITLE_STATUS.DONE,
      summary: null,
      source: TITLE_SOURCE.LIFECYCLE_FINISH,
      currentTitle: title,
      now: NEXT_NOW,
      issueNumber: 13,
    });

    expect(writtenTitle(finished)).toBe("#13 已完成：优化主会话标题生成");
  });

  it("renders no-issue title when issueNumber is null and never set", () => {
    const registry = createTitleStateRegistry();

    const title = writtenTitle(
      decide(registry, {
        summary: ISSUE_TOPIC,
        issueNumber: null,
      }),
    );

    expect(title).toBe(ISSUE_TOPIC);
    expect(registry.getTopic(SESSION).issueNumber).toBeNull();
  });

  it("upgrades from no-issue to issue-prefixed once issueNumber arrives", () => {
    const registry = createTitleStateRegistry();
    const title = writtenTitle(
      decide(registry, {
        summary: ISSUE_TOPIC,
        issueNumber: null,
      }),
    );

    const upgraded = decide(registry, {
      summary: null,
      currentTitle: title,
      now: NEXT_NOW,
      issueNumber: 13,
    });

    expect(writtenTitle(upgraded)).toBe("#13 规划中：优化主会话标题生成");
  });

  it("rejects tool-like summary as topic regardless of source confidence", () => {
    const registry = createTitleStateRegistry();
    const title = writtenTitle(
      decide(registry, {
        summary: ISSUE_TOPIC,
        issueNumber: 13,
      }),
    );

    const polluted = decide(registry, {
      status: TITLE_STATUS.EXECUTING,
      summary: "executor",
      source: TITLE_SOURCE.LIFECYCLE_ISSUE,
      currentTitle: title,
      now: NEXT_NOW,
      issueNumber: 13,
    });

    expect(writtenTitle(polluted)).toBe("#13 执行中：优化主会话标题生成");
  });

  it("keeps a real topic when a higher-confidence tool-like summary arrives", () => {
    const registry = createTitleStateRegistry();
    const title = writtenTitle(
      decide(registry, {
        summary: ISSUE_TOPIC,
        source: TITLE_SOURCE.USER_MESSAGE,
        issueNumber: null,
      }),
    );

    const polluted = decide(registry, {
      status: TITLE_STATUS.EXECUTING,
      summary: "implementer-backend",
      source: TITLE_SOURCE.LIFECYCLE_ISSUE,
      currentTitle: title,
      now: NEXT_NOW,
      issueNumber: 13,
    });

    expect(writtenTitle(polluted)).toBe("#13 执行中：优化主会话标题生成");
  });

  it("still replaces a weaker topic with a higher-confidence real topic", () => {
    const registry = createTitleStateRegistry();
    const title = writtenTitle(
      decide(registry, {
        summary: ISSUE_TOPIC,
        source: TITLE_SOURCE.USER_MESSAGE,
        issueNumber: null,
      }),
    );

    const upgraded = decide(registry, {
      summary: RENAMED_ISSUE_TOPIC,
      source: TITLE_SOURCE.LIFECYCLE_ISSUE,
      currentTitle: title,
      now: NEXT_NOW,
      issueNumber: 13,
    });

    expect(writtenTitle(upgraded)).toBe("#13 规划中：改进主会话标题命名");
  });

  it("getTopic returns issueNumber as null when never set", () => {
    const registry = createTitleStateRegistry();

    expect(registry.getTopic("never_seen")).toEqual({
      topic: null,
      source: null,
      issueNumber: null,
    });
  });
});
