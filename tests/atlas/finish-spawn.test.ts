import { describe, expect, it } from "bun:test";
import { buildHandoffFromLifecycle, buildSpawnReceipt, shouldSpawnAgent2 } from "@/atlas/finish-spawn";
import { ATLAS_SPAWN_OUTCOMES } from "@/atlas/types";

describe("finish-spawn helpers", () => {
  it("skips spawn when quickMode true", () => {
    expect(shouldSpawnAgent2({ quickMode: true, terminal: true })).toBe(false);
  });

  it("skips spawn when not terminal", () => {
    expect(shouldSpawnAgent2({ quickMode: false, terminal: false })).toBe(false);
  });

  it("spawns when terminal and not quick", () => {
    expect(shouldSpawnAgent2({ quickMode: false, terminal: true })).toBe(true);
  });

  it("builds a handoff package from lifecycle inputs", () => {
    const handoff = buildHandoffFromLifecycle({
      issueNumber: 26,
      affectedModules: ["lifecycle"],
      affectedFeatures: ["atlas"],
      designPointer: "thoughts:shared/designs/x.md",
      planPointer: null,
      ledgerPointer: null,
      decisions: ["d1"],
      crossLayerEffects: ["e1"],
      doNotTouch: [],
    });
    expect(handoff.lifecycleIssue).toBe(26);
    expect(handoff.affectedModules).toEqual(["lifecycle"]);
  });

  it("builds a pending spawn receipt", () => {
    const receipt = buildSpawnReceipt({
      runId: "agent2-26-100",
      sessionId: "s",
      spawnAt: "2026-05-04T00:00:00.000Z",
      expectedCompletionWindowSec: 600,
    });
    expect(receipt.outcome).toBe(ATLAS_SPAWN_OUTCOMES.PENDING);
    expect(receipt.doneAt).toBe(null);
  });
});
