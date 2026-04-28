import { describe, expect, it } from "bun:test";

import type { LeaseRecord } from "@/lifecycle/lease/types";

describe("lease types", () => {
  it("compiles a canonical lease", () => {
    const lease: LeaseRecord = {
      issueNumber: 10,
      owner: "session-abc",
      host: "host-xyz",
      branch: "issue/10-feature",
      worktree: "/tmp/wt",
      acquiredAt: 1_777_000_000_000,
      heartbeatAt: 1_777_000_001_000,
      ttlMs: 600_000,
    };
    expect(lease.owner).toBe("session-abc");
  });
});
