# Project Memory Core Implementation Plan

**Goal:** Add a project-scoped durable memory layer (entities, entries, relations, sources) over the existing artifact / mindmodel / lifecycle stores, with safety-checked promotion driven by lifecycle finish, while preserving every current `/ledger`, `/search`, `/mindmodel`, `artifact_search`, `milestone_artifact_search`, and `mindmodel_lookup` behavior.

**Architecture:** Project Memory Core is an additive SQLite-backed structured index that lives alongside the current artifact-index database, keyed by a stable `projectId` derived from the git remote / repo root. Promotion is explicit (lifecycle finish + manual tool), guarded by secret detection and project-identity checks. Existing tools are untouched; new memory tools (`project_memory_lookup`, `project_memory_promote`, `project_memory_health`, `project_memory_forget`) are the new entry point.

**Design:** [thoughts/shared/designs/2026-04-28-project-memory-core-design.md](../designs/2026-04-28-project-memory-core-design.md)

**Contract:** none (single-domain plan: every task is `general` or `backend`, no frontend surface — see Domain audit below)

---

## Senior-engineer gap-filling decisions

Decisions made because the design intentionally left the HOW open. Implementer must follow these unless escalated.

- **Storage location.** `~/.config/opencode/project-memory/<projectId>/memory.db` (SQLite via `bun:sqlite`), with one DB file per project. This keeps memory worktree-independent (the directory is outside any repo), per-project (no cross-project leakage at the storage boundary), and reuses the existing `~/.config/opencode/artifact-index` precedent.
- **Project identity (`projectId`).** Resolve from `git config --get remote.origin.url`, normalize to `host/owner/repo` (lowercased, `.git` stripped), hash with SHA-1 and take the first 16 hex chars. Worktrees inherit `origin`, so all worktrees of the same repo collapse to the same `projectId`. Fallback when no `origin`: SHA-1 of the absolute git toplevel path; mark resolution as `degraded` and refuse durable writes.
- **Schema.** Four tables (`entities`, `entries`, `relations`, `sources`) plus FTS5 virtual tables for entry titles + summaries. All rows carry `project_id` as the leading column; every query filters by `project_id` first. Status / sensitivity / type are first-class indexed columns, ranking happens after structured filtering.
- **Sensitivity model.** Three levels: `public`, `internal`, `secret`. Secret-detection rejects on insert (it does not silently store). Internal is the default for promoted lifecycle content.
- **Secret detection.** Regex pack covering: AWS keys, GCP / Azure keys, generic `(?:api|secret|token|password|key)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}`, GitHub tokens (`ghp_`, `gho_`, `ghu_`, `ghs_`, `ghr_`, `github_pat_`), JWT shape, and PEM block headers. Match → reject with reason; redaction is reserved for v2.
- **Promotion source format.** Markdown sections; each section header becomes one entry candidate. Lifecycle summary parsing extracts: decisions (anything under `## Decisions` / `## Key Decisions`), risks (`## Risks`), lessons (`## Lessons` / `## Lessons Learned`), and follow-ups (`## Follow-ups` / `## Open Questions`). Free-form summaries are stored as a single `note` entry.
- **Status vocabulary.** `active`, `superseded`, `tentative`, `hypothesis`, `deprecated`. Supersedes is recorded as a relation (`supersedes`), not by deletion.
- **Lookup ranking.** FTS5 BM25 score, then sort active > tentative > hypothesis > superseded > deprecated, then by recency. Lookup never returns full payload by default (only title + summary + source pointer + 240-char snippet).
- **Forget semantics.** Hard delete from base tables and FTS shadow tables in one transaction; orphaned relations are also deleted. Audit is out of scope for v1 (call sites log via `log.info`).
- **Compatibility facade.** Existing `artifact_search`, `milestone_artifact_search`, `mindmodel_lookup` keep their current behavior bit-for-bit. The new `project_memory_lookup` is documented as the preferred higher-level entry point, but no existing tool is removed, renamed, or rewired. `/search` continues to call the existing `artifact_search`.
- **Lifecycle finish hook.** `applyFinishOutcome` in `src/lifecycle/index.ts` already decides when a finish is successful. We add a new `promoteOnFinish(record, outcome)` step that runs *only on successful merge*, *after* `closeMergedIssue`, and *before* the final `saveAndSync`. Failures are best-effort: a promotion error appends a note (`memory_promotion_failed: <reason>`) but never blocks the finish.
- **No vector search, no automatic chat capture.** All entries originate from explicit promotion calls. Out of scope for v1.

---

## Domain audit (every task)

All work is server-side / Node-only. No UI, no React, no CSS. Therefore:

- Tasks creating SQLite schema, migrations, store factories, identity resolver, secret detection, lookup implementation, promotion pipeline, lifecycle hook → **backend** (server-side data + business logic).
- Tasks creating tool wrappers (the `tool({...})` definitions registered with the plugin), config additions, registry / index re-exports → **general** (cross-cutting plugin wiring).
- No `frontend` tasks.

Cross-domain trigger condition not met → **no contract document is generated.**

---

## Dependency Graph

```
Batch 1 (parallel, foundation, no deps):
  1.1 config additions (paths, sensitivity levels, status vocabulary)
  1.2 project identity resolver (utils/project-id.ts)
  1.3 secret detector (utils/secret-detect.ts)
  1.4 memory types module (project-memory/types.ts)
  1.5 memory schema SQL (project-memory/schema.sql)

Batch 2 (parallel, store + parsing, depends on Batch 1):
  2.1 memory store factory (project-memory/store.ts) [depends 1.1, 1.2, 1.4, 1.5]
  2.2 promotion source parser (project-memory/parser.ts) [depends 1.4]
  2.3 lookup formatter (project-memory/format.ts) [depends 1.4]

Batch 3 (parallel, business logic, depends on Batch 2):
  3.1 promotion pipeline (project-memory/promote.ts) [depends 2.1, 2.2, 1.3]
  3.2 lookup service (project-memory/lookup.ts) [depends 2.1, 2.3]
  3.3 health service (project-memory/health.ts) [depends 2.1]
  3.4 forget service (project-memory/forget.ts) [depends 2.1]
  3.5 module barrel (project-memory/index.ts) [depends 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4 — last in batch via re-export only]

Batch 4 (parallel, tool surface, depends on Batch 3):
  4.1 project_memory_lookup tool (tools/project-memory/lookup.ts)
  4.2 project_memory_promote tool (tools/project-memory/promote.ts)
  4.3 project_memory_health tool (tools/project-memory/health.ts)
  4.4 project_memory_forget tool (tools/project-memory/forget.ts)
  4.5 tools barrel (tools/project-memory/index.ts)

Batch 5 (sequential single-task, integration):
  5.1 lifecycle finish promotion hook (src/lifecycle/index.ts edit) [depends 3.1]
  5.2 plugin wiring (src/index.ts + src/tools/index.ts edits) [depends 4.5]

Batch 6 (parallel, end-to-end and compatibility tests, depends on Batch 5):
  6.1 isolation E2E test
  6.2 worktree durability E2E test
  6.3 lifecycle-finish-promotes E2E test
  6.4 secret-rejection E2E test
  6.5 compatibility regression test (artifact_search / milestone_artifact_search / mindmodel_lookup unchanged)
```

Total: ~24 micro-tasks across 6 batches. Batches 1–4 each fan out to 5+ parallel implementers.

---

## Batch 1: Foundation (parallel — 5 implementers)

### Task 1.1: Config additions for project memory
**File:** `src/utils/config.ts`
**Test:** `tests/utils/config.test.ts` (extend existing)
**Depends:** none
**Domain:** general

Add a new `projectMemory` block to the existing `config` object. Do not touch other blocks.

```typescript
// Test additions (append inside existing describe block, in tests/utils/config.test.ts)
import { config } from "@/utils/config";

describe("projectMemory config", () => {
  it("exposes a stable storage directory under the user opencode config root", () => {
    expect(config.projectMemory.storageDir).toMatch(/\.config\/opencode\/project-memory$/);
  });

  it("declares the sensitivity vocabulary", () => {
    expect(config.projectMemory.sensitivity).toEqual(["public", "internal", "secret"]);
  });

  it("declares the entry status vocabulary", () => {
    expect(config.projectMemory.statuses).toEqual(["active", "superseded", "tentative", "hypothesis", "deprecated"]);
  });

  it("defaults the lookup result limit to 10", () => {
    expect(config.projectMemory.defaultLookupLimit).toBe(10);
  });
});
```

```typescript
// Implementation: insert this block inside the `export const config = { ... } as const;` literal,
// just before the closing `} as const;`.

  projectMemory: {
    storageDir: join(homedir(), ".config", "opencode", "project-memory"),
    dbFileName: "memory.db",
    sensitivity: ["public", "internal", "secret"] as readonly string[],
    statuses: ["active", "superseded", "tentative", "hypothesis", "deprecated"] as readonly string[],
    defaultLookupLimit: 10,
    snippetMaxChars: 240,
    promoteOnLifecycleFinish: true,
    /** When project identity cannot be resolved, refuse durable writes. */
    refuseWritesOnDegradedIdentity: true,
  },
```

You will need two new imports at the top of `src/utils/config.ts`:

```typescript
import { homedir } from "node:os";
import { join } from "node:path";
```

**Verify:** `bun test tests/utils/config.test.ts`
**Commit:** `feat(memory): add projectMemory config block`

---

### Task 1.2: Project identity resolver
**File:** `src/utils/project-id.ts`
**Test:** `tests/utils/project-id.test.ts`
**Depends:** none
**Domain:** backend

Pure helper: given a working directory, return `{ projectId, kind, source }` where `kind` is `"origin"` or `"path"` (degraded). Uses `bun` `$` for git, falls back to git toplevel hash when origin missing.

```typescript
// tests/utils/project-id.test.ts
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync, mkdirSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

import { resolveProjectId } from "@/utils/project-id";

let workdir: string;

beforeEach(async () => {
  workdir = mkdtempSync(join(tmpdir(), "pid-"));
  await $`git init -q`.cwd(workdir);
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("resolveProjectId", () => {
  it("derives a stable id from origin url when present", async () => {
    await $`git remote add origin https://github.com/Wuxie233/micode.git`.cwd(workdir);
    const a = await resolveProjectId(workdir);
    const b = await resolveProjectId(workdir);
    expect(a.kind).toBe("origin");
    expect(a.projectId).toEqual(b.projectId);
    expect(a.projectId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("normalizes ssh and https forms of the same remote to the same id", async () => {
    await $`git remote add origin https://github.com/Wuxie233/micode.git`.cwd(workdir);
    const httpsId = (await resolveProjectId(workdir)).projectId;
    await $`git remote set-url origin git@github.com:Wuxie233/micode.git`.cwd(workdir);
    const sshId = (await resolveProjectId(workdir)).projectId;
    expect(sshId).toBe(httpsId);
  });

  it("falls back to git toplevel hash when origin is missing", async () => {
    const result = await resolveProjectId(workdir);
    expect(result.kind).toBe("path");
    expect(result.projectId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("returns kind=path when not in a git repo", async () => {
    const plain = mkdtempSync(join(tmpdir(), "plain-"));
    try {
      const result = await resolveProjectId(plain);
      expect(result.kind).toBe("path");
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});
```

```typescript
// src/utils/project-id.ts
import { createHash } from "node:crypto";
import { resolve } from "node:path";
import { $ } from "bun";

import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

const ID_LENGTH = 16;
const SSH_REMOTE_PATTERN = /^git@([^:]+):(.+)$/;
const TRAILING_GIT = /\.git$/;

export interface ProjectIdentity {
  readonly projectId: string;
  readonly kind: "origin" | "path";
  readonly source: string;
}

function hash(input: string): string {
  return createHash("sha1").update(input).digest("hex").slice(0, ID_LENGTH);
}

function normalizeRemote(remote: string): string {
  const trimmed = remote.trim();
  const sshMatch = SSH_REMOTE_PATTERN.exec(trimmed);
  if (sshMatch) {
    const host = sshMatch[1].toLowerCase();
    const path = sshMatch[2].toLowerCase().replace(TRAILING_GIT, "");
    return `${host}/${path}`;
  }
  try {
    const url = new URL(trimmed);
    const host = url.host.toLowerCase();
    const path = url.pathname.toLowerCase().replace(/^\/+/, "").replace(TRAILING_GIT, "");
    return `${host}/${path}`;
  } catch {
    return trimmed.toLowerCase().replace(TRAILING_GIT, "");
  }
}

async function readOrigin(cwd: string): Promise<string | null> {
  try {
    const result = await $`git config --get remote.origin.url`.cwd(cwd).quiet();
    const text = result.stdout.toString().trim();
    return text.length > 0 ? text : null;
  } catch (error) {
    log.debug("project-id", `origin lookup failed: ${extractErrorMessage(error)}`);
    return null;
  }
}

async function readToplevel(cwd: string): Promise<string> {
  try {
    const result = await $`git rev-parse --show-toplevel`.cwd(cwd).quiet();
    const text = result.stdout.toString().trim();
    return text.length > 0 ? text : resolve(cwd);
  } catch {
    return resolve(cwd);
  }
}

export async function resolveProjectId(cwd: string): Promise<ProjectIdentity> {
  const origin = await readOrigin(cwd);
  if (origin) {
    const source = normalizeRemote(origin);
    return { projectId: hash(source), kind: "origin", source };
  }
  const toplevel = await readToplevel(cwd);
  return { projectId: hash(toplevel), kind: "path", source: toplevel };
}
```

**Verify:** `bun test tests/utils/project-id.test.ts`
**Commit:** `feat(memory): add project identity resolver`

---

### Task 1.3: Secret detector
**File:** `src/utils/secret-detect.ts`
**Test:** `tests/utils/secret-detect.test.ts`
**Depends:** none
**Domain:** backend

Pure regex pipeline. Returns first match with reason, or null.

```typescript
// tests/utils/secret-detect.test.ts
import { describe, expect, it } from "bun:test";
import { detectSecret } from "@/utils/secret-detect";

describe("detectSecret", () => {
  it("returns null for clean text", () => {
    expect(detectSecret("decided to cache user permissions for 30s")).toBeNull();
  });

  it("flags AWS access keys", () => {
    expect(detectSecret("AKIAIOSFODNN7EXAMPLE")?.reason).toBe("aws_access_key");
  });

  it("flags GitHub PAT prefixes", () => {
    expect(detectSecret("token=ghp_abcdefghijklmnopqrstuvwxyz0123456789")?.reason).toBe("github_token");
  });

  it("flags generic api key patterns", () => {
    expect(detectSecret('api_key: "Z9d0a8e3f5c7b2a1Z9d0a8e3"')?.reason).toBe("generic_secret");
  });

  it("flags PEM blocks", () => {
    expect(detectSecret("-----BEGIN RSA PRIVATE KEY-----")?.reason).toBe("pem_block");
  });

  it("flags JWT-shaped tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(detectSecret(jwt)?.reason).toBe("jwt");
  });
});
```

```typescript
// src/utils/secret-detect.ts
const PATTERNS: ReadonlyArray<{ readonly reason: string; readonly regex: RegExp }> = [
  { reason: "aws_access_key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { reason: "github_token", regex: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { reason: "pem_block", regex: /-----BEGIN [A-Z ]+PRIVATE KEY-----/ },
  { reason: "jwt", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { reason: "generic_secret", regex: /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_\-]{16,}["']?/i },
];

export interface SecretMatch {
  readonly reason: string;
  readonly index: number;
}

export function detectSecret(text: string): SecretMatch | null {
  for (const { reason, regex } of PATTERNS) {
    const match = regex.exec(text);
    if (match) return { reason, index: match.index };
  }
  return null;
}
```

**Verify:** `bun test tests/utils/secret-detect.test.ts`
**Commit:** `feat(memory): add secret detector for promotion guard`

---

### Task 1.4: Memory types module
**File:** `src/project-memory/types.ts`
**Test:** `tests/project-memory/types.test.ts`
**Depends:** none
**Domain:** backend

Pure type definitions and Valibot schemas. No runtime logic beyond schema parsing.

```typescript
// tests/project-memory/types.test.ts
import { describe, expect, it } from "bun:test";
import * as v from "valibot";

import { EntrySchema, EntityKindValues, EntryTypeValues, RelationKindValues } from "@/project-memory/types";

describe("project-memory types", () => {
  it("declares the entity kind vocabulary", () => {
    expect(EntityKindValues).toContain("workflow");
    expect(EntityKindValues).toContain("module");
    expect(EntityKindValues).toContain("decision_area");
  });

  it("declares the entry type vocabulary", () => {
    expect(EntryTypeValues).toEqual(["fact", "decision", "rationale", "lesson", "risk", "todo", "open_question", "hypothesis", "note"]);
  });

  it("declares the relation kinds vocabulary", () => {
    expect(RelationKindValues).toEqual(["parent", "related", "supersedes"]);
  });

  it("rejects entries with unknown sensitivity", () => {
    const result = v.safeParse(EntrySchema, {
      id: "e_1", projectId: "abc", entityId: "ent_1",
      type: "decision", title: "x", summary: "y",
      status: "active", sensitivity: "ultra-public", createdAt: 1, updatedAt: 1,
    });
    expect(result.success).toBe(false);
  });

  it("accepts a well-formed entry", () => {
    const result = v.safeParse(EntrySchema, {
      id: "e_1", projectId: "abc", entityId: "ent_1",
      type: "decision", title: "x", summary: "y",
      status: "active", sensitivity: "internal", createdAt: 1, updatedAt: 1,
    });
    expect(result.success).toBe(true);
  });
});
```

```typescript
// src/project-memory/types.ts
import * as v from "valibot";

export const EntityKindValues = [
  "workflow",
  "module",
  "tool",
  "feature",
  "risk_area",
  "decision_area",
] as const;

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
] as const;

export const SensitivityValues = ["public", "internal", "secret"] as const;
export const StatusValues = ["active", "superseded", "tentative", "hypothesis", "deprecated"] as const;
export const RelationKindValues = ["parent", "related", "supersedes"] as const;
export const SourceKindValues = ["design", "plan", "ledger", "lifecycle", "mindmodel", "manual"] as const;

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
**Commit:** `feat(memory): add project-memory type vocabulary and schemas`

---

### Task 1.5: Memory schema SQL
**File:** `src/project-memory/schema.sql`
**Test:** none (config asset; covered indirectly by the store test in 2.1)
**Depends:** none
**Domain:** backend

```sql
-- src/project-memory/schema.sql
CREATE TABLE IF NOT EXISTS entities (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  kind TEXT NOT NULL,
  name TEXT NOT NULL,
  summary TEXT,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, id)
);
CREATE INDEX IF NOT EXISTS idx_entities_project_kind ON entities (project_id, kind);

CREATE TABLE IF NOT EXISTS entries (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  type TEXT NOT NULL,
  title TEXT NOT NULL,
  summary TEXT NOT NULL,
  status TEXT NOT NULL,
  sensitivity TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, id)
);
CREATE INDEX IF NOT EXISTS idx_entries_project_status ON entries (project_id, status);
CREATE INDEX IF NOT EXISTS idx_entries_project_type ON entries (project_id, type);
CREATE INDEX IF NOT EXISTS idx_entries_entity ON entries (project_id, entity_id);

CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
  id UNINDEXED,
  project_id UNINDEXED,
  title,
  summary
);

CREATE TABLE IF NOT EXISTS relations (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  from_id TEXT NOT NULL,
  to_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, id)
);
CREATE INDEX IF NOT EXISTS idx_relations_from ON relations (project_id, from_id);
CREATE INDEX IF NOT EXISTS idx_relations_to ON relations (project_id, to_id);

CREATE TABLE IF NOT EXISTS sources (
  project_id TEXT NOT NULL,
  id TEXT NOT NULL,
  entry_id TEXT NOT NULL,
  kind TEXT NOT NULL,
  pointer TEXT NOT NULL,
  excerpt TEXT,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (project_id, id)
);
CREATE INDEX IF NOT EXISTS idx_sources_entry ON sources (project_id, entry_id);
CREATE INDEX IF NOT EXISTS idx_sources_kind ON sources (project_id, kind);
```

The schema must be readable both as a bundled file and via inline fallback (mirroring `src/tools/artifact-index/index.ts` `getInlineSchema`). Task 2.1 adds the inline fallback.

**Verify:** `ls src/project-memory/schema.sql`
**Commit:** `feat(memory): add project-memory sqlite schema`

---

## Batch 2: Store + parsing (parallel — 3 implementers)

### Task 2.1: Memory store factory
**File:** `src/project-memory/store.ts`
**Test:** `tests/project-memory/store.test.ts`
**Depends:** 1.1, 1.2, 1.4, 1.5
**Domain:** backend

Mirror the pattern in `src/tools/artifact-index/index.ts`: `bun:sqlite`, schema file with inline fallback, factory function returning a `ProjectMemoryStore` interface. Must be project-scoped (every read/write filters by `project_id` from the resolved identity).

Test must cover: insert/query for each table, FTS hit, isolation between two `projectId`s sharing the same DB directory, transactional `forget`, idempotent `initialize`.

```typescript
// tests/project-memory/store.test.ts (essentials)
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProjectMemoryStore } from "@/project-memory/store";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "memstore-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("ProjectMemoryStore", () => {
  it("isolates entries by projectId", async () => {
    const store = createProjectMemoryStore({ dbDir: dir });
    await store.initialize();
    await store.upsertEntity({ projectId: "p1", id: "e1", kind: "module", name: "auth", createdAt: 1, updatedAt: 1 });
    await store.upsertEntity({ projectId: "p2", id: "e1", kind: "module", name: "auth", createdAt: 1, updatedAt: 1 });
    await store.upsertEntry({ projectId: "p1", id: "x1", entityId: "e1", type: "decision", title: "A", summary: "alpha", status: "active", sensitivity: "internal", createdAt: 1, updatedAt: 1 });
    const hitsP1 = await store.searchEntries("p1", "alpha", { limit: 5 });
    const hitsP2 = await store.searchEntries("p2", "alpha", { limit: 5 });
    expect(hitsP1.length).toBe(1);
    expect(hitsP2.length).toBe(0);
    await store.close();
  });

  it("forget by project removes entries, sources, relations atomically", async () => {
    const store = createProjectMemoryStore({ dbDir: dir });
    await store.initialize();
    await store.upsertEntity({ projectId: "p1", id: "e1", kind: "module", name: "auth", createdAt: 1, updatedAt: 1 });
    await store.upsertEntry({ projectId: "p1", id: "x1", entityId: "e1", type: "decision", title: "A", summary: "alpha", status: "active", sensitivity: "internal", createdAt: 1, updatedAt: 1 });
    await store.upsertSource({ projectId: "p1", id: "s1", entryId: "x1", kind: "design", pointer: "thoughts/...md", createdAt: 1 });
    await store.forgetProject("p1");
    expect(await store.countEntries("p1")).toBe(0);
    expect(await store.countSources("p1")).toBe(0);
    await store.close();
  });

  it("filter by status / type before ranking", async () => {
    const store = createProjectMemoryStore({ dbDir: dir });
    await store.initialize();
    await store.upsertEntity({ projectId: "p1", id: "e1", kind: "module", name: "auth", createdAt: 1, updatedAt: 1 });
    await store.upsertEntry({ projectId: "p1", id: "x1", entityId: "e1", type: "decision", title: "A", summary: "alpha bravo", status: "active", sensitivity: "internal", createdAt: 1, updatedAt: 1 });
    await store.upsertEntry({ projectId: "p1", id: "x2", entityId: "e1", type: "risk", title: "B", summary: "alpha bravo", status: "deprecated", sensitivity: "internal", createdAt: 1, updatedAt: 1 });
    const onlyDecisions = await store.searchEntries("p1", "alpha", { type: "decision", limit: 5 });
    const onlyActive = await store.searchEntries("p1", "alpha", { status: "active", limit: 5 });
    expect(onlyDecisions.length).toBe(1);
    expect(onlyActive.length).toBe(1);
    await store.close();
  });
});
```

```typescript
// src/project-memory/store.ts (skeleton — implementer fills bodies)
import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { config } from "@/utils/config";
import type { Entity, Entry, EntryType, Relation, Source, Status } from "./types";

const ERR_NOT_INITIALIZED = "Project memory store not initialized";

export interface SearchEntriesOptions {
  readonly type?: EntryType;
  readonly status?: Status;
  readonly entityId?: string;
  readonly sensitivityCeiling?: "public" | "internal";
  readonly limit?: number;
}

export interface SearchHit {
  readonly entry: Entry;
  readonly score: number;
}

export interface ProjectMemoryStoreOptions {
  readonly dbDir?: string;
  readonly dbFileName?: string;
}

export interface ProjectMemoryStore {
  initialize(): Promise<void>;
  upsertEntity(entity: Entity): Promise<void>;
  upsertEntry(entry: Entry): Promise<void>;
  upsertRelation(relation: Relation): Promise<void>;
  upsertSource(source: Source): Promise<void>;
  loadEntity(projectId: string, id: string): Promise<Entity | null>;
  loadEntry(projectId: string, id: string): Promise<Entry | null>;
  loadSourcesForEntry(projectId: string, entryId: string): Promise<readonly Source[]>;
  searchEntries(projectId: string, query: string, options?: SearchEntriesOptions): Promise<readonly SearchHit[]>;
  countEntities(projectId: string): Promise<number>;
  countEntries(projectId: string): Promise<number>;
  countEntriesByStatus(projectId: string): Promise<Record<Status, number>>;
  countSources(projectId: string): Promise<number>;
  countMissingSources(projectId: string): Promise<number>;
  forgetEntry(projectId: string, entryId: string): Promise<void>;
  forgetEntity(projectId: string, entityId: string): Promise<void>;
  forgetSource(projectId: string, kind: string, pointer: string): Promise<void>;
  forgetProject(projectId: string): Promise<void>;
  close(): Promise<void>;
}

export function createProjectMemoryStore(options: ProjectMemoryStoreOptions = {}): ProjectMemoryStore {
  const dbDir = options.dbDir ?? config.projectMemory.storageDir;
  const dbFileName = options.dbFileName ?? config.projectMemory.dbFileName;
  let db: Database | null = null;

  const requireDb = (): Database => {
    if (!db) throw new Error(ERR_NOT_INITIALIZED);
    return db;
  };

  // Implementer: define escapeFtsQuery, getInlineSchema (mirrors src/tools/artifact-index/index.ts pattern),
  // and helpers for each upsert/load/forget. forgetProject must run inside db.transaction(() => {...})()
  // and must clean both base tables and entries_fts.

  return {
    async initialize() { /* mkdir, open db, run schema (file or inline) */ },
    async upsertEntity(entity) { /* INSERT ... ON CONFLICT DO UPDATE */ },
    async upsertEntry(entry) { /* upsert + maintain entries_fts */ },
    async upsertRelation(relation) { /* upsert */ },
    async upsertSource(source) { /* upsert */ },
    async loadEntity(projectId, id) { /* SELECT */ return null; },
    async loadEntry(projectId, id) { /* SELECT */ return null; },
    async loadSourcesForEntry(projectId, entryId) { /* SELECT */ return []; },
    async searchEntries(projectId, query, opts = {}) { /* FTS MATCH + structured filters */ return []; },
    async countEntities(projectId) { return 0; },
    async countEntries(projectId) { return 0; },
    async countEntriesByStatus(projectId) { return {} as Record<Status, number>; },
    async countSources(projectId) { return 0; },
    async countMissingSources(projectId) { return 0; },
    async forgetEntry(projectId, entryId) { /* delete + delete fts row + cascade sources/relations referencing this entry */ },
    async forgetEntity(projectId, entityId) { /* delete entity + all entries with this entityId (cascading via forgetEntry) */ },
    async forgetSource(projectId, kind, pointer) { /* delete matching source rows */ },
    async forgetProject(projectId) { /* transactional delete from all 4 base tables + fts shadow */ },
    async close() { db?.close(); db = null; },
  };
}
```

The implementer must read `src/tools/artifact-index/index.ts` and replicate (a) schema-file-with-inline-fallback loading via `import.meta.path`, (b) `escapeFtsQuery` style escaping, (c) `bun:sqlite` prepared statements with explicit row types. The schema fallback string lives inside this file so the bundled `dist/index.js` works without the `.sql` file present.

**Verify:** `bun test tests/project-memory/store.test.ts`
**Commit:** `feat(memory): add project-memory sqlite store`

---

### Task 2.2: Promotion source parser
**File:** `src/project-memory/parser.ts`
**Test:** `tests/project-memory/parser.test.ts`
**Depends:** 1.4
**Domain:** backend

Parses a markdown document (lifecycle summary, design, plan, ledger) into candidate `{ entityName, entryType, title, summary }` records. Pure function, no IO.

```typescript
// tests/project-memory/parser.test.ts
import { describe, expect, it } from "bun:test";
import { extractCandidates } from "@/project-memory/parser";

describe("extractCandidates", () => {
  it("emits decision candidates from a Decisions section", () => {
    const md = `## Decisions\n- Cache TTL set to 30s for permission lookups\n- Use SQLite WAL mode\n`;
    const result = extractCandidates({ markdown: md, defaultEntityName: "auth", sourceKind: "lifecycle", pointer: "thoughts/lifecycle/123.md" });
    expect(result.candidates.length).toBe(2);
    expect(result.candidates[0].entryType).toBe("decision");
  });

  it("emits risk candidates from a Risks section", () => {
    const md = `## Risks\n- Cache invalidation race during permission updates\n`;
    const r = extractCandidates({ markdown: md, defaultEntityName: "auth", sourceKind: "lifecycle", pointer: "x" });
    expect(r.candidates[0].entryType).toBe("risk");
  });

  it("emits lessons from a Lessons or Lessons Learned section", () => {
    const md = `## Lessons Learned\n- Promotion must run after merge, not before\n`;
    const r = extractCandidates({ markdown: md, defaultEntityName: "lifecycle", sourceKind: "lifecycle", pointer: "x" });
    expect(r.candidates[0].entryType).toBe("lesson");
  });

  it("emits open questions from Open Questions / Follow-ups", () => {
    const md = `## Follow-ups\n- Decide remote sync format\n`;
    const r = extractCandidates({ markdown: md, defaultEntityName: "memory", sourceKind: "design", pointer: "x" });
    expect(r.candidates[0].entryType).toBe("open_question");
  });

  it("falls back to a single note candidate when no recognized section is found", () => {
    const md = `Just a free form summary.`;
    const r = extractCandidates({ markdown: md, defaultEntityName: "memory", sourceKind: "manual", pointer: "x" });
    expect(r.candidates.length).toBe(1);
    expect(r.candidates[0].entryType).toBe("note");
  });
});
```

```typescript
// src/project-memory/parser.ts
import type { EntryType, SourceKind } from "./types";

const SECTION_PATTERNS: ReadonlyArray<{ readonly type: EntryType; readonly headers: readonly RegExp[] }> = [
  { type: "decision", headers: [/^##\s+Decisions?\b/im, /^##\s+Key Decisions\b/im] },
  { type: "risk", headers: [/^##\s+Risks?\b/im] },
  { type: "lesson", headers: [/^##\s+Lessons?(?:\s+Learned)?\b/im] },
  { type: "open_question", headers: [/^##\s+Open Questions?\b/im, /^##\s+Follow-?ups?\b/im] },
];
const BULLET_PATTERN = /^\s*[-*+]\s+(.+?)\s*$/gm;
const TITLE_MAX_CHARS = 96;

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

function deriveTitle(summary: string): string {
  const firstLine = summary.split("\n", 1)[0]?.trim() ?? "";
  if (firstLine.length <= TITLE_MAX_CHARS) return firstLine;
  return `${firstLine.slice(0, TITLE_MAX_CHARS - 1)}…`;
}

function extractSection(markdown: string, headerPattern: RegExp): string | null {
  const match = headerPattern.exec(markdown);
  if (!match) return null;
  const start = match.index + match[0].length;
  const rest = markdown.slice(start);
  const next = /^##\s+/m.exec(rest);
  return next ? rest.slice(0, next.index).trim() : rest.trim();
}

function extractBullets(section: string): readonly string[] {
  const bullets: string[] = [];
  const pattern = new RegExp(BULLET_PATTERN.source, BULLET_PATTERN.flags);
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(section)) !== null) {
    bullets.push(match[1].trim());
  }
  return bullets;
}

export function extractCandidates(input: PromotionInput): PromotionExtraction {
  const candidates: PromotionCandidate[] = [];
  for (const { type, headers } of SECTION_PATTERNS) {
    for (const header of headers) {
      const section = extractSection(input.markdown, header);
      if (!section) continue;
      for (const summary of extractBullets(section)) {
        candidates.push({
          entityName: input.defaultEntityName,
          entryType: type,
          title: deriveTitle(summary),
          summary,
          sourceKind: input.sourceKind,
          pointer: input.pointer,
        });
      }
    }
  }
  if (candidates.length === 0) {
    const summary = input.markdown.trim().slice(0, 1000);
    if (summary.length > 0) {
      candidates.push({
        entityName: input.defaultEntityName,
        entryType: "note",
        title: deriveTitle(summary),
        summary,
        sourceKind: input.sourceKind,
        pointer: input.pointer,
      });
    }
  }
  return { candidates };
}
```

**Verify:** `bun test tests/project-memory/parser.test.ts`
**Commit:** `feat(memory): add promotion source parser`

---

### Task 2.3: Lookup formatter
**File:** `src/project-memory/format.ts`
**Test:** `tests/project-memory/format.test.ts`
**Depends:** 1.4
**Domain:** backend

Pure formatter that turns `LookupHit[]` into the markdown the lookup tool returns. No raw payload, just title + summary snippet + source pointers.

```typescript
// tests/project-memory/format.test.ts
import { describe, expect, it } from "bun:test";
import { formatLookupResults } from "@/project-memory/format";

describe("formatLookupResults", () => {
  it("renders an empty-state line when there are no hits", () => {
    expect(formatLookupResults("perm cache", [])).toContain("No project memory entries");
  });

  it("renders entry title, type, status, source pointers, and snippet", () => {
    const out = formatLookupResults("perm cache", [{
      entry: { id: "x1", projectId: "p", entityId: "e1", type: "decision", title: "Cache TTL 30s", summary: "Decided to cache permissions for 30s", status: "active", sensitivity: "internal", createdAt: 1, updatedAt: 1 },
      entity: { id: "e1", projectId: "p", kind: "module", name: "auth", createdAt: 1, updatedAt: 1 },
      sources: [{ id: "s1", projectId: "p", entryId: "x1", kind: "design", pointer: "thoughts/shared/designs/2026-04-28.md", createdAt: 1 }],
      snippet: "Decided to cache permissions for 30s",
      score: 1.5,
      degraded: false,
    }]);
    expect(out).toContain("Cache TTL 30s");
    expect(out).toContain("decision");
    expect(out).toContain("auth");
    expect(out).toContain("thoughts/shared/designs/2026-04-28.md");
  });

  it("marks degraded entries with a warning glyph", () => {
    const out = formatLookupResults("x", [{
      entry: { id: "x1", projectId: "p", entityId: "e1", type: "fact", title: "T", summary: "S", status: "active", sensitivity: "internal", createdAt: 1, updatedAt: 1 },
      entity: { id: "e1", projectId: "p", kind: "module", name: "auth", createdAt: 1, updatedAt: 1 },
      sources: [], snippet: "S", score: 1, degraded: true,
    }]);
    expect(out.toLowerCase()).toContain("degraded");
  });
});
```

```typescript
// src/project-memory/format.ts
import type { LookupHit } from "./types";

const HEADER = "## Project Memory";
const NO_RESULTS = "No project memory entries match this query. Falling back to raw artifact search may help.";

function formatSources(hit: LookupHit): string {
  if (hit.sources.length === 0) return "(no source pointers)";
  return hit.sources.map((s) => `\`${s.kind}\` → \`${s.pointer}\``).join(", ");
}

function formatHit(hit: LookupHit): string {
  const flags: string[] = [];
  if (hit.degraded) flags.push("degraded");
  if (hit.entry.status !== "active") flags.push(hit.entry.status);
  const flagText = flags.length > 0 ? ` _(${flags.join(", ")})_` : "";
  return [
    `### ${hit.entry.title}${flagText}`,
    `- **Entity:** ${hit.entity.name} (${hit.entity.kind})`,
    `- **Type:** ${hit.entry.type}`,
    `- **Sources:** ${formatSources(hit)}`,
    `- **Snippet:** ${hit.snippet}`,
  ].join("\n");
}

export function formatLookupResults(query: string, hits: readonly LookupHit[]): string {
  if (hits.length === 0) return `${HEADER}\n\n${NO_RESULTS}`;
  const body = hits.map(formatHit).join("\n\n");
  return `${HEADER}\n\nQuery: \`${query}\` — ${hits.length} result(s)\n\n${body}`;
}
```

**Verify:** `bun test tests/project-memory/format.test.ts`
**Commit:** `feat(memory): add project-memory lookup formatter`

---

## Batch 3: Business logic (parallel — 5 implementers)

### Task 3.1: Promotion pipeline
**File:** `src/project-memory/promote.ts`
**Test:** `tests/project-memory/promote.test.ts`
**Depends:** 2.1, 2.2, 1.3
**Domain:** backend

Orchestrates: identity check → secret detection → entity ensure → entry insert → source insert. Each candidate is a transaction. Reject on degraded identity (per `config.projectMemory.refuseWritesOnDegradedIdentity`). Return a structured outcome (per-candidate accepted/rejected with reason).

Key rules from the design's Error Handling section:
- Project identity failure → refuse durable writes.
- Secret detection failure → reject the candidate, don't store.
- Promotion uncertainty → if the source kind is `design` or `plan` (pre-merge artifacts), force `status = "tentative"`. Lifecycle finish promotions get `status = "active"`.

```typescript
// tests/project-memory/promote.test.ts (essentials)
import { describe, expect, it, beforeEach, afterEach } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createProjectMemoryStore } from "@/project-memory/store";
import { promoteMarkdown } from "@/project-memory/promote";

let dir: string;
beforeEach(() => { dir = mkdtempSync(join(tmpdir(), "promote-")); });
afterEach(() => { rmSync(dir, { recursive: true, force: true }); });

describe("promoteMarkdown", () => {
  it("rejects candidates containing secrets", async () => {
    const store = createProjectMemoryStore({ dbDir: dir });
    await store.initialize();
    const md = `## Decisions\n- Use API key ${"sk_live_"}${"abcdefghijklmnopqrstuvwx"} for billing\n`;
    const result = await promoteMarkdown({ store, identity: { projectId: "p1", kind: "origin", source: "x" }, markdown: md, defaultEntityName: "billing", sourceKind: "lifecycle", pointer: "x" });
    expect(result.rejected.length).toBe(1);
    expect(result.rejected[0].reason).toContain("secret");
    expect(result.accepted.length).toBe(0);
    await store.close();
  });

  it("refuses durable writes on degraded identity", async () => {
    const store = createProjectMemoryStore({ dbDir: dir });
    await store.initialize();
    const result = await promoteMarkdown({ store, identity: { projectId: "p1", kind: "path", source: "x" }, markdown: "## Decisions\n- Cache for 30s\n", defaultEntityName: "auth", sourceKind: "lifecycle", pointer: "x" });
    expect(result.refusedReason).toBe("degraded_identity");
    await store.close();
  });

  it("marks design / plan promotions as tentative", async () => {
    const store = createProjectMemoryStore({ dbDir: dir });
    await store.initialize();
    const result = await promoteMarkdown({ store, identity: { projectId: "p1", kind: "origin", source: "x" }, markdown: "## Decisions\n- Cache for 30s\n", defaultEntityName: "auth", sourceKind: "design", pointer: "x" });
    expect(result.accepted[0].status).toBe("tentative");
    await store.close();
  });

  it("marks lifecycle promotions as active", async () => {
    const store = createProjectMemoryStore({ dbDir: dir });
    await store.initialize();
    const result = await promoteMarkdown({ store, identity: { projectId: "p1", kind: "origin", source: "x" }, markdown: "## Decisions\n- Cache for 30s\n", defaultEntityName: "auth", sourceKind: "lifecycle", pointer: "x" });
    expect(result.accepted[0].status).toBe("active");
    await store.close();
  });
});
```

```typescript
// src/project-memory/promote.ts (skeleton — implementer fills bodies)
import { createHash, randomUUID } from "node:crypto";

import { config } from "@/utils/config";
import { detectSecret } from "@/utils/secret-detect";
import type { ProjectIdentity } from "@/utils/project-id";
import { extractCandidates, type PromotionCandidate } from "./parser";
import type { ProjectMemoryStore } from "./store";
import type { Entry, SourceKind, Status } from "./types";

export interface PromoteInput {
  readonly store: ProjectMemoryStore;
  readonly identity: ProjectIdentity;
  readonly markdown: string;
  readonly defaultEntityName: string;
  readonly sourceKind: SourceKind;
  readonly pointer: string;
}

export interface PromoteAccepted {
  readonly entryId: string;
  readonly title: string;
  readonly status: Status;
}

export interface PromoteRejected {
  readonly title: string;
  readonly reason: string;
}

export interface PromoteOutcome {
  readonly accepted: readonly PromoteAccepted[];
  readonly rejected: readonly PromoteRejected[];
  readonly refusedReason: string | null;
}

const TENTATIVE_KINDS: ReadonlySet<SourceKind> = new Set(["design", "plan"]);

function statusFor(kind: SourceKind): Status {
  if (TENTATIVE_KINDS.has(kind)) return "tentative";
  return "active";
}

function entityIdFor(projectId: string, name: string): string {
  return `ent_${createHash("sha1").update(`${projectId}/${name}`).digest("hex").slice(0, 12)}`;
}

export async function promoteMarkdown(input: PromoteInput): Promise<PromoteOutcome> {
  if (input.identity.kind !== "origin" && config.projectMemory.refuseWritesOnDegradedIdentity) {
    return { accepted: [], rejected: [], refusedReason: "degraded_identity" };
  }
  // Implementer:
  // 1. extractCandidates(...)
  // 2. for each candidate: detectSecret(candidate.summary). If matched → push to rejected with reason.
  // 3. ensure entity exists (upsertEntity if first time per (projectId, entityName))
  // 4. upsertEntry with status = statusFor(input.sourceKind), sensitivity = "internal"
  // 5. upsertSource referencing entry
  // Return aggregated outcome.
  return { accepted: [], rejected: [], refusedReason: null };
}
```

**Verify:** `bun test tests/project-memory/promote.test.ts`
**Commit:** `feat(memory): add promotion pipeline with secret guard`

---

### Task 3.2: Lookup service
**File:** `src/project-memory/lookup.ts`
**Test:** `tests/project-memory/lookup.test.ts`
**Depends:** 2.1, 2.3
**Domain:** backend

Wraps `store.searchEntries` with: identity resolution, structured filtering (status/type/entity), source attachment, snippet trimming to `config.projectMemory.snippetMaxChars`, and degraded marking when source pointer is missing.

```typescript
// src/project-memory/lookup.ts (skeleton)
import { config } from "@/utils/config";
import type { ProjectIdentity } from "@/utils/project-id";
import type { ProjectMemoryStore } from "./store";
import type { EntryType, LookupHit, Status } from "./types";

export interface LookupInput {
  readonly store: ProjectMemoryStore;
  readonly identity: ProjectIdentity;
  readonly query: string;
  readonly type?: EntryType;
  readonly status?: Status;
  readonly entityId?: string;
  readonly limit?: number;
}

const STATUS_RANK: Record<Status, number> = {
  active: 0, tentative: 1, hypothesis: 2, superseded: 3, deprecated: 4,
};

function trimSnippet(summary: string): string {
  const max = config.projectMemory.snippetMaxChars;
  if (summary.length <= max) return summary;
  return `${summary.slice(0, max - 1)}…`;
}

export async function lookup(input: LookupInput): Promise<readonly LookupHit[]> {
  const limit = input.limit ?? config.projectMemory.defaultLookupLimit;
  const hits = await input.store.searchEntries(input.identity.projectId, input.query, {
    type: input.type, status: input.status, entityId: input.entityId, limit,
  });
  // Implementer:
  // - For each hit: load entity, load sources, build LookupHit { snippet, degraded: sources.length === 0, score }.
  // - Sort by (statusRank asc, score desc, updatedAt desc).
  return [];
}
```

Test must cover: filters apply before ranking; status sort order; snippet truncated to configured length; `degraded: true` when no sources attached.

**Verify:** `bun test tests/project-memory/lookup.test.ts`
**Commit:** `feat(memory): add project-memory lookup service`

---

### Task 3.3: Health service
**File:** `src/project-memory/health.ts`
**Test:** `tests/project-memory/health.test.ts`
**Depends:** 2.1
**Domain:** backend

Aggregates counts from the store + identity warnings. Returns `HealthReport` from `types.ts`. Stale = `updatedAt` older than 90 days.

```typescript
// src/project-memory/health.ts (skeleton)
import type { ProjectIdentity } from "@/utils/project-id";
import type { ProjectMemoryStore } from "./store";
import type { HealthReport } from "./types";

const STALE_DAYS = 90;
const MS_PER_DAY = 86_400_000;

export async function buildHealthReport(store: ProjectMemoryStore, identity: ProjectIdentity): Promise<HealthReport> {
  const warnings: string[] = [];
  if (identity.kind !== "origin") warnings.push("identity_degraded: origin not resolved");
  // Implementer:
  // - call store.countEntities, countEntries, countEntriesByStatus, countMissingSources
  // - compute staleEntryCount via a new store method (add: store.countStaleEntries(projectId, olderThanMs))
  //   IMPLEMENTER NOTE: add this method to the store interface in 2.1 if missing — coordinate with reviewer.
  return { /* fill */ } as HealthReport;
}
```

If the store method `countStaleEntries` is missing, the implementer adds it to `src/project-memory/store.ts` and exports it from the interface. Update the test in 2.1 accordingly.

**Verify:** `bun test tests/project-memory/health.test.ts`
**Commit:** `feat(memory): add project-memory health service`

---

### Task 3.4: Forget service
**File:** `src/project-memory/forget.ts`
**Test:** `tests/project-memory/forget.test.ts`
**Depends:** 2.1
**Domain:** backend

Thin orchestrator over `store.forgetEntry` / `store.forgetEntity` / `store.forgetSource` / `store.forgetProject`. Validates input, refuses cross-project deletion (caller's `identity.projectId` must equal target).

```typescript
// src/project-memory/forget.ts
import type { ProjectIdentity } from "@/utils/project-id";
import type { ProjectMemoryStore } from "./store";

export type ForgetTarget =
  | { readonly kind: "project" }
  | { readonly kind: "entity"; readonly entityId: string }
  | { readonly kind: "entry"; readonly entryId: string }
  | { readonly kind: "source"; readonly sourceKind: string; readonly pointer: string };

export interface ForgetInput {
  readonly store: ProjectMemoryStore;
  readonly identity: ProjectIdentity;
  readonly target: ForgetTarget;
}

export interface ForgetOutcome {
  readonly removed: number;
  readonly target: ForgetTarget;
}

export async function forget(input: ForgetInput): Promise<ForgetOutcome> {
  const pid = input.identity.projectId;
  switch (input.target.kind) {
    case "project": {
      const entries = await input.store.countEntries(pid);
      const entities = await input.store.countEntities(pid);
      await input.store.forgetProject(pid);
      return { removed: entries + entities, target: input.target };
    }
    case "entity": {
      await input.store.forgetEntity(pid, input.target.entityId);
      return { removed: 1, target: input.target };
    }
    case "entry": {
      await input.store.forgetEntry(pid, input.target.entryId);
      return { removed: 1, target: input.target };
    }
    case "source": {
      await input.store.forgetSource(pid, input.target.sourceKind, input.target.pointer);
      return { removed: 1, target: input.target };
    }
  }
}
```

Test: each target kind round-trips correctly; FTS shadow rows are also deleted (verified by re-running `searchEntries` after forget).

**Verify:** `bun test tests/project-memory/forget.test.ts`
**Commit:** `feat(memory): add project-memory forget service`

---

### Task 3.5: Module barrel
**File:** `src/project-memory/index.ts`
**Test:** none (re-export only; covered by integration tests in Batch 6)
**Depends:** 2.1, 2.2, 2.3, 3.1, 3.2, 3.3, 3.4
**Domain:** general

```typescript
// src/project-memory/index.ts
export type { Entity, Entry, EntryType, HealthReport, LookupHit, Relation, RelationKind, Sensitivity, Source, SourceKind, Status } from "./types";
export { EntityKindValues, EntryTypeValues, RelationKindValues, SensitivityValues, SourceKindValues, StatusValues } from "./types";
export { createProjectMemoryStore, type ProjectMemoryStore, type SearchEntriesOptions, type SearchHit } from "./store";
export { extractCandidates, type PromotionCandidate, type PromotionInput, type PromotionExtraction } from "./parser";
export { formatLookupResults } from "./format";
export { promoteMarkdown, type PromoteInput, type PromoteOutcome, type PromoteAccepted, type PromoteRejected } from "./promote";
export { lookup, type LookupInput } from "./lookup";
export { buildHealthReport } from "./health";
export { forget, type ForgetInput, type ForgetOutcome, type ForgetTarget } from "./forget";
```

**Verify:** `bun build src/project-memory/index.ts --target=bun --outfile=/tmp/pm-barrel.js`
**Commit:** `feat(memory): add project-memory barrel`

---

## Batch 4: Tool surface (parallel — 5 implementers)

Each tool follows the existing factory pattern (`createXTool(ctx: PluginInput) => { tool_name: ToolDefinition }`) seen in `src/tools/mindmodel-lookup.ts`. Each tool internally:

1. Resolves the identity via `resolveProjectId(ctx.directory)`.
2. Lazily creates a singleton `ProjectMemoryStore`, calls `initialize()` once.
3. Catches all errors and returns a friendly `## Error` message via `extractErrorMessage`.
4. Never throws.

The shared singleton lives inside `src/tools/project-memory/store-singleton.ts` (created opportunistically by whichever tool runs first). To avoid scattering this concern across 4 tasks, declare a tiny shared helper here:

> **Shared helper for Batch 4 (one file, place inside tools/project-memory):**
>
> `src/tools/project-memory/runtime.ts` — exports `getStore(): Promise<ProjectMemoryStore>` (lazy singleton) and `getIdentity(directory): Promise<ProjectIdentity>`. The implementer of any task in Batch 4 may add this file; subsequent tasks reuse it. If two implementers both add it, the reviewer keeps the first. (This is the only intentional coordination point in Batch 4.)

### Task 4.1: project_memory_lookup tool
**File:** `src/tools/project-memory/lookup.ts`
**Test:** `tests/tools/project-memory/lookup.test.ts`
**Depends:** 3.5
**Domain:** general

Tool name: `project_memory_lookup`. Args: `query` (string, required), `type` (enum from `EntryTypeValues`, optional), `status` (enum from `StatusValues`, optional), `limit` (number, optional). Returns the markdown produced by `formatLookupResults`.

```typescript
// src/tools/project-memory/lookup.ts (skeleton)
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { EntryTypeValues, StatusValues, formatLookupResults, lookup } from "@/project-memory";
import { extractErrorMessage } from "@/utils/errors";
import { getIdentity, getStore } from "./runtime";

export function createProjectMemoryLookupTool(ctx: PluginInput): { project_memory_lookup: ToolDefinition } {
  const project_memory_lookup = tool({
    description: `Look up durable project memory entries (decisions, lessons, risks, facts) scoped to the current project.
Prefer this over reading raw thoughts/ files when you only need conclusions.`,
    args: {
      query: tool.schema.string().describe("Topic to search (e.g., 'permission cache TTL')"),
      type: tool.schema.enum(EntryTypeValues).optional().describe("Filter by entry type"),
      status: tool.schema.enum(StatusValues).optional().describe("Filter by status (default: active)"),
      limit: tool.schema.number().optional().describe("Max results (default: 10)"),
    },
    execute: async (args) => {
      try {
        const store = await getStore();
        const identity = await getIdentity(ctx.directory);
        const hits = await lookup({
          store, identity,
          query: args.query,
          type: args.type as never,
          status: (args.status ?? "active") as never,
          limit: args.limit,
        });
        return formatLookupResults(args.query, hits);
      } catch (error) {
        return `## Error\n\n${extractErrorMessage(error)}`;
      }
    },
  });
  return { project_memory_lookup };
}
```

**Verify:** `bun test tests/tools/project-memory/lookup.test.ts`
**Commit:** `feat(memory): add project_memory_lookup tool`

---

### Task 4.2: project_memory_promote tool
**File:** `src/tools/project-memory/promote.ts`
**Test:** `tests/tools/project-memory/promote.test.ts`
**Depends:** 3.5
**Domain:** general

Tool name: `project_memory_promote`. Args: `markdown` (string, required), `entity_name` (string, required), `source_kind` (enum from `SourceKindValues`), `pointer` (string, required). Returns a markdown summary table of accepted / rejected candidates.

The implementer mirrors the format used in `src/tools/lifecycle/finish.ts` (header + table + note). The tool refuses with a clear message when `outcome.refusedReason === "degraded_identity"`.

**Verify:** `bun test tests/tools/project-memory/promote.test.ts`
**Commit:** `feat(memory): add project_memory_promote tool`

---

### Task 4.3: project_memory_health tool
**File:** `src/tools/project-memory/health.ts`
**Test:** `tests/tools/project-memory/health.test.ts`
**Depends:** 3.5
**Domain:** general

Tool name: `project_memory_health`. No args. Returns a markdown report (entity / entry counts, breakdown by status, stale count, missing-source count, identity warnings).

**Verify:** `bun test tests/tools/project-memory/health.test.ts`
**Commit:** `feat(memory): add project_memory_health tool`

---

### Task 4.4: project_memory_forget tool
**File:** `src/tools/project-memory/forget.ts`
**Test:** `tests/tools/project-memory/forget.test.ts`
**Depends:** 3.5
**Domain:** general

Tool name: `project_memory_forget`. Args: `target` (enum: `project | entity | entry | source`, required) plus `entity_id`, `entry_id`, `source_kind`, `pointer` (each optional, validated by `target`). Refuses if required fields for the chosen target are missing.

Safety: when `target === "project"`, returns a confirmation echo (`Removed N entries / M entities for project <id-prefix>`).

**Verify:** `bun test tests/tools/project-memory/forget.test.ts`
**Commit:** `feat(memory): add project_memory_forget tool`

---

### Task 4.5: Tools barrel
**File:** `src/tools/project-memory/index.ts`
**Test:** none
**Depends:** 4.1, 4.2, 4.3, 4.4
**Domain:** general

```typescript
// src/tools/project-memory/index.ts
export { createProjectMemoryLookupTool } from "./lookup";
export { createProjectMemoryPromoteTool } from "./promote";
export { createProjectMemoryHealthTool } from "./health";
export { createProjectMemoryForgetTool } from "./forget";
```

**Verify:** `bun build src/tools/project-memory/index.ts --target=bun --outfile=/tmp/pmt-barrel.js`
**Commit:** `feat(memory): add project-memory tools barrel`

---

## Batch 5: Integration (sequential — 2 tasks)

### Task 5.1: Lifecycle finish promotion hook
**File:** `src/lifecycle/index.ts` (edit, single function added + single call site)
**Test:** `tests/lifecycle/promote-on-finish.test.ts`
**Depends:** 3.1
**Domain:** backend

Modify only the existing `createFinisher` function (lines 424–439) to call a new internal helper `promoteFinishedRecord(record, outcome)` *after* `closeMergedIssue` and *before* `saveAndSync`. The helper:

1. Returns immediately when `!outcome.merged`, when `!config.projectMemory.promoteOnLifecycleFinish`, or when promotion errors. Errors append a single note (`memory_promotion_failed: <reason>`) but never throw.
2. Reads the lifecycle issue body (or the latest ledger pointer in `record.artifacts.ledger`) as the markdown source. Prefer the ledger pointer when available because it already holds Decisions / Risks / Lessons headings; fall back to the issue body.
3. Resolves identity via `resolveProjectId(context.cwd)`.
4. Calls `promoteMarkdown({ store, identity, markdown, defaultEntityName: \`issue-${record.issueNumber}\`, sourceKind: "lifecycle", pointer: \`issue/${record.issueNumber}\` })`.
5. Appends a single note `memory_promoted: <accepted_count> entries` (or `memory_rejected: <reason>` when nothing accepted).

Do **not** change any other lifecycle behavior. Existing tests in `tests/lifecycle/*` and `tests/tools/lifecycle/*` must keep passing.

The helper accepts the store as a parameter so the test can inject a temporary one. Use the same lazy singleton from `src/tools/project-memory/runtime.ts` in production via a small bridge function exported from `src/project-memory/index.ts` (`getDefaultStore()` — implementer adds this to `index.ts` when wiring 5.1).

```typescript
// tests/lifecycle/promote-on-finish.test.ts (sketch)
// - Build a fake LifecycleRunner that returns a "merged" outcome.
// - Build a temp ProjectMemoryStore in tmpdir, inject via a test seam.
// - Run finish() and assert: store contains accepted entries with sourceKind=lifecycle.
// - Run finish() with a non-merged outcome and assert: store contains nothing.
// - Run finish() with promoteMarkdown forced to throw and assert: outcome.merged still true and a memory_promotion_failed note was appended.
```

**Verify:** `bun test tests/lifecycle/promote-on-finish.test.ts && bun test tests/lifecycle/`
**Commit:** `feat(memory): promote lifecycle finish into project memory`

---

### Task 5.2: Plugin wiring
**Files:** `src/tools/index.ts` (edit), `src/index.ts` (edit)
**Test:** `tests/index-wiring.test.ts` (extend existing)
**Depends:** 4.5, 5.1
**Domain:** general

In `src/tools/index.ts`, add:

```typescript
export { createProjectMemoryForgetTool, createProjectMemoryHealthTool, createProjectMemoryLookupTool, createProjectMemoryPromoteTool } from "./project-memory";
```

In `src/index.ts`, register the 4 new tools next to the existing tool registrations (mirror the wiring used for `createMindmodelLookupTool(ctx)`). Do **not** modify the registration of existing tools. Read the file first; the registration block is the only edit.

Test must verify all four tool names appear in the registered tool surface and existing tool names are still present (compatibility regression).

**Verify:** `bun test tests/index-wiring.test.ts && bun run check`
**Commit:** `feat(memory): wire project-memory tools into plugin surface`

---

## Batch 6: End-to-end + compatibility tests (parallel — 5 implementers)

These are pure test additions — no production code changes.

### Task 6.1: Project isolation E2E
**File:** `tests/integration/project-memory-isolation.test.ts`
**Test:** itself
**Depends:** 5.2
**Domain:** general

Two temp git repos with different origins → run promote in repo A, lookup in repo B → expect zero hits.

**Verify:** `bun test tests/integration/project-memory-isolation.test.ts`
**Commit:** `test(memory): cross-project isolation`

---

### Task 6.2: Worktree durability E2E
**File:** `tests/integration/project-memory-worktree.test.ts`
**Test:** itself
**Depends:** 5.2
**Domain:** general

One repo + two `git worktree add` directories sharing the same `origin` → promote from worktree A → lookup from worktree B succeeds → delete worktree A → lookup from worktree B still succeeds.

**Verify:** `bun test tests/integration/project-memory-worktree.test.ts`
**Commit:** `test(memory): worktree durability`

---

### Task 6.3: Lifecycle finish promotion E2E
**File:** `tests/integration/project-memory-lifecycle-finish.test.ts`
**Test:** itself
**Depends:** 5.2
**Domain:** general

Reuses fakes from `tests/lifecycle/index.test.ts`. Run a full lifecycle (start → commit → finish with merge=true) and assert: at least one entry with `sourceKind=lifecycle` and `status=active` exists in the project memory store after finish completes.

**Verify:** `bun test tests/integration/project-memory-lifecycle-finish.test.ts`
**Commit:** `test(memory): lifecycle finish promotes durable entries`

---

### Task 6.4: Secret rejection E2E
**File:** `tests/integration/project-memory-secret-rejection.test.ts`
**Test:** itself
**Depends:** 5.2
**Domain:** general

Call `project_memory_promote` with markdown containing a fake AWS key and a real decision. Expect: the decision is accepted, the secret-bearing bullet is rejected with `reason: "aws_access_key"`, and the store contains exactly one entry.

**Verify:** `bun test tests/integration/project-memory-secret-rejection.test.ts`
**Commit:** `test(memory): secret-bearing promotions are rejected`

---

### Task 6.5: Compatibility regression
**File:** `tests/integration/project-memory-compatibility.test.ts`
**Test:** itself
**Depends:** 5.2
**Domain:** general

Asserts existing behaviors are unchanged:

1. `artifact_search` source still does not contain the string `"handoff"` (mirrors existing assertion).
2. `milestone_artifact_search` still queries the `milestone_artifacts_fts` table only — adding the new memory tables to the same SQLite instance must not regress its behavior. Verify via a smoke insert/query against `getArtifactIndex()`.
3. `mindmodel_lookup` still returns `"No .mindmodel/ directory found in this project"` when no `.mindmodel` exists.
4. `/ledger` and `/search` command definitions in `src/index.ts` are present and unchanged in their description fields (string-grep assertion against the current source).

**Verify:** `bun test tests/integration/project-memory-compatibility.test.ts && bun run check`
**Commit:** `test(memory): compatibility regression for existing tools`

---

## Final validation gate (post Batch 6)

After all batches green:

```sh
bun run check
```

Must pass: `biome check . && eslint . && bun run typecheck && bun test`. The full test suite (existing + new) must remain green; no existing test is allowed to be modified except `tests/utils/config.test.ts` (extension only) and `tests/index-wiring.test.ts` (extension only).

## Out-of-scope reminders (carried forward from design)

- No vector search, no embeddings.
- No automatic chat capture. All entries originate from explicit promotion calls.
- No replacement of `.mindmodel`. Mindmodel keeps owning code patterns; project memory owns historical decisions, risks, lessons, and durable facts.
- No remote sync. Storage is per-user, local. A later version may sync curated summaries to GitHub issue bodies or a private memory repository.
- No automatic redaction. Secret-bearing content is rejected; the user keeps it in raw artifacts only.
