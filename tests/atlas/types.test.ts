import { describe, expect, it } from "bun:test";

import {
  ATLAS_LAYERS,
  ATLAS_NODE_STATUSES,
  ATLAS_SPAWN_OUTCOMES,
  type AtlasLayer,
  type AtlasNodeStatus,
  type AtlasSpawnOutcome,
} from "@/atlas/types";

describe("atlas types", () => {
  it("declares the five node layers", () => {
    const layers: readonly AtlasLayer[] = Object.values(ATLAS_LAYERS);
    expect(layers).toEqual(["impl", "behavior", "decision", "risk", "timeline"]);
  });

  it("declares node statuses", () => {
    const statuses: readonly AtlasNodeStatus[] = Object.values(ATLAS_NODE_STATUSES);
    expect(statuses).toContain("active");
    expect(statuses).toContain("superseded");
    expect(statuses).toContain("deprecated");
  });

  it("declares spawn outcomes", () => {
    const outcomes: readonly AtlasSpawnOutcome[] = Object.values(ATLAS_SPAWN_OUTCOMES);
    expect(outcomes).toEqual(["pending", "succeeded", "failed"]);
  });
});
