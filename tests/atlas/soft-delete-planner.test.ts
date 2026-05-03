import { describe, expect, it } from "bun:test";

import { planSoftDeletes } from "@/atlas/soft-delete-planner";

describe("planSoftDeletes", () => {
  it("plans archive moves for nodes whose sources all disappeared", () => {
    const plans = planSoftDeletes({
      nodes: [
        { id: "10-impl/old", sources: ["lifecycle:99"] },
        { id: "10-impl/keep", sources: ["lifecycle:1"] },
      ],
      activeSources: new Set(["lifecycle:1"]),
    });
    expect(plans).toEqual([{ id: "10-impl/old", reason: "all sources disappeared" }]);
  });

  it("keeps nodes when at least one source remains", () => {
    const plans = planSoftDeletes({
      nodes: [{ id: "10-impl/keep", sources: ["lifecycle:1", "lifecycle:gone"] }],
      activeSources: new Set(["lifecycle:1"]),
    });
    expect(plans).toEqual([]);
  });

  it("does not plan deletion for nodes with no sources at all", () => {
    const plans = planSoftDeletes({
      nodes: [{ id: "10-impl/orphan", sources: [] }],
      activeSources: new Set(),
    });
    expect(plans).toEqual([]);
  });
});
