import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { addDismissedChallenge } from "@/atlas/challenge-dedup";
import { computeClaimHash } from "@/atlas/claim-hash";
import { ATLAS_CHALLENGE_CAP_PER_RUN } from "@/atlas/config";
import { routeConflicts } from "@/atlas/conflict-router";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-router-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("routeConflicts", () => {
  it("emits a challenge per conflict up to the cap", async () => {
    const conflicts = Array.from({ length: ATLAS_CHALLENGE_CAP_PER_RUN + 5 }, (_, i) => ({
      target: `10-impl/n${i}.md`,
      reason: `reason-${i}`,
      proposedChange: `change-${i}`,
      sources: [],
    }));
    const result = await routeConflicts(projectRoot, "run-1", conflicts);
    expect(result.written.length).toBe(ATLAS_CHALLENGE_CAP_PER_RUN);
    expect(result.deferred.length).toBe(5);
  });

  it("skips dismissed claims", async () => {
    const target = "10-impl/x.md";
    addDismissedChallenge(projectRoot, {
      target,
      claimHash: computeClaimHash(target, "reason"),
      dismissedAt: "2026-01-01",
    });
    const result = await routeConflicts(projectRoot, "run-2", [
      { target, reason: "reason", proposedChange: "p", sources: [] },
    ]);
    expect(result.written).toEqual([]);
    expect(result.skippedDueToDedup).toBe(1);
  });
});
