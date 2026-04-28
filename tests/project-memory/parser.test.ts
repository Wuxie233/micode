import { describe, expect, it } from "bun:test";

import { extractCandidates } from "@/project-memory/parser";

describe("extractCandidates", () => {
  it("emits decision candidates from a Decisions section", () => {
    const md = `## Decisions\n- Cache TTL set to 30s for permission lookups\n- Use SQLite WAL mode\n`;
    const result = extractCandidates({
      markdown: md,
      defaultEntityName: "auth",
      sourceKind: "lifecycle",
      pointer: "thoughts/lifecycle/123.md",
    });
    expect(result.candidates.length).toBe(2);
    expect(result.candidates[0].entryType).toBe("decision");
  });

  it("stops a recognized section at the next heading", () => {
    const md = `## Decisions\n- Keep lifecycle issue records canonical\n## Notes\n- This note is outside decisions\n`;
    const r = extractCandidates({ markdown: md, defaultEntityName: "memory", sourceKind: "plan", pointer: "x" });
    expect(r.candidates.length).toBe(1);
    expect(r.candidates[0].summary).toBe("Keep lifecycle issue records canonical");
  });

  it("caps candidate titles to 96 characters", () => {
    const longTitle = "a".repeat(120);
    const md = `## Decisions\n- ${longTitle}\n`;
    const r = extractCandidates({ markdown: md, defaultEntityName: "memory", sourceKind: "manual", pointer: "x" });
    expect(r.candidates[0].title.length).toBe(96);
    expect(r.candidates[0].title).toBe(`${"a".repeat(95)}…`);
  });

  it("emits risk candidates from a Risks section", () => {
    const md = `## Risks\n- Cache invalidation race during permission updates\n`;
    const r = extractCandidates({ markdown: md, defaultEntityName: "auth", sourceKind: "lifecycle", pointer: "x" });
    expect(r.candidates[0].entryType).toBe("risk");
  });

  it("emits lessons from a Lessons or Lessons Learned section", () => {
    const md = `## Lessons Learned\n- Promotion must run after merge, not before\n`;
    const r = extractCandidates({
      markdown: md,
      defaultEntityName: "lifecycle",
      sourceKind: "lifecycle",
      pointer: "x",
    });
    expect(r.candidates[0].entryType).toBe("lesson");
  });

  it("emits open questions from Open Questions / Follow-ups", () => {
    const md = `## Follow-ups\n- Decide remote sync format\n`;
    const r = extractCandidates({ markdown: md, defaultEntityName: "memory", sourceKind: "design", pointer: "x" });
    expect(r.candidates[0].entryType).toBe("open_question");
  });

  it("recognizes Key Decisions and Open Questions headings", () => {
    const md = `## Key Decisions\n- Persist promoted memory in SQLite\n## Open Questions\n- Decide import cadence\n`;
    const r = extractCandidates({ markdown: md, defaultEntityName: "memory", sourceKind: "design", pointer: "x" });
    expect(r.candidates.map(({ entryType, summary }) => ({ entryType, summary }))).toEqual([
      { entryType: "decision", summary: "Persist promoted memory in SQLite" },
      { entryType: "open_question", summary: "Decide import cadence" },
    ]);
  });

  it("falls back to a single note candidate when no recognized section is found", () => {
    const md = `Just a free form summary.`;
    const r = extractCandidates({ markdown: md, defaultEntityName: "memory", sourceKind: "manual", pointer: "x" });
    expect(r.candidates.length).toBe(1);
    expect(r.candidates[0].entryType).toBe("note");
  });

  it("slices fallback note summaries to 1000 characters", () => {
    const md = "n".repeat(1200);
    const r = extractCandidates({ markdown: md, defaultEntityName: "memory", sourceKind: "manual", pointer: "x" });
    expect(r.candidates[0].summary.length).toBe(1000);
    expect(r.candidates[0].summary).toBe("n".repeat(1000));
  });
});
