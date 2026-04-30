---
date: 2026-04-30
topic: "Project Memory Promotion Quality"
issue: 15
scope: project-memory
contract: none
---

# Project Memory Promotion Quality Implementation Plan

**Goal:** Make the project-memory promotion parser lifecycle-aware so issue-body fallbacks produce meaningful note entries instead of one collapsed `## Request` blob, and harden cleanup-related regressions.

**Architecture:** Limit changes to `src/project-memory/parser.ts` and its tests, plus an additional integration test on the lifecycle promote-on-finish path. The storage layer, secret rejection, and `promoteMarkdown` orchestration stay unchanged. The parser gains a lifecycle-section pass that runs after the structured-section pass when the structured pass produced zero candidates, mapping `## Request` to one note titled from the request text and `## Goals` / `## Constraints` bullets to one note per bullet. Fallback titles are derived from the first meaningful content line, never from a markdown heading marker.

**Design:** [thoughts/shared/designs/2026-04-30-project-memory-promotion-quality-design.md](../designs/2026-04-30-project-memory-promotion-quality-design.md)

**Contract:** none (single-domain change, all tasks are `general` / backend tooling).

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2 [foundation - failing tests, no deps]
Batch 2 (sequential within batch / parallel across plan): 2.1 [parser implementation - depends on 1.1]
Batch 3 (parallel): 3.1 [lifecycle integration test - depends on 2.1]
```

Rationale for batching:

- 1.1 and 1.2 are failing-test-first TDD specs that touch different test files; they have no code dependencies on each other and run in parallel.
- 2.1 implements the parser change that makes 1.1 pass; it must wait for 1.1 to land so the executor can verify-fail-then-pass.
- 3.1 exercises the lifecycle promote-on-finish wiring with a realistic issue body and depends on the parser change in 2.1.

---

## Batch 1: Foundation (parallel - 2 implementers)

All tasks in this batch have NO dependencies and run simultaneously. Both produce failing tests that pin down behavior before the parser is touched.
Tasks: 1.1, 1.2

### Task 1.1: Add lifecycle-aware parser test cases
**File:** `tests/project-memory/parser.test.ts`
**Test:** `tests/project-memory/parser.test.ts` (this task IS the test file)
**Depends:** none
**Domain:** general

Append the following test cases to the existing `describe("extractCandidates", ...)` block in `tests/project-memory/parser.test.ts`. Do NOT modify or delete the existing eight tests; they encode behavior that must still hold. Place the new tests after the final `it("slices fallback note summaries to 1000 characters", ...)` test, inside the same `describe` block (insert before the closing `});` on the last line).

```typescript
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

    expect(types).toEqual(["note", "note", "note", "note", "note"]);
    expect(titles[0]).toBe("Improve project memory promotion quality so issue bodies become useful entries.");
    expect(summaries[0]).toBe("Improve project memory promotion quality so issue bodies become useful entries.");
    expect(summaries.slice(1, 3)).toEqual([
      "Parse lifecycle sections deterministically",
      "Avoid collapsing the body into a single ## Request note",
    ]);
    expect(summaries.slice(3)).toEqual([
      "Keep promotion best-effort and non-blocking",
    ]);
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
    const md = [
      "## Request",
      "",
      "## Goals",
      "",
      "## Constraints",
      "",
    ].join("\n");
    const r = extractCandidates({
      markdown: md,
      defaultEntityName: "issue-15",
      sourceKind: "lifecycle",
      pointer: "issue/15",
    });

    expect(r.candidates).toEqual([]);
  });

  it("derives a fallback title from the first meaningful line, not the markdown heading", () => {
    const md = [
      "# Heading",
      "",
      "Real first sentence describing the change.",
      "",
      "More detail.",
    ].join("\n");
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
```

**Verify:** `bun test tests/project-memory/parser.test.ts` — the six new tests MUST fail (parser not yet updated). Existing eight tests MUST still pass. If any existing test fails, you have edited the wrong region; revert and reapply.

**Commit:** `test(project-memory): pin lifecycle-aware parser behavior`

---

### Task 1.2: Add post-forget health regression test
**File:** `tests/project-memory/health.test.ts`
**Test:** `tests/project-memory/health.test.ts` (this task IS the test file)
**Depends:** none
**Domain:** general

Add ONE new test to `tests/project-memory/health.test.ts` that proves entity-level forget leaves the project with zero `missingSourceCount`. This pins the smoke-test cleanup invariant from the design's "Manual cleanup" data flow.

First read the file to learn its existing imports and helpers:

```bash
# implementer: Read tests/project-memory/health.test.ts in full first.
# Reuse its existing identity, store factory, and seed helpers; do NOT duplicate them.
```

Append this test inside the existing `describe(...)` block, after the last existing test, before the closing `});`:

```typescript
  it("returns zero missing sources after entity-level forget removes orphaned entries", async () => {
    const store = createStore();
    await store.initialize();

    // Seed: one entity with one entry that has NO source pointer (a smoke-test leftover shape).
    const orphanedEntity = entity({ id: "ent_orphan", name: "smoke" });
    const orphanedEntry = entry({
      id: "entry_orphan",
      entityId: orphanedEntity.id,
      title: "Smoke leftover",
      summary: "leftover from a manual smoke test",
    });
    await store.upsertEntity(orphanedEntity);
    await store.upsertEntry(orphanedEntry);

    const before = await reportHealth({ store, identity });
    expect(before.missingSourceCount).toBeGreaterThan(0);

    await forget({ store, identity, target: { kind: "entity", entityId: orphanedEntity.id } });

    const after = await reportHealth({ store, identity });
    expect(after.missingSourceCount).toBe(0);
    expect(after.entityCount).toBe(0);
    expect(after.entryCount).toBe(0);
  });
```

If `reportHealth`, `forget`, `entity`, `entry`, or `createStore` are not already imported / defined in this file, add the minimum imports needed at the top, mirroring `tests/project-memory/forget.test.ts` exactly:

```typescript
import { forget } from "@/project-memory/forget";
import { reportHealth } from "@/project-memory/health";
```

Reuse the file's existing test fixtures (`identity`, `createStore`, `entity`, `entry`). If they don't exist in `health.test.ts`, copy the helper definitions from `tests/project-memory/forget.test.ts` (lines 29-94 in the current file) into the top of `health.test.ts` so this test is self-contained. Do NOT alter any existing test in `health.test.ts`.

**Verify:** `bun test tests/project-memory/health.test.ts` — the new test MUST pass on the current code (this is a regression guard, not a TDD spec; entity forget already works per the design's existing-behavior note). All other tests in the file MUST still pass. If the new test fails, the bug is real and Task 2.1 should also fix `forget.ts` to cascade source removal correctly. Document any such finding in the commit body.

**Commit:** `test(project-memory): pin zero missing-sources invariant after entity forget`

---

## Batch 2: Core Modules (parallel - 1 implementer)

This batch implements the parser change. It depends on Task 1.1 landing so the implementer can verify the new tests fail, then implement, then verify they pass.
Tasks: 2.1

### Task 2.1: Implement lifecycle-aware parser
**File:** `src/project-memory/parser.ts`
**Test:** `tests/project-memory/parser.test.ts` (already updated in Task 1.1)
**Depends:** 1.1
**Domain:** general

Rewrite `src/project-memory/parser.ts` to add a lifecycle-section fallback pass and a content-aware title derivation. Keep the public API (`PromotionInput`, `PromotionCandidate`, `PromotionExtraction`, `extractCandidates`) byte-identical: same export names, same shapes. Existing tests in `tests/project-memory/parser.test.ts` MUST continue to pass unchanged.

Algorithm:

1. Run the existing structured-section pass over `## Decisions` / `## Risks` / `## Lessons` / `## Open Questions` (and their aliases). If it produces ≥ 1 candidate, return them and STOP. (Unchanged behavior — this preserves existing tests.)
2. Otherwise run a new **lifecycle-section pass** over `## Request`, `## Goals`, and `## Constraints` headers. For each header found:
   - `## Request`: trim the section body. If non-empty, emit ONE `note` candidate whose `summary` is the full trimmed body (capped at `NOTE_SUMMARY_MAX_CHARS`) and whose `title` is the first non-empty trimmed line of that body, capped at `TITLE_MAX_CHARS`.
   - `## Goals`: extract bullets via the existing `extractBullets` helper. Emit ONE `note` candidate per bullet, exactly like the structured pass does.
   - `## Constraints`: same as `## Goals`.
   - Empty sections (no body, no bullets) emit zero candidates. Order: Request first, then Goals (in document order within the section), then Constraints.
3. If the lifecycle pass produced ≥ 1 candidate, return them and STOP.
4. Otherwise fall back to the existing single-`note` whole-document behavior, but with an improved title: derive the title from the first non-empty content line that is NOT a markdown heading line (line starting with `#`). If every non-empty line is a heading line, return zero candidates instead of producing a useless `## Request`-titled note.

Implementation guidance (mind the project rules: no nested ternaries, ≤ 40 LOC per function, ≤ 10 cognitive complexity, no `any`, named constants, no comments explaining what):

```typescript
import type { EntryType, SourceKind } from "./types";

const SECTION_PATTERNS: ReadonlyArray<{ readonly entryType: EntryType; readonly headers: readonly RegExp[] }> = [
  { entryType: "decision", headers: [/^##\s+Decisions?\b/im, /^##\s+Key Decisions\b/im] },
  { entryType: "risk", headers: [/^##\s+Risks?\b/im] },
  { entryType: "lesson", headers: [/^##\s+Lessons?(?:\s+Learned)?\b/im] },
  { entryType: "open_question", headers: [/^##\s+Open Questions?\b/im, /^##\s+Follow-?ups?\b/im] },
];

const LIFECYCLE_REQUEST_HEADER = /^##\s+Request\b/im;
const LIFECYCLE_GOALS_HEADER = /^##\s+Goals?\b/im;
const LIFECYCLE_CONSTRAINTS_HEADER = /^##\s+Constraints?\b/im;
const LIFECYCLE_BULLET_HEADERS: readonly RegExp[] = [LIFECYCLE_GOALS_HEADER, LIFECYCLE_CONSTRAINTS_HEADER];

const BULLET_PATTERN = /^\s*[-*+]\s+(.+?)\s*$/gm;
const NEXT_SECTION_PATTERN = /^##\s+/m;
const HEADING_LINE_PATTERN = /^#+\s/;
const TITLE_MAX_CHARS = 96;
const NOTE_SUMMARY_MAX_CHARS = 1000;
const ELLIPSIS = "…";

export interface PromotionInput {
  readonly markdown: string;
  readonly defaultEntityName: string;
  readonly sourceKind: SourceKind;
  readonly pointer: string;
}

export interface PromotionCandidate {
  readonly entityName: string;
  readonly entryType: EntryType;
  readonly title: string;
  readonly summary: string;
  readonly sourceKind: SourceKind;
  readonly pointer: string;
}

export interface PromotionExtraction {
  readonly candidates: readonly PromotionCandidate[];
}

function capTitle(text: string): string {
  if (text.length <= TITLE_MAX_CHARS) return text;
  return `${text.slice(0, TITLE_MAX_CHARS - 1)}${ELLIPSIS}`;
}

function firstMeaningfulLine(text: string): string {
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (line.length === 0) continue;
    if (HEADING_LINE_PATTERN.test(line)) continue;
    return line;
  }
  return "";
}

function deriveTitleFromSummary(summary: string): string {
  const candidate = firstMeaningfulLine(summary);
  if (candidate.length > 0) return capTitle(candidate);
  return capTitle(summary.split("\n", 1)[0]?.trim() ?? "");
}

function extractSection(markdown: string, headerPattern: RegExp): string | null {
  const match = headerPattern.exec(markdown);
  if (!match) return null;

  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = NEXT_SECTION_PATTERN.exec(rest);
  return next ? rest.slice(0, next.index).trim() : rest.trim();
}

function extractBullets(section: string): readonly string[] {
  const bullets: string[] = [];
  const pattern = new RegExp(BULLET_PATTERN.source, BULLET_PATTERN.flags);
  let match = pattern.exec(section);

  while (match !== null) {
    bullets.push(match[1].trim());
    match = pattern.exec(section);
  }

  return bullets;
}

function createCandidate(input: PromotionInput, entryType: EntryType, summary: string): PromotionCandidate {
  return {
    entityName: input.defaultEntityName,
    entryType,
    title: deriveTitleFromSummary(summary),
    summary,
    sourceKind: input.sourceKind,
    pointer: input.pointer,
  };
}

function extractStructuredCandidates(input: PromotionInput): readonly PromotionCandidate[] {
  return SECTION_PATTERNS.flatMap(({ entryType, headers }) =>
    headers.flatMap((header) => {
      const section = extractSection(input.markdown, header);
      if (!section) return [];
      return extractBullets(section).map((summary) => createCandidate(input, entryType, summary));
    }),
  );
}

function extractRequestNote(input: PromotionInput): PromotionCandidate | null {
  const section = extractSection(input.markdown, LIFECYCLE_REQUEST_HEADER);
  if (!section) return null;
  const summary = section.slice(0, NOTE_SUMMARY_MAX_CHARS);
  if (summary.length === 0) return null;
  return createCandidate(input, "note", summary);
}

function extractBulletNotes(input: PromotionInput, header: RegExp): readonly PromotionCandidate[] {
  const section = extractSection(input.markdown, header);
  if (!section) return [];
  return extractBullets(section).map((summary) => createCandidate(input, "note", summary));
}

function extractLifecycleCandidates(input: PromotionInput): readonly PromotionCandidate[] {
  const requestNote = extractRequestNote(input);
  const bulletNotes = LIFECYCLE_BULLET_HEADERS.flatMap((header) => extractBulletNotes(input, header));
  return requestNote ? [requestNote, ...bulletNotes] : bulletNotes;
}

function extractFallbackCandidate(input: PromotionInput): PromotionCandidate | null {
  const trimmed = input.markdown.trim();
  if (trimmed.length === 0) return null;
  const meaningful = firstMeaningfulLine(trimmed);
  if (meaningful.length === 0) return null;
  const summary = trimmed.slice(0, NOTE_SUMMARY_MAX_CHARS);
  return createCandidate(input, "note", summary);
}

export function extractCandidates(input: PromotionInput): PromotionExtraction {
  const structured = extractStructuredCandidates(input);
  if (structured.length > 0) return { candidates: structured };

  const lifecycle = extractLifecycleCandidates(input);
  if (lifecycle.length > 0) return { candidates: lifecycle };

  const fallback = extractFallbackCandidate(input);
  return { candidates: fallback === null ? [] : [fallback] };
}
```

Notes for the implementer:

- The order of operations (structured → lifecycle → generic fallback) is what makes the change non-breaking. Do not invert it.
- `firstMeaningfulLine` is the unified title-derivation helper. The old `deriveTitle` (which used `summary.split("\n", 1)[0]`) is replaced by `deriveTitleFromSummary`, which prefers a non-heading line. The fallback path on the last line of `deriveTitleFromSummary` matches the OLD behavior for the bullet case where `summary` is already a single line, so existing tests like the 96-char cap still pass.
- `extractFallbackCandidate` now returns `null` when the document has zero non-heading content. This is consistent with the design's "Empty sections produce no candidates" rule and matches the new test "falls back to the heading text only when no other meaningful content exists".
- All function bodies stay under 40 LOC. `extractCandidates` body is 4 lines of logic. No nested ternaries. No `any`.
- Existing call sites import `extractCandidates`, `PromotionCandidate`, `PromotionInput`, `PromotionExtraction` — all preserved.

**Verify:**

```bash
bun test tests/project-memory/parser.test.ts
bun run typecheck
bun run check
```

The full `tests/project-memory/parser.test.ts` suite (existing 8 + new 6 from Task 1.1) MUST pass. `bun run check` MUST stay green.

**Commit:** `feat(project-memory): make promotion parser lifecycle-aware with meaningful titles`

---

## Batch 3: Integration (parallel - 1 implementer)

All tasks in this batch depend on Batch 2 completing.
Tasks: 3.1

### Task 3.1: Add lifecycle promote-on-finish issue-body fallback test
**File:** `tests/lifecycle/promote-on-finish.test.ts`
**Test:** `tests/lifecycle/promote-on-finish.test.ts` (this task IS the test file)
**Depends:** 2.1
**Domain:** general

Extend the existing `tests/lifecycle/promote-on-finish.test.ts` with one new test that proves: when there is NO ledger artifact, the lifecycle finisher promotes the issue body, the parser maps `## Request` / `## Goals` / `## Constraints` to meaningful note entries, and none of the resulting entry titles are raw markdown headings like `## Request`.

First read the full existing file (212 lines) to understand the `FakeRunner`, `createRepoView`, store wiring, and how the existing "ledger wins over issue body" test is structured. Reuse those helpers verbatim.

Add this test inside the existing `describe("promoteFinishedRecord", ...)` (or whatever the top-level describe block is — read first), placed AFTER the existing ledger-wins test:

```typescript
  it("promotes lifecycle issue body sections as meaningful notes when no ledger exists", async () => {
    const issueBody = [
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

    const runner = createRunner({ issueBody });
    // Set up a lifecycle record with NO ledger artifact so the finisher falls back to the issue body.
    const dir = mkdtempSync(join(tmpdir(), PREFIX));
    try {
      const store = createProjectMemoryStore({ dbDir: dir });
      await store.initialize();
      setProjectMemoryStoreForTest(store);

      // ... reuse the existing test's lifecycle setup helpers (handle creation, finish call) ...
      // The implementer MUST mirror the structure of the existing ledger-wins test, swapping
      //   - artifact: omit the LEDGER artifact entirely (or pass an empty list)
      //   - issueBody: pass the multi-section body above
      //   - assert: query the store and confirm:
      //       * accepted entries length === 4 (1 Request + 2 Goals + 1 Constraint)
      //       * every accepted entry has entryType === "note"
      //       * no accepted entry title starts with "##" or "#"
      //       * the first entry's title === "Improve project memory promotion quality so issue bodies become useful entries."

      const identity = await resolveProjectId(process.cwd());
      const entries = await store.searchEntries(identity.projectId, "lifecycle sections", { limit: 20 });
      expect(entries.length).toBeGreaterThanOrEqual(1);
      const titles = entries.map((hit) => hit.entry.title);
      expect(titles.every((t) => !t.startsWith("#"))).toBe(true);

      await store.close();
      resetProjectMemoryRuntimeForTest();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
```

The above is a sketch — the exact wiring (how to invoke the finisher, how to inject `issueBody` into the `FakeRunner` so `gh issue view --json body` returns it, how to set a record with no ledger) is dictated by the existing test in the same file. The implementer MUST read the existing test top-to-bottom and copy its skeleton, only changing:

1. The `RunnerOptions.issueBody` value (use `issueBody` from above).
2. The lifecycle record's artifacts: do NOT include `ARTIFACT_KINDS.LEDGER` (force ledger-fallback into issue-body path).
3. The post-finish assertions: query the project-memory store and verify the 4 expected note entries with the expected titles, and assert no title starts with `#`.

If the existing test does not cover the no-ledger-artifact case, this test exercises a new code path through `readPromotionMarkdown` → `readIssueBody` → `parseIssueIdentity` → `promoteMarkdown` → updated parser. That is the intent.

**Verify:**

```bash
bun test tests/lifecycle/promote-on-finish.test.ts
bun run check
```

Both MUST be green. Existing tests in this file MUST continue to pass unchanged.

**Commit:** `test(lifecycle): cover issue-body fallback promotion with lifecycle sections`
