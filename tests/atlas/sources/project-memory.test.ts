import { describe, expect, it } from "bun:test";

import { collectProjectMemorySources } from "@/atlas/sources/project-memory";

const fakeStore = {
  list: async () => [
    { id: "e1", type: "decision", title: "d", body: "body", status: "active" },
    { id: "e2", type: "risk", title: "r", body: "body", status: "active" },
    { id: "e3", type: "open_question", title: "q", body: "body", status: "active" },
    { id: "e4", type: "fact", title: "f", body: "body", status: "active" },
  ],
};

describe("collectProjectMemorySources", () => {
  it("partitions entries by type", async () => {
    const sources = await collectProjectMemorySources(fakeStore);
    expect(sources.decisions.map((entry) => entry.pointer)).toEqual(["pm:e1"]);
    expect(sources.risks.map((entry) => entry.pointer)).toEqual(["pm:e2"]);
    expect(sources.openQuestions.map((entry) => entry.pointer)).toEqual(["pm:e3"]);
  });

  it("returns empty when store yields nothing", async () => {
    const empty = { list: async () => [] };
    const sources = await collectProjectMemorySources(empty);
    expect(sources.decisions).toEqual([]);
    expect(sources.risks).toEqual([]);
    expect(sources.openQuestions).toEqual([]);
  });
});
