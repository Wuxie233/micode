import { describe, expect, it } from "bun:test";

import { reconcileWorkerOutput } from "@/atlas/reconciler";

describe("reconcileWorkerOutput", () => {
  it("merges agreed claims and surfaces disagreements as conflicts", () => {
    const result = reconcileWorkerOutput([
      { worker: "build", claims: [{ target: "10-impl/a.md", claim: "spawns workers" }] },
      { worker: "behavior", claims: [{ target: "10-impl/a.md", claim: "spawns workers" }] },
      { worker: "build", claims: [{ target: "10-impl/a.md", claim: "uses queue" }] },
    ]);

    expect(result.agreed).toContainEqual({
      target: "10-impl/a.md",
      claim: "spawns workers",
      workers: ["build", "behavior"],
    });
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({
        target: "10-impl/a.md",
        proposedChange: expect.stringContaining("uses queue"),
      }),
    );
  });

  it("returns empty arrays when no claims", () => {
    const result = reconcileWorkerOutput([]);

    expect(result.agreed).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });
});
