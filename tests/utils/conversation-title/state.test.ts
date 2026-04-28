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
    expect(registry.getTopic(SESSION)).toEqual({ topic: LIFECYCLE_TOPIC, source: TITLE_SOURCE.LIFECYCLE_ISSUE });
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
    expect(registry.getTopic(SESSION)).toEqual({ topic: LIFECYCLE_TOPIC, source: TITLE_SOURCE.LIFECYCLE_ISSUE });
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
    expect(registry.getTopic(SESSION)).toEqual({ topic: LIFECYCLE_TOPIC, source: TITLE_SOURCE.LIFECYCLE_ISSUE });
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
    expect(registry.getTopic(SESSION)).toEqual({ topic: LIFECYCLE_TOPIC, source: TITLE_SOURCE.LIFECYCLE_ISSUE });
  });

  it("returns the current topic without creating missing records", () => {
    const registry = createTitleStateRegistry();

    expect(registry.getTopic(OTHER_SESSION)).toEqual({ topic: null, source: null });
    expect(registry.size()).toBe(0);

    writtenTitle(
      decide(registry, {
        summary: PLAN_TOPIC,
        source: TITLE_SOURCE.PLAN_PATH,
      }),
    );
    expect(registry.getTopic(SESSION)).toEqual({ topic: PLAN_TOPIC, source: TITLE_SOURCE.PLAN_PATH });

    registry.forget(SESSION);
    expect(registry.getTopic(SESSION)).toEqual({ topic: null, source: null });
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
    expect(registry.getTopic(SESSION)).toEqual({ topic: LIFECYCLE_TOPIC, source: TITLE_SOURCE.LIFECYCLE_ISSUE });
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
    expect(registry.getTopic(SESSION)).toEqual({ topic: NEXT_LIFECYCLE_TOPIC, source: TITLE_SOURCE.LIFECYCLE_ISSUE });
  });

  it("opts out of further writes when the user manually edits the title", () => {
    const registry = createTitleStateRegistry();
    const title = writtenTitle(decide(registry));

    const userEdited = decide(registry, {
      status: TITLE_STATUS.EXECUTING,
      summary: USER_TOPIC,
      source: TITLE_SOURCE.USER_MESSAGE,
      currentTitle: MANUAL_TITLE,
      now: NEXT_NOW,
    });
    expect(skippedReason(userEdited)).toBe("opted-out");
    expect(registry.isOptedOut(SESSION)).toBe(true);

    const later = decide(registry, {
      status: TITLE_STATUS.EXECUTING,
      summary: PLAN_TOPIC,
      source: TITLE_SOURCE.PLAN_PATH,
      currentTitle: title,
      now: THAWED_NOW,
    });
    expect(skippedReason(later)).toBe("opted-out");
  });
});
