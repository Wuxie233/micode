import { describe, expect, it } from "bun:test";

import { createDedupeStore } from "@/notifications/dedupe";
import { createPolicy } from "@/notifications/policy";
import { NOTIFICATION_STATUSES } from "@/notifications/types";

describe("createPolicy", () => {
  const DEDUPE_TTL_MS = 60_000;
  const DEDUPE_MAX_ENTRIES = 100;
  const DEFAULT_QQ_USER_ID = "445714414";
  const GROUP_ID = "123456";

  const baseConfig = {
    enabled: true,
    qqUserId: DEFAULT_QQ_USER_ID,
    qqGroupId: null as string | null,
    maxSummaryChars: 200,
    dedupeTtlMs: DEDUPE_TTL_MS,
    dedupeMaxEntries: DEDUPE_MAX_ENTRIES,
  };

  const createDedupe = () => createDedupeStore({ ttlMs: DEDUPE_TTL_MS, maxEntries: DEDUPE_MAX_ENTRIES });

  it("admits a first-time terminal status", () => {
    const dedupe = createDedupe();
    const policy = createPolicy({ config: baseConfig, dedupe });
    const decision = policy.evaluate({
      status: NOTIFICATION_STATUSES.COMPLETED,
      issueNumber: 16,
    });
    expect(decision.kind).toBe("notify");
    if (decision.kind !== "notify") throw new Error("expected notify decision");
    expect(decision.target).toEqual({ kind: "private", userId: DEFAULT_QQ_USER_ID });
  });

  it("uses the configured QQ group target when present", () => {
    const dedupe = createDedupe();
    const policy = createPolicy({ config: { ...baseConfig, qqGroupId: GROUP_ID }, dedupe });
    expect(policy.buildTarget()).toEqual({ kind: "group", groupId: GROUP_ID });
  });

  it("suppresses a duplicate completed status for the same lifecycle issue", () => {
    const dedupe = createDedupe();
    const policy = createPolicy({ config: baseConfig, dedupe });
    policy.commit({ status: NOTIFICATION_STATUSES.COMPLETED, issueNumber: 16 });
    const decision = policy.evaluate({ status: NOTIFICATION_STATUSES.COMPLETED, issueNumber: 16 });
    expect(decision.kind).toBe("suppress");
  });

  it("permits completed after blocked for the same lifecycle issue", () => {
    const dedupe = createDedupe();
    const policy = createPolicy({ config: baseConfig, dedupe });
    policy.commit({ status: NOTIFICATION_STATUSES.BLOCKED, issueNumber: 16 });
    const decision = policy.evaluate({ status: NOTIFICATION_STATUSES.COMPLETED, issueNumber: 16 });
    expect(decision.kind).toBe("notify");
  });

  it("returns disabled when notifications are turned off in config", () => {
    const dedupe = createDedupe();
    const policy = createPolicy({ config: { ...baseConfig, enabled: false }, dedupe });
    const decision = policy.evaluate({ status: NOTIFICATION_STATUSES.COMPLETED, issueNumber: 16 });
    expect(decision.kind).toBe("disabled");
  });

  it("uses session id as the dedupe key when no issue is provided", () => {
    const dedupe = createDedupe();
    const policy = createPolicy({ config: baseConfig, dedupe });
    policy.commit({ status: NOTIFICATION_STATUSES.COMPLETED, sessionId: "sess-1" });
    const decision = policy.evaluate({ status: NOTIFICATION_STATUSES.COMPLETED, sessionId: "sess-1" });
    expect(decision.kind).toBe("suppress");
  });

  it("falls back to a generic key when neither issue nor session is provided", () => {
    const dedupe = createDedupe();
    const policy = createPolicy({ config: baseConfig, dedupe });
    const decision = policy.evaluate({ status: NOTIFICATION_STATUSES.FAILED_STOP });
    expect(decision.kind).toBe("notify");
    if (decision.kind !== "notify") throw new Error("expected notify decision");
    expect(decision.key).toContain("anonymous");
  });
});
