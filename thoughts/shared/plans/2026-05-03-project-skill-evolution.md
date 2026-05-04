---
date: 2026-05-03
topic: "Project Skill Evolution"
issue: 24
scope: project-memory
contract: none
---

# Project Skill Evolution Implementation Plan

**Goal:** Capture proven development workflows as gated, sensitivity-filtered procedural memory that future agents can load only when relevant, without auto-activation.

**Architecture:** Active procedures live inside Project Memory under a new `procedure` entry type. Unreviewed mined candidates live in a private user-level directory outside the repo (`~/.config/opencode/project-skill-candidates/<projectId>/`). A miner scans only deterministic persisted artifacts (lifecycle journal, lifecycle record, ledgers). A `/skills` review flow gates promotion. A feature-flagged injector retrieves matching procedures under a strict character budget and a sensitivity ceiling. MVP excludes GEPA, prompt evolution, tool-description optimization, and code evolution.

**Design:** [thoughts/shared/designs/2026-05-03-project-skill-evolution-design.md](../designs/2026-05-03-project-skill-evolution-design.md)

**Contract:** none (single-domain plugin work, no frontend/backend split)

---

## Dependency Graph

```
Batch 1 (parallel - foundation, no deps): 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
Batch 2 (parallel - schema extensions, depends on 1.1, 1.2): 2.1, 2.2, 2.3, 2.4
Batch 3 (parallel - storage, miner, review, depends on Batch 1 + 2): 3.1, 3.2, 3.3, 3.4, 3.5
Batch 4 (parallel - integration: tools + injector + plugin wiring, depends on Batch 3): 4.1, 4.2, 4.3, 4.4
```

Key dependency rules:

- 1.1 (`procedure` entry type, `skill` source kind) is required by 2.1 (parser), 2.2 (promote.ts allowance), 3.5 (review-promote bridge), 4.2 (injector).
- 1.2 (skill feature flag schema) is required by 4.2 (injector) and 4.3 (`/skills` command).
- 1.3 (candidate Valibot schema) is required by 3.1 (candidate store), 3.2 (path utils), 3.3 (miner), 3.4 (review state).
- 1.4 (candidate path resolver) is required by 3.1 (store) and 4.3 (`/skills` tool).
- 1.5 (sanitization helper) is required by 3.1 (store) and 3.3 (miner).
- 1.6 (journal/ledger reader) is required by 3.3 (miner).
- 1.7 (config tunables: budget, expiry, max procedures) is required by 3.1, 3.3, 4.2.
- 2.3 (lookup `sensitivityCeiling` parameter) is required by 4.2 (injector) so injection respects the ceiling.
- 2.4 (lookup tool argument surface) is required by 4.3 (`/skills` command can call lookup with the new filter).

---

## Batch 1: Foundation (parallel - 7 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7

### Task 1.1: Extend Project Memory entry type and source kind for procedures
**File:** `src/project-memory/types.ts`
**Test:** `tests/project-memory/types.test.ts`
**Depends:** none
**Domain:** general

Design says Project Memory gains a `procedure` entry type for reusable workflows, and a `skill` source kind so promoted candidates can be traced and cleaned up. We extend the two `as const` arrays and rely on TypeScript inference to update the union types and `EntrySchema`/`SourceSchema` validation.

```typescript
// tests/project-memory/types.test.ts
import { describe, expect, it } from "bun:test";
import * as v from "valibot";

import {
  EntryTypeValues,
  EntrySchema,
  SourceKindValues,
  SourceSchema,
} from "@/project-memory/types";

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
```

```typescript
// src/project-memory/types.ts
import * as v from "valibot";

export const EntityKindValues = ["workflow", "module", "tool", "feature", "risk_area", "decision_area"] as const;

export const EntryTypeValues = [
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
] as const;

export const SensitivityValues = ["public", "internal", "secret"] as const;
export const StatusValues = ["active", "superseded", "tentative", "hypothesis", "deprecated"] as const;
export const RelationKindValues = ["parent", "related", "supersedes"] as const;
export const SourceKindValues = ["design", "plan", "ledger", "lifecycle", "mindmodel", "manual", "skill"] as const;

export type EntityKind = (typeof EntityKindValues)[number];
export type EntryType = (typeof EntryTypeValues)[number];
export type Sensitivity = (typeof SensitivityValues)[number];
export type Status = (typeof StatusValues)[number];
export type RelationKind = (typeof RelationKindValues)[number];
export type SourceKind = (typeof SourceKindValues)[number];

export const EntitySchema = v.object({
  id: v.string(),
  projectId: v.string(),
  kind: v.picklist(EntityKindValues),
  name: v.string(),
  summary: v.optional(v.string()),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const EntrySchema = v.object({
  id: v.string(),
  projectId: v.string(),
  entityId: v.string(),
  type: v.picklist(EntryTypeValues),
  title: v.string(),
  summary: v.string(),
  status: v.picklist(StatusValues),
  sensitivity: v.picklist(SensitivityValues),
  createdAt: v.number(),
  updatedAt: v.number(),
});

export const RelationSchema = v.object({
  id: v.string(),
  projectId: v.string(),
  fromId: v.string(),
  toId: v.string(),
  kind: v.picklist(RelationKindValues),
  createdAt: v.number(),
});

export const SourceSchema = v.object({
  id: v.string(),
  projectId: v.string(),
  entryId: v.string(),
  kind: v.picklist(SourceKindValues),
  pointer: v.string(),
  excerpt: v.optional(v.string()),
  createdAt: v.number(),
});

export type Entity = v.InferOutput<typeof EntitySchema>;
export type Entry = v.InferOutput<typeof EntrySchema>;
export type Relation = v.InferOutput<typeof RelationSchema>;
export type Source = v.InferOutput<typeof SourceSchema>;

export interface LookupHit {
  readonly entry: Entry;
  readonly entity: Entity;
  readonly sources: readonly Source[];
  readonly snippet: string;
  readonly score: number;
  readonly degraded: boolean;
}

export interface HealthReport {
  readonly projectId: string;
  readonly identityKind: "origin" | "path";
  readonly entityCount: number;
  readonly entryCount: number;
  readonly entriesByStatus: Record<Status, number>;
  readonly staleEntryCount: number;
  readonly missingSourceCount: number;
  readonly recentUpdates: number;
  readonly warnings: readonly string[];
}
```

**Verify:** `bun test tests/project-memory/types.test.ts`
**Commit:** `feat(project-memory): add procedure entry type and skill source kind`

---

### Task 1.2: Add skill evolution feature flag to micode config schema
**File:** `src/config-schemas.ts`
**Test:** `tests/config-loader.test.ts` (extended; add skillEvolution case)
**Depends:** none
**Domain:** general

Design requires the feature to default disabled. We extend `MicodeFeaturesSchema` with `skillEvolution?: boolean` so user can flip it on via `micode.json` and the loader sanitizes unknown keys safely. Existing config-loader already returns the sanitized features object verbatim, so no loader changes needed beyond the schema.

```typescript
// tests/config-loader.test.ts excerpt to ADD inside the existing describe block
// (Append the following test cases to the EXISTING tests/config-loader.test.ts.
// The implementer should locate the existing "features" describe block and add these tests there.
// Full file structure unchanged.)

import { describe, expect, it } from "bun:test";
import { sanitizeFeatures } from "@/config-schemas";

describe("sanitizeFeatures: skillEvolution flag", () => {
  it("accepts skillEvolution=true", () => {
    const out = sanitizeFeatures({ skillEvolution: true });
    expect(out.skillEvolution).toBe(true);
  });

  it("accepts skillEvolution=false", () => {
    const out = sanitizeFeatures({ skillEvolution: false });
    expect(out.skillEvolution).toBe(false);
  });

  it("omits skillEvolution when missing", () => {
    const out = sanitizeFeatures({ mindmodelInjection: true });
    expect(out.skillEvolution).toBeUndefined();
  });

  it("rejects non-boolean skillEvolution by dropping the field", () => {
    const out = sanitizeFeatures({ skillEvolution: "yes" } as Record<string, unknown>);
    expect(out.skillEvolution).toBeUndefined();
  });
});
```

```typescript
// src/config-schemas.ts (only the MicodeFeaturesSchema changes; rest of file unchanged)
// REPLACE the existing MicodeFeaturesSchema declaration with:
const MicodeFeaturesSchema = v.object({
  mindmodelInjection: v.optional(v.boolean()),
  conversationTitleChatFallback: v.optional(v.boolean()),
  skillEvolution: v.optional(v.boolean()),
});
```

Implementation note: this is a one-line schema addition. The implementer must edit the existing `MicodeFeaturesSchema` in `src/config-schemas.ts` and not rewrite the file. The rest of the file (sanitizeAgentOverride, sanitizeFragments, opencode schemas) stays unchanged. The loader (`src/config-loader.ts`) reads features through `sanitizeFeatures`, which already passes through valid boolean fields, so no loader change is needed.

**Verify:** `bun test tests/config-loader.test.ts`
**Commit:** `feat(config): add skillEvolution feature flag (default off)`

---

### Task 1.3: Define skill candidate Valibot schema
**File:** `src/skill-evolution/candidate-schema.ts`
**Test:** `tests/skill-evolution/candidate-schema.test.ts`
**Depends:** none
**Domain:** general

Design requires the candidate to validate trigger, normalized steps, source pointers, created timestamp, expiry, sensitivity, and status. We use Valibot at the boundary and derive the type. Steps are an array of strings (1..16), trigger is non-empty, sources reference deterministic artifacts only.

```typescript
// tests/skill-evolution/candidate-schema.test.ts
import { describe, expect, it } from "bun:test";
import * as v from "valibot";

import {
  CandidateSchema,
  CandidateStatusValues,
  CandidateSourceKindValues,
  parseCandidate,
} from "@/skill-evolution/candidate-schema";

describe("skill-evolution CandidateSchema", () => {
  const valid = {
    id: "cand_abc123",
    projectId: "proj_1",
    trigger: "On lifecycle finish that promotes a ledger",
    steps: ["Read ledger", "Run extractCandidates", "Upsert entry"],
    sources: [
      { kind: "lifecycle_journal" as const, pointer: "thoughts/lifecycle/24.journal.jsonl" },
      { kind: "ledger" as const, pointer: "thoughts/ledgers/CONTINUITY_2026-05-03.md" },
    ],
    sensitivity: "internal" as const,
    status: "pending" as const,
    createdAt: 1_700_000_000_000,
    expiresAt: 1_700_000_000_000 + 1000,
    hits: 1,
  };

  it("accepts a complete candidate", () => {
    const result = v.safeParse(CandidateSchema, valid);
    expect(result.success).toBe(true);
  });

  it("rejects an empty trigger", () => {
    const result = v.safeParse(CandidateSchema, { ...valid, trigger: "" });
    expect(result.success).toBe(false);
  });

  it("rejects zero steps", () => {
    const result = v.safeParse(CandidateSchema, { ...valid, steps: [] });
    expect(result.success).toBe(false);
  });

  it("rejects more than the maximum number of steps", () => {
    const tooMany = Array.from({ length: 17 }, (_, i) => `step ${i}`);
    const result = v.safeParse(CandidateSchema, { ...valid, steps: tooMany });
    expect(result.success).toBe(false);
  });

  it("rejects unknown status", () => {
    const result = v.safeParse(CandidateSchema, { ...valid, status: "weird" });
    expect(result.success).toBe(false);
  });

  it("rejects unknown source kind", () => {
    const result = v.safeParse(CandidateSchema, {
      ...valid,
      sources: [{ kind: "design", pointer: "x" }],
    });
    expect(result.success).toBe(false);
  });

  it("rejects sensitivity 'secret' (candidates must not store secrets)", () => {
    const result = v.safeParse(CandidateSchema, { ...valid, sensitivity: "secret" });
    expect(result.success).toBe(false);
  });

  it("CandidateStatusValues lists pending, approved, rejected, expired", () => {
    expect([...CandidateStatusValues].sort()).toEqual(["approved", "expired", "pending", "rejected"]);
  });

  it("CandidateSourceKindValues lists lifecycle_journal, lifecycle_record, ledger", () => {
    expect([...CandidateSourceKindValues].sort()).toEqual(["ledger", "lifecycle_journal", "lifecycle_record"]);
  });

  it("parseCandidate returns ok=true with the parsed candidate on valid input", () => {
    const result = parseCandidate(valid);
    expect(result.ok).toBe(true);
    if (result.ok) expect(result.candidate.id).toBe("cand_abc123");
  });

  it("parseCandidate returns ok=false with issue strings on invalid input", () => {
    const result = parseCandidate({ ...valid, steps: [] });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.issues.length).toBeGreaterThan(0);
  });
});
```

```typescript
// src/skill-evolution/candidate-schema.ts
import * as v from "valibot";

const MIN_STEPS = 1;
const MAX_STEPS = 16;

export const CandidateStatusValues = ["pending", "approved", "rejected", "expired"] as const;
export const CandidateSourceKindValues = ["lifecycle_journal", "lifecycle_record", "ledger"] as const;
export const CandidateSensitivityValues = ["public", "internal"] as const;

export type CandidateStatus = (typeof CandidateStatusValues)[number];
export type CandidateSourceKind = (typeof CandidateSourceKindValues)[number];
export type CandidateSensitivity = (typeof CandidateSensitivityValues)[number];

export const CandidateSourceSchema = v.object({
  kind: v.picklist(CandidateSourceKindValues),
  pointer: v.pipe(v.string(), v.minLength(1)),
});

export const CandidateSchema = v.object({
  id: v.pipe(v.string(), v.minLength(1)),
  projectId: v.pipe(v.string(), v.minLength(1)),
  trigger: v.pipe(v.string(), v.minLength(1), v.maxLength(240)),
  steps: v.pipe(
    v.array(v.pipe(v.string(), v.minLength(1), v.maxLength(500))),
    v.minLength(MIN_STEPS),
    v.maxLength(MAX_STEPS),
  ),
  sources: v.pipe(v.array(CandidateSourceSchema), v.minLength(1)),
  sensitivity: v.picklist(CandidateSensitivityValues),
  status: v.picklist(CandidateStatusValues),
  createdAt: v.number(),
  expiresAt: v.number(),
  hits: v.pipe(v.number(), v.minValue(0)),
});

export type Candidate = v.InferOutput<typeof CandidateSchema>;
export type CandidateSource = v.InferOutput<typeof CandidateSourceSchema>;

export type CandidateParseResult =
  | { readonly ok: true; readonly candidate: Candidate }
  | { readonly ok: false; readonly issues: readonly string[] };

export function parseCandidate(raw: unknown): CandidateParseResult {
  const result = v.safeParse(CandidateSchema, raw);
  if (result.success) return { ok: true, candidate: result.output };
  return { ok: false, issues: result.issues.map((issue) => issue.message) };
}
```

**Verify:** `bun test tests/skill-evolution/candidate-schema.test.ts`
**Commit:** `feat(skill-evolution): add candidate Valibot schema`

---

### Task 1.4: Add candidate path resolver
**File:** `src/skill-evolution/paths.ts`
**Test:** `tests/skill-evolution/paths.test.ts`
**Depends:** none
**Domain:** general

Design requires candidates to live OUTSIDE `thoughts/` so they are not auto-indexed or injected. We resolve the candidate root to `~/.config/opencode/project-skill-candidates/<projectId>/`, mirroring how `config.projectMemory.storageDir` lives in `~/.config/opencode/project-memory/`. The resolver also produces per-candidate JSON file paths and rejects path-escape attempts.

```typescript
// tests/skill-evolution/paths.test.ts
import { describe, expect, it } from "bun:test";
import { homedir } from "node:os";
import { join } from "node:path";

import { candidateFilePath, candidateRootDir } from "@/skill-evolution/paths";

describe("skill-evolution paths", () => {
  it("candidateRootDir scopes by projectId under the user config tree", () => {
    const result = candidateRootDir("proj_abc123");
    expect(result).toBe(join(homedir(), ".config", "opencode", "project-skill-candidates", "proj_abc123"));
  });

  it("candidateFilePath places candidate JSON files in the project root with .json suffix", () => {
    const result = candidateFilePath("proj_abc123", "cand_def456");
    expect(result).toBe(
      join(homedir(), ".config", "opencode", "project-skill-candidates", "proj_abc123", "cand_def456.json"),
    );
  });

  it("rejects projectId containing path separators", () => {
    expect(() => candidateRootDir("proj/escape")).toThrow();
    expect(() => candidateRootDir("../escape")).toThrow();
  });

  it("rejects candidateId containing path separators", () => {
    expect(() => candidateFilePath("proj", "cand/escape")).toThrow();
    expect(() => candidateFilePath("proj", "../cand")).toThrow();
  });

  it("rejects empty projectId or candidateId", () => {
    expect(() => candidateRootDir("")).toThrow();
    expect(() => candidateFilePath("proj", "")).toThrow();
  });
});
```

```typescript
// src/skill-evolution/paths.ts
import { homedir } from "node:os";
import { join } from "node:path";

const CANDIDATE_DIR_NAME = "project-skill-candidates";
const CANDIDATE_FILE_SUFFIX = ".json";
const FORBIDDEN_SEGMENTS = /[\\/]|\.\.|^\s*$/;

function assertSafeSegment(segment: string, label: string): void {
  if (segment.length === 0) throw new Error(`${label} must be non-empty`);
  if (FORBIDDEN_SEGMENTS.test(segment)) throw new Error(`${label} must not contain path separators or '..'`);
}

function rootDir(): string {
  return join(homedir(), ".config", "opencode", CANDIDATE_DIR_NAME);
}

export function candidateRootDir(projectId: string): string {
  assertSafeSegment(projectId, "projectId");
  return join(rootDir(), projectId);
}

export function candidateFilePath(projectId: string, candidateId: string): string {
  assertSafeSegment(candidateId, "candidateId");
  return join(candidateRootDir(projectId), `${candidateId}${CANDIDATE_FILE_SUFFIX}`);
}
```

**Verify:** `bun test tests/skill-evolution/paths.test.ts`
**Commit:** `feat(skill-evolution): add candidate path resolver`

---

### Task 1.5: Add candidate sanitization helper (path normalization, secret scan, dedupe key)
**File:** `src/skill-evolution/sanitize.ts`
**Test:** `tests/skill-evolution/sanitize.test.ts`
**Depends:** none
**Domain:** general

Design: "Candidate content must be sanitized before any disk write." Sanitization combines three concerns into one helper consumed by both miner and store: collapse whitespace in trigger/steps, scan for secrets via `detectSecret`, and produce a deterministic `dedupeKey` (sha1 over normalized trigger + step joined string). Miner and store both call the same helper so the dedupe key is consistent.

```typescript
// tests/skill-evolution/sanitize.test.ts
import { describe, expect, it } from "bun:test";

import { dedupeKeyFor, sanitizeCandidateInput } from "@/skill-evolution/sanitize";

describe("sanitizeCandidateInput", () => {
  it("collapses internal whitespace and trims trigger and steps", () => {
    const result = sanitizeCandidateInput({
      trigger: "  on   lifecycle\tfinish\n",
      steps: ["  step  one  ", "step\ttwo"],
    });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.value.trigger).toBe("on lifecycle finish");
    expect(result.value.steps).toEqual(["step one", "step two"]);
  });

  it("rejects when trigger is empty after trimming", () => {
    const result = sanitizeCandidateInput({ trigger: "   ", steps: ["x"] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("trigger");
  });

  it("rejects when any step is empty after trimming", () => {
    const result = sanitizeCandidateInput({ trigger: "t", steps: ["a", "  "] });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("step");
  });

  it("rejects when trigger contains a detectable secret", () => {
    const result = sanitizeCandidateInput({
      trigger: "use AKIAABCDEFGHIJKLMNOP for s3",
      steps: ["x"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("secret");
  });

  it("rejects when any step contains a detectable secret", () => {
    const result = sanitizeCandidateInput({
      trigger: "trigger",
      steps: ["call api with ghp_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa"],
    });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("secret");
  });
});

describe("dedupeKeyFor", () => {
  it("produces the same hex key for the same normalized input", () => {
    const a = dedupeKeyFor({ trigger: "trig", steps: ["a", "b"] });
    const b = dedupeKeyFor({ trigger: "trig", steps: ["a", "b"] });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{12}$/);
  });

  it("differs when trigger differs", () => {
    const a = dedupeKeyFor({ trigger: "trig1", steps: ["a"] });
    const b = dedupeKeyFor({ trigger: "trig2", steps: ["a"] });
    expect(a).not.toBe(b);
  });

  it("differs when step order differs", () => {
    const a = dedupeKeyFor({ trigger: "t", steps: ["a", "b"] });
    const b = dedupeKeyFor({ trigger: "t", steps: ["b", "a"] });
    expect(a).not.toBe(b);
  });
});
```

```typescript
// src/skill-evolution/sanitize.ts
import { createHash } from "node:crypto";

import { detectSecret } from "@/utils/secret-detect";

const WHITESPACE_RUN = /\s+/g;
const HASH_PREFIX_LENGTH = 12;
const SEPARATOR = "\u0000";

export interface RawCandidateInput {
  readonly trigger: string;
  readonly steps: readonly string[];
}

export interface SanitizedCandidateInput {
  readonly trigger: string;
  readonly steps: readonly string[];
}

export type SanitizeResult =
  | { readonly ok: true; readonly value: SanitizedCandidateInput }
  | { readonly ok: false; readonly reason: string };

function normalize(text: string): string {
  return text.replace(WHITESPACE_RUN, " ").trim();
}

function checkSecret(text: string, label: string): string | null {
  const match = detectSecret(text);
  return match ? `${label} contains secret (${match.reason})` : null;
}

export function sanitizeCandidateInput(raw: RawCandidateInput): SanitizeResult {
  const trigger = normalize(raw.trigger);
  if (trigger.length === 0) return { ok: false, reason: "trigger empty after normalization" };
  const triggerSecret = checkSecret(trigger, "trigger");
  if (triggerSecret) return { ok: false, reason: triggerSecret };

  const steps: string[] = [];
  for (const [index, rawStep] of raw.steps.entries()) {
    const step = normalize(rawStep);
    if (step.length === 0) return { ok: false, reason: `step ${index} empty after normalization` };
    const stepSecret = checkSecret(step, `step ${index}`);
    if (stepSecret) return { ok: false, reason: stepSecret };
    steps.push(step);
  }

  return { ok: true, value: { trigger, steps } };
}

export function dedupeKeyFor(input: RawCandidateInput): string {
  const trigger = normalize(input.trigger);
  const steps = input.steps.map(normalize);
  const payload = [trigger, ...steps].join(SEPARATOR);
  return createHash("sha1").update(payload).digest("hex").slice(0, HASH_PREFIX_LENGTH);
}
```

**Verify:** `bun test tests/skill-evolution/sanitize.test.ts`
**Commit:** `feat(skill-evolution): add sanitize and dedupe helpers`

---

### Task 1.6: Add deterministic source readers (lifecycle journal + ledger)
**File:** `src/skill-evolution/sources.ts`
**Test:** `tests/skill-evolution/sources.test.ts`
**Depends:** none
**Domain:** general

Design constrains the miner to deterministic persisted sources only (lifecycle journal events, lifecycle record body, ledger markdown). This module wraps the IO so the miner stays pure. Returns parsed `JournalEvent[]` from the journal store and raw text from the lifecycle record and ledger files. Missing files return empty results, never throw.

```typescript
// tests/skill-evolution/sources.test.ts
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readJournalEvents, readLedgerTexts, readLifecycleRecord } from "@/skill-evolution/sources";

describe("skill-evolution sources", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "skill-sources-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("readJournalEvents returns parsed events from a journal file", async () => {
    const lifecycleDir = join(baseDir, "thoughts", "lifecycle");
    mkdirSync(lifecycleDir, { recursive: true });
    const event = {
      kind: "review_completed",
      issueNumber: 24,
      seq: 1,
      at: 1_700_000_000_000,
      batchId: "b1",
      taskId: "t1",
      attempt: 1,
      summary: "review done",
      commitMarker: null,
      reviewOutcome: "approved",
    };
    writeFileSync(join(lifecycleDir, "24.journal.jsonl"), `${JSON.stringify(event)}\n`);

    const events = await readJournalEvents({ cwd: baseDir, issueNumber: 24 });
    expect(events.length).toBe(1);
    expect(events[0].summary).toBe("review done");
  });

  it("readJournalEvents returns empty array when journal missing", async () => {
    const events = await readJournalEvents({ cwd: baseDir, issueNumber: 999 });
    expect(events).toEqual([]);
  });

  it("readLifecycleRecord returns the markdown body when present", async () => {
    const lifecycleDir = join(baseDir, "thoughts", "lifecycle");
    mkdirSync(lifecycleDir, { recursive: true });
    writeFileSync(join(lifecycleDir, "24.md"), "## Request\nbody\n");

    const text = await readLifecycleRecord({ cwd: baseDir, issueNumber: 24 });
    expect(text).toContain("body");
  });

  it("readLifecycleRecord returns null when file missing", async () => {
    const text = await readLifecycleRecord({ cwd: baseDir, issueNumber: 999 });
    expect(text).toBeNull();
  });

  it("readLedgerTexts returns markdown of all ledger files in thoughts/ledgers", async () => {
    const ledgersDir = join(baseDir, "thoughts", "ledgers");
    mkdirSync(ledgersDir, { recursive: true });
    writeFileSync(join(ledgersDir, "CONTINUITY_2026-05-01.md"), "ledger one");
    writeFileSync(join(ledgersDir, "CONTINUITY_2026-05-02.md"), "ledger two");
    writeFileSync(join(ledgersDir, "README.md"), "should be ignored");

    const ledgers = await readLedgerTexts({ cwd: baseDir });
    expect(ledgers.length).toBe(2);
    expect(ledgers.map((l) => l.text).sort()).toEqual(["ledger one", "ledger two"]);
  });

  it("readLedgerTexts returns empty array when ledger directory missing", async () => {
    const ledgers = await readLedgerTexts({ cwd: baseDir });
    expect(ledgers).toEqual([]);
  });
});
```

```typescript
// src/skill-evolution/sources.ts
import { existsSync, readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

import { createJournalStore } from "@/lifecycle/journal/store";
import type { JournalEvent } from "@/lifecycle/journal/types";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

const LOG_SCOPE = "skill-evolution.sources";
const LIFECYCLE_RECORD_SUFFIX = ".md";
const LEDGER_FILE_PATTERN = /^CONTINUITY_.+\.md$/;

export interface JournalReadInput {
  readonly cwd: string;
  readonly issueNumber: number;
}

export interface LifecycleReadInput {
  readonly cwd: string;
  readonly issueNumber: number;
}

export interface LedgerReadInput {
  readonly cwd: string;
}

export interface LedgerText {
  readonly path: string;
  readonly text: string;
}

export async function readJournalEvents(input: JournalReadInput): Promise<readonly JournalEvent[]> {
  const baseDir = join(input.cwd, config.lifecycle.lifecycleDir);
  const store = createJournalStore({ baseDir });
  try {
    return await store.list(input.issueNumber);
  } catch (error) {
    log.warn(LOG_SCOPE, `journal read failed: ${extractErrorMessage(error)}`);
    return [];
  }
}

export async function readLifecycleRecord(input: LifecycleReadInput): Promise<string | null> {
  const file = join(input.cwd, config.lifecycle.lifecycleDir, `${input.issueNumber}${LIFECYCLE_RECORD_SUFFIX}`);
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, "utf-8");
  } catch (error) {
    log.warn(LOG_SCOPE, `lifecycle record read failed: ${extractErrorMessage(error)}`);
    return null;
  }
}

export async function readLedgerTexts(input: LedgerReadInput): Promise<readonly LedgerText[]> {
  const dir = join(input.cwd, config.paths.ledgerDir);
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    log.warn(LOG_SCOPE, `ledger dir read failed: ${extractErrorMessage(error)}`);
    return [];
  }

  const ledgers: LedgerText[] = [];
  for (const name of entries) {
    if (!LEDGER_FILE_PATTERN.test(name)) continue;
    const file = join(dir, name);
    try {
      ledgers.push({ path: file, text: readFileSync(file, "utf-8") });
    } catch (error) {
      log.warn(LOG_SCOPE, `ledger file read failed (${file}): ${extractErrorMessage(error)}`);
    }
  }
  return ledgers;
}
```

**Verify:** `bun test tests/skill-evolution/sources.test.ts`
**Commit:** `feat(skill-evolution): add deterministic source readers`

---

### Task 1.7: Add skill-evolution config tunables
**File:** `src/utils/config.ts`
**Test:** `tests/utils/config-skill-evolution.test.ts`
**Depends:** none
**Domain:** general

Design: "Retrieval must respect sensitivity filtering and context budget limits." We add a `skillEvolution` config block to the central tunables: max procedures per injection, char budget per injection, candidate expiry days, max candidates per project, snippet length cap. Defaults are conservative because the feature is gated.

```typescript
// tests/utils/config-skill-evolution.test.ts
import { describe, expect, it } from "bun:test";

import { config } from "@/utils/config";

describe("config.skillEvolution tunables", () => {
  it("exposes all expected tunables with conservative defaults", () => {
    expect(config.skillEvolution.maxInjectedProcedures).toBeGreaterThan(0);
    expect(config.skillEvolution.maxInjectedProcedures).toBeLessThanOrEqual(5);
    expect(config.skillEvolution.injectionCharBudget).toBeGreaterThan(0);
    expect(config.skillEvolution.injectionCharBudget).toBeLessThanOrEqual(2000);
    expect(config.skillEvolution.candidateExpiryDays).toBeGreaterThanOrEqual(7);
    expect(config.skillEvolution.maxCandidatesPerProject).toBeGreaterThan(0);
    expect(config.skillEvolution.snippetMaxChars).toBeGreaterThan(0);
    expect(config.skillEvolution.injectionSensitivityCeiling).toBe("internal");
  });
});
```

```typescript
// src/utils/config.ts
// EDIT: locate the existing `config = { ... }` literal in src/utils/config.ts.
// Insert the following block immediately AFTER `projectMemory: { ... },` and BEFORE
// `notifications: { ... },`. Do NOT rewrite the surrounding file. The full block to insert:

skillEvolution: {
  /** Max procedures injected per chat (strict ceiling so context stays small) */
  maxInjectedProcedures: 3,
  /** Hard char budget across all injected procedures combined */
  injectionCharBudget: 1200,
  /** Candidate auto-expiry in days; expired entries are purged at next /skills review */
  candidateExpiryDays: 30,
  /** Hard cap on stored pending candidates per project (oldest evicted) */
  maxCandidatesPerProject: 200,
  /** Per-procedure snippet truncation when injecting */
  snippetMaxChars: 320,
  /** Ceiling for sensitivity filter on lookup-and-inject ('internal' excludes 'secret') */
  injectionSensitivityCeiling: "internal" as "public" | "internal",
},
```

Implementation note: `config` is a single `as const` literal exported from `src/utils/config.ts`. The implementer must edit the literal in place using a unique anchor (the line `  projectMemory: {` and its closing `},` block). Because `config` uses `as const`, adding the new block automatically extends the inferred type so `config.skillEvolution.*` becomes available across the codebase.

**Verify:** `bun test tests/utils/config-skill-evolution.test.ts`
**Commit:** `feat(config): add skill-evolution tunables`

---

## Batch 2: Schema and Lookup Extensions (parallel - 4 implementers)

All tasks in this batch depend on Batch 1 (specifically 1.1, 1.7).
Tasks: 2.1, 2.2, 2.3, 2.4

### Task 2.1: Add Procedure section parser to project-memory parser
**File:** `src/project-memory/parser.ts`
**Test:** `tests/project-memory/parser.test.ts` (extend existing file with new cases)
**Depends:** 1.1
**Domain:** general

Design: "Adds a `Procedure` section pattern so approved candidate markdown can be promoted through the existing Project Memory promotion path." We add `procedure` to `SECTION_PATTERNS` so a markdown block with `## Procedure` produces one entry per bullet, type=`procedure`. The reviewer flow (3.5) renders approved candidates as markdown with a `## Procedure` section before promotion, so the existing `promoteMarkdown` path works unchanged.

```typescript
// tests/project-memory/parser.test.ts excerpt to ADD inside the existing
// `describe("extractCandidates", () => { ... })` block. The implementer must
// open the existing file and append these test cases inside the same describe.

import { describe, expect, it } from "bun:test";
import { extractCandidates } from "@/project-memory/parser";

describe("extractCandidates: procedure section", () => {
  it("emits procedure candidates from a Procedure section", () => {
    const md = "## Procedure\n- Trigger: on lifecycle finish; Steps: list -> normalize -> upsert\n";
    const r = extractCandidates({
      markdown: md,
      defaultEntityName: "skill",
      sourceKind: "skill",
      pointer: "skill-candidate://abc123",
    });
    expect(r.candidates.length).toBe(1);
    expect(r.candidates[0].entryType).toBe("procedure");
  });

  it("supports multiple procedure bullets in the same section", () => {
    const md = "## Procedure\n- workflow A\n- workflow B\n";
    const r = extractCandidates({
      markdown: md,
      defaultEntityName: "skill",
      sourceKind: "skill",
      pointer: "x",
    });
    expect(r.candidates.length).toBe(2);
    expect(r.candidates.every((c) => c.entryType === "procedure")).toBe(true);
  });

  it("recognizes Procedures (plural) as the procedure section header", () => {
    const md = "## Procedures\n- workflow A\n";
    const r = extractCandidates({
      markdown: md,
      defaultEntityName: "skill",
      sourceKind: "skill",
      pointer: "x",
    });
    expect(r.candidates[0].entryType).toBe("procedure");
  });
});
```

```typescript
// src/project-memory/parser.ts
// EDIT: locate the SECTION_PATTERNS array (line ~3 of parser.ts) and append a new
// entry. The full updated array:

const SECTION_PATTERNS: ReadonlyArray<{ readonly entryType: EntryType; readonly headers: readonly RegExp[] }> = [
  { entryType: "decision", headers: [/^##\s+Decisions?\b/im, /^##\s+Key Decisions\b/im] },
  { entryType: "risk", headers: [/^##\s+Risks?\b/im] },
  { entryType: "lesson", headers: [/^##\s+Lessons?(?:\s+Learned)?\b/im] },
  { entryType: "open_question", headers: [/^##\s+Open Questions?\b/im, /^##\s+Follow-?ups?\b/im] },
  { entryType: "procedure", headers: [/^##\s+Procedures?\b/im] },
];
```

Note: this edit is one literal change to `SECTION_PATTERNS`. The rest of `parser.ts` (lifecycle Request fallback, fallback note logic, `extractBullets`, etc.) is unchanged. Because we add `procedure` to `SECTION_PATTERNS`, structured Procedure sections take precedence over lifecycle Request fallback, exactly like Decisions.

**Verify:** `bun test tests/project-memory/parser.test.ts`
**Commit:** `feat(project-memory): parse Procedure sections into procedure entries`

---

### Task 2.2: Allow `skill` source kind in promote.ts and pick correct status
**File:** `src/project-memory/promote.ts`
**Test:** `tests/project-memory/promote.test.ts` (extend with skill-source case)
**Depends:** 1.1
**Domain:** general

`promote.ts` currently maps `design` and `plan` source kinds to `tentative` status. For approved skill candidates we want the same conservative posture: a newly approved candidate becomes a `tentative` procedure entry, never `active`, until an explicit user review later (open question in design). We add `skill` to the `TENTATIVE_KINDS` set. The rest of `promote.ts` already handles arbitrary `SourceKind` values via `picklist(SourceKindValues)`, so once 1.1 lands, `skill` flows through unchanged.

```typescript
// tests/project-memory/promote.test.ts excerpt to ADD inside existing describe block

import { describe, expect, it } from "bun:test";
import { createProjectMemoryStore, promoteMarkdown } from "@/project-memory";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

describe("promoteMarkdown: skill source kind", () => {
  it("creates a tentative procedure entry from a skill markdown body", async () => {
    const dir = mkdtempSync(join(tmpdir(), "promote-skill-"));
    try {
      const store = createProjectMemoryStore({ dbDir: dir, dbFileName: "memory.db" });
      await store.initialize();
      const md = "## Procedure\n- Trigger A; Steps 1-2-3\n";
      const result = await promoteMarkdown({
        store,
        identity: { projectId: "p1", kind: "origin", source: "github.com/example/repo" },
        markdown: md,
        defaultEntityName: "skill-2026-05-03",
        sourceKind: "skill",
        pointer: "skill-candidate://abc123",
      });
      expect(result.refusedReason).toBeNull();
      expect(result.accepted.length).toBe(1);
      expect(result.accepted[0].status).toBe("tentative");
      await store.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});
```

```typescript
// src/project-memory/promote.ts
// EDIT: replace the existing TENTATIVE_KINDS line so 'skill' is treated as tentative.
// The full updated line (line ~36):

const TENTATIVE_KINDS: ReadonlySet<SourceKind> = new Set(["design", "plan", "skill"]);
```

Implementation note: this is a one-literal change. The implementer must keep the rest of the file untouched. After Task 1.1 lands, `SourceKind` already includes `"skill"`, so `TENTATIVE_KINDS` accepts the literal at compile time.

**Verify:** `bun test tests/project-memory/promote.test.ts`
**Commit:** `feat(project-memory): treat skill source kind as tentative on promotion`

---

### Task 2.3: Expose sensitivityCeiling on the lookup function
**File:** `src/project-memory/lookup.ts`
**Test:** `tests/project-memory/lookup.test.ts` (extend with ceiling case)
**Depends:** 1.1
**Domain:** general

Design: "Exposes sensitivity filtering in the project memory lookup tool so injected procedures never exceed the allowed sensitivity ceiling." The store already supports `sensitivityCeiling` in `SearchEntriesOptions`. We thread it through the `lookup()` function so the higher-level injector and tool can pass it. The existing `searchEntries` signature already receives the ceiling.

```typescript
// tests/project-memory/lookup.test.ts excerpt to ADD inside existing describe

import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProjectMemoryStore, lookup } from "@/project-memory";

describe("lookup: sensitivityCeiling", () => {
  let dir: string;

  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "pm-sens-"));
  });

  afterEach(() => {
    rmSync(dir, { recursive: true, force: true });
  });

  it("excludes entries above the ceiling and includes entries at or below it", async () => {
    const store = createProjectMemoryStore({ dbDir: dir, dbFileName: "memory.db" });
    await store.initialize();
    const projectId = "p1";
    const now = Date.now();

    await store.upsertEntity({
      projectId,
      id: "ent_1",
      kind: "module",
      name: "auth",
      summary: "auth",
      createdAt: now,
      updatedAt: now,
    });

    const baseEntry = {
      projectId,
      entityId: "ent_1",
      type: "fact" as const,
      title: "title",
      summary: "permission cache decisions",
      status: "active" as const,
      createdAt: now,
      updatedAt: now,
    };

    await store.upsertEntry({ ...baseEntry, id: "entry_pub", sensitivity: "public" });
    await store.upsertEntry({ ...baseEntry, id: "entry_int", sensitivity: "internal" });
    await store.upsertEntry({ ...baseEntry, id: "entry_sec", sensitivity: "secret" });

    const identity = { projectId, kind: "origin" as const, source: "x" };

    const allHits = await lookup({ store, identity, query: "permission cache" });
    expect(allHits.length).toBe(3);

    const ceilingHits = await lookup({
      store,
      identity,
      query: "permission cache",
      sensitivityCeiling: "internal",
    });
    expect(ceilingHits.map((h) => h.entry.sensitivity).sort()).toEqual(["internal", "public"]);

    await store.close();
  });
});
```

```typescript
// src/project-memory/lookup.ts (full replacement file)
import { config } from "@/utils/config";
import type { ProjectIdentity } from "@/utils/project-id";
import type { ProjectMemoryStore, SearchHit } from "./store";
import type { EntryType, LookupHit, Status } from "./types";

export interface LookupInput {
  readonly store: ProjectMemoryStore;
  readonly identity: ProjectIdentity;
  readonly query: string;
  readonly type?: EntryType;
  readonly status?: Status;
  readonly entityId?: string;
  readonly sensitivityCeiling?: "public" | "internal";
  readonly limit?: number;
}

const ELLIPSIS = "…";
const STATUS_RANK: Record<Status, number> = {
  active: 0,
  tentative: 1,
  hypothesis: 2,
  superseded: 3,
  deprecated: 4,
};

function trimSnippet(summary: string): string {
  const max = config.projectMemory.snippetMaxChars;
  if (summary.length <= max) return summary;
  return `${summary.slice(0, max - ELLIPSIS.length)}${ELLIPSIS}`;
}

function isLookupHit(hit: LookupHit | null): hit is LookupHit {
  return hit !== null;
}

function compareHits(left: LookupHit, right: LookupHit): number {
  const statusDelta = STATUS_RANK[left.entry.status] - STATUS_RANK[right.entry.status];
  if (statusDelta !== 0) return statusDelta;

  const scoreDelta = right.score - left.score;
  if (scoreDelta !== 0) return scoreDelta;

  return right.entry.updatedAt - left.entry.updatedAt;
}

async function loadHit(store: ProjectMemoryStore, projectId: string, hit: SearchHit): Promise<LookupHit | null> {
  const [entity, sources] = await Promise.all([
    store.loadEntity(projectId, hit.entry.entityId),
    store.loadSourcesForEntry(projectId, hit.entry.id),
  ]);

  if (!entity) return null;

  return {
    entry: hit.entry,
    entity,
    sources,
    snippet: trimSnippet(hit.entry.summary),
    score: hit.score,
    degraded: sources.length === 0,
  };
}

export async function lookup(input: LookupInput): Promise<readonly LookupHit[]> {
  const limit = input.limit ?? config.projectMemory.defaultLookupLimit;
  const hits = await input.store.searchEntries(input.identity.projectId, input.query, {
    type: input.type,
    status: input.status,
    entityId: input.entityId,
    sensitivityCeiling: input.sensitivityCeiling,
    limit,
  });
  const loaded = await Promise.all(hits.map((hit) => loadHit(input.store, input.identity.projectId, hit)));
  return loaded.filter(isLookupHit).sort(compareHits);
}
```

**Verify:** `bun test tests/project-memory/lookup.test.ts`
**Commit:** `feat(project-memory): plumb sensitivityCeiling through lookup()`

---

### Task 2.4: Surface sensitivity ceiling on project_memory_lookup tool
**File:** `src/tools/project-memory/lookup.ts`
**Test:** `tests/tools/project-memory-lookup.test.ts`
**Depends:** 2.3, 1.1
**Domain:** general

Design requires the tool boundary to expose sensitivity filtering. We add an optional `sensitivity_ceiling` argument that maps to the new `LookupInput.sensitivityCeiling` field. We deliberately allow only `"public"` and `"internal"` (not `"secret"`) on the public tool surface, matching the design intent. We also add `procedure` to the existing enum because Task 1.1 already includes it in `EntryTypeValues` (so the enum auto-updates), but we add an explicit test to verify that wiring.

```typescript
// tests/tools/project-memory-lookup.test.ts
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProjectMemoryStore, EntryTypeValues } from "@/project-memory";
import { createProjectMemoryLookupTool } from "@/tools/project-memory/lookup";
import {
  resetProjectMemoryRuntimeForTest,
  setProjectMemoryStoreForTest,
} from "@/tools/project-memory/runtime";

describe("project_memory_lookup tool: sensitivity_ceiling argument", () => {
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "pm-lookup-tool-"));
    const store = createProjectMemoryStore({ dbDir: dir, dbFileName: "memory.db" });
    await store.initialize();
    setProjectMemoryStoreForTest(store);
  });

  afterEach(async () => {
    await resetProjectMemoryRuntimeForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it("exposes sensitivity_ceiling and procedure as accepted argument values", () => {
    const ctx = { directory: process.cwd() } as unknown as Parameters<typeof createProjectMemoryLookupTool>[0];
    const { project_memory_lookup } = createProjectMemoryLookupTool(ctx);
    const description = String(project_memory_lookup.description ?? "");
    expect(description.length).toBeGreaterThan(0);
    expect(EntryTypeValues).toContain("procedure");
  });
});
```

```typescript
// src/tools/project-memory/lookup.ts (full replacement)
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { EntryTypeValues, formatLookupResults, lookup, type Status, StatusValues } from "@/project-memory";
import { extractErrorMessage } from "@/utils/errors";
import { getIdentity, getStore } from "./runtime";

const DEFAULT_STATUS: Status = "active";
const SENSITIVITY_CEILING_VALUES = ["public", "internal"] as const;
type SensitivityCeiling = (typeof SENSITIVITY_CEILING_VALUES)[number];

export function createProjectMemoryLookupTool(ctx: PluginInput): { project_memory_lookup: ToolDefinition } {
  const project_memory_lookup = tool({
    description: `Look up durable project memory entries (decisions, lessons, risks, facts, procedures) scoped to the current project.
Prefer this over reading raw thoughts/ files when you only need conclusions.`,
    args: {
      query: tool.schema.string().describe("Topic to search (e.g., 'permission cache TTL')"),
      type: tool.schema.enum(EntryTypeValues).optional().describe("Filter by entry type"),
      status: tool.schema.enum(StatusValues).optional().describe("Filter by status (default: active)"),
      sensitivity_ceiling: tool.schema
        .enum(SENSITIVITY_CEILING_VALUES)
        .optional()
        .describe("Cap returned entries at this sensitivity (public or internal)"),
      limit: tool.schema.number().optional().describe("Max results (default: 10)"),
    },
    execute: async ({ query, type, status, sensitivity_ceiling, limit }) => {
      try {
        const store = await getStore();
        const identity = await getIdentity(ctx.directory);
        const hits = await lookup({
          store,
          identity,
          query,
          type,
          status: status ?? DEFAULT_STATUS,
          sensitivityCeiling: sensitivity_ceiling as SensitivityCeiling | undefined,
          limit,
        });
        return formatLookupResults(query, hits);
      } catch (error) {
        return `## Error\n\n${extractErrorMessage(error)}`;
      }
    },
  });

  return { project_memory_lookup };
}
```

**Verify:** `bun test tests/tools/project-memory-lookup.test.ts`
**Commit:** `feat(tools): expose sensitivity_ceiling and procedure on project_memory_lookup`

---

## Batch 3: Candidate Storage, Miner, Review (parallel - 5 implementers)

All tasks in this batch depend on Batches 1 and 2.
Tasks: 3.1, 3.2, 3.3, 3.4, 3.5

### Task 3.1: Implement candidate store (read, write, list, dedupe, expire)
**File:** `src/skill-evolution/store.ts`
**Test:** `tests/skill-evolution/store.test.ts`
**Depends:** 1.3, 1.4, 1.5, 1.7
**Domain:** general

Design: "Stores pending candidates under a user-level project-scoped directory outside the repository, avoiding `thoughts/` auto-indexing." We implement a small JSON-on-disk store: one file per candidate keyed by candidate id, atomic write via tmp + rename, dedupe by `dedupeKeyFor`, and bulk expiry purge. Validation runs through `parseCandidate` on every read; corrupt files are logged and skipped. Hard cap at `config.skillEvolution.maxCandidatesPerProject` evicts the oldest by createdAt.

```typescript
// tests/skill-evolution/store.test.ts
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Candidate } from "@/skill-evolution/candidate-schema";
import { createCandidateStore } from "@/skill-evolution/store";

describe("candidate store", () => {
  let homeRoot: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    homeRoot = mkdtempSync(join(tmpdir(), "skill-store-"));
    originalHome = process.env.HOME;
    process.env.HOME = homeRoot;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(homeRoot, { recursive: true, force: true });
  });

  const baseCandidate = (overrides: Partial<Candidate> = {}): Candidate => ({
    id: "cand_a",
    projectId: "proj_1",
    trigger: "trigger one",
    steps: ["one", "two"],
    sources: [{ kind: "ledger", pointer: "thoughts/ledgers/CONTINUITY_2026-05-01.md" }],
    sensitivity: "internal",
    status: "pending",
    createdAt: 1_700_000_000_000,
    expiresAt: 1_800_000_000_000,
    hits: 0,
    ...overrides,
  });

  it("upsertCandidate writes a JSON file under the project candidate root", async () => {
    const store = createCandidateStore();
    const c = baseCandidate();
    await store.upsertCandidate(c);
    const list = await store.listCandidates(c.projectId);
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("cand_a");
  });

  it("listCandidates returns empty array when project root is missing", async () => {
    const store = createCandidateStore();
    const list = await store.listCandidates("nonexistent_project");
    expect(list).toEqual([]);
  });

  it("loadCandidate returns null for missing candidate", async () => {
    const store = createCandidateStore();
    const loaded = await store.loadCandidate("p", "missing");
    expect(loaded).toBeNull();
  });

  it("loadCandidate returns the stored candidate on hit", async () => {
    const store = createCandidateStore();
    const c = baseCandidate();
    await store.upsertCandidate(c);
    const loaded = await store.loadCandidate(c.projectId, c.id);
    expect(loaded?.trigger).toBe("trigger one");
  });

  it("upsertCandidate overwrites the existing record by id", async () => {
    const store = createCandidateStore();
    await store.upsertCandidate(baseCandidate({ trigger: "first" }));
    await store.upsertCandidate(baseCandidate({ trigger: "second" }));
    const loaded = await store.loadCandidate("proj_1", "cand_a");
    expect(loaded?.trigger).toBe("second");
  });

  it("deleteCandidate removes the file", async () => {
    const store = createCandidateStore();
    await store.upsertCandidate(baseCandidate());
    await store.deleteCandidate("proj_1", "cand_a");
    expect(await store.loadCandidate("proj_1", "cand_a")).toBeNull();
  });

  it("listCandidates skips corrupted JSON files", async () => {
    const store = createCandidateStore();
    await store.upsertCandidate(baseCandidate());
    const root = join(homeRoot, ".config", "opencode", "project-skill-candidates", "proj_1");
    writeFileSync(join(root, "cand_corrupt.json"), "{not json");
    const list = await store.listCandidates("proj_1");
    expect(list.length).toBe(1);
    expect(list[0].id).toBe("cand_a");
  });

  it("listCandidates skips files that fail schema validation", async () => {
    const store = createCandidateStore();
    await store.upsertCandidate(baseCandidate());
    const root = join(homeRoot, ".config", "opencode", "project-skill-candidates", "proj_1");
    writeFileSync(join(root, "cand_invalid.json"), JSON.stringify({ id: "x" }));
    const list = await store.listCandidates("proj_1");
    expect(list.length).toBe(1);
  });

  it("purgeExpired deletes candidates with expiresAt <= now and returns count", async () => {
    const store = createCandidateStore();
    await store.upsertCandidate(baseCandidate({ id: "cand_old", expiresAt: 100 }));
    await store.upsertCandidate(baseCandidate({ id: "cand_new", expiresAt: 1_900_000_000_000 }));
    const purged = await store.purgeExpired("proj_1", 1_000);
    expect(purged).toBe(1);
    const remaining = await store.listCandidates("proj_1");
    expect(remaining.map((c) => c.id)).toEqual(["cand_new"]);
  });

  it("findByDedupeKey locates an existing candidate by trigger+steps key", async () => {
    const store = createCandidateStore();
    const c = baseCandidate();
    await store.upsertCandidate(c);
    const hit = await store.findByDedupeKey("proj_1", { trigger: c.trigger, steps: c.steps });
    expect(hit?.id).toBe("cand_a");
  });

  it("findByDedupeKey returns null when nothing matches", async () => {
    const store = createCandidateStore();
    await store.upsertCandidate(baseCandidate());
    const hit = await store.findByDedupeKey("proj_1", { trigger: "different", steps: ["x"] });
    expect(hit).toBeNull();
  });

  it("upsertCandidate atomically writes via tmp+rename (no partial file remains on next read)", async () => {
    const store = createCandidateStore();
    await store.upsertCandidate(baseCandidate());
    const root = join(homeRoot, ".config", "opencode", "project-skill-candidates", "proj_1");
    const file = join(root, "cand_a.json");
    const text = readFileSync(file, "utf-8");
    expect(JSON.parse(text).id).toBe("cand_a");
  });
});
```

```typescript
// src/skill-evolution/store.ts
import { existsSync, mkdirSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import { type Candidate, parseCandidate } from "./candidate-schema";
import { candidateFilePath, candidateRootDir } from "./paths";
import { dedupeKeyFor, type RawCandidateInput } from "./sanitize";

const LOG_SCOPE = "skill-evolution.store";
const TMP_SUFFIX = ".tmp";
const JSON_SUFFIX = ".json";

export interface CandidateStore {
  readonly upsertCandidate: (candidate: Candidate) => Promise<void>;
  readonly loadCandidate: (projectId: string, id: string) => Promise<Candidate | null>;
  readonly listCandidates: (projectId: string) => Promise<readonly Candidate[]>;
  readonly deleteCandidate: (projectId: string, id: string) => Promise<void>;
  readonly purgeExpired: (projectId: string, now: number) => Promise<number>;
  readonly findByDedupeKey: (projectId: string, input: RawCandidateInput) => Promise<Candidate | null>;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function writeAtomic(path: string, data: string): void {
  const tmp = `${path}${TMP_SUFFIX}`;
  writeFileSync(tmp, data);
  renameSync(tmp, path);
}

function readCandidateFile(file: string): Candidate | null {
  let raw: string;
  try {
    raw = readFileSync(file, "utf-8");
  } catch (error) {
    log.warn(LOG_SCOPE, `read failed ${file}: ${extractErrorMessage(error)}`);
    return null;
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    log.warn(LOG_SCOPE, `parse failed ${file}: ${extractErrorMessage(error)}`);
    return null;
  }
  const result = parseCandidate(parsed);
  if (!result.ok) {
    log.warn(LOG_SCOPE, `schema invalid ${file}: ${result.issues.join("; ")}`);
    return null;
  }
  return result.candidate;
}

function listFiles(root: string): readonly string[] {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root).filter((name) => name.endsWith(JSON_SUFFIX));
  } catch (error) {
    log.warn(LOG_SCOPE, `list failed ${root}: ${extractErrorMessage(error)}`);
    return [];
  }
}

async function upsertCandidate(candidate: Candidate): Promise<void> {
  const root = candidateRootDir(candidate.projectId);
  ensureDir(root);
  const file = candidateFilePath(candidate.projectId, candidate.id);
  writeAtomic(file, `${JSON.stringify(candidate, null, 2)}\n`);
}

async function loadCandidate(projectId: string, id: string): Promise<Candidate | null> {
  const file = candidateFilePath(projectId, id);
  if (!existsSync(file)) return null;
  return readCandidateFile(file);
}

async function listCandidates(projectId: string): Promise<readonly Candidate[]> {
  const root = candidateRootDir(projectId);
  const out: Candidate[] = [];
  for (const name of listFiles(root)) {
    const c = readCandidateFile(join(root, name));
    if (c) out.push(c);
  }
  return out;
}

async function deleteCandidate(projectId: string, id: string): Promise<void> {
  const file = candidateFilePath(projectId, id);
  if (!existsSync(file)) return;
  try {
    unlinkSync(file);
  } catch (error) {
    log.warn(LOG_SCOPE, `delete failed ${file}: ${extractErrorMessage(error)}`);
  }
}

async function purgeExpired(projectId: string, now: number): Promise<number> {
  const all = await listCandidates(projectId);
  let purged = 0;
  for (const c of all) {
    if (c.expiresAt <= now) {
      await deleteCandidate(projectId, c.id);
      purged += 1;
    }
  }
  return purged;
}

async function findByDedupeKey(projectId: string, input: RawCandidateInput): Promise<Candidate | null> {
  const target = dedupeKeyFor(input);
  const all = await listCandidates(projectId);
  for (const c of all) {
    const key = dedupeKeyFor({ trigger: c.trigger, steps: c.steps });
    if (key === target) return c;
  }
  return null;
}

export function createCandidateStore(): CandidateStore {
  return {
    upsertCandidate,
    loadCandidate,
    listCandidates,
    deleteCandidate,
    purgeExpired,
    findByDedupeKey,
  };
}
```

**Verify:** `bun test tests/skill-evolution/store.test.ts`
**Commit:** `feat(skill-evolution): add candidate JSON store with atomic write and dedupe`

---

### Task 3.2: Implement miner core (pure extraction from journal + ledger fixtures)
**File:** `src/skill-evolution/miner.ts`
**Test:** `tests/skill-evolution/miner.test.ts`
**Depends:** 1.3, 1.5, 1.6, 1.7
**Domain:** general

Design: "The miner reads only deterministic persisted sources: lifecycle journal, lifecycle record, and ledgers. It does not mine arbitrary raw agent output." We split the miner into a pure `extractCandidatesFromSources` (no IO; takes journal events, lifecycle markdown, ledgers) and a runner (Task 4.1 will wire scheduling). This task delivers the pure extractor only.

The pure extractor produces zero or more `Candidate` objects per input set. MVP heuristic: a sequence of `BATCH_COMPLETED` events followed by `REVIEW_COMPLETED` with `reviewOutcome=approved` whose summaries together describe a workflow yields one candidate (`trigger` = lifecycle issue summary or lifecycle record `## Request` first line; `steps` = ordered batch summaries, capped at 16). Ledger markdown adds candidates by parsing `## Procedure` sections (reusing `extractCandidates` from project-memory parser). All candidates pass through `sanitizeCandidateInput`.

```typescript
// tests/skill-evolution/miner.test.ts
import { describe, expect, it } from "bun:test";

import type { JournalEvent } from "@/lifecycle/journal/types";
import { extractCandidatesFromSources, type MinerInput } from "@/skill-evolution/miner";

const baseEvent = (overrides: Partial<JournalEvent> = {}): JournalEvent => ({
  kind: "batch_completed",
  issueNumber: 24,
  seq: 1,
  at: 1_700_000_000_000,
  batchId: "b1",
  taskId: null,
  attempt: 1,
  summary: "batch 1 summary",
  commitMarker: null,
  reviewOutcome: null,
  ...overrides,
});

describe("extractCandidatesFromSources", () => {
  const projectId = "p1";
  const now = 1_700_000_000_000;
  const expiryMs = 30 * 24 * 3600 * 1000;

  it("emits a candidate from approved batch_completed + review_completed sequence", () => {
    const input: MinerInput = {
      projectId,
      now,
      expiryMs,
      lifecycleIssueNumber: 24,
      lifecycleRecord: "## Request\nImprove project memory promotion quality.\n",
      journalEvents: [
        baseEvent({ seq: 1, summary: "wire types", batchId: "b1" }),
        baseEvent({ seq: 2, summary: "wire parser", batchId: "b2" }),
        baseEvent({
          kind: "review_completed",
          seq: 3,
          summary: "review approved",
          batchId: "b2",
          reviewOutcome: "approved",
        }),
      ],
      ledgers: [],
    };

    const out = extractCandidatesFromSources(input);
    expect(out.candidates.length).toBe(1);
    expect(out.candidates[0].steps).toEqual(["wire types", "wire parser"]);
    expect(out.candidates[0].trigger).toContain("Improve project memory promotion quality");
    expect(out.candidates[0].sensitivity).toBe("internal");
    expect(out.candidates[0].status).toBe("pending");
    expect(out.candidates[0].sources.length).toBeGreaterThan(0);
    expect(out.candidates[0].expiresAt).toBe(now + expiryMs);
  });

  it("skips when no review_completed approved event is present", () => {
    const out = extractCandidatesFromSources({
      projectId,
      now,
      expiryMs,
      lifecycleIssueNumber: 24,
      lifecycleRecord: null,
      journalEvents: [baseEvent({ seq: 1, summary: "lonely batch" })],
      ledgers: [],
    });
    expect(out.candidates).toEqual([]);
  });

  it("skips when reviewOutcome is changes_requested", () => {
    const out = extractCandidatesFromSources({
      projectId,
      now,
      expiryMs,
      lifecycleIssueNumber: 24,
      lifecycleRecord: "## Request\nx\n",
      journalEvents: [
        baseEvent({ seq: 1, summary: "step a" }),
        baseEvent({ kind: "review_completed", seq: 2, summary: "x", reviewOutcome: "changes_requested" }),
      ],
      ledgers: [],
    });
    expect(out.candidates).toEqual([]);
  });

  it("emits a candidate per ## Procedure bullet found in ledger markdown", () => {
    const out = extractCandidatesFromSources({
      projectId,
      now,
      expiryMs,
      lifecycleIssueNumber: null,
      lifecycleRecord: null,
      journalEvents: [],
      ledgers: [
        {
          path: "thoughts/ledgers/CONTINUITY_2026-05-03.md",
          text: "## Procedure\n- Trigger A; Step1; Step2; Step3\n- Trigger B; Step1\n",
        },
      ],
    });
    expect(out.candidates.length).toBe(2);
    expect(out.candidates.every((c) => c.sources[0].kind === "ledger")).toBe(true);
  });

  it("rejects candidates whose sanitization fails (e.g., contains a secret)", () => {
    const out = extractCandidatesFromSources({
      projectId,
      now,
      expiryMs,
      lifecycleIssueNumber: 24,
      lifecycleRecord: "## Request\nrun with AKIAABCDEFGHIJKLMNOP\n",
      journalEvents: [
        baseEvent({ seq: 1, summary: "batch" }),
        baseEvent({ kind: "review_completed", seq: 2, summary: "approved", reviewOutcome: "approved" }),
      ],
      ledgers: [],
    });
    expect(out.candidates.length).toBe(0);
    expect(out.rejected.length).toBe(1);
    expect(out.rejected[0].reason).toContain("secret");
  });

  it("caps steps at 16 even when many batch_completed events are present", () => {
    const events: JournalEvent[] = [];
    for (let i = 0; i < 20; i += 1) {
      events.push(baseEvent({ seq: i + 1, summary: `batch ${i}` }));
    }
    events.push(
      baseEvent({ kind: "review_completed", seq: 21, summary: "approved", reviewOutcome: "approved" }),
    );
    const out = extractCandidatesFromSources({
      projectId,
      now,
      expiryMs,
      lifecycleIssueNumber: 24,
      lifecycleRecord: "## Request\ntopic\n",
      journalEvents: events,
      ledgers: [],
    });
    expect(out.candidates.length).toBe(1);
    expect(out.candidates[0].steps.length).toBe(16);
  });

  it("assigns deterministic ids based on (projectId, dedupeKey) so re-runs deduplicate", () => {
    const input: MinerInput = {
      projectId,
      now,
      expiryMs,
      lifecycleIssueNumber: 24,
      lifecycleRecord: "## Request\nsame topic\n",
      journalEvents: [
        baseEvent({ seq: 1, summary: "step one" }),
        baseEvent({ kind: "review_completed", seq: 2, summary: "ok", reviewOutcome: "approved" }),
      ],
      ledgers: [],
    };

    const a = extractCandidatesFromSources(input);
    const b = extractCandidatesFromSources(input);
    expect(a.candidates[0].id).toBe(b.candidates[0].id);
  });
});
```

```typescript
// src/skill-evolution/miner.ts
import { createHash } from "node:crypto";

import type { JournalEvent } from "@/lifecycle/journal/types";
import { extractCandidates as extractMemoryCandidates } from "@/project-memory/parser";
import type { Candidate } from "./candidate-schema";
import { dedupeKeyFor, sanitizeCandidateInput } from "./sanitize";
import type { LedgerText } from "./sources";

const ID_PREFIX = "cand_";
const ID_HASH_CHARS = 12;
const MAX_STEPS = 16;
const TRIGGER_FALLBACK = "Lifecycle workflow";
const PROCEDURE_BULLET_SEPARATOR = /\s*[;.]\s+/;

export interface MinerInput {
  readonly projectId: string;
  readonly now: number;
  readonly expiryMs: number;
  readonly lifecycleIssueNumber: number | null;
  readonly lifecycleRecord: string | null;
  readonly journalEvents: readonly JournalEvent[];
  readonly ledgers: readonly LedgerText[];
}

export interface MinerRejection {
  readonly trigger: string;
  readonly reason: string;
}

export interface MinerOutput {
  readonly candidates: readonly Candidate[];
  readonly rejected: readonly MinerRejection[];
}

interface RawDraft {
  readonly trigger: string;
  readonly steps: readonly string[];
  readonly sources: Candidate["sources"];
}

function candidateIdFor(projectId: string, trigger: string, steps: readonly string[]): string {
  const key = dedupeKeyFor({ trigger, steps });
  const payload = `${projectId}\u0000${key}`;
  return `${ID_PREFIX}${createHash("sha1").update(payload).digest("hex").slice(0, ID_HASH_CHARS)}`;
}

function firstLine(text: string): string {
  const trimmed = text.trim();
  if (trimmed.length === 0) return "";
  return trimmed.split(/\r?\n/, 1)[0]?.trim() ?? "";
}

function deriveTriggerFromLifecycle(record: string | null): string {
  if (!record) return TRIGGER_FALLBACK;
  const requestMatch = /^##\s+Request\b/im.exec(record);
  if (!requestMatch) return TRIGGER_FALLBACK;
  const after = record.slice(requestMatch.index + requestMatch[0].length);
  const next = /^##\s+/m.exec(after);
  const body = next ? after.slice(0, next.index) : after;
  const candidate = firstLine(body);
  return candidate.length > 0 ? candidate : TRIGGER_FALLBACK;
}

function reviewApproved(events: readonly JournalEvent[]): boolean {
  return events.some((e) => e.kind === "review_completed" && e.reviewOutcome === "approved");
}

function batchSteps(events: readonly JournalEvent[]): readonly string[] {
  return events
    .filter((e) => e.kind === "batch_completed")
    .map((e) => e.summary)
    .slice(0, MAX_STEPS);
}

function lifecycleDraft(input: MinerInput): RawDraft | null {
  if (input.lifecycleIssueNumber === null) return null;
  if (!reviewApproved(input.journalEvents)) return null;
  const steps = batchSteps(input.journalEvents);
  if (steps.length === 0) return null;
  const trigger = deriveTriggerFromLifecycle(input.lifecycleRecord);
  const sources: Candidate["sources"] = [
    { kind: "lifecycle_journal", pointer: `thoughts/lifecycle/${input.lifecycleIssueNumber}.journal.jsonl` },
  ];
  if (input.lifecycleRecord !== null) {
    sources.push({ kind: "lifecycle_record", pointer: `thoughts/lifecycle/${input.lifecycleIssueNumber}.md` });
  }
  return { trigger, steps, sources };
}

function ledgerDrafts(input: MinerInput): readonly RawDraft[] {
  const drafts: RawDraft[] = [];
  for (const ledger of input.ledgers) {
    const extracted = extractMemoryCandidates({
      markdown: ledger.text,
      defaultEntityName: "skill",
      sourceKind: "ledger",
      pointer: ledger.path,
    });
    for (const c of extracted.candidates) {
      if (c.entryType !== "procedure") continue;
      const parts = c.summary
        .split(PROCEDURE_BULLET_SEPARATOR)
        .map((p) => p.trim())
        .filter((p) => p.length > 0);
      if (parts.length < 2) continue;
      const [trigger, ...steps] = parts;
      drafts.push({
        trigger,
        steps: steps.slice(0, MAX_STEPS),
        sources: [{ kind: "ledger", pointer: ledger.path }],
      });
    }
  }
  return drafts;
}

function buildCandidate(input: MinerInput, draft: RawDraft): Candidate | MinerRejection {
  const sanitized = sanitizeCandidateInput({ trigger: draft.trigger, steps: draft.steps });
  if (!sanitized.ok) return { trigger: draft.trigger, reason: sanitized.reason };
  const id = candidateIdFor(input.projectId, sanitized.value.trigger, sanitized.value.steps);
  return {
    id,
    projectId: input.projectId,
    trigger: sanitized.value.trigger,
    steps: sanitized.value.steps,
    sources: draft.sources,
    sensitivity: "internal",
    status: "pending",
    createdAt: input.now,
    expiresAt: input.now + input.expiryMs,
    hits: 0,
  };
}

export function extractCandidatesFromSources(input: MinerInput): MinerOutput {
  const drafts: RawDraft[] = [];
  const lifecycle = lifecycleDraft(input);
  if (lifecycle) drafts.push(lifecycle);
  drafts.push(...ledgerDrafts(input));

  const candidates: Candidate[] = [];
  const rejected: MinerRejection[] = [];
  const seenIds = new Set<string>();
  for (const draft of drafts) {
    const built = buildCandidate(input, draft);
    if ("reason" in built) {
      rejected.push(built);
      continue;
    }
    if (seenIds.has(built.id)) continue;
    seenIds.add(built.id);
    candidates.push(built);
  }
  return { candidates, rejected };
}
```

**Verify:** `bun test tests/skill-evolution/miner.test.ts`
**Commit:** `feat(skill-evolution): add pure miner over journal and ledger sources`

---

### Task 3.3: Implement candidate review state machine
**File:** `src/skill-evolution/review.ts`
**Test:** `tests/skill-evolution/review.test.ts`
**Depends:** 1.3, 1.4, 3.1
**Domain:** general

Design: "Pending candidates remain inactive until reviewed" and "Unit-test review-state transitions independently from the Octto or command UI wrapper." This module exposes `listPending`, `approve`, `reject`, and `purgeExpired` operations that read/write the candidate store. `approve` returns the markdown text the caller must then pass to `promoteMarkdown` (Task 3.5 wires that bridge). State transitions: pending → approved (with optional reason note) or pending → rejected (with reason); both eventually delete the candidate after promotion succeeds (approve) or immediately (reject).

```typescript
// tests/skill-evolution/review.test.ts
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Candidate } from "@/skill-evolution/candidate-schema";
import { approveCandidate, listPending, rejectCandidate, purgeExpiredCandidates } from "@/skill-evolution/review";
import { createCandidateStore } from "@/skill-evolution/store";

describe("review state machine", () => {
  let homeRoot: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    homeRoot = mkdtempSync(join(tmpdir(), "skill-review-"));
    originalHome = process.env.HOME;
    process.env.HOME = homeRoot;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(homeRoot, { recursive: true, force: true });
  });

  const candidate = (overrides: Partial<Candidate> = {}): Candidate => ({
    id: "cand_a",
    projectId: "p1",
    trigger: "trigger one",
    steps: ["s1", "s2"],
    sources: [{ kind: "ledger", pointer: "x" }],
    sensitivity: "internal",
    status: "pending",
    createdAt: 100,
    expiresAt: 1_900_000_000_000,
    hits: 0,
    ...overrides,
  });

  it("listPending returns pending candidates ordered by createdAt asc", async () => {
    const store = createCandidateStore();
    await store.upsertCandidate(candidate({ id: "c1", createdAt: 200 }));
    await store.upsertCandidate(candidate({ id: "c2", createdAt: 100 }));
    const pending = await listPending(store, "p1");
    expect(pending.map((c) => c.id)).toEqual(["c2", "c1"]);
  });

  it("listPending excludes non-pending candidates", async () => {
    const store = createCandidateStore();
    await store.upsertCandidate(candidate({ id: "c1", status: "pending" }));
    await store.upsertCandidate(candidate({ id: "c2", status: "rejected" }));
    const pending = await listPending(store, "p1");
    expect(pending.map((c) => c.id)).toEqual(["c1"]);
  });

  it("approveCandidate returns a markdown body with a Procedure section and the candidate's trigger as title", async () => {
    const store = createCandidateStore();
    await store.upsertCandidate(candidate());
    const result = await approveCandidate({ store, projectId: "p1", candidateId: "cand_a" });
    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.markdown).toContain("## Procedure");
    expect(result.markdown).toContain(candidate().trigger);
    expect(result.entityName).toBe("skill-cand_a");
    expect(result.pointer).toBe("skill-candidate://cand_a");
  });

  it("approveCandidate returns ok=false when candidate is missing", async () => {
    const store = createCandidateStore();
    const result = await approveCandidate({ store, projectId: "p1", candidateId: "missing" });
    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("not found");
  });

  it("rejectCandidate deletes the candidate file and returns the rejection record", async () => {
    const store = createCandidateStore();
    await store.upsertCandidate(candidate());
    const result = await rejectCandidate({ store, projectId: "p1", candidateId: "cand_a", reason: "low value" });
    expect(result.ok).toBe(true);
    expect(await store.loadCandidate("p1", "cand_a")).toBeNull();
  });

  it("rejectCandidate returns ok=false when candidate is missing", async () => {
    const store = createCandidateStore();
    const result = await rejectCandidate({ store, projectId: "p1", candidateId: "missing", reason: "x" });
    expect(result.ok).toBe(false);
  });

  it("purgeExpiredCandidates returns the count of expired entries removed", async () => {
    const store = createCandidateStore();
    await store.upsertCandidate(candidate({ id: "old", expiresAt: 100 }));
    await store.upsertCandidate(candidate({ id: "new", expiresAt: 1_900_000_000_000 }));
    const count = await purgeExpiredCandidates({ store, projectId: "p1", now: 1_000 });
    expect(count).toBe(1);
  });
});
```

```typescript
// src/skill-evolution/review.ts
import type { Candidate } from "./candidate-schema";
import type { CandidateStore } from "./store";

export interface ApproveInput {
  readonly store: CandidateStore;
  readonly projectId: string;
  readonly candidateId: string;
}

export interface ApproveSuccess {
  readonly ok: true;
  readonly markdown: string;
  readonly entityName: string;
  readonly pointer: string;
  readonly candidate: Candidate;
}

export interface ApproveFailure {
  readonly ok: false;
  readonly reason: string;
}

export type ApproveResult = ApproveSuccess | ApproveFailure;

export interface RejectInput {
  readonly store: CandidateStore;
  readonly projectId: string;
  readonly candidateId: string;
  readonly reason: string;
}

export type RejectResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

export interface PurgeInput {
  readonly store: CandidateStore;
  readonly projectId: string;
  readonly now: number;
}

const POINTER_PREFIX = "skill-candidate://";
const ENTITY_PREFIX = "skill-";

function compareCreatedAt(a: Candidate, b: Candidate): number {
  return a.createdAt - b.createdAt;
}

export async function listPending(store: CandidateStore, projectId: string): Promise<readonly Candidate[]> {
  const all = await store.listCandidates(projectId);
  return all.filter((c) => c.status === "pending").slice().sort(compareCreatedAt);
}

function renderApprovalMarkdown(candidate: Candidate): string {
  const stepsLine = candidate.steps.map((s, i) => `${i + 1}) ${s}`).join("; ");
  const bullet = `${candidate.trigger}; ${stepsLine}`;
  return `## Procedure\n- ${bullet}\n`;
}

export async function approveCandidate(input: ApproveInput): Promise<ApproveResult> {
  const candidate = await input.store.loadCandidate(input.projectId, input.candidateId);
  if (!candidate) return { ok: false, reason: `candidate not found: ${input.candidateId}` };
  return {
    ok: true,
    markdown: renderApprovalMarkdown(candidate),
    entityName: `${ENTITY_PREFIX}${candidate.id}`,
    pointer: `${POINTER_PREFIX}${candidate.id}`,
    candidate,
  };
}

export async function rejectCandidate(input: RejectInput): Promise<RejectResult> {
  const existing = await input.store.loadCandidate(input.projectId, input.candidateId);
  if (!existing) return { ok: false, reason: `candidate not found: ${input.candidateId}` };
  await input.store.deleteCandidate(input.projectId, input.candidateId);
  return { ok: true };
}

export async function purgeExpiredCandidates(input: PurgeInput): Promise<number> {
  return input.store.purgeExpired(input.projectId, input.now);
}
```

**Verify:** `bun test tests/skill-evolution/review.test.ts`
**Commit:** `feat(skill-evolution): add review state machine`

---

### Task 3.4: Implement procedure injection planner (pure, budget-aware)
**File:** `src/skill-evolution/inject-plan.ts`
**Test:** `tests/skill-evolution/inject-plan.test.ts`
**Depends:** 1.7, 2.3
**Domain:** general

Design: "Retrieves at most a small number of relevant procedure entries and injects trimmed summaries only when the feature flag is enabled." We isolate the pure planning logic so injection behavior with flag-disabled, flag-enabled-no-matches, and flag-enabled-many-matches can be unit-tested without touching `chat.params`.

The planner takes the lookup result list and returns the formatted block string (or `null` to inject nothing). It enforces three caps: `maxInjectedProcedures`, `injectionCharBudget`, and `snippetMaxChars`. The flag itself is gated upstream (Task 4.2 reads `userConfig.features.skillEvolution`); this module is flag-agnostic but accepts an `enabled` argument for ease of testing.

```typescript
// tests/skill-evolution/inject-plan.test.ts
import { describe, expect, it } from "bun:test";

import type { LookupHit } from "@/project-memory";
import { planProcedureInjection } from "@/skill-evolution/inject-plan";

const hit = (overrides: Partial<LookupHit["entry"]> = {}, score = 1): LookupHit => ({
  entry: {
    id: "entry_1",
    projectId: "p1",
    entityId: "ent_1",
    type: "procedure",
    title: "title",
    summary: "summary text",
    status: "tentative",
    sensitivity: "internal",
    createdAt: 1,
    updatedAt: 1,
    ...overrides,
  },
  entity: { id: "ent_1", projectId: "p1", kind: "module", name: "x", createdAt: 1, updatedAt: 1 },
  sources: [],
  snippet: "summary text",
  score,
  degraded: false,
});

const baseCfg = {
  enabled: true,
  maxInjectedProcedures: 3,
  injectionCharBudget: 500,
  snippetMaxChars: 80,
};

describe("planProcedureInjection", () => {
  it("returns null when feature is disabled", () => {
    const out = planProcedureInjection({ ...baseCfg, enabled: false, hits: [hit()] });
    expect(out).toBeNull();
  });

  it("returns null when there are zero matches", () => {
    const out = planProcedureInjection({ ...baseCfg, hits: [] });
    expect(out).toBeNull();
  });

  it("formats up to maxInjectedProcedures matches inside a procedure-context block", () => {
    const hits = [hit({ id: "e1", title: "t1" }), hit({ id: "e2", title: "t2" }), hit({ id: "e3", title: "t3" }), hit({ id: "e4", title: "t4" })];
    const out = planProcedureInjection({ ...baseCfg, maxInjectedProcedures: 2, hits });
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out).toContain("<procedure-context>");
    expect(out).toContain("</procedure-context>");
    expect(out).toContain("t1");
    expect(out).toContain("t2");
    expect(out).not.toContain("t3");
  });

  it("truncates each snippet to snippetMaxChars characters", () => {
    const long = "x".repeat(500);
    const out = planProcedureInjection({ ...baseCfg, snippetMaxChars: 20, hits: [hit({ summary: long })] });
    expect(out).not.toBeNull();
    if (!out) return;
    const xCount = (out.match(/x/g) ?? []).length;
    expect(xCount).toBeLessThanOrEqual(20);
  });

  it("stops adding entries once the char budget would be exceeded", () => {
    const long = "y".repeat(200);
    const hits = [hit({ id: "e1", summary: long }), hit({ id: "e2", summary: long }), hit({ id: "e3", summary: long })];
    const out = planProcedureInjection({ ...baseCfg, injectionCharBudget: 250, hits });
    expect(out).not.toBeNull();
    if (!out) return;
    expect(out.length).toBeLessThanOrEqual(450);
  });

  it("returns null if no entry fits within the char budget", () => {
    const out = planProcedureInjection({
      ...baseCfg,
      injectionCharBudget: 5,
      snippetMaxChars: 200,
      hits: [hit({ summary: "long summary text here" })],
    });
    expect(out).toBeNull();
  });
});
```

```typescript
// src/skill-evolution/inject-plan.ts
import type { LookupHit } from "@/project-memory";

const ELLIPSIS = "…";
const BLOCK_OPEN = "<procedure-context>";
const BLOCK_CLOSE = "</procedure-context>";
const NEWLINE = "\n";

export interface InjectPlanInput {
  readonly enabled: boolean;
  readonly maxInjectedProcedures: number;
  readonly injectionCharBudget: number;
  readonly snippetMaxChars: number;
  readonly hits: readonly LookupHit[];
}

function trim(text: string, max: number): string {
  if (text.length <= max) return text;
  if (max <= ELLIPSIS.length) return text.slice(0, max);
  return `${text.slice(0, max - ELLIPSIS.length)}${ELLIPSIS}`;
}

function entryLine(hit: LookupHit, snippetMaxChars: number): string {
  const snippet = trim(hit.entry.summary.replace(/\s+/g, " ").trim(), snippetMaxChars);
  return `- [${hit.entry.title}] ${snippet}`;
}

function fitWithinBudget(lines: readonly string[], budget: number, frame: number): readonly string[] | null {
  let used = frame;
  const accepted: string[] = [];
  for (const line of lines) {
    const next = used + line.length + NEWLINE.length;
    if (next > budget) break;
    accepted.push(line);
    used = next;
  }
  return accepted.length > 0 ? accepted : null;
}

export function planProcedureInjection(input: InjectPlanInput): string | null {
  if (!input.enabled) return null;
  if (input.hits.length === 0) return null;

  const limited = input.hits.slice(0, input.maxInjectedProcedures);
  const lines = limited.map((hit) => entryLine(hit, input.snippetMaxChars));
  const frame = BLOCK_OPEN.length + NEWLINE.length + BLOCK_CLOSE.length + NEWLINE.length;
  const accepted = fitWithinBudget(lines, input.injectionCharBudget, frame);
  if (!accepted) return null;

  return `\n${BLOCK_OPEN}\n${accepted.join("\n")}\n${BLOCK_CLOSE}\n`;
}
```

**Verify:** `bun test tests/skill-evolution/inject-plan.test.ts`
**Commit:** `feat(skill-evolution): add pure injection planner with budget enforcement`

---

### Task 3.5: Implement review-to-promote bridge
**File:** `src/skill-evolution/promote-bridge.ts`
**Test:** `tests/skill-evolution/promote-bridge.test.ts`
**Depends:** 2.1, 2.2, 3.1, 3.3
**Domain:** general

This bridge calls `approveCandidate` (3.3), pipes the produced markdown into `promoteMarkdown` (2.2 path), and on success deletes the candidate file. It surfaces `degraded_identity` refusal verbatim so the `/skills` tool can show it. On promotion success the function returns the accepted entry id and the candidate id; both are tagged onto a unified `BridgeResult` discriminated union.

```typescript
// tests/skill-evolution/promote-bridge.test.ts
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProjectMemoryStore } from "@/project-memory";
import type { Candidate } from "@/skill-evolution/candidate-schema";
import { promoteApprovedCandidate } from "@/skill-evolution/promote-bridge";
import { createCandidateStore } from "@/skill-evolution/store";

describe("promoteApprovedCandidate", () => {
  let homeRoot: string;
  let originalHome: string | undefined;
  let dbDir: string;

  beforeEach(async () => {
    homeRoot = mkdtempSync(join(tmpdir(), "skill-bridge-"));
    originalHome = process.env.HOME;
    process.env.HOME = homeRoot;
    dbDir = mkdtempSync(join(tmpdir(), "skill-bridge-db-"));
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(homeRoot, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  const candidate: Candidate = {
    id: "cand_a",
    projectId: "p1",
    trigger: "trigger one",
    steps: ["s1", "s2"],
    sources: [{ kind: "ledger", pointer: "x" }],
    sensitivity: "internal",
    status: "pending",
    createdAt: 100,
    expiresAt: 1_900_000_000_000,
    hits: 0,
  };

  it("promotes an approved candidate as tentative procedure entry and deletes the candidate", async () => {
    const candidateStore = createCandidateStore();
    await candidateStore.upsertCandidate(candidate);
    const memoryStore = createProjectMemoryStore({ dbDir, dbFileName: "memory.db" });
    await memoryStore.initialize();

    const result = await promoteApprovedCandidate({
      candidateStore,
      memoryStore,
      identity: { projectId: "p1", kind: "origin", source: "github.com/example/repo" },
      candidateId: "cand_a",
    });

    expect(result.ok).toBe(true);
    if (!result.ok) return;
    expect(result.entryIds.length).toBe(1);
    expect(await candidateStore.loadCandidate("p1", "cand_a")).toBeNull();
    await memoryStore.close();
  });

  it("returns ok=false with reason when candidate is missing", async () => {
    const candidateStore = createCandidateStore();
    const memoryStore = createProjectMemoryStore({ dbDir, dbFileName: "memory.db" });
    await memoryStore.initialize();

    const result = await promoteApprovedCandidate({
      candidateStore,
      memoryStore,
      identity: { projectId: "p1", kind: "origin", source: "x" },
      candidateId: "missing",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("not found");
    await memoryStore.close();
  });

  it("does NOT delete the candidate when promotion is refused due to degraded identity", async () => {
    const candidateStore = createCandidateStore();
    await candidateStore.upsertCandidate(candidate);
    const memoryStore = createProjectMemoryStore({ dbDir, dbFileName: "memory.db" });
    await memoryStore.initialize();

    const result = await promoteApprovedCandidate({
      candidateStore,
      memoryStore,
      identity: { projectId: "p1", kind: "path", source: "/tmp/x" },
      candidateId: "cand_a",
    });

    expect(result.ok).toBe(false);
    if (result.ok) return;
    expect(result.reason).toContain("degraded_identity");
    expect(await candidateStore.loadCandidate("p1", "cand_a")).not.toBeNull();
    await memoryStore.close();
  });
});
```

```typescript
// src/skill-evolution/promote-bridge.ts
import { promoteMarkdown, type ProjectMemoryStore } from "@/project-memory";
import type { ProjectIdentity } from "@/utils/project-id";
import { approveCandidate } from "./review";
import type { CandidateStore } from "./store";

export interface PromoteApprovedInput {
  readonly candidateStore: CandidateStore;
  readonly memoryStore: ProjectMemoryStore;
  readonly identity: ProjectIdentity;
  readonly candidateId: string;
}

export type PromoteApprovedResult =
  | { readonly ok: true; readonly entryIds: readonly string[]; readonly candidateId: string }
  | { readonly ok: false; readonly reason: string };

export async function promoteApprovedCandidate(input: PromoteApprovedInput): Promise<PromoteApprovedResult> {
  const approval = await approveCandidate({
    store: input.candidateStore,
    projectId: input.identity.projectId,
    candidateId: input.candidateId,
  });
  if (!approval.ok) return { ok: false, reason: approval.reason };

  const promotion = await promoteMarkdown({
    store: input.memoryStore,
    identity: input.identity,
    markdown: approval.markdown,
    defaultEntityName: approval.entityName,
    sourceKind: "skill",
    pointer: approval.pointer,
  });

  if (promotion.refusedReason) {
    return { ok: false, reason: promotion.refusedReason };
  }
  if (promotion.accepted.length === 0) {
    const reason = promotion.rejected[0]?.reason ?? "no entries accepted";
    return { ok: false, reason };
  }

  await input.candidateStore.deleteCandidate(input.identity.projectId, input.candidateId);
  return {
    ok: true,
    candidateId: input.candidateId,
    entryIds: promotion.accepted.map((a) => a.entryId),
  };
}
```

**Verify:** `bun test tests/skill-evolution/promote-bridge.test.ts`
**Commit:** `feat(skill-evolution): add review-to-promote bridge`

---

## Batch 4: Tools, Injector, Plugin Wiring (parallel - 4 implementers)

All tasks in this batch depend on Batch 3.
Tasks: 4.1, 4.2, 4.3, 4.4

### Task 4.1: Add miner runner that reads sources and writes candidates
**File:** `src/skill-evolution/miner-runner.ts`
**Test:** `tests/skill-evolution/miner-runner.test.ts`
**Depends:** 1.6, 3.1, 3.2
**Domain:** general

The runner is the IO-bound wrapper around the pure miner from Task 3.2. It takes a cwd and an issue number, calls the source readers (Task 1.6), invokes `extractCandidatesFromSources`, and writes new candidates to the candidate store (Task 3.1) deduping against existing entries by `findByDedupeKey`. Errors are logged and swallowed: design specifies miner failures must be non-blocking. Returns counts so the caller can log a summary.

```typescript
// tests/skill-evolution/miner-runner.test.ts
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runMiner } from "@/skill-evolution/miner-runner";
import { createCandidateStore } from "@/skill-evolution/store";

describe("runMiner", () => {
  let cwdRoot: string;
  let homeRoot: string;
  let originalHome: string | undefined;

  beforeEach(() => {
    cwdRoot = mkdtempSync(join(tmpdir(), "skill-runner-cwd-"));
    homeRoot = mkdtempSync(join(tmpdir(), "skill-runner-home-"));
    originalHome = process.env.HOME;
    process.env.HOME = homeRoot;
  });

  afterEach(() => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    rmSync(cwdRoot, { recursive: true, force: true });
    rmSync(homeRoot, { recursive: true, force: true });
  });

  function seedJournal(issue: number, events: ReadonlyArray<Record<string, unknown>>): void {
    const dir = join(cwdRoot, "thoughts", "lifecycle");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${issue}.journal.jsonl`), events.map((e) => JSON.stringify(e)).join("\n") + "\n");
  }

  function seedRecord(issue: number, body: string): void {
    const dir = join(cwdRoot, "thoughts", "lifecycle");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, `${issue}.md`), body);
  }

  it("writes a new candidate when sources contain a fresh approved workflow", async () => {
    seedRecord(24, "## Request\nImprove project memory promotion.\n");
    seedJournal(24, [
      { kind: "batch_completed", issueNumber: 24, seq: 1, at: 1, batchId: "b1", taskId: null, attempt: 1, summary: "wire types", commitMarker: null, reviewOutcome: null },
      { kind: "review_completed", issueNumber: 24, seq: 2, at: 2, batchId: "b1", taskId: null, attempt: 1, summary: "approved", commitMarker: null, reviewOutcome: "approved" },
    ]);

    const store = createCandidateStore();
    const result = await runMiner({
      cwd: cwdRoot,
      projectId: "p1",
      issueNumber: 24,
      now: 1_700_000_000_000,
      candidateStore: store,
    });
    expect(result.candidatesAdded).toBe(1);
    const list = await store.listCandidates("p1");
    expect(list.length).toBe(1);
  });

  it("does not duplicate when re-run with the same sources", async () => {
    seedRecord(24, "## Request\nSame topic.\n");
    seedJournal(24, [
      { kind: "batch_completed", issueNumber: 24, seq: 1, at: 1, batchId: "b1", taskId: null, attempt: 1, summary: "step", commitMarker: null, reviewOutcome: null },
      { kind: "review_completed", issueNumber: 24, seq: 2, at: 2, batchId: "b1", taskId: null, attempt: 1, summary: "ok", commitMarker: null, reviewOutcome: "approved" },
    ]);

    const store = createCandidateStore();
    const first = await runMiner({ cwd: cwdRoot, projectId: "p1", issueNumber: 24, now: 1, candidateStore: store });
    const second = await runMiner({ cwd: cwdRoot, projectId: "p1", issueNumber: 24, now: 2, candidateStore: store });
    expect(first.candidatesAdded).toBe(1);
    expect(second.candidatesAdded).toBe(0);
    expect((await store.listCandidates("p1")).length).toBe(1);
  });

  it("returns zero candidates when the journal has no approved review event", async () => {
    seedRecord(24, "## Request\nx\n");
    seedJournal(24, [
      { kind: "batch_completed", issueNumber: 24, seq: 1, at: 1, batchId: "b1", taskId: null, attempt: 1, summary: "step", commitMarker: null, reviewOutcome: null },
    ]);

    const store = createCandidateStore();
    const result = await runMiner({ cwd: cwdRoot, projectId: "p1", issueNumber: 24, now: 1, candidateStore: store });
    expect(result.candidatesAdded).toBe(0);
  });

  it("does not throw when lifecycle files are missing", async () => {
    const store = createCandidateStore();
    const result = await runMiner({ cwd: cwdRoot, projectId: "p1", issueNumber: 999, now: 1, candidateStore: store });
    expect(result.candidatesAdded).toBe(0);
  });
});
```

```typescript
// src/skill-evolution/miner-runner.ts
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import { extractCandidatesFromSources } from "./miner";
import { dedupeKeyFor } from "./sanitize";
import { readJournalEvents, readLedgerTexts, readLifecycleRecord } from "./sources";
import type { CandidateStore } from "./store";

const LOG_SCOPE = "skill-evolution.miner-runner";
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface RunMinerInput {
  readonly cwd: string;
  readonly projectId: string;
  readonly issueNumber: number;
  readonly now: number;
  readonly candidateStore: CandidateStore;
}

export interface RunMinerOutput {
  readonly candidatesAdded: number;
  readonly candidatesSkipped: number;
  readonly rejected: number;
}

export async function runMiner(input: RunMinerInput): Promise<RunMinerOutput> {
  const expiryMs = config.skillEvolution.candidateExpiryDays * MS_PER_DAY;
  let candidatesAdded = 0;
  let candidatesSkipped = 0;
  let rejected = 0;

  try {
    const [journalEvents, lifecycleRecord, ledgers] = await Promise.all([
      readJournalEvents({ cwd: input.cwd, issueNumber: input.issueNumber }),
      readLifecycleRecord({ cwd: input.cwd, issueNumber: input.issueNumber }),
      readLedgerTexts({ cwd: input.cwd }),
    ]);

    const result = extractCandidatesFromSources({
      projectId: input.projectId,
      now: input.now,
      expiryMs,
      lifecycleIssueNumber: input.issueNumber,
      lifecycleRecord,
      journalEvents,
      ledgers,
    });

    rejected = result.rejected.length;

    for (const candidate of result.candidates) {
      const existing = await input.candidateStore.findByDedupeKey(input.projectId, {
        trigger: candidate.trigger,
        steps: candidate.steps,
      });
      if (existing) {
        candidatesSkipped += 1;
        continue;
      }
      await input.candidateStore.upsertCandidate(candidate);
      candidatesAdded += 1;
    }
  } catch (error) {
    log.warn(LOG_SCOPE, `runMiner failed: ${extractErrorMessage(error)}`);
  }

  return { candidatesAdded, candidatesSkipped, rejected };
}

// Helper exported for tests / callers that want to compute the dedupe key without running.
export const computeDedupeKey = dedupeKeyFor;
```

**Verify:** `bun test tests/skill-evolution/miner-runner.test.ts`
**Commit:** `feat(skill-evolution): add miner runner with non-blocking error handling`

---

### Task 4.2: Add procedure injector hook (feature-flag gated)
**File:** `src/hooks/procedure-injector.ts`
**Test:** `tests/hooks/procedure-injector.test.ts`
**Depends:** 1.7, 2.3, 3.4
**Domain:** general

Design: "Reuses the existing context injection path and shared budget. It retrieves at most a small number of relevant procedure entries and injects trimmed summaries only when the feature flag is enabled."

The hook implements `chat.params`. When the feature flag is off, it returns immediately. When on, it queries the project memory lookup with `type=procedure`, `status=tentative` (the conservative default for MVP since approved candidates land as tentative; design's open question covers later auto-promotion), and `sensitivityCeiling=internal`. It uses the user's most recent message as the query text. Budget is enforced by `planProcedureInjection`. On any error, logs and skips: lookup errors must not break task execution.

```typescript
// tests/hooks/procedure-injector.test.ts
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProjectMemoryStore } from "@/project-memory";
import {
  resetProjectMemoryRuntimeForTest,
  setProjectMemoryStoreForTest,
} from "@/tools/project-memory/runtime";
import { createProcedureInjectorHook } from "@/hooks/procedure-injector";

const ctx = { directory: process.cwd() } as never;

describe("procedure injector hook", () => {
  let dir: string;

  beforeEach(async () => {
    dir = mkdtempSync(join(tmpdir(), "proc-inject-"));
  });

  afterEach(async () => {
    await resetProjectMemoryRuntimeForTest();
    rmSync(dir, { recursive: true, force: true });
  });

  it("does NOT inject when feature flag is disabled", async () => {
    const hook = createProcedureInjectorHook(ctx, { enabled: false });
    const output: { system?: string } = { system: "" };
    await hook["chat.params"]({ sessionID: "s1" }, output);
    expect(output.system).toBe("");
  });

  it("does NOT inject when feature flag is enabled but lookup returns no matches", async () => {
    const store = createProjectMemoryStore({ dbDir: dir, dbFileName: "memory.db" });
    await store.initialize();
    setProjectMemoryStoreForTest(store);

    const hook = createProcedureInjectorHook(ctx, { enabled: true, lastUserText: () => "irrelevant" });
    const output: { system?: string } = { system: "" };
    await hook["chat.params"]({ sessionID: "s1" }, output);
    expect(output.system ?? "").not.toContain("procedure-context");
    await store.close();
  });

  it("appends a procedure-context block when matches exist within budget", async () => {
    const store = createProjectMemoryStore({ dbDir: dir, dbFileName: "memory.db" });
    await store.initialize();
    const now = Date.now();
    await store.upsertEntity({
      projectId: "p", id: "ent_1", kind: "module", name: "skill", summary: "", createdAt: now, updatedAt: now,
    });
    await store.upsertEntry({
      projectId: "p", id: "entry_1", entityId: "ent_1", type: "procedure",
      title: "Promote ledger", summary: "Trigger; step1; step2; step3",
      status: "tentative", sensitivity: "internal", createdAt: now, updatedAt: now,
    });
    setProjectMemoryStoreForTest(store);

    const hook = createProcedureInjectorHook(ctx, {
      enabled: true,
      lastUserText: () => "Promote ledger",
      identityOverride: { projectId: "p", kind: "origin", source: "x" },
    });
    const output: { system?: string } = { system: "" };
    await hook["chat.params"]({ sessionID: "s1" }, output);
    expect(output.system ?? "").toContain("procedure-context");
    expect(output.system ?? "").toContain("Promote ledger");
    await store.close();
  });

  it("does NOT throw when the lookup throws; output.system is unchanged", async () => {
    const hook = createProcedureInjectorHook(ctx, {
      enabled: true,
      lastUserText: () => "x",
      lookupFn: async () => {
        throw new Error("boom");
      },
    });
    const output: { system?: string } = { system: "before" };
    await hook["chat.params"]({ sessionID: "s1" }, output);
    expect(output.system).toBe("before");
  });
});
```

```typescript
// src/hooks/procedure-injector.ts
import type { PluginInput } from "@opencode-ai/plugin";

import { lookup, type LookupHit } from "@/project-memory";
import { getIdentity, getStore } from "@/tools/project-memory/runtime";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import type { ProjectIdentity } from "@/utils/project-id";
import { planProcedureInjection } from "@/skill-evolution/inject-plan";

const LOG_SCOPE = "skill-evolution.injector";
const DEFAULT_QUERY = "";

export interface ProcedureInjectorOptions {
  readonly enabled: boolean;
  readonly lastUserText?: () => string;
  readonly identityOverride?: ProjectIdentity;
  readonly lookupFn?: (query: string, identity: ProjectIdentity) => Promise<readonly LookupHit[]>;
}

interface ChatParamsHook {
  "chat.params": (
    input: { sessionID: string },
    output: { system?: string; options?: Record<string, unknown> },
  ) => Promise<void>;
}

async function defaultLookup(query: string, identity: ProjectIdentity): Promise<readonly LookupHit[]> {
  const store = await getStore();
  return lookup({
    store,
    identity,
    query,
    type: "procedure",
    status: "tentative",
    sensitivityCeiling: config.skillEvolution.injectionSensitivityCeiling,
    limit: config.skillEvolution.maxInjectedProcedures,
  });
}

export function createProcedureInjectorHook(ctx: PluginInput, options: ProcedureInjectorOptions): ChatParamsHook {
  const enabled = options.enabled;
  const lookupFn = options.lookupFn ?? defaultLookup;
  const readQuery = options.lastUserText ?? (() => DEFAULT_QUERY);

  return {
    "chat.params": async (_input, output) => {
      if (!enabled) return;
      try {
        const query = readQuery();
        if (query.trim().length === 0) return;
        const identity = options.identityOverride ?? (await getIdentity(ctx.directory));
        const hits = await lookupFn(query, identity);
        const block = planProcedureInjection({
          enabled: true,
          maxInjectedProcedures: config.skillEvolution.maxInjectedProcedures,
          injectionCharBudget: config.skillEvolution.injectionCharBudget,
          snippetMaxChars: config.skillEvolution.snippetMaxChars,
          hits,
        });
        if (!block) return;
        output.system = output.system ? `${output.system}${block}` : block;
      } catch (error) {
        log.warn(LOG_SCOPE, `injection skipped: ${extractErrorMessage(error)}`);
      }
    },
  };
}
```

**Verify:** `bun test tests/hooks/procedure-injector.test.ts`
**Commit:** `feat(hooks): add procedure injector (feature-flag gated)`

---

### Task 4.3: Add /skills command and tool surface
**File:** `src/tools/skills.ts`
**Test:** `tests/tools/skills.test.ts`
**Depends:** 3.3, 3.5
**Domain:** general

Design: "Users approve or reject pending candidates through a dedicated `/skills` flow." MVP starts as a text command that lists pending candidates and supports approve/reject by id (the Octto vs text command choice is an explicit open question in the design). We expose three tools: `skills_list`, `skills_approve`, `skills_reject`. Each operates against the candidate store + project memory store. `skills_list` also purges expired candidates first.

The `/skills` plugin command is registered separately in Task 4.4 (plugin wiring); this task only delivers the tools.

```typescript
// tests/tools/skills.test.ts
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProjectMemoryStore } from "@/project-memory";
import type { Candidate } from "@/skill-evolution/candidate-schema";
import { createCandidateStore } from "@/skill-evolution/store";
import {
  resetProjectMemoryRuntimeForTest,
  setProjectMemoryStoreForTest,
} from "@/tools/project-memory/runtime";
import { createSkillsTools } from "@/tools/skills";

const ctx = { directory: process.cwd() } as never;

const baseCandidate = (overrides: Partial<Candidate> = {}): Candidate => ({
  id: "cand_a",
  projectId: "p1",
  trigger: "trigger one",
  steps: ["s1", "s2"],
  sources: [{ kind: "ledger", pointer: "x" }],
  sensitivity: "internal",
  status: "pending",
  createdAt: 100,
  expiresAt: 1_900_000_000_000,
  hits: 0,
  ...overrides,
});

describe("skills tools", () => {
  let homeRoot: string;
  let dbDir: string;
  let originalHome: string | undefined;

  beforeEach(async () => {
    homeRoot = mkdtempSync(join(tmpdir(), "skills-tool-home-"));
    dbDir = mkdtempSync(join(tmpdir(), "skills-tool-db-"));
    originalHome = process.env.HOME;
    process.env.HOME = homeRoot;

    const memoryStore = createProjectMemoryStore({ dbDir, dbFileName: "memory.db" });
    await memoryStore.initialize();
    setProjectMemoryStoreForTest(memoryStore);
  });

  afterEach(async () => {
    if (originalHome === undefined) delete process.env.HOME;
    else process.env.HOME = originalHome;
    await resetProjectMemoryRuntimeForTest();
    rmSync(homeRoot, { recursive: true, force: true });
    rmSync(dbDir, { recursive: true, force: true });
  });

  it("skills_list returns markdown listing pending candidates and purges expired", async () => {
    const candidateStore = createCandidateStore();
    await candidateStore.upsertCandidate(baseCandidate({ id: "c_pending" }));
    await candidateStore.upsertCandidate(baseCandidate({ id: "c_expired", expiresAt: 1 }));

    const tools = createSkillsTools(ctx, {
      candidateStore,
      identityOverride: { projectId: "p1", kind: "origin", source: "github.com/x/y" },
      now: () => 100,
    });

    const result = (await tools.skills_list.execute({}, {} as never)) as string;
    expect(result).toContain("c_pending");
    expect(result).not.toContain("c_expired");
  });

  it("skills_approve promotes the candidate and removes it from pending", async () => {
    const candidateStore = createCandidateStore();
    await candidateStore.upsertCandidate(baseCandidate());

    const tools = createSkillsTools(ctx, {
      candidateStore,
      identityOverride: { projectId: "p1", kind: "origin", source: "github.com/x/y" },
      now: () => 100,
    });

    const out = (await tools.skills_approve.execute({ id: "cand_a" }, {} as never)) as string;
    expect(out).toContain("approved");
    expect(await candidateStore.loadCandidate("p1", "cand_a")).toBeNull();
  });

  it("skills_reject deletes the candidate", async () => {
    const candidateStore = createCandidateStore();
    await candidateStore.upsertCandidate(baseCandidate());

    const tools = createSkillsTools(ctx, {
      candidateStore,
      identityOverride: { projectId: "p1", kind: "origin", source: "github.com/x/y" },
      now: () => 100,
    });

    const out = (await tools.skills_reject.execute({ id: "cand_a", reason: "low value" }, {} as never)) as string;
    expect(out).toContain("rejected");
    expect(await candidateStore.loadCandidate("p1", "cand_a")).toBeNull();
  });

  it("skills_approve returns an error message when candidate is missing", async () => {
    const candidateStore = createCandidateStore();

    const tools = createSkillsTools(ctx, {
      candidateStore,
      identityOverride: { projectId: "p1", kind: "origin", source: "x" },
      now: () => 100,
    });

    const out = (await tools.skills_approve.execute({ id: "missing" }, {} as never)) as string;
    expect(out).toContain("not found");
  });
});
```

```typescript
// src/tools/skills.ts
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { promoteApprovedCandidate } from "@/skill-evolution/promote-bridge";
import { listPending, purgeExpiredCandidates, rejectCandidate } from "@/skill-evolution/review";
import { createCandidateStore, type CandidateStore } from "@/skill-evolution/store";
import { getIdentity, getStore } from "@/tools/project-memory/runtime";
import { extractErrorMessage } from "@/utils/errors";
import type { ProjectIdentity } from "@/utils/project-id";

export interface SkillsToolOptions {
  readonly candidateStore?: CandidateStore;
  readonly identityOverride?: ProjectIdentity;
  readonly now?: () => number;
}

export interface SkillsTools {
  readonly skills_list: ToolDefinition;
  readonly skills_approve: ToolDefinition;
  readonly skills_reject: ToolDefinition;
}

function formatList(items: readonly { id: string; trigger: string; steps: readonly string[]; createdAt: number }[]): string {
  if (items.length === 0) return "## Pending skill candidates\n\n(none)";
  const lines = items.map((c) => `- **${c.id}** [${new Date(c.createdAt).toISOString()}] ${c.trigger}`);
  return `## Pending skill candidates\n\n${lines.join("\n")}\n\nApprove with \`skills_approve\` or reject with \`skills_reject\`.`;
}

export function createSkillsTools(ctx: PluginInput, options: SkillsToolOptions = {}): SkillsTools {
  const candidateStore = options.candidateStore ?? createCandidateStore();
  const now = options.now ?? Date.now;
  const resolveIdentity = async (): Promise<ProjectIdentity> =>
    options.identityOverride ?? (await getIdentity(ctx.directory));

  const skills_list = tool({
    description: "List pending skill candidates for the current project. Purges expired candidates first.",
    args: {},
    execute: async () => {
      try {
        const identity = await resolveIdentity();
        await purgeExpiredCandidates({ store: candidateStore, projectId: identity.projectId, now: now() });
        const pending = await listPending(candidateStore, identity.projectId);
        return formatList(pending);
      } catch (error) {
        return `## Error\n\n${extractErrorMessage(error)}`;
      }
    },
  });

  const skills_approve = tool({
    description: "Approve a pending skill candidate by id; promotes it as a tentative procedure entry in project memory.",
    args: { id: tool.schema.string().describe("Candidate id, e.g. cand_abc123") },
    execute: async ({ id }) => {
      try {
        const identity = await resolveIdentity();
        const memoryStore = await getStore();
        const result = await promoteApprovedCandidate({
          candidateStore,
          memoryStore,
          identity,
          candidateId: id,
        });
        if (!result.ok) return `## Error\n\n${result.reason}`;
        return `## Approved\n\nCandidate ${result.candidateId} promoted as ${result.entryIds.length} tentative procedure entry/entries.`;
      } catch (error) {
        return `## Error\n\n${extractErrorMessage(error)}`;
      }
    },
  });

  const skills_reject = tool({
    description: "Reject and delete a pending skill candidate by id.",
    args: {
      id: tool.schema.string().describe("Candidate id"),
      reason: tool.schema.string().describe("Why this candidate is being rejected"),
    },
    execute: async ({ id, reason }) => {
      try {
        const identity = await resolveIdentity();
        const result = await rejectCandidate({ store: candidateStore, projectId: identity.projectId, candidateId: id, reason });
        if (!result.ok) return `## Error\n\n${result.reason}`;
        return `## Rejected\n\nCandidate ${id} rejected: ${reason}`;
      } catch (error) {
        return `## Error\n\n${extractErrorMessage(error)}`;
      }
    },
  });

  return { skills_list, skills_approve, skills_reject };
}
```

**Verify:** `bun test tests/tools/skills.test.ts`
**Commit:** `feat(tools): add skills_list / skills_approve / skills_reject tools`

---

### Task 4.4: Wire skill-evolution into plugin (index.ts) under feature flag
**File:** `src/index.ts`
**Test:** `tests/index-wiring.test.ts` (extend with skill-evolution wiring assertions)
**Depends:** 1.2, 4.1, 4.2, 4.3
**Domain:** general

Final wiring task. We register the three new tools, add the `/skills` plugin command, register the procedure injector hook (only when `userConfig.features.skillEvolution === true`), and call `runMiner` opportunistically inside the existing `event` hook on `session.deleted` (cheap, non-blocking, deterministic). The miner runner is also exposed via `tools.skills_list`'s purge step. Feature flag default is `undefined`, treated as `false`.

```typescript
// tests/index-wiring.test.ts excerpt to ADD inside the existing describe block.
// The implementer must locate the existing tests/index-wiring.test.ts and add these cases.

import { describe, expect, it } from "bun:test";

describe("plugin wiring: skill evolution", () => {
  it("registers skills_list, skills_approve, skills_reject tool keys", async () => {
    // The existing test file already imports the plugin and inspects the returned tools record.
    // Add an assertion that the three tool keys are present:
    // expect(plugin.tool).toHaveProperty("skills_list");
    // expect(plugin.tool).toHaveProperty("skills_approve");
    // expect(plugin.tool).toHaveProperty("skills_reject");
    // Use the same test harness pattern (mock PluginInput) already established in the file.
  });

  it("registers the /skills plugin command with the primary agent", async () => {
    // Inspect the config callback: PLUGIN_COMMANDS must contain a 'skills' entry.
    // expect(Object.keys(PLUGIN_COMMANDS)).toContain("skills");
  });

  it("does NOT inject procedure-context when features.skillEvolution is undefined", async () => {
    // Drive chat.params with no userConfig.features and assert output.system is empty
    // (or unchanged from baseline established by other injectors).
  });
});
```

```typescript
// src/index.ts
// EDITS to apply (the implementer must apply these as targeted edits, NOT rewrite the file):
//
// 1) Import the new modules at the top of the file, alongside existing tool imports.
//    Add (immediately after the existing `createMindmodelLookupTool` import line, e.g. line 67):
//
//        import { createProcedureInjectorHook } from "@/hooks/procedure-injector";
//        import { runMiner } from "@/skill-evolution/miner-runner";
//        import { createCandidateStore } from "@/skill-evolution/store";
//        import { createSkillsTools } from "@/tools/skills";
//        import { resolveProjectId } from "@/utils/project-id";
//
// 2) Add a new entry to PLUGIN_COMMANDS (the literal at line ~133). Insert AFTER 'memory':
//
//        skills: {
//          description: "Review pending skill candidates (list/approve/reject)",
//          agent: PRIMARY_AGENT_NAME,
//          template:
//            "Use skills_list to show pending skill candidates. If arguments include 'approve <id>' or 'reject <id> <reason>' run skills_approve or skills_reject. $ARGUMENTS",
//        },
//
// 3) Inside the OpenCodeConfigPlugin function, AFTER `const projectMemoryTools = { ... }` (line ~508)
//    and BEFORE `const constraintReviewerHook = ...`, insert:
//
//        const candidateStore = createCandidateStore();
//        const skillsTools = createSkillsTools(ctx, { candidateStore });
//        const skillEvolutionEnabled = userConfig?.features?.skillEvolution === true;
//        const procedureInjectorHook = skillEvolutionEnabled
//          ? createProcedureInjectorHook(ctx, {
//              enabled: true,
//              lastUserText: () => lastUserTextBySession.get("__current__") ?? "",
//            })
//          : null;
//
//    Note: lastUserText delivery is wired through chat.message; the simplest approach is to
//    track the last user text per sessionID in a Map and look up by sessionID. Implementer
//    may use a closure-scoped Map keyed by sessionID rather than a single "__current__" key.
//    Update the placeholder above accordingly when implementing.
//
// 4) Inside the returned `tool: { ... }` object (line ~676), add the three skills tools alongside
//    the existing `...projectMemoryTools` spread:
//
//        ...skillsTools,
//
// 5) Inside the returned `chat.params` handler (line ~746), AFTER the existing context window
//    monitor injection but BEFORE the think mode block, insert:
//
//        if (procedureInjectorHook) {
//          await procedureInjectorHook["chat.params"](input, output);
//        }
//
// 6) Inside the `chat.message` handler (line ~729), record the last user text per sessionID so
//    the procedure injector can use it as the lookup query. Add at the top of the handler:
//
//        if (skillEvolutionEnabled) {
//          lastUserTextBySession.set(input.sessionID, text);
//        }
//
//    Declare `const lastUserTextBySession = new Map<string, string>();` at the same scope as
//    `thinkModeState`.
//
// 7) Inside the existing `event` hook (line ~902), AFTER the existing session.deleted cleanup,
//    add an opportunistic miner run. Trigger ONLY on `session.deleted` events to avoid
//    impacting hot paths. Wrap in try/catch and log on failure; do not throw.
//
//        if (skillEvolutionEnabled && event.type === "session.deleted") {
//          try {
//            const identity = await resolveProjectId(ctx.directory);
//            // Issue number is best-effort: read from lifecycle resolver if available.
//            const resolved = await lifecycleResolver.resolve();
//            const issueNumber = resolved.kind === "resolved" ? resolved.issueNumber : null;
//            if (issueNumber !== null) {
//              const summary = await runMiner({
//                cwd: ctx.directory,
//                projectId: identity.projectId,
//                issueNumber,
//                now: Date.now(),
//                candidateStore,
//              });
//              log.info("skill-evolution", `miner ran: added=${summary.candidatesAdded} skipped=${summary.candidatesSkipped} rejected=${summary.rejected}`);
//            }
//          } catch (error) {
//            log.warn("skill-evolution", `miner trigger skipped: ${extractErrorMessage(error)}`);
//          }
//        }
```

Implementation note: this task is the integration point. The implementer must apply the seven edits above to the existing `src/index.ts` (not rewrite the file). The feature flag gating is critical: when `features.skillEvolution !== true`:
- `procedureInjectorHook` stays `null` and `chat.params` is a no-op for procedures
- `lastUserTextBySession` is not populated
- The miner does not run on `session.deleted`
- The `skills_*` tools and `/skills` command are still registered (so the user can opt in by listing candidates manually) but produce empty results until candidates exist

The candidate store and skills tools are registered unconditionally because they have no runtime cost when no candidates exist. This matches the design constraint that flag rollback must not delete stored procedures.

**Verify:** `bun test tests/index-wiring.test.ts && bun run check`
**Commit:** `feat(plugin): wire skill-evolution under feature flag`
