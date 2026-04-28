import { describe, expect, it } from "bun:test";
import * as v from "valibot";

import { EntityKindValues, EntrySchema, EntryTypeValues, RelationKindValues } from "@/project-memory/types";

describe("project-memory types", () => {
  it("declares the entity kind vocabulary", () => {
    expect(EntityKindValues).toContain("workflow");
    expect(EntityKindValues).toContain("module");
    expect(EntityKindValues).toContain("decision_area");
  });

  it("declares the entry type vocabulary", () => {
    expect(EntryTypeValues).toEqual([
      "fact",
      "decision",
      "rationale",
      "lesson",
      "risk",
      "todo",
      "open_question",
      "hypothesis",
      "note",
    ]);
  });

  it("declares the relation kinds vocabulary", () => {
    expect(RelationKindValues).toEqual(["parent", "related", "supersedes"]);
  });

  it("rejects entries with unknown sensitivity", () => {
    const result = v.safeParse(EntrySchema, {
      id: "e_1",
      projectId: "abc",
      entityId: "ent_1",
      type: "decision",
      title: "x",
      summary: "y",
      status: "active",
      sensitivity: "ultra-public",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed entry", () => {
    const result = v.safeParse(EntrySchema, {
      id: "e_1",
      projectId: "abc",
      entityId: "ent_1",
      type: "decision",
      title: "x",
      summary: "y",
      status: "active",
      sensitivity: "internal",
      createdAt: 1,
      updatedAt: 1,
    });
    expect(result.success).toBe(true);
  });
});
