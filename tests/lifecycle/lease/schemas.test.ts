import { describe, expect, it } from "bun:test";
import * as v from "valibot";

import { LeaseRecordSchema, parseLeaseRecord } from "@/lifecycle/lease/schemas";

const valid = {
  issueNumber: 10,
  owner: "session-abc",
  host: "host-xyz",
  branch: "issue/10-feature",
  worktree: "/tmp/wt",
  acquiredAt: 1_777_000_000_000,
  heartbeatAt: 1_777_000_001_000,
  ttlMs: 600_000,
};

describe("lease schemas", () => {
  it("accepts a valid lease", () => {
    expect(v.safeParse(LeaseRecordSchema, valid).success).toBe(true);
  });

  it("rejects negative ttl", () => {
    const result = parseLeaseRecord({ ...valid, ttlMs: -1 });
    expect(result.ok).toBe(false);
  });

  it("rejects empty owner", () => {
    const result = parseLeaseRecord({ ...valid, owner: "" });
    expect(result.ok).toBe(false);
  });
});
