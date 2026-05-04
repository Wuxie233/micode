import { describe, expect, it } from "bun:test";
import * as v from "valibot";

import {
  EntityKindValues,
  EntrySchema,
  EntryTypeValues,
  RelationKindValues,
  SourceKindValues,
  SourceSchema,
} from "@/project-memory/types";

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
      "procedure",
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

describe("project-memory types: procedure entry type", () => {
  it("includes 'procedure' in EntryTypeValues", () => {
    expect(EntryTypeValues).toContain("procedure");
  });

  it("accepts a procedure entry through EntrySchema", () => {
    const entry = {
      id: "entry_proc_1",
      projectId: "proj",
      entityId: "ent_proc",
      type: "procedure" as const,
      title: "Promote ledger summaries",
      summary: "Trigger: on lifecycle finish. Steps: 1) list... 2) ...",
      status: "tentative" as const,
      sensitivity: "internal" as const,
      createdAt: 1,
      updatedAt: 1,
    };
    const result = v.safeParse(EntrySchema, entry);
    expect(result.success).toBe(true);
  });

  it("rejects an unknown entry type", () => {
    const entry = {
      id: "entry_x",
      projectId: "proj",
      entityId: "ent",
      type: "skill",
      title: "x",
      summary: "y",
      status: "active",
      sensitivity: "internal",
      createdAt: 1,
      updatedAt: 1,
    };
    const result = v.safeParse(EntrySchema, entry);
    expect(result.success).toBe(false);
  });
});

describe("project-memory types: skill source kind", () => {
  it("includes 'skill' in SourceKindValues", () => {
    expect(SourceKindValues).toContain("skill");
  });

  it("accepts a skill source through SourceSchema", () => {
    const source = {
      id: "src_1",
      projectId: "proj",
      entryId: "entry_1",
      kind: "skill" as const,
      pointer: "skill-candidate://abc123",
      excerpt: "trigger: ...",
      createdAt: 1,
    };
    const result = v.safeParse(SourceSchema, source);
    expect(result.success).toBe(true);
  });
});
