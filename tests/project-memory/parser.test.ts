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

  it("emits procedure candidates from a Procedure section", () => {
    const md = `## Procedure\n- Run /mindmodel before changing project patterns\n`;
    const r = extractCandidates({
      markdown: md,
      defaultEntityName: "skill-evolution",
      sourceKind: "skill",
      pointer: "x",
    });
    expect(r.candidates[0].entryType).toBe("procedure");
    expect(r.candidates[0].sourceKind).toBe("skill");
    expect(r.candidates[0].summary).toBe("Run /mindmodel before changing project patterns");
  });

  it("creates one procedure candidate per bullet", () => {
    const md = `## Procedure\n- Draft the skill procedure\n- Store it as project memory\n`;
    const r = extractCandidates({
      markdown: md,
      defaultEntityName: "skill-evolution",
      sourceKind: "manual",
      pointer: "x",
    });
    expect(r.candidates.map(({ entryType, summary }) => ({ entryType, summary }))).toEqual([
      { entryType: "procedure", summary: "Draft the skill procedure" },
      { entryType: "procedure", summary: "Store it as project memory" },
    ]);
  });

  it("recognizes plural Procedures headings", () => {
    const md = `## Procedures\n- Promote accepted workflows into memory\n`;
    const r = extractCandidates({
      markdown: md,
      defaultEntityName: "skill-evolution",
      sourceKind: "manual",
      pointer: "x",
    });
    expect(r.candidates[0].entryType).toBe("procedure");
    expect(r.candidates[0].summary).toBe("Promote accepted workflows into memory");
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

  it("emits a meaningful note from a lifecycle Request section when no structured section is present", () => {
    const md = [
      "## Request",
      "",
      "Improve project memory promotion quality so issue bodies become useful entries.",
      "",
      "## Goals",
      "",
      "- Parse lifecycle sections deterministically",
      "- Avoid collapsing the body into a single ## Request note",
      "",
      "## Constraints",
      "",
      "- Keep promotion best-effort and non-blocking",
    ].join("\n");
    const r = extractCandidates({
      markdown: md,
      defaultEntityName: "issue-15",
      sourceKind: "lifecycle",
      pointer: "issue/15",
    });

    const types = r.candidates.map((c) => c.entryType);
    const titles = r.candidates.map((c) => c.title);
    const summaries = r.candidates.map((c) => c.summary);

    expect(types).toEqual(["note", "note", "note", "note"]);
    expect(titles[0]).toBe("Improve project memory promotion quality so issue bodies become useful entries.");
    expect(summaries[0]).toBe("Improve project memory promotion quality so issue bodies become useful entries.");
    expect(summaries.slice(1, 3)).toEqual([
      "Parse lifecycle sections deterministically",
      "Avoid collapsing the body into a single ## Request note",
    ]);
    expect(summaries.slice(3)).toEqual(["Keep promotion best-effort and non-blocking"]);
    expect(titles.every((t) => !t.startsWith("##"))).toBe(true);
  });

  it("prefers explicit Decisions over lifecycle Request fallback", () => {
    const md = [
      "## Request",
      "Free-form request body that should be ignored when decisions exist.",
      "",
      "## Decisions",
      "- Persist promoted memory in SQLite",
      "",
      "## Goals",
      "- Should also be ignored",
    ].join("\n");
    const r = extractCandidates({
      markdown: md,
      defaultEntityName: "issue-15",
      sourceKind: "lifecycle",
      pointer: "issue/15",
    });

    expect(r.candidates.length).toBe(1);
    expect(r.candidates[0].entryType).toBe("decision");
    expect(r.candidates[0].summary).toBe("Persist promoted memory in SQLite");
  });

  it("ignores empty lifecycle sections", () => {
    const md = ["## Request", "", "## Goals", "", "## Constraints", ""].join("\n");
    const r = extractCandidates({
      markdown: md,
      defaultEntityName: "issue-15",
      sourceKind: "lifecycle",
      pointer: "issue/15",
    });

    expect(r.candidates).toEqual([]);
  });

  it("derives a fallback title from the first meaningful line, not the markdown heading", () => {
    const md = ["# Heading", "", "Real first sentence describing the change.", "", "More detail."].join("\n");
    const r = extractCandidates({
      markdown: md,
      defaultEntityName: "memory",
      sourceKind: "manual",
      pointer: "manual://x",
    });

    expect(r.candidates.length).toBe(1);
    expect(r.candidates[0].entryType).toBe("note");
    expect(r.candidates[0].title).toBe("Real first sentence describing the change.");
    expect(r.candidates[0].title.startsWith("#")).toBe(false);
  });

  it("falls back to the heading text only when no other meaningful content exists", () => {
    const md = "## Request";
    const r = extractCandidates({
      markdown: md,
      defaultEntityName: "issue-15",
      sourceKind: "lifecycle",
      pointer: "issue/15",
    });

    expect(r.candidates).toEqual([]);
  });

  it("treats a lifecycle Request body that spans multiple lines as a single note titled by the first line", () => {
    const md = [
      "## Request",
      "",
      "First sentence summary.",
      "",
      "Second paragraph with extra context that should appear in the summary.",
      "",
    ].join("\n");
    const r = extractCandidates({
      markdown: md,
      defaultEntityName: "issue-15",
      sourceKind: "lifecycle",
      pointer: "issue/15",
    });

    expect(r.candidates.length).toBe(1);
    expect(r.candidates[0].entryType).toBe("note");
    expect(r.candidates[0].title).toBe("First sentence summary.");
    expect(r.candidates[0].summary).toContain("First sentence summary.");
    expect(r.candidates[0].summary).toContain("Second paragraph with extra context");
  });
});
