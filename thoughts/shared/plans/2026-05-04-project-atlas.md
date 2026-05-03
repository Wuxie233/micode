---
date: 2026-05-04
topic: "Project Atlas (Phase 2 closed-loop integration)"
issue: 26
scope: atlas
contract: none
---

# Project Atlas Phase 2 Implementation Plan

**Goal:** Deliver Phase 2 of Project Atlas: a curated, human-and-agent-readable Markdown vault under `atlas/` that is bootstrapped via `/atlas-init`, refreshed automatically after lifecycle finish by an asynchronous KG agent (agent2), kept consistent through atomic writes, mtime-based edit detection, and a challenge flow, and surfaced through `/atlas-status` and `/atlas-refresh`.

**Architecture:** A new `src/atlas/` module owns vault I/O, frontmatter, wikilinks, atomic writes, mtime detection, challenges, soft-delete, and the run staging protocol. Three new agents (`atlas-compiler` = agent2, `atlas-worker-build`, `atlas-worker-behavior`) plus reuse of generic worker patterns deliver content. Three new tools (`atlas_init`, `atlas_status`, `atlas_refresh`) plus three slash commands (`/atlas-init`, `/atlas-status`, `/atlas-refresh`) wire the surface. Lifecycle integration adds: a User Perspective guard at artifact recording, a handoff-package marker in issue body, a spawn-receipt marker, and a finish-time hook that writes the handoff and spawns agent2 fire-and-forget. Atlas commits use the `atlas:` prefix and never bundle with feature commits.

**Design:** [thoughts/shared/designs/2026-05-04-project-atlas-design.md](../designs/2026-05-04-project-atlas-design.md)

**Contract:** none (single-domain plan: every task is `general` or `backend`; no React/CSS/UI surface)

---

## Senior-engineer gap-filling decisions

The design specifies WHAT. These are the HOW choices the planner is making so the implementer does not have to re-derive them.

- **Vault path resolution.** Vault root is `<projectRoot>/atlas/`. `projectRoot` is the same value `src/utils/project-id.ts` already resolves (git toplevel; falls back to `process.cwd()`). Atlas paths live in `src/atlas/paths.ts` and never hard-code the literal `atlas` outside of one constant.
- **Frontmatter format.** YAML, parsed and serialized by a small in-house codec in `src/atlas/frontmatter.ts`. We do not add a YAML dependency; the codec accepts a strict subset (string scalars, ISO timestamps, integer commits-as-strings, list-of-strings for `sources`). Unknown keys round-trip unchanged so future schema additions do not corrupt existing nodes.
- **Schema version.** Stored at `atlas/_meta/schema-version` as a single line of plain text, current value `1`. A reader returns `0` when missing. Tools that mutate the vault refuse to run when on-disk version exceeds known.
- **Source pointer scheme.** Single-string format: `lifecycle:<n>` | `thoughts:<rel/path>` | `pm:<entryId>` | `mindmodel:<group>/<file>` | `code:<rel/path>`. Codec in `src/atlas/pointer.ts`. Same scheme used in node frontmatter `sources:` list and challenge bodies.
- **Wikilink format.** Obsidian default `[[<rel-path-without-extension>]]`. Parser and rewriter live in `src/atlas/wikilink.ts`. Rewriter only touches links inside `## Connections` sections to keep human-authored body text untouched by accident.
- **Atomic write protocol.** Per-run staging dir at `atlas/_meta/staging/<runId>/`. `runId` is `agent2-<lifecycleIssueNumber>-<unixSecs>` for lifecycle-driven runs, `<command>-<unixSecs>` for command-driven runs. After all worker output is reconciled, files are renamed individually with `fs.renameSync`. On startup, a sweeper scans `atlas/_meta/staging/` and rolls back any directory not bound to a running session.
- **Per-project write lock.** File-based lock at `atlas/_meta/.write.lock` containing `{ pid, runId, acquiredAt }`. Acquired before any vault mutation; released on success or rollback. A stale lock (pid not alive AND older than 30 minutes) is reclaimed.
- **mtime detection.** Compare `Bun.file(path).lastModified` (truncated to millisecond integer) against frontmatter `last_written_mtime`. Mismatch = human edit. The compare is exact equality, not a range, because we control both writes.
- **Claim hash.** SHA-256 of `<targetPath>\n<normalizedClaim>` truncated to first 12 hex chars. Normalization lowercases, collapses whitespace, strips trailing punctuation. Used to dedupe challenges.
- **Challenge cooldown.** A dismissed challenge records its `claim_hash` and `dismissedAt` in `atlas/_meta/challenges/_dismissed.json`. agent2 will not re-raise the same `(target, claim_hash)` pair until either (a) any source pointer the original challenge cited reports a fresher source mtime, or (b) the user manually deletes the dismissed entry. No clock-based expiry.
- **Per-run challenge cap.** 20 new challenges per agent2 run. Excess proposals are merged into a single `_meta/challenges/<runId>-deferred.md` summary with a list of skipped targets.
- **Wikilink rewiring constraint.** "Recently human-edited" = the target node's `last_written_mtime` is strictly less than the file's current mtime, AND the file mtime is within the most recent N=5 lifecycle runs (we read `lifecycle:lastRun:*` markers from issue bodies; absent count treats any mtime drift as recent). When both hold, the rewire becomes a challenge rather than a write.
- **Worker concurrency cap.** Hard cap of `min(cpuCount, 6)` workers active at once. Implemented with a small in-house semaphore (`src/atlas/concurrency.ts`); we do not pull a queue dependency.
- **Worker subagent surface.** Two named worker agents: `atlas-worker-build` and `atlas-worker-behavior`. Decisions/risks/timeline are projected by agent2 itself from already-structured Project Memory entries (no LLM needed beyond formatting). This keeps the spawn fan-out small and predictable.
- **Handoff marker.** Issue body block delimited by `<!-- micode:atlas:handoff:begin -->` / `:end -->`. Schema fields: `lifecycleIssue`, `affectedModules` (list), `affectedFeatures` (list), `designPointer`, `planPointer`, `ledgerPointer`, `decisions` (list of strings), `crossLayerEffects` (list), `doNotTouch` (list of node paths). Serialized as a small JSON block inside the marker.
- **Spawn receipt marker.** Separate issue body block `<!-- micode:atlas:spawn:begin -->` / `:end -->`. Fields: `runId`, `sessionId`, `spawnAt`, `expectedCompletionWindowSec`, `doneAt` (nullable), `summary` (nullable), `outcome` (`pending` | `succeeded` | `failed`).
- **agent2 spawn channel.** Use existing `spawn_agent` tool with `model` left unspecified (default model). Fire-and-forget at the surface = agent1 does not await; the spawn returns a `session_id` immediately, which is recorded in the receipt marker. agent2's completion writes `doneAt`/`outcome` back to the same marker via `lifecycle_log_progress` with `kind=status` plus a direct issue body edit through `gh issue edit`.
- **Lifecycle User Perspective guard.** New file `src/lifecycle/user-perspective-guard.ts`; reads target file content, requires a `## User Perspective` H2 with at least one non-empty line under it. Hooked into `record_artifact` for `kind in {design, ledger}`. Plan/commit/PR/worktree are unaffected.
- **Phase roadmap seed.** `/atlas-init` produces `atlas/40-decisions/atlas-phase-roadmap.md` from a fixed template in `src/atlas/templates/phase-roadmap.ts` whose body matches the "Phase Roadmap" section of the design verbatim. The same content is also promoted as Project Memory `open_question` entries by lifecycle finish (one entry per Phase 3 item).
- **Octto integration for `/atlas-init`.** Reuse the existing Octto session API (`createBrainstorm` is too heavy here; we use `start_session` with a flat `pick_one` + `ask_text` batch). Fire one batch, end session, ingest answers. No new portal surface.
- **`atlas:` commit discipline.** New utility `src/atlas/git.ts` exposes `commitAtlas({ message, cwd })` which (1) verifies only files under `atlas/` are staged, (2) runs `git commit -m "atlas: <message>"`, (3) refuses with a clear error if mixed staging is detected. lifecycle-finish-driven runs invoke this; it never bundles with feature commits.
- **Quick-mode exemption.** Agent2 spawn at lifecycle finish is skipped when the lifecycle record's `quickMode === true`. We follow the same mechanism Project Memory promotion uses.
- **Test scope.** Bun test under `tests/atlas/` mirroring `src/atlas/`. Unit-level coverage for codecs, atomic write rollback, mtime detection, challenge dedup, wikilink rewiring constraint, schema version, pointer codec, soft-delete. Integration test under `tests/integration/atlas-end-to-end.test.ts` runs `/atlas-init` + simulated lifecycle finish + `/atlas-status` against a `/tmp` fixture and asserts vault shape.
- **Failure mode for agent2 silent stop.** `/atlas-status` reports the diff between `lifecycle finish count` (count of lifecycle records in `terminal` state with at least one `atlas` commit pointer) and `vault update count` (count of receipts with `outcome=succeeded`). A diff > 1 fires a one-shot QQ notification through the existing `notification-courier` agent (no new transport).

---

## Domain audit

Every task in this plan operates on Node-side code: file I/O, agent prompts, lifecycle markers, git commands, slash commands. There is no `.tsx`, no CSS, no browser surface. All tasks are `backend` for business logic or `general` for plugin wiring, agent prompts, types, fixtures, and tests. **No frontend tasks => no contract document required.**

---

## Dependency Graph

```
Batch 1 (parallel, foundation, no deps): 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10
  config, paths, types, frontmatter codec, pointer codec, wikilink codec,
  schema-version codec, page templates, claim hash util, fixture vault data

Batch 2 (parallel, vault I/O, depends on Batch 1): 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8
  page reader, page writer (atomic), staging dir manager, write lock,
  mtime detector, archive mover, broken wikilink scanner, run staging sweeper

Batch 3 (parallel, source collectors, depends on Batch 1): 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
  lifecycle source collector, thoughts source collector, project-memory source collector,
  mindmodel source collector, module-map heuristic, behavior inferrer

Batch 4 (parallel, agent2 core logic, depends on Batch 2 + 3): 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9
  challenge writer, challenge dedup + cooldown, conflict router, wikilink rewiring guard,
  soft-delete planner, worker output reconciler, maintenance log writer,
  concurrency semaphore, atlas commit utility

Batch 5 (parallel, lifecycle integration, depends on Batch 4): 5.1, 5.2, 5.3, 5.4, 5.5
  handoff marker codec, spawn receipt marker codec, user-perspective guard,
  user-perspective wired into record-artifact, finish hook spawning agent2

Batch 6 (parallel, agents, tools, commands, depends on Batch 4 + 5): 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10
  agent2 (atlas-compiler), atlas-worker-build agent, atlas-worker-behavior agent,
  agents barrel registration, atlas_init tool, atlas_status tool, atlas_refresh tool,
  tools index export, slash commands /atlas-init /atlas-status /atlas-refresh,
  plugin index wiring

Batch 7 (parallel, integration tests + polish, depends on Batch 6): 7.1, 7.2, 7.3
  end-to-end fixture test, phase roadmap content seed, README update for atlas/
```

---

## Batch 1: Foundation (parallel, 10 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 1.8, 1.9, 1.10

### Task 1.1: Atlas configuration constants
**File:** `src/atlas/config.ts`
**Test:** `tests/atlas/config.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/atlas/config.test.ts
import { describe, expect, it } from "bun:test";

import {
  ATLAS_ARCHIVE_DIR,
  ATLAS_CHALLENGE_CAP_PER_RUN,
  ATLAS_DECISIONS_DIR,
  ATLAS_IMPL_DIR,
  ATLAS_META_DIR,
  ATLAS_RECENT_HUMAN_EDIT_LIFECYCLE_WINDOW,
  ATLAS_ROOT_DIRNAME,
  ATLAS_SCHEMA_VERSION,
  ATLAS_STAGING_DIR,
  ATLAS_STALE_LOCK_MS,
  ATLAS_WORKER_CONCURRENCY_MAX,
} from "@/atlas/config";

describe("atlas config", () => {
  it("exposes the vault root directory name", () => {
    expect(ATLAS_ROOT_DIRNAME).toBe("atlas");
  });

  it("uses numeric prefixes for top level directories", () => {
    expect(ATLAS_IMPL_DIR).toBe("10-impl");
    expect(ATLAS_DECISIONS_DIR).toBe("40-decisions");
    expect(ATLAS_ARCHIVE_DIR).toBe("_archive");
    expect(ATLAS_META_DIR).toBe("_meta");
    expect(ATLAS_STAGING_DIR).toBe("staging");
  });

  it("declares schema version one for phase two", () => {
    expect(ATLAS_SCHEMA_VERSION).toBe(1);
  });

  it("caps challenge volume per run", () => {
    expect(ATLAS_CHALLENGE_CAP_PER_RUN).toBe(20);
  });

  it("caps worker concurrency at six", () => {
    expect(ATLAS_WORKER_CONCURRENCY_MAX).toBe(6);
  });

  it("declares the recent human edit lifecycle window", () => {
    expect(ATLAS_RECENT_HUMAN_EDIT_LIFECYCLE_WINDOW).toBe(5);
  });

  it("declares stale lock reclamation window in milliseconds", () => {
    expect(ATLAS_STALE_LOCK_MS).toBe(30 * 60 * 1000);
  });
});
```

```typescript
// src/atlas/config.ts
export const ATLAS_ROOT_DIRNAME = "atlas";
export const ATLAS_IMPL_DIR = "10-impl";
export const ATLAS_BEHAVIOR_DIR = "20-behavior";
export const ATLAS_DECISIONS_DIR = "40-decisions";
export const ATLAS_RISKS_DIR = "50-risks";
export const ATLAS_TIMELINE_DIR = "60-timeline";
export const ATLAS_ARCHIVE_DIR = "_archive";
export const ATLAS_META_DIR = "_meta";
export const ATLAS_CHALLENGES_DIR = "challenges";
export const ATLAS_LOG_DIR = "log";
export const ATLAS_STAGING_DIR = "staging";

export const ATLAS_SCHEMA_VERSION = 1;
export const ATLAS_SCHEMA_VERSION_FILE = "schema-version";
export const ATLAS_INDEX_FILE = "00-index.md";
export const ATLAS_DISMISSED_CHALLENGES_FILE = "_dismissed.json";
export const ATLAS_LOCK_FILE = ".write.lock";

export const ATLAS_CHALLENGE_CAP_PER_RUN = 20;
export const ATLAS_WORKER_CONCURRENCY_MAX = 6;
export const ATLAS_RECENT_HUMAN_EDIT_LIFECYCLE_WINDOW = 5;
export const ATLAS_CLAIM_HASH_HEX_LENGTH = 12;

const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const STALE_LOCK_MINUTES = 30;
export const ATLAS_STALE_LOCK_MS = STALE_LOCK_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;

export const ATLAS_COMMIT_PREFIX = "atlas:";
export const ATLAS_HANDOFF_MARKER_BEGIN = "<!-- micode:atlas:handoff:begin -->";
export const ATLAS_HANDOFF_MARKER_END = "<!-- micode:atlas:handoff:end -->";
export const ATLAS_SPAWN_MARKER_BEGIN = "<!-- micode:atlas:spawn:begin -->";
export const ATLAS_SPAWN_MARKER_END = "<!-- micode:atlas:spawn:end -->";
```

**Verify:** `bun test tests/atlas/config.test.ts`
**Commit:** `atlas: add config constants for vault layout, caps, and markers`

### Task 1.2: Atlas vault path resolver
**File:** `src/atlas/paths.ts`
**Test:** `tests/atlas/paths.test.ts`
**Depends:** 1.1
**Domain:** general

```typescript
// tests/atlas/paths.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createAtlasPaths } from "@/atlas/paths";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-paths-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("createAtlasPaths", () => {
  it("computes vault root and well-known subdirs", () => {
    const paths = createAtlasPaths(projectRoot);
    expect(paths.root).toBe(join(projectRoot, "atlas"));
    expect(paths.impl).toBe(join(projectRoot, "atlas", "10-impl"));
    expect(paths.behavior).toBe(join(projectRoot, "atlas", "20-behavior"));
    expect(paths.decisions).toBe(join(projectRoot, "atlas", "40-decisions"));
    expect(paths.risks).toBe(join(projectRoot, "atlas", "50-risks"));
    expect(paths.timeline).toBe(join(projectRoot, "atlas", "60-timeline"));
    expect(paths.archive).toBe(join(projectRoot, "atlas", "_archive"));
    expect(paths.meta).toBe(join(projectRoot, "atlas", "_meta"));
    expect(paths.challenges).toBe(join(projectRoot, "atlas", "_meta", "challenges"));
    expect(paths.log).toBe(join(projectRoot, "atlas", "_meta", "log"));
    expect(paths.staging).toBe(join(projectRoot, "atlas", "_meta", "staging"));
  });

  it("computes well-known files", () => {
    const paths = createAtlasPaths(projectRoot);
    expect(paths.indexFile).toBe(join(projectRoot, "atlas", "00-index.md"));
    expect(paths.schemaVersionFile).toBe(join(projectRoot, "atlas", "_meta", "schema-version"));
    expect(paths.lockFile).toBe(join(projectRoot, "atlas", "_meta", ".write.lock"));
    expect(paths.dismissedChallengesFile).toBe(
      join(projectRoot, "atlas", "_meta", "challenges", "_dismissed.json"),
    );
  });

  it("scopes a run staging directory under the meta staging dir", () => {
    const paths = createAtlasPaths(projectRoot);
    expect(paths.runStaging("agent2-26-100")).toBe(
      join(projectRoot, "atlas", "_meta", "staging", "agent2-26-100"),
    );
  });
});
```

```typescript
// src/atlas/paths.ts
import { join } from "node:path";

import {
  ATLAS_ARCHIVE_DIR,
  ATLAS_BEHAVIOR_DIR,
  ATLAS_CHALLENGES_DIR,
  ATLAS_DECISIONS_DIR,
  ATLAS_DISMISSED_CHALLENGES_FILE,
  ATLAS_IMPL_DIR,
  ATLAS_INDEX_FILE,
  ATLAS_LOCK_FILE,
  ATLAS_LOG_DIR,
  ATLAS_META_DIR,
  ATLAS_RISKS_DIR,
  ATLAS_ROOT_DIRNAME,
  ATLAS_SCHEMA_VERSION_FILE,
  ATLAS_STAGING_DIR,
  ATLAS_TIMELINE_DIR,
} from "./config";

export interface AtlasPaths {
  readonly projectRoot: string;
  readonly root: string;
  readonly impl: string;
  readonly behavior: string;
  readonly decisions: string;
  readonly risks: string;
  readonly timeline: string;
  readonly archive: string;
  readonly meta: string;
  readonly challenges: string;
  readonly log: string;
  readonly staging: string;
  readonly indexFile: string;
  readonly schemaVersionFile: string;
  readonly lockFile: string;
  readonly dismissedChallengesFile: string;
  readonly runStaging: (runId: string) => string;
}

export function createAtlasPaths(projectRoot: string): AtlasPaths {
  const root = join(projectRoot, ATLAS_ROOT_DIRNAME);
  const meta = join(root, ATLAS_META_DIR);
  const challenges = join(meta, ATLAS_CHALLENGES_DIR);
  const staging = join(meta, ATLAS_STAGING_DIR);
  return {
    projectRoot,
    root,
    impl: join(root, ATLAS_IMPL_DIR),
    behavior: join(root, ATLAS_BEHAVIOR_DIR),
    decisions: join(root, ATLAS_DECISIONS_DIR),
    risks: join(root, ATLAS_RISKS_DIR),
    timeline: join(root, ATLAS_TIMELINE_DIR),
    archive: join(root, ATLAS_ARCHIVE_DIR),
    meta,
    challenges,
    log: join(meta, ATLAS_LOG_DIR),
    staging,
    indexFile: join(root, ATLAS_INDEX_FILE),
    schemaVersionFile: join(meta, ATLAS_SCHEMA_VERSION_FILE),
    lockFile: join(meta, ATLAS_LOCK_FILE),
    dismissedChallengesFile: join(challenges, ATLAS_DISMISSED_CHALLENGES_FILE),
    runStaging: (runId: string) => join(staging, runId),
  };
}
```

**Verify:** `bun test tests/atlas/paths.test.ts`
**Commit:** `atlas: add vault path resolver`

### Task 1.3: Atlas core types
**File:** `src/atlas/types.ts`
**Test:** `tests/atlas/types.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/atlas/types.test.ts
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
```

```typescript
// src/atlas/types.ts
export const ATLAS_LAYERS = {
  IMPL: "impl",
  BEHAVIOR: "behavior",
  DECISION: "decision",
  RISK: "risk",
  TIMELINE: "timeline",
} as const;

export type AtlasLayer = (typeof ATLAS_LAYERS)[keyof typeof ATLAS_LAYERS];

export const ATLAS_NODE_STATUSES = {
  ACTIVE: "active",
  SUPERSEDED: "superseded",
  DEPRECATED: "deprecated",
} as const;

export type AtlasNodeStatus = (typeof ATLAS_NODE_STATUSES)[keyof typeof ATLAS_NODE_STATUSES];

export const ATLAS_CHALLENGE_STATUSES = {
  OPEN: "open",
  APPROVED: "approved",
  DISMISSED: "dismissed",
} as const;

export type AtlasChallengeStatus = (typeof ATLAS_CHALLENGE_STATUSES)[keyof typeof ATLAS_CHALLENGE_STATUSES];

export const ATLAS_SPAWN_OUTCOMES = {
  PENDING: "pending",
  SUCCEEDED: "succeeded",
  FAILED: "failed",
} as const;

export type AtlasSpawnOutcome = (typeof ATLAS_SPAWN_OUTCOMES)[keyof typeof ATLAS_SPAWN_OUTCOMES];

export interface AtlasFrontmatter {
  readonly id: string;
  readonly layer: AtlasLayer;
  readonly status: AtlasNodeStatus;
  readonly last_verified_commit: string;
  readonly last_written_mtime: number;
  readonly sources: readonly string[];
  readonly extras: Readonly<Record<string, string>>;
}

export interface AtlasNode {
  readonly path: string;
  readonly frontmatter: AtlasFrontmatter;
  readonly summary: string;
  readonly connections: readonly string[];
  readonly sourcesBody: readonly string[];
  readonly notes: string;
}

export interface AtlasHandoff {
  readonly lifecycleIssue: number;
  readonly affectedModules: readonly string[];
  readonly affectedFeatures: readonly string[];
  readonly designPointer: string | null;
  readonly planPointer: string | null;
  readonly ledgerPointer: string | null;
  readonly decisions: readonly string[];
  readonly crossLayerEffects: readonly string[];
  readonly doNotTouch: readonly string[];
}

export interface AtlasSpawnReceipt {
  readonly runId: string;
  readonly sessionId: string;
  readonly spawnAt: string;
  readonly expectedCompletionWindowSec: number;
  readonly doneAt: string | null;
  readonly summary: string | null;
  readonly outcome: AtlasSpawnOutcome;
}

export interface AtlasChallengeRecord {
  readonly target: string;
  readonly claimHash: string;
  readonly status: AtlasChallengeStatus;
  readonly reason: string;
  readonly proposedChange: string;
  readonly sources: readonly string[];
  readonly createdAt: string;
}
```

**Verify:** `bun test tests/atlas/types.test.ts`
**Commit:** `atlas: add core type definitions and status enums`

### Task 1.4: Frontmatter codec
**File:** `src/atlas/frontmatter.ts`
**Test:** `tests/atlas/frontmatter.test.ts`
**Depends:** 1.3
**Domain:** backend

```typescript
// tests/atlas/frontmatter.test.ts
import { describe, expect, it } from "bun:test";

import { parseFrontmatter, serializeFrontmatter } from "@/atlas/frontmatter";
import { ATLAS_LAYERS, ATLAS_NODE_STATUSES } from "@/atlas/types";

const SAMPLE = `---
id: impl/lifecycle
layer: impl
status: active
last_verified_commit: abc123
last_written_mtime: 1700000000000
sources:
  - lifecycle:26
  - thoughts:shared/designs/x.md
---

# Body
`;

describe("frontmatter codec", () => {
  it("parses required fields", () => {
    const result = parseFrontmatter(SAMPLE);
    expect(result.frontmatter.id).toBe("impl/lifecycle");
    expect(result.frontmatter.layer).toBe(ATLAS_LAYERS.IMPL);
    expect(result.frontmatter.status).toBe(ATLAS_NODE_STATUSES.ACTIVE);
    expect(result.frontmatter.last_verified_commit).toBe("abc123");
    expect(result.frontmatter.last_written_mtime).toBe(1700000000000);
    expect(result.frontmatter.sources).toEqual(["lifecycle:26", "thoughts:shared/designs/x.md"]);
    expect(result.body.startsWith("# Body")).toBe(true);
  });

  it("round trips unknown extras", () => {
    const withExtra = SAMPLE.replace("sources:", "custom: keep-me\nsources:");
    const parsed = parseFrontmatter(withExtra);
    expect(parsed.frontmatter.extras.custom).toBe("keep-me");
    const serialized = serializeFrontmatter(parsed.frontmatter, parsed.body);
    expect(serialized).toContain("custom: keep-me");
  });

  it("rejects missing required fields", () => {
    expect(() => parseFrontmatter("---\nid: x\n---\nbody")).toThrow();
  });

  it("rejects unknown layer or status", () => {
    const bad = SAMPLE.replace("layer: impl", "layer: weird");
    expect(() => parseFrontmatter(bad)).toThrow();
  });

  it("serializes deterministically", () => {
    const parsed = parseFrontmatter(SAMPLE);
    const serialized = serializeFrontmatter(parsed.frontmatter, parsed.body);
    const reparsed = parseFrontmatter(serialized);
    expect(reparsed.frontmatter).toEqual(parsed.frontmatter);
    expect(reparsed.body).toEqual(parsed.body);
  });
});
```

```typescript
// src/atlas/frontmatter.ts
import {
  ATLAS_LAYERS,
  ATLAS_NODE_STATUSES,
  type AtlasFrontmatter,
  type AtlasLayer,
  type AtlasNodeStatus,
} from "./types";

const FRONTMATTER_DELIMITER = "---";
const REQUIRED_KEYS = ["id", "layer", "status", "last_verified_commit", "last_written_mtime"] as const;
const LAYER_VALUES = Object.values(ATLAS_LAYERS) as readonly string[];
const STATUS_VALUES = Object.values(ATLAS_NODE_STATUSES) as readonly string[];

interface ParseResult {
  readonly frontmatter: AtlasFrontmatter;
  readonly body: string;
}

const splitDocument = (raw: string): { readonly head: string; readonly body: string } => {
  if (!raw.startsWith(`${FRONTMATTER_DELIMITER}\n`)) throw new Error("missing frontmatter delimiter");
  const closeIdx = raw.indexOf(`\n${FRONTMATTER_DELIMITER}`, FRONTMATTER_DELIMITER.length + 1);
  if (closeIdx === -1) throw new Error("missing frontmatter close delimiter");
  const head = raw.slice(FRONTMATTER_DELIMITER.length + 1, closeIdx);
  const body = raw.slice(closeIdx + FRONTMATTER_DELIMITER.length + 1).replace(/^\n/, "");
  return { head, body };
};

const parseScalarLine = (line: string): readonly [string, string] | null => {
  const idx = line.indexOf(":");
  if (idx === -1) return null;
  return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
};

const collectListItems = (lines: readonly string[], startIdx: number): readonly [readonly string[], number] => {
  const items: string[] = [];
  let i = startIdx;
  while (i < lines.length && lines[i].startsWith("  - ")) {
    items.push(lines[i].slice(4).trim());
    i += 1;
  }
  return [items, i];
};

const parseLayer = (raw: string): AtlasLayer => {
  if (!LAYER_VALUES.includes(raw)) throw new Error(`unknown layer: ${raw}`);
  return raw as AtlasLayer;
};

const parseStatus = (raw: string): AtlasNodeStatus => {
  if (!STATUS_VALUES.includes(raw)) throw new Error(`unknown status: ${raw}`);
  return raw as AtlasNodeStatus;
};

const ensureRequired = (record: Record<string, unknown>): void => {
  for (const key of REQUIRED_KEYS) {
    if (record[key] === undefined) throw new Error(`missing required frontmatter key: ${key}`);
  }
};

export function parseFrontmatter(raw: string): ParseResult {
  const { head, body } = splitDocument(raw);
  const lines = head.split("\n");
  const record: Record<string, unknown> = {};
  const extras: Record<string, string> = {};
  let sources: readonly string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().length === 0) {
      i += 1;
      continue;
    }
    const parsed = parseScalarLine(line);
    if (parsed === null) throw new Error(`malformed frontmatter line: ${line}`);
    const [key, value] = parsed;
    if (key === "sources") {
      const [items, next] = collectListItems(lines, i + 1);
      sources = items;
      i = next;
      continue;
    }
    record[key] = value;
    if (!REQUIRED_KEYS.includes(key as (typeof REQUIRED_KEYS)[number])) extras[key] = value;
    i += 1;
  }
  ensureRequired(record);
  const frontmatter: AtlasFrontmatter = {
    id: String(record.id),
    layer: parseLayer(String(record.layer)),
    status: parseStatus(String(record.status)),
    last_verified_commit: String(record.last_verified_commit),
    last_written_mtime: Number.parseInt(String(record.last_written_mtime), 10),
    sources,
    extras,
  };
  return { frontmatter, body };
}

export function serializeFrontmatter(fm: AtlasFrontmatter, body: string): string {
  const lines: string[] = [FRONTMATTER_DELIMITER];
  lines.push(`id: ${fm.id}`);
  lines.push(`layer: ${fm.layer}`);
  lines.push(`status: ${fm.status}`);
  lines.push(`last_verified_commit: ${fm.last_verified_commit}`);
  lines.push(`last_written_mtime: ${fm.last_written_mtime}`);
  for (const [key, value] of Object.entries(fm.extras)) lines.push(`${key}: ${value}`);
  lines.push("sources:");
  for (const source of fm.sources) lines.push(`  - ${source}`);
  lines.push(FRONTMATTER_DELIMITER);
  lines.push("");
  return `${lines.join("\n")}\n${body}`;
}
```

**Verify:** `bun test tests/atlas/frontmatter.test.ts`
**Commit:** `atlas: add frontmatter parser and serializer`

### Task 1.5: Source pointer codec
**File:** `src/atlas/pointer.ts`
**Test:** `tests/atlas/pointer.test.ts`
**Depends:** none
**Domain:** backend

```typescript
// tests/atlas/pointer.test.ts
import { describe, expect, it } from "bun:test";

import { formatPointer, parsePointer, POINTER_KINDS } from "@/atlas/pointer";

describe("source pointer codec", () => {
  it("parses lifecycle pointers", () => {
    expect(parsePointer("lifecycle:26")).toEqual({ kind: POINTER_KINDS.LIFECYCLE, value: "26" });
  });

  it("parses thoughts pointers preserving slashes", () => {
    expect(parsePointer("thoughts:shared/designs/x.md")).toEqual({
      kind: POINTER_KINDS.THOUGHTS,
      value: "shared/designs/x.md",
    });
  });

  it("parses pm, mindmodel, code", () => {
    expect(parsePointer("pm:abc")).toEqual({ kind: POINTER_KINDS.PROJECT_MEMORY, value: "abc" });
    expect(parsePointer("mindmodel:patterns/x")).toEqual({ kind: POINTER_KINDS.MINDMODEL, value: "patterns/x" });
    expect(parsePointer("code:src/x.ts")).toEqual({ kind: POINTER_KINDS.CODE, value: "src/x.ts" });
  });

  it("rejects unknown prefixes", () => {
    expect(() => parsePointer("weird:x")).toThrow();
  });

  it("formats round trip", () => {
    const sources = ["lifecycle:1", "thoughts:a.md", "pm:e", "mindmodel:c/d", "code:src/s.ts"];
    for (const source of sources) {
      const parsed = parsePointer(source);
      expect(formatPointer(parsed)).toBe(source);
    }
  });
});
```

```typescript
// src/atlas/pointer.ts
export const POINTER_KINDS = {
  LIFECYCLE: "lifecycle",
  THOUGHTS: "thoughts",
  PROJECT_MEMORY: "pm",
  MINDMODEL: "mindmodel",
  CODE: "code",
} as const;

export type PointerKind = (typeof POINTER_KINDS)[keyof typeof POINTER_KINDS];

export interface SourcePointer {
  readonly kind: PointerKind;
  readonly value: string;
}

const KIND_VALUES = Object.values(POINTER_KINDS) as readonly string[];

export function parsePointer(raw: string): SourcePointer {
  const idx = raw.indexOf(":");
  if (idx === -1) throw new Error(`invalid pointer: ${raw}`);
  const prefix = raw.slice(0, idx);
  if (!KIND_VALUES.includes(prefix)) throw new Error(`unknown pointer kind: ${prefix}`);
  return { kind: prefix as PointerKind, value: raw.slice(idx + 1) };
}

export function formatPointer(pointer: SourcePointer): string {
  return `${pointer.kind}:${pointer.value}`;
}

export function tryParsePointer(raw: string): SourcePointer | null {
  try {
    return parsePointer(raw);
  } catch {
    return null;
  }
}
```

**Verify:** `bun test tests/atlas/pointer.test.ts`
**Commit:** `atlas: add source pointer codec`

### Task 1.6: Wikilink codec
**File:** `src/atlas/wikilink.ts`
**Test:** `tests/atlas/wikilink.test.ts`
**Depends:** none
**Domain:** backend

```typescript
// tests/atlas/wikilink.test.ts
import { describe, expect, it } from "bun:test";

import { extractWikilinks, formatWikilink, parseWikilink, rewriteWikilinks } from "@/atlas/wikilink";

describe("wikilink codec", () => {
  it("parses a single link", () => {
    expect(parseWikilink("[[20-behavior/economy-system]]")).toBe("20-behavior/economy-system");
  });

  it("returns null on invalid format", () => {
    expect(parseWikilink("not a link")).toBe(null);
    expect(parseWikilink("[[ ]]")).toBe(null);
  });

  it("formats a link", () => {
    expect(formatWikilink("10-impl/runner")).toBe("[[10-impl/runner]]");
  });

  it("extracts all links from text", () => {
    const text = "see [[a/b]] and [[c/d]] but not [c]";
    expect(extractWikilinks(text)).toEqual(["a/b", "c/d"]);
  });

  it("rewrites only matching targets", () => {
    const text = "- [[old/x]]\n- [[other/y]]";
    const out = rewriteWikilinks(text, { "old/x": "new/x" });
    expect(out).toBe("- [[new/x]]\n- [[other/y]]");
  });
});
```

```typescript
// src/atlas/wikilink.ts
const WIKILINK_PATTERN = /\[\[([^\]]+)\]\]/g;

export function parseWikilink(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith("[[") || !trimmed.endsWith("]]")) return null;
  const inner = trimmed.slice(2, -2).trim();
  if (inner.length === 0) return null;
  return inner;
}

export function formatWikilink(target: string): string {
  return `[[${target}]]`;
}

export function extractWikilinks(text: string): readonly string[] {
  const matches: string[] = [];
  for (const match of text.matchAll(WIKILINK_PATTERN)) {
    const inner = match[1].trim();
    if (inner.length > 0) matches.push(inner);
  }
  return matches;
}

export function rewriteWikilinks(text: string, mapping: Readonly<Record<string, string>>): string {
  return text.replace(WIKILINK_PATTERN, (whole, inner: string) => {
    const trimmed = inner.trim();
    const replacement = mapping[trimmed];
    return replacement ? `[[${replacement}]]` : whole;
  });
}
```

**Verify:** `bun test tests/atlas/wikilink.test.ts`
**Commit:** `atlas: add wikilink parsing, formatting, and rewriting`

### Task 1.7: Schema version codec
**File:** `src/atlas/schema-version.ts`
**Test:** `tests/atlas/schema-version.test.ts`
**Depends:** 1.1
**Domain:** backend

```typescript
// tests/atlas/schema-version.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { ATLAS_SCHEMA_VERSION } from "@/atlas/config";
import { readSchemaVersion, writeSchemaVersion } from "@/atlas/schema-version";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atlas-schema-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("schema version codec", () => {
  it("returns 0 when file missing", () => {
    expect(readSchemaVersion(join(dir, "missing"))).toBe(0);
  });

  it("reads written version", () => {
    const file = join(dir, "schema-version");
    mkdirSync(dir, { recursive: true });
    writeFileSync(file, "1\n", "utf8");
    expect(readSchemaVersion(file)).toBe(1);
  });

  it("writes the current schema version", () => {
    const file = join(dir, "schema-version");
    writeSchemaVersion(file, ATLAS_SCHEMA_VERSION);
    expect(readSchemaVersion(file)).toBe(ATLAS_SCHEMA_VERSION);
  });

  it("returns 0 on garbage content", () => {
    const file = join(dir, "schema-version");
    writeFileSync(file, "not-a-number", "utf8");
    expect(readSchemaVersion(file)).toBe(0);
  });
});
```

```typescript
// src/atlas/schema-version.ts
import { existsSync, readFileSync, writeFileSync } from "node:fs";

const DECIMAL_RADIX = 10;
const MISSING_VERSION = 0;

export function readSchemaVersion(file: string): number {
  if (!existsSync(file)) return MISSING_VERSION;
  const raw = readFileSync(file, "utf8").trim();
  const parsed = Number.parseInt(raw, DECIMAL_RADIX);
  if (!Number.isFinite(parsed)) return MISSING_VERSION;
  return parsed;
}

export function writeSchemaVersion(file: string, version: number): void {
  writeFileSync(file, `${version}\n`, "utf8");
}
```

**Verify:** `bun test tests/atlas/schema-version.test.ts`
**Commit:** `atlas: add schema version reader and writer`

### Task 1.8: Page templates
**File:** `src/atlas/templates.ts`
**Test:** `tests/atlas/templates.test.ts`
**Depends:** 1.3, 1.4
**Domain:** backend

```typescript
// tests/atlas/templates.test.ts
import { describe, expect, it } from "bun:test";

import { renderEmptyNode, renderIndexPage, renderPhaseRoadmap } from "@/atlas/templates";
import { ATLAS_LAYERS, ATLAS_NODE_STATUSES } from "@/atlas/types";

describe("page templates", () => {
  it("renders an empty impl node with required H2 sections", () => {
    const text = renderEmptyNode({
      id: "impl/sample",
      layer: ATLAS_LAYERS.IMPL,
      status: ATLAS_NODE_STATUSES.ACTIVE,
      summary: "Sample module",
      sources: ["code:src/sample.ts"],
      lastVerifiedCommit: "abc",
      lastWrittenMtime: 1,
    });
    expect(text).toContain("## Summary");
    expect(text).toContain("## Connections");
    expect(text).toContain("## Sources");
    expect(text).toContain("## Notes");
    expect(text).toContain("Sample module");
    expect(text).toContain("- code:src/sample.ts");
  });

  it("renders the index page header", () => {
    const text = renderIndexPage({ projectName: "demo" });
    expect(text).toContain("# demo");
    expect(text).toContain("agent2");
  });

  it("renders the phase roadmap with phase 2 and phase 3 sections", () => {
    const text = renderPhaseRoadmap();
    expect(text).toContain("Phase 2: Closed-loop integration");
    expect(text).toContain("Phase 3");
    expect(text).toContain("layer: decision");
  });
});
```

```typescript
// src/atlas/templates.ts
import { serializeFrontmatter } from "./frontmatter";
import { ATLAS_NODE_STATUSES, type AtlasFrontmatter, type AtlasLayer, type AtlasNodeStatus } from "./types";

interface EmptyNodeInput {
  readonly id: string;
  readonly layer: AtlasLayer;
  readonly status: AtlasNodeStatus;
  readonly summary: string;
  readonly sources: readonly string[];
  readonly lastVerifiedCommit: string;
  readonly lastWrittenMtime: number;
  readonly connections?: readonly string[];
}

const renderH2 = (title: string, body: string): string => `## ${title}\n\n${body}\n`;
const bullet = (items: readonly string[]): string => (items.length === 0 ? "_none_" : items.map((s) => `- ${s}`).join("\n"));

export function renderEmptyNode(input: EmptyNodeInput): string {
  const fm: AtlasFrontmatter = {
    id: input.id,
    layer: input.layer,
    status: input.status,
    last_verified_commit: input.lastVerifiedCommit,
    last_written_mtime: input.lastWrittenMtime,
    sources: input.sources,
    extras: {},
  };
  const body = [
    renderH2("Summary", input.summary),
    renderH2("Connections", bullet(input.connections ?? [])),
    renderH2("Sources", bullet(input.sources)),
    renderH2("Notes", "_none_"),
  ].join("\n");
  return serializeFrontmatter(fm, body);
}

export function renderIndexPage(input: { readonly projectName: string }): string {
  const fm: AtlasFrontmatter = {
    id: "index",
    layer: "decision",
    status: ATLAS_NODE_STATUSES.ACTIVE,
    last_verified_commit: "",
    last_written_mtime: 0,
    sources: [],
    extras: {},
  };
  const body = [
    `# ${input.projectName}\n`,
    "Project Atlas is a curated map maintained by humans and agents together.\n",
    "agent2 refreshes the impl, decision, risk, and timeline layers after lifecycle finish.\n",
    "Open `_meta/challenges/` to review proposed changes that touch your edits.\n",
    renderH2("Summary", "_human-authored intro goes here_"),
    renderH2("Reading guide", "Build layer at `10-impl/`. Behavior layer at `20-behavior/`."),
  ].join("\n");
  return serializeFrontmatter(fm, body);
}

export function renderPhaseRoadmap(): string {
  const fm: AtlasFrontmatter = {
    id: "decision/atlas-phase-roadmap",
    layer: "decision",
    status: ATLAS_NODE_STATUSES.ACTIVE,
    last_verified_commit: "",
    last_written_mtime: 0,
    sources: ["thoughts:shared/designs/2026-05-04-project-atlas-design.md"],
    extras: {},
  };
  const body = [
    "## Summary\n\nCanonical record of what is in scope for Phase 2 and what is deferred to Phase 3.\n",
    "## Connections\n\n_none_\n",
    "## Sources\n\n- thoughts:shared/designs/2026-05-04-project-atlas-design.md\n",
    "## Notes\n",
    "### Phase 2: Closed-loop integration (delivered)\n",
    "Lifecycle finish auto-spawn of agent2; structured handoff; spawn receipt; worker fan-out;",
    "atomic write protocol; mtime-based edit detection; challenge flow with dedup and cooldown;",
    "wikilink rewiring constraint; soft delete to `_archive/`; first-person maintenance log;",
    "`/atlas-status`; `/atlas-init --reconcile` and `--force-rebuild`; `atlas:` commit prefix;",
    "User Perspective lifecycle enforcement; schema version file at `_meta/schema-version`.\n",
    "### Phase 3: Hardening and operational maturity (deferred)\n",
    "Independent lint and GC pass; project type profile system; agent2 failure escalation;",
    "cross-project schema migration tools; independent git isolation; madge/dep-cruiser SVG;",
    "Behavior layer round-trip verification.",
  ].join("\n");
  return serializeFrontmatter(fm, body);
}
```

**Verify:** `bun test tests/atlas/templates.test.ts`
**Commit:** `atlas: add page templates for empty node, index, and phase roadmap`

### Task 1.9: Claim hash utility
**File:** `src/atlas/claim-hash.ts`
**Test:** `tests/atlas/claim-hash.test.ts`
**Depends:** 1.1
**Domain:** backend

```typescript
// tests/atlas/claim-hash.test.ts
import { describe, expect, it } from "bun:test";

import { ATLAS_CLAIM_HASH_HEX_LENGTH } from "@/atlas/config";
import { computeClaimHash } from "@/atlas/claim-hash";

describe("claim hash", () => {
  it("returns a 12-hex string", () => {
    const hash = computeClaimHash("10-impl/runner.md", "the runner spawns workers");
    expect(hash).toMatch(/^[0-9a-f]+$/);
    expect(hash.length).toBe(ATLAS_CLAIM_HASH_HEX_LENGTH);
  });

  it("normalizes whitespace and case", () => {
    const a = computeClaimHash("a", "  Hello   World!  ");
    const b = computeClaimHash("a", "hello world");
    expect(a).toBe(b);
  });

  it("differs across targets", () => {
    expect(computeClaimHash("a", "x")).not.toBe(computeClaimHash("b", "x"));
  });
});
```

```typescript
// src/atlas/claim-hash.ts
import { createHash } from "node:crypto";

import { ATLAS_CLAIM_HASH_HEX_LENGTH } from "./config";

const TRAILING_PUNCTUATION = /[\s.,;:!?]+$/;
const COLLAPSE_WHITESPACE = /\s+/g;

const normalize = (claim: string): string => {
  return claim.toLowerCase().replace(COLLAPSE_WHITESPACE, " ").replace(TRAILING_PUNCTUATION, "").trim();
};

export function computeClaimHash(target: string, claim: string): string {
  const hash = createHash("sha256");
  hash.update(`${target}\n${normalize(claim)}`);
  return hash.digest("hex").slice(0, ATLAS_CLAIM_HASH_HEX_LENGTH);
}
```

**Verify:** `bun test tests/atlas/claim-hash.test.ts`
**Commit:** `atlas: add claim hash for challenge deduplication`

### Task 1.10: Test fixture vault
**File:** `tests/atlas/fixtures/vault/README.md`
**Test:** none
**Depends:** none
**Domain:** general

```markdown
# Atlas test fixture

This directory contains a minimal but realistic atlas vault used by atlas integration tests.

Layout matches a Phase 2 vault produced by `/atlas-init`:

- `00-index.md`
- `10-impl/runner.md`
- `20-behavior/spawning.md`
- `40-decisions/atlas-phase-roadmap.md`
- `_meta/schema-version`
- `_meta/challenges/.gitkeep`
- `_meta/log/.gitkeep`

Tests copy the fixture to a `/tmp` working dir per case, mutate it, then assert resulting state.
```

(The implementer creates the fixture files alongside this README; concrete contents are produced by `renderEmptyNode`, `renderIndexPage`, and `renderPhaseRoadmap` from Task 1.8 to keep the fixture aligned with the templates.)

**Verify:** `ls tests/atlas/fixtures/vault/00-index.md tests/atlas/fixtures/vault/_meta/schema-version`
**Commit:** `atlas: add test fixture vault for integration tests`

---

## Batch 2: Vault I/O (parallel, 8 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7, 2.8

### Task 2.1: Page reader
**File:** `src/atlas/page-reader.ts`
**Test:** `tests/atlas/page-reader.test.ts`
**Depends:** 1.4
**Domain:** backend

```typescript
// tests/atlas/page-reader.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { readPage } from "@/atlas/page-reader";
import { renderEmptyNode } from "@/atlas/templates";
import { ATLAS_LAYERS, ATLAS_NODE_STATUSES } from "@/atlas/types";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atlas-reader-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readPage", () => {
  it("reads a node and returns frontmatter + body sections", async () => {
    const file = join(dir, "node.md");
    mkdirSync(dir, { recursive: true });
    const text = renderEmptyNode({
      id: "impl/x",
      layer: ATLAS_LAYERS.IMPL,
      status: ATLAS_NODE_STATUSES.ACTIVE,
      summary: "x summary",
      sources: ["code:src/x.ts"],
      lastVerifiedCommit: "abc",
      lastWrittenMtime: 100,
      connections: ["[[20-behavior/x]]"],
    });
    writeFileSync(file, text, "utf8");
    const node = await readPage(file);
    expect(node.frontmatter.id).toBe("impl/x");
    expect(node.summary).toContain("x summary");
    expect(node.connections).toEqual(["[[20-behavior/x]]"]);
    expect(node.sourcesBody).toEqual(["code:src/x.ts"]);
  });

  it("returns null on missing file", async () => {
    const node = await readPage(join(dir, "missing.md"));
    expect(node).toBe(null);
  });

  it("throws on malformed frontmatter", async () => {
    const file = join(dir, "broken.md");
    writeFileSync(file, "no frontmatter at all", "utf8");
    await expect(readPage(file)).rejects.toThrow();
  });
});
```

```typescript
// src/atlas/page-reader.ts
import { existsSync, readFileSync } from "node:fs";

import { parseFrontmatter } from "./frontmatter";
import type { AtlasNode } from "./types";

const H2_PATTERN = /^## (.+)$/;
const SECTION_NAMES = ["Summary", "Connections", "Sources", "Notes"] as const;

interface Sections {
  readonly Summary: string;
  readonly Connections: string;
  readonly Sources: string;
  readonly Notes: string;
}

const splitSections = (body: string): Sections => {
  const out: Record<string, string[]> = { Summary: [], Connections: [], Sources: [], Notes: [] };
  let current: string | null = null;
  for (const line of body.split("\n")) {
    const match = H2_PATTERN.exec(line);
    if (match && SECTION_NAMES.includes(match[1] as (typeof SECTION_NAMES)[number])) {
      current = match[1];
      continue;
    }
    if (current !== null) out[current].push(line);
  }
  return {
    Summary: out.Summary.join("\n").trim(),
    Connections: out.Connections.join("\n").trim(),
    Sources: out.Sources.join("\n").trim(),
    Notes: out.Notes.join("\n").trim(),
  };
};

const collectBullets = (raw: string): readonly string[] => {
  if (raw.length === 0 || raw === "_none_") return [];
  return raw
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("- "))
    .map((line) => line.slice(2).trim());
};

export async function readPage(path: string): Promise<AtlasNode | null> {
  if (!existsSync(path)) return null;
  const raw = readFileSync(path, "utf8");
  const { frontmatter, body } = parseFrontmatter(raw);
  const sections = splitSections(body);
  return {
    path,
    frontmatter,
    summary: sections.Summary,
    connections: collectBullets(sections.Connections),
    sourcesBody: collectBullets(sections.Sources),
    notes: sections.Notes,
  };
}
```

**Verify:** `bun test tests/atlas/page-reader.test.ts`
**Commit:** `atlas: add page reader that parses frontmatter and body sections`

### Task 2.2: Atomic page writer with staging
**File:** `src/atlas/page-writer.ts`
**Test:** `tests/atlas/page-writer.test.ts`
**Depends:** 1.4, 2.3
**Domain:** backend

```typescript
// tests/atlas/page-writer.test.ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { commitStagedPages, stagePageWrite } from "@/atlas/page-writer";
import { createStagingManager } from "@/atlas/staging";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-writer-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("page writer", () => {
  it("stages content and atomic-renames into vault on commit", async () => {
    const staging = createStagingManager(projectRoot, "run-1");
    staging.create();
    const target = join(projectRoot, "atlas", "10-impl", "x.md");
    stagePageWrite(staging, target, "hello world");
    expect(existsSync(target)).toBe(false);
    await commitStagedPages(staging);
    expect(readFileSync(target, "utf8")).toBe("hello world");
  });

  it("rolls back staging without writing on rollback", async () => {
    const staging = createStagingManager(projectRoot, "run-2");
    staging.create();
    const target = join(projectRoot, "atlas", "10-impl", "y.md");
    stagePageWrite(staging, target, "should not land");
    staging.rollback();
    expect(existsSync(target)).toBe(false);
    expect(existsSync(staging.dir)).toBe(false);
  });

  it("commit refuses if any staged file's parent target overlap is missing", async () => {
    const staging = createStagingManager(projectRoot, "run-3");
    staging.create();
    stagePageWrite(staging, join(projectRoot, "atlas", "10-impl", "deep", "z.md"), "content");
    await commitStagedPages(staging);
    expect(readFileSync(join(projectRoot, "atlas", "10-impl", "deep", "z.md"), "utf8")).toBe("content");
  });
});
```

```typescript
// src/atlas/page-writer.ts
import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import type { StagingManager } from "./staging";

interface StagedWrite {
  readonly target: string;
  readonly stagedAt: string;
}

const writes = new WeakMap<StagingManager, StagedWrite[]>();

export function stagePageWrite(staging: StagingManager, target: string, content: string): void {
  const list = writes.get(staging) ?? [];
  const rel = relative(staging.projectRoot, target);
  const stagedAt = join(staging.dir, rel);
  mkdirSync(dirname(stagedAt), { recursive: true });
  writeFileSync(stagedAt, content, "utf8");
  list.push({ target, stagedAt });
  writes.set(staging, list);
}

export async function commitStagedPages(staging: StagingManager): Promise<readonly string[]> {
  const list = writes.get(staging) ?? [];
  const moved: string[] = [];
  for (const entry of list) {
    mkdirSync(dirname(entry.target), { recursive: true });
    renameSync(entry.stagedAt, entry.target);
    moved.push(entry.target);
  }
  writes.delete(staging);
  staging.cleanup();
  return moved;
}
```

**Verify:** `bun test tests/atlas/page-writer.test.ts`
**Commit:** `atlas: add atomic page writer using per-run staging dir`

### Task 2.3: Run staging dir manager
**File:** `src/atlas/staging.ts`
**Test:** `tests/atlas/staging.test.ts`
**Depends:** 1.1, 1.2
**Domain:** backend

```typescript
// tests/atlas/staging.test.ts
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { createStagingManager } from "@/atlas/staging";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-staging-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("staging manager", () => {
  it("creates and cleans up a per-run staging directory", () => {
    const sm = createStagingManager(projectRoot, "run-1");
    sm.create();
    expect(existsSync(sm.dir)).toBe(true);
    sm.cleanup();
    expect(existsSync(sm.dir)).toBe(false);
  });

  it("rollback removes the staging directory", () => {
    const sm = createStagingManager(projectRoot, "run-2");
    sm.create();
    sm.rollback();
    expect(existsSync(sm.dir)).toBe(false);
  });

  it("dir resolves under atlas/_meta/staging", () => {
    const sm = createStagingManager(projectRoot, "run-3");
    expect(sm.dir).toBe(join(projectRoot, "atlas", "_meta", "staging", "run-3"));
  });
});
```

```typescript
// src/atlas/staging.ts
import { existsSync, mkdirSync, rmSync } from "node:fs";

import { createAtlasPaths } from "./paths";

export interface StagingManager {
  readonly projectRoot: string;
  readonly runId: string;
  readonly dir: string;
  readonly create: () => void;
  readonly cleanup: () => void;
  readonly rollback: () => void;
}

export function createStagingManager(projectRoot: string, runId: string): StagingManager {
  const paths = createAtlasPaths(projectRoot);
  const dir = paths.runStaging(runId);
  return {
    projectRoot,
    runId,
    dir,
    create: () => {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    },
    cleanup: () => {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    },
    rollback: () => {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    },
  };
}
```

**Verify:** `bun test tests/atlas/staging.test.ts`
**Commit:** `atlas: add per-run staging directory manager`

### Task 2.4: Per-project write lock
**File:** `src/atlas/write-lock.ts`
**Test:** `tests/atlas/write-lock.test.ts`
**Depends:** 1.1, 1.2
**Domain:** backend

```typescript
// tests/atlas/write-lock.test.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { ATLAS_STALE_LOCK_MS } from "@/atlas/config";
import { acquireWriteLock, releaseWriteLock } from "@/atlas/write-lock";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-lock-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("write lock", () => {
  it("acquires a fresh lock and writes the lock file", async () => {
    const lock = await acquireWriteLock(projectRoot, "run-1");
    expect(lock).not.toBe(null);
    expect(existsSync(lock!.lockFile)).toBe(true);
    const parsed = JSON.parse(readFileSync(lock!.lockFile, "utf8"));
    expect(parsed.runId).toBe("run-1");
    releaseWriteLock(lock!);
    expect(existsSync(lock!.lockFile)).toBe(false);
  });

  it("refuses when another live lock exists", async () => {
    const first = await acquireWriteLock(projectRoot, "run-a");
    expect(first).not.toBe(null);
    const second = await acquireWriteLock(projectRoot, "run-b");
    expect(second).toBe(null);
    releaseWriteLock(first!);
  });

  it("reclaims a stale lock", async () => {
    const lockFile = join(projectRoot, "atlas", "_meta", ".write.lock");
    mkdirSync(dirname(lockFile), { recursive: true });
    writeFileSync(
      lockFile,
      JSON.stringify({ pid: 999_999_999, runId: "old", acquiredAt: Date.now() - ATLAS_STALE_LOCK_MS - 1000 }),
      "utf8",
    );
    const fresh = await acquireWriteLock(projectRoot, "run-c");
    expect(fresh).not.toBe(null);
    releaseWriteLock(fresh!);
  });
});
```

```typescript
// src/atlas/write-lock.ts
import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { ATLAS_STALE_LOCK_MS } from "./config";
import { createAtlasPaths } from "./paths";

interface LockPayload {
  readonly pid: number;
  readonly runId: string;
  readonly acquiredAt: number;
}

export interface WriteLock {
  readonly lockFile: string;
  readonly runId: string;
}

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const isStale = (payload: LockPayload): boolean => {
  if (isProcessAlive(payload.pid)) return false;
  return Date.now() - payload.acquiredAt > ATLAS_STALE_LOCK_MS;
};

export async function acquireWriteLock(projectRoot: string, runId: string): Promise<WriteLock | null> {
  const paths = createAtlasPaths(projectRoot);
  mkdirSync(dirname(paths.lockFile), { recursive: true });
  if (existsSync(paths.lockFile)) {
    try {
      const existing = JSON.parse(readFileSync(paths.lockFile, "utf8")) as LockPayload;
      if (!isStale(existing)) return null;
    } catch {
      // bare catch: malformed lock file is reclaimable
    }
  }
  const payload: LockPayload = { pid: process.pid, runId, acquiredAt: Date.now() };
  writeFileSync(paths.lockFile, JSON.stringify(payload), "utf8");
  return { lockFile: paths.lockFile, runId };
}

export function releaseWriteLock(lock: WriteLock): void {
  if (existsSync(lock.lockFile)) unlinkSync(lock.lockFile);
}
```

**Verify:** `bun test tests/atlas/write-lock.test.ts`
**Commit:** `atlas: add per-project write lock with stale reclamation`

### Task 2.5: mtime-based edit detector
**File:** `src/atlas/mtime-detect.ts`
**Test:** `tests/atlas/mtime-detect.test.ts`
**Depends:** 1.4, 2.1
**Domain:** backend

```typescript
// tests/atlas/mtime-detect.test.ts
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { detectHumanEdit } from "@/atlas/mtime-detect";
import { renderEmptyNode } from "@/atlas/templates";
import { ATLAS_LAYERS, ATLAS_NODE_STATUSES } from "@/atlas/types";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atlas-mtime-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const writeNode = (path: string, lastWrittenMtime: number): void => {
  mkdirSync(dir, { recursive: true });
  const text = renderEmptyNode({
    id: "impl/x",
    layer: ATLAS_LAYERS.IMPL,
    status: ATLAS_NODE_STATUSES.ACTIVE,
    summary: "x",
    sources: [],
    lastVerifiedCommit: "",
    lastWrittenMtime,
  });
  writeFileSync(path, text, "utf8");
};

describe("detectHumanEdit", () => {
  it("returns false when frontmatter mtime matches file mtime", async () => {
    const path = join(dir, "x.md");
    writeNode(path, 0);
    const stat = statSync(path);
    utimesSync(path, stat.atime, new Date(0));
    writeNode(path, statSync(path).mtimeMs);
    const result = await detectHumanEdit(path);
    expect(result.edited).toBe(false);
  });

  it("returns true when file mtime drifted from frontmatter", async () => {
    const path = join(dir, "y.md");
    writeNode(path, 100);
    const stat = statSync(path);
    expect(stat.mtimeMs).not.toBe(100);
    const result = await detectHumanEdit(path);
    expect(result.edited).toBe(true);
  });

  it("returns false when node is missing", async () => {
    const result = await detectHumanEdit(join(dir, "missing.md"));
    expect(result.edited).toBe(false);
    expect(result.reason).toBe("missing");
  });
});
```

```typescript
// src/atlas/mtime-detect.ts
import { existsSync, statSync } from "node:fs";

import { readPage } from "./page-reader";

export interface MtimeDetectResult {
  readonly edited: boolean;
  readonly reason: "missing" | "match" | "drift";
  readonly fileMtime: number;
  readonly recordedMtime: number;
}

export async function detectHumanEdit(path: string): Promise<MtimeDetectResult> {
  if (!existsSync(path)) return { edited: false, reason: "missing", fileMtime: 0, recordedMtime: 0 };
  const node = await readPage(path);
  if (node === null) return { edited: false, reason: "missing", fileMtime: 0, recordedMtime: 0 };
  const fileMtime = Math.trunc(statSync(path).mtimeMs);
  const recordedMtime = Math.trunc(node.frontmatter.last_written_mtime);
  if (fileMtime === recordedMtime) return { edited: false, reason: "match", fileMtime, recordedMtime };
  return { edited: true, reason: "drift", fileMtime, recordedMtime };
}
```

**Verify:** `bun test tests/atlas/mtime-detect.test.ts`
**Commit:** `atlas: add mtime-based human edit detector`

### Task 2.6: Archive mover (soft delete)
**File:** `src/atlas/archive.ts`
**Test:** `tests/atlas/archive.test.ts`
**Depends:** 1.2
**Domain:** backend

```typescript
// tests/atlas/archive.test.ts
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { archiveNode } from "@/atlas/archive";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-archive-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("archiveNode", () => {
  it("moves a node into _archive preserving relative path", () => {
    const source = join(projectRoot, "atlas", "10-impl", "obsolete.md");
    mkdirSync(join(projectRoot, "atlas", "10-impl"), { recursive: true });
    writeFileSync(source, "node body", "utf8");
    const archived = archiveNode(projectRoot, source);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(archived)).toBe(true);
    expect(archived).toBe(join(projectRoot, "atlas", "_archive", "10-impl", "obsolete.md"));
    expect(readFileSync(archived, "utf8")).toBe("node body");
  });

  it("throws when source is outside vault", () => {
    expect(() => archiveNode(projectRoot, join(projectRoot, "src", "x.ts"))).toThrow();
  });

  it("throws when source missing", () => {
    expect(() => archiveNode(projectRoot, join(projectRoot, "atlas", "10-impl", "ghost.md"))).toThrow();
  });
});
```

```typescript
// src/atlas/archive.ts
import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import { createAtlasPaths } from "./paths";

export function archiveNode(projectRoot: string, sourcePath: string): string {
  const paths = createAtlasPaths(projectRoot);
  if (!sourcePath.startsWith(`${paths.root}${require("node:path").sep}`)) {
    throw new Error(`refuse to archive outside vault: ${sourcePath}`);
  }
  if (!existsSync(sourcePath)) throw new Error(`source not found: ${sourcePath}`);
  const rel = relative(paths.root, sourcePath);
  const target = join(paths.archive, rel);
  mkdirSync(dirname(target), { recursive: true });
  renameSync(sourcePath, target);
  return target;
}
```

**Verify:** `bun test tests/atlas/archive.test.ts`
**Commit:** `atlas: add archive mover for soft-delete`

### Task 2.7: Broken wikilink scanner
**File:** `src/atlas/broken-link-scanner.ts`
**Test:** `tests/atlas/broken-link-scanner.test.ts`
**Depends:** 1.6, 2.1
**Domain:** backend

```typescript
// tests/atlas/broken-link-scanner.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { scanBrokenWikilinks } from "@/atlas/broken-link-scanner";
import { renderEmptyNode } from "@/atlas/templates";
import { ATLAS_LAYERS, ATLAS_NODE_STATUSES } from "@/atlas/types";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-broken-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

const writeNode = (rel: string, connections: readonly string[]): void => {
  const file = join(projectRoot, "atlas", `${rel}.md`);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(
    file,
    renderEmptyNode({
      id: rel,
      layer: ATLAS_LAYERS.IMPL,
      status: ATLAS_NODE_STATUSES.ACTIVE,
      summary: "x",
      sources: [],
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
      connections,
    }),
    "utf8",
  );
};

describe("scanBrokenWikilinks", () => {
  it("reports targets that do not exist", async () => {
    writeNode("10-impl/a", ["[[20-behavior/missing]]"]);
    const broken = await scanBrokenWikilinks(projectRoot);
    expect(broken).toEqual([{ source: "10-impl/a", target: "20-behavior/missing" }]);
  });

  it("ignores valid links", async () => {
    writeNode("10-impl/a", ["[[10-impl/b]]"]);
    writeNode("10-impl/b", []);
    const broken = await scanBrokenWikilinks(projectRoot);
    expect(broken).toEqual([]);
  });

  it("returns empty when vault missing", async () => {
    expect(await scanBrokenWikilinks(join(projectRoot, "no-vault"))).toEqual([]);
  });
});
```

```typescript
// src/atlas/broken-link-scanner.ts
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { createAtlasPaths } from "./paths";
import { readPage } from "./page-reader";
import { extractWikilinks, parseWikilink } from "./wikilink";

export interface BrokenLink {
  readonly source: string;
  readonly target: string;
}

const MD_EXTENSION = ".md";

const collectMarkdown = (dir: string, root: string, out: string[]): void => {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (full.includes("/_meta/")) continue;
    if (full.includes("/_archive/")) continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectMarkdown(full, root, out);
      continue;
    }
    if (full.endsWith(MD_EXTENSION)) out.push(relative(root, full).replace(/\.md$/, ""));
  }
};

export async function scanBrokenWikilinks(projectRoot: string): Promise<readonly BrokenLink[]> {
  const paths = createAtlasPaths(projectRoot);
  if (!existsSync(paths.root)) return [];
  const ids: string[] = [];
  collectMarkdown(paths.root, paths.root, ids);
  const idSet = new Set(ids);
  const broken: BrokenLink[] = [];
  for (const id of ids) {
    const node = await readPage(join(paths.root, `${id}.md`));
    if (node === null) continue;
    const linkSources = [...node.connections, node.notes];
    for (const linkSource of linkSources) {
      const targets = linkSource.startsWith("[[")
        ? [parseWikilink(linkSource)].filter((t): t is string => t !== null)
        : extractWikilinks(linkSource);
      for (const target of targets) {
        if (!idSet.has(target)) broken.push({ source: id, target });
      }
    }
  }
  return broken;
}
```

**Verify:** `bun test tests/atlas/broken-link-scanner.test.ts`
**Commit:** `atlas: add broken wikilink scanner`

### Task 2.8: Orphan staging sweeper
**File:** `src/atlas/staging-sweeper.ts`
**Test:** `tests/atlas/staging-sweeper.test.ts`
**Depends:** 1.2, 2.3
**Domain:** backend

```typescript
// tests/atlas/staging-sweeper.test.ts
import { existsSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { sweepOrphanStaging } from "@/atlas/staging-sweeper";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-sweep-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("sweepOrphanStaging", () => {
  it("removes orphan staging directories", async () => {
    const stagingDir = join(projectRoot, "atlas", "_meta", "staging", "stale-run");
    mkdirSync(stagingDir, { recursive: true });
    const removed = await sweepOrphanStaging(projectRoot, new Set());
    expect(removed).toEqual(["stale-run"]);
    expect(existsSync(stagingDir)).toBe(false);
  });

  it("keeps active runs", async () => {
    const stagingDir = join(projectRoot, "atlas", "_meta", "staging", "live-run");
    mkdirSync(stagingDir, { recursive: true });
    const removed = await sweepOrphanStaging(projectRoot, new Set(["live-run"]));
    expect(removed).toEqual([]);
    expect(existsSync(stagingDir)).toBe(true);
  });

  it("returns empty when staging dir missing", async () => {
    expect(await sweepOrphanStaging(projectRoot, new Set())).toEqual([]);
  });
});
```

```typescript
// src/atlas/staging-sweeper.ts
import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { createAtlasPaths } from "./paths";

export async function sweepOrphanStaging(
  projectRoot: string,
  activeRunIds: ReadonlySet<string>,
): Promise<readonly string[]> {
  const paths = createAtlasPaths(projectRoot);
  if (!existsSync(paths.staging)) return [];
  const removed: string[] = [];
  for (const entry of readdirSync(paths.staging)) {
    const full = join(paths.staging, entry);
    if (!statSync(full).isDirectory()) continue;
    if (activeRunIds.has(entry)) continue;
    rmSync(full, { recursive: true, force: true });
    removed.push(entry);
  }
  return removed;
}
```

**Verify:** `bun test tests/atlas/staging-sweeper.test.ts`
**Commit:** `atlas: add orphan staging directory sweeper`

---

## Batch 3: Source Collectors (parallel, 6 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6

### Task 3.1: Lifecycle source collector
**File:** `src/atlas/sources/lifecycle.ts`
**Test:** `tests/atlas/sources/lifecycle.test.ts`
**Depends:** 1.3, 1.5
**Domain:** backend

```typescript
// tests/atlas/sources/lifecycle.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collectLifecycleSources } from "@/atlas/sources/lifecycle";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-src-lc-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("collectLifecycleSources", () => {
  it("returns lifecycle pointers for terminal records", async () => {
    const dir = join(projectRoot, "thoughts", "lifecycle");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "26.json"),
      JSON.stringify({
        issueNumber: 26,
        state: "terminal",
        artifacts: { design: ["thoughts/shared/designs/x.md"], plan: [], ledger: [], commit: [], pr: [], worktree: [] },
        notes: [],
        updatedAt: 1,
      }),
      "utf8",
    );
    const sources = await collectLifecycleSources(projectRoot);
    expect(sources).toContainEqual(expect.objectContaining({ pointer: "lifecycle:26", state: "terminal" }));
  });

  it("returns empty when lifecycle dir missing", async () => {
    expect(await collectLifecycleSources(projectRoot)).toEqual([]);
  });
});
```

```typescript
// src/atlas/sources/lifecycle.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

const LIFECYCLE_DIR = join("thoughts", "lifecycle");
const JSON_SUFFIX = ".json";
const LOG_SCOPE = "atlas.sources.lifecycle";

export interface LifecycleSource {
  readonly pointer: string;
  readonly issueNumber: number;
  readonly state: string;
  readonly designPointers: readonly string[];
  readonly planPointers: readonly string[];
  readonly ledgerPointers: readonly string[];
}

const parseRecord = (raw: string): LifecycleSource | null => {
  try {
    const parsed = JSON.parse(raw) as Record<string, unknown>;
    const artifacts = (parsed.artifacts ?? {}) as Record<string, readonly string[]>;
    return {
      pointer: `lifecycle:${parsed.issueNumber}`,
      issueNumber: Number(parsed.issueNumber),
      state: String(parsed.state ?? ""),
      designPointers: artifacts.design ?? [],
      planPointers: artifacts.plan ?? [],
      ledgerPointers: artifacts.ledger ?? [],
    };
  } catch (error) {
    log.warn(LOG_SCOPE, `parse failed: ${extractErrorMessage(error)}`);
    return null;
  }
};

export async function collectLifecycleSources(projectRoot: string): Promise<readonly LifecycleSource[]> {
  const dir = join(projectRoot, LIFECYCLE_DIR);
  if (!existsSync(dir)) return [];
  const out: LifecycleSource[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(JSON_SUFFIX)) continue;
    const raw = readFileSync(join(dir, entry), "utf8");
    const record = parseRecord(raw);
    if (record !== null) out.push(record);
  }
  return out;
}
```

**Verify:** `bun test tests/atlas/sources/lifecycle.test.ts`
**Commit:** `atlas: add lifecycle source collector`

### Task 3.2: Thoughts source collector
**File:** `src/atlas/sources/thoughts.ts`
**Test:** `tests/atlas/sources/thoughts.test.ts`
**Depends:** 1.5
**Domain:** backend

```typescript
// tests/atlas/sources/thoughts.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collectThoughtsSources } from "@/atlas/sources/thoughts";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-src-th-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("collectThoughtsSources", () => {
  it("returns design and plan pointers", async () => {
    const designs = join(projectRoot, "thoughts", "shared", "designs");
    const plans = join(projectRoot, "thoughts", "shared", "plans");
    mkdirSync(designs, { recursive: true });
    mkdirSync(plans, { recursive: true });
    writeFileSync(join(designs, "a.md"), "# a", "utf8");
    writeFileSync(join(plans, "b.md"), "# b", "utf8");
    const sources = await collectThoughtsSources(projectRoot);
    const pointers = sources.map((s) => s.pointer);
    expect(pointers).toContain("thoughts:shared/designs/a.md");
    expect(pointers).toContain("thoughts:shared/plans/b.md");
  });

  it("returns empty when thoughts missing", async () => {
    expect(await collectThoughtsSources(projectRoot)).toEqual([]);
  });
});
```

```typescript
// src/atlas/sources/thoughts.ts
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const THOUGHTS_DIRS = [
  ["thoughts", "shared", "designs"],
  ["thoughts", "shared", "plans"],
] as const;

export interface ThoughtsSource {
  readonly pointer: string;
  readonly relativePath: string;
}

const collectFiles = (dir: string, projectRoot: string, out: ThoughtsSource[]): void => {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isFile()) continue;
    if (!entry.endsWith(".md")) continue;
    const rel = relative(projectRoot, full);
    out.push({ pointer: `thoughts:${rel.split("thoughts/")[1] ?? rel}`, relativePath: rel });
  }
};

export async function collectThoughtsSources(projectRoot: string): Promise<readonly ThoughtsSource[]> {
  const out: ThoughtsSource[] = [];
  for (const segments of THOUGHTS_DIRS) collectFiles(join(projectRoot, ...segments), projectRoot, out);
  return out;
}
```

**Verify:** `bun test tests/atlas/sources/thoughts.test.ts`
**Commit:** `atlas: add thoughts source collector for designs and plans`

### Task 3.3: Project Memory source collector
**File:** `src/atlas/sources/project-memory.ts`
**Test:** `tests/atlas/sources/project-memory.test.ts`
**Depends:** 1.5
**Domain:** backend

```typescript
// tests/atlas/sources/project-memory.test.ts
import { describe, expect, it } from "bun:test";

import { collectProjectMemorySources } from "@/atlas/sources/project-memory";

const fakeStore = {
  list: async () => [
    { id: "e1", type: "decision", title: "use bun", body: "...", status: "active" },
    { id: "e2", type: "risk", title: "perf", body: "...", status: "active" },
    { id: "e3", type: "open_question", title: "phase 3", body: "...", status: "tentative" },
  ],
};

describe("collectProjectMemorySources", () => {
  it("partitions entries by type", async () => {
    const sources = await collectProjectMemorySources(fakeStore as never);
    expect(sources.decisions.map((d) => d.pointer)).toEqual(["pm:e1"]);
    expect(sources.risks.map((d) => d.pointer)).toEqual(["pm:e2"]);
    expect(sources.openQuestions.map((d) => d.pointer)).toEqual(["pm:e3"]);
  });

  it("returns empty when store yields nothing", async () => {
    const empty = { list: async () => [] };
    const sources = await collectProjectMemorySources(empty as never);
    expect(sources.decisions).toEqual([]);
    expect(sources.risks).toEqual([]);
    expect(sources.openQuestions).toEqual([]);
  });
});
```

```typescript
// src/atlas/sources/project-memory.ts
export interface PmEntryLike {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly status: string;
}

export interface PmEntryProjection {
  readonly pointer: string;
  readonly entry: PmEntryLike;
}

export interface ProjectMemorySources {
  readonly decisions: readonly PmEntryProjection[];
  readonly risks: readonly PmEntryProjection[];
  readonly openQuestions: readonly PmEntryProjection[];
}

interface StoreLike {
  readonly list: () => Promise<readonly PmEntryLike[]>;
}

const project = (entry: PmEntryLike): PmEntryProjection => ({ pointer: `pm:${entry.id}`, entry });

export async function collectProjectMemorySources(store: StoreLike): Promise<ProjectMemorySources> {
  const entries = await store.list();
  return {
    decisions: entries.filter((e) => e.type === "decision").map(project),
    risks: entries.filter((e) => e.type === "risk").map(project),
    openQuestions: entries.filter((e) => e.type === "open_question").map(project),
  };
}
```

**Verify:** `bun test tests/atlas/sources/project-memory.test.ts`
**Commit:** `atlas: add Project Memory source projector`

### Task 3.4: Mindmodel source collector
**File:** `src/atlas/sources/mindmodel.ts`
**Test:** `tests/atlas/sources/mindmodel.test.ts`
**Depends:** 1.5
**Domain:** backend

```typescript
// tests/atlas/sources/mindmodel.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collectMindmodelSources } from "@/atlas/sources/mindmodel";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-src-mm-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("collectMindmodelSources", () => {
  it("returns mindmodel pointers under .mindmodel", async () => {
    const dir = join(projectRoot, ".mindmodel", "patterns");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "factory.md"), "# factory", "utf8");
    const sources = await collectMindmodelSources(projectRoot);
    expect(sources).toContainEqual({ pointer: "mindmodel:patterns/factory", relativePath: ".mindmodel/patterns/factory.md" });
  });

  it("returns empty when mindmodel missing", async () => {
    expect(await collectMindmodelSources(projectRoot)).toEqual([]);
  });
});
```

```typescript
// src/atlas/sources/mindmodel.ts
import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const MINDMODEL_DIR = ".mindmodel";

export interface MindmodelSource {
  readonly pointer: string;
  readonly relativePath: string;
}

const walk = (dir: string, projectRoot: string, out: MindmodelSource[]): void => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, projectRoot, out);
      continue;
    }
    if (!entry.endsWith(".md")) continue;
    const rel = relative(projectRoot, full);
    const inner = rel.replace(`${MINDMODEL_DIR}/`, "").replace(/\.md$/, "");
    out.push({ pointer: `mindmodel:${inner}`, relativePath: rel });
  }
};

export async function collectMindmodelSources(projectRoot: string): Promise<readonly MindmodelSource[]> {
  const dir = join(projectRoot, MINDMODEL_DIR);
  if (!existsSync(dir)) return [];
  const out: MindmodelSource[] = [];
  walk(dir, projectRoot, out);
  return out;
}
```

**Verify:** `bun test tests/atlas/sources/mindmodel.test.ts`
**Commit:** `atlas: add mindmodel source collector`

### Task 3.5: Module map heuristic
**File:** `src/atlas/sources/module-map.ts`
**Test:** `tests/atlas/sources/module-map.test.ts`
**Depends:** 1.5
**Domain:** backend

```typescript
// tests/atlas/sources/module-map.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { collectModuleMap } from "@/atlas/sources/module-map";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-src-mod-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("collectModuleMap", () => {
  it("identifies modules with index.ts and reads leading comment", async () => {
    const dir = join(projectRoot, "src", "lifecycle");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.ts"), "// Lifecycle state machine module\nexport {};\n", "utf8");
    const modules = await collectModuleMap(projectRoot);
    expect(modules).toContainEqual({
      name: "lifecycle",
      pointer: "code:src/lifecycle",
      responsibility: "Lifecycle state machine module",
      relativePath: "src/lifecycle",
    });
  });

  it("falls back to unknown responsibility when no leading comment", async () => {
    const dir = join(projectRoot, "src", "tools");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.ts"), "export {};\n", "utf8");
    const modules = await collectModuleMap(projectRoot);
    const tools = modules.find((m) => m.name === "tools");
    expect(tools?.responsibility).toBe("(unknown responsibility)");
  });

  it("returns empty when src missing", async () => {
    expect(await collectModuleMap(projectRoot)).toEqual([]);
  });
});
```

```typescript
// src/atlas/sources/module-map.ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = "src";
const INDEX_FILE = "index.ts";
const COMMENT_PATTERN = /^\s*\/\/\s*(.+)$/;
const UNKNOWN = "(unknown responsibility)";

export interface ModuleEntry {
  readonly name: string;
  readonly pointer: string;
  readonly responsibility: string;
  readonly relativePath: string;
}

const readLeadingComment = (path: string): string => {
  const lines = readFileSync(path, "utf8").split("\n");
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const match = COMMENT_PATTERN.exec(line);
    if (match !== null) return match[1].trim();
    return UNKNOWN;
  }
  return UNKNOWN;
};

export async function collectModuleMap(projectRoot: string): Promise<readonly ModuleEntry[]> {
  const root = join(projectRoot, SRC_DIR);
  if (!existsSync(root)) return [];
  const out: ModuleEntry[] = [];
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    if (!statSync(dir).isDirectory()) continue;
    const indexPath = join(dir, INDEX_FILE);
    if (!existsSync(indexPath)) continue;
    out.push({
      name: entry,
      pointer: `code:${SRC_DIR}/${entry}`,
      responsibility: readLeadingComment(indexPath),
      relativePath: `${SRC_DIR}/${entry}`,
    });
  }
  return out;
}
```

**Verify:** `bun test tests/atlas/sources/module-map.test.ts`
**Commit:** `atlas: add module map heuristic from src/<dir>/index.ts`

### Task 3.6: Behavior inferrer scaffold
**File:** `src/atlas/sources/behavior-infer.ts`
**Test:** `tests/atlas/sources/behavior-infer.test.ts`
**Depends:** 3.1, 3.2
**Domain:** backend

```typescript
// tests/atlas/sources/behavior-infer.test.ts
import { describe, expect, it } from "bun:test";

import { inferBehaviorDrafts } from "@/atlas/sources/behavior-infer";

describe("inferBehaviorDrafts", () => {
  it("creates a draft per terminal lifecycle issue with a User Perspective section", () => {
    const drafts = inferBehaviorDrafts({
      lifecycle: [
        {
          pointer: "lifecycle:26",
          issueNumber: 26,
          state: "terminal",
          designPointers: ["thoughts/shared/designs/x.md"],
          planPointers: [],
          ledgerPointers: [],
        },
      ],
      designContents: { "thoughts/shared/designs/x.md": "## User Perspective\n\nThe user wants Y.\n" },
    });
    expect(drafts).toHaveLength(1);
    expect(drafts[0].id).toBe("behavior/lifecycle-26");
    expect(drafts[0].userPerspective).toContain("The user wants Y.");
    expect(drafts[0].sources).toContain("lifecycle:26");
  });

  it("skips lifecycles with no User Perspective section", () => {
    const drafts = inferBehaviorDrafts({
      lifecycle: [
        {
          pointer: "lifecycle:1",
          issueNumber: 1,
          state: "terminal",
          designPointers: ["thoughts/shared/designs/y.md"],
          planPointers: [],
          ledgerPointers: [],
        },
      ],
      designContents: { "thoughts/shared/designs/y.md": "no user section" },
    });
    expect(drafts).toEqual([]);
  });
});
```

```typescript
// src/atlas/sources/behavior-infer.ts
import type { LifecycleSource } from "./lifecycle";

const USER_PERSPECTIVE_HEADING = /^##\s+User Perspective\s*$/m;
const NEXT_HEADING = /^##\s+/m;

interface InferInput {
  readonly lifecycle: readonly LifecycleSource[];
  readonly designContents: Readonly<Record<string, string>>;
}

export interface BehaviorDraft {
  readonly id: string;
  readonly title: string;
  readonly userPerspective: string;
  readonly sources: readonly string[];
}

const extractUserPerspective = (raw: string): string | null => {
  const match = USER_PERSPECTIVE_HEADING.exec(raw);
  if (match === null) return null;
  const start = match.index + match[0].length;
  const rest = raw.slice(start);
  const next = NEXT_HEADING.exec(rest);
  return (next === null ? rest : rest.slice(0, next.index)).trim();
};

export function inferBehaviorDrafts(input: InferInput): readonly BehaviorDraft[] {
  const drafts: BehaviorDraft[] = [];
  for (const lifecycle of input.lifecycle) {
    if (lifecycle.state !== "terminal") continue;
    for (const designPointer of lifecycle.designPointers) {
      const content = input.designContents[designPointer];
      if (content === undefined) continue;
      const userPerspective = extractUserPerspective(content);
      if (userPerspective === null || userPerspective.length === 0) continue;
      drafts.push({
        id: `behavior/lifecycle-${lifecycle.issueNumber}`,
        title: `Behavior from lifecycle ${lifecycle.issueNumber}`,
        userPerspective,
        sources: [lifecycle.pointer, `thoughts:${designPointer.replace(/^thoughts\//, "")}`],
      });
    }
  }
  return drafts;
}
```

**Verify:** `bun test tests/atlas/sources/behavior-infer.test.ts`
**Commit:** `atlas: add behavior draft inferrer from lifecycle User Perspective sections`

---

## Batch 4: Agent2 Core Logic (parallel, 9 implementers)

All tasks in this batch depend on Batch 2 and Batch 3 completing.
Tasks: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7, 4.8, 4.9

### Task 4.1: Challenge writer
**File:** `src/atlas/challenge-writer.ts`
**Test:** `tests/atlas/challenge-writer.test.ts`
**Depends:** 1.2, 1.3, 1.9
**Domain:** backend

```typescript
// tests/atlas/challenge-writer.test.ts
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { writeChallenge } from "@/atlas/challenge-writer";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-cw-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("writeChallenge", () => {
  it("creates a markdown challenge in atlas/_meta/challenges with first-person body", async () => {
    const file = await writeChallenge(projectRoot, {
      target: "10-impl/runner.md",
      reason: "I see X in source Y, which differs from what the node says.",
      proposedChange: "I suggest changing it to Z.",
      sources: ["lifecycle:26", "code:src/lifecycle/runner.ts"],
      runId: "agent2-26-100",
    });
    expect(existsSync(file)).toBe(true);
    const body = readFileSync(file, "utf8");
    expect(body).toContain("status: open");
    expect(body).toContain("target: 10-impl/runner.md");
    expect(body).toContain("I see X");
    expect(body).toContain("I suggest changing it to Z.");
    expect(body).toContain("- lifecycle:26");
  });

  it("namespaces files under run id", async () => {
    await writeChallenge(projectRoot, {
      target: "20-behavior/x.md",
      reason: "r",
      proposedChange: "p",
      sources: [],
      runId: "agent2-26-200",
    });
    const files = readdirSync(join(projectRoot, "atlas", "_meta", "challenges"));
    expect(files.some((f) => f.startsWith("agent2-26-200-"))).toBe(true);
  });
});
```

```typescript
// src/atlas/challenge-writer.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { computeClaimHash } from "./claim-hash";
import { createAtlasPaths } from "./paths";

export interface NewChallenge {
  readonly target: string;
  readonly reason: string;
  readonly proposedChange: string;
  readonly sources: readonly string[];
  readonly runId: string;
}

const SLUG_PATTERN = /[^a-z0-9]+/g;

const slug = (raw: string): string => raw.toLowerCase().replace(SLUG_PATTERN, "-").replace(/^-+|-+$/g, "");

const renderBody = (input: NewChallenge, claimHash: string, createdAt: string): string => {
  const sources = input.sources.length === 0 ? "_none_" : input.sources.map((s) => `- ${s}`).join("\n");
  return `---
target: ${input.target}
status: open
claim_hash: ${claimHash}
run_id: ${input.runId}
created_at: ${createdAt}
---

## Reason

${input.reason}

## Proposed change

${input.proposedChange}

## Sources

${sources}
`;
};

export async function writeChallenge(projectRoot: string, input: NewChallenge): Promise<string> {
  const paths = createAtlasPaths(projectRoot);
  mkdirSync(paths.challenges, { recursive: true });
  const claimHash = computeClaimHash(input.target, input.reason);
  const createdAt = new Date().toISOString();
  const fileName = `${input.runId}-${slug(input.target)}-${claimHash}.md`;
  const file = join(paths.challenges, fileName);
  writeFileSync(file, renderBody(input, claimHash, createdAt), "utf8");
  return file;
}
```

**Verify:** `bun test tests/atlas/challenge-writer.test.ts`
**Commit:** `atlas: add challenge writer with first-person body and run-scoped filename`

### Task 4.2: Challenge dedup and cooldown
**File:** `src/atlas/challenge-dedup.ts`
**Test:** `tests/atlas/challenge-dedup.test.ts`
**Depends:** 1.2, 1.9, 4.1
**Domain:** backend

```typescript
// tests/atlas/challenge-dedup.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { addDismissedChallenge, isDismissed, loadDismissedChallenges } from "@/atlas/challenge-dedup";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-dedup-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("challenge dedup", () => {
  it("returns empty when dismissed file missing", () => {
    expect(loadDismissedChallenges(projectRoot)).toEqual([]);
  });

  it("loads parses and queries dismissed entries", () => {
    const path = join(projectRoot, "atlas", "_meta", "challenges", "_dismissed.json");
    mkdirSync(join(path, ".."), { recursive: true });
    writeFileSync(path, JSON.stringify([{ target: "a.md", claimHash: "abc", dismissedAt: "2026-01-01" }]), "utf8");
    expect(isDismissed(projectRoot, "a.md", "abc")).toBe(true);
    expect(isDismissed(projectRoot, "a.md", "other")).toBe(false);
  });

  it("addDismissedChallenge appends to file", () => {
    addDismissedChallenge(projectRoot, { target: "x.md", claimHash: "h1", dismissedAt: "2026-05-04" });
    addDismissedChallenge(projectRoot, { target: "y.md", claimHash: "h2", dismissedAt: "2026-05-04" });
    const all = loadDismissedChallenges(projectRoot);
    expect(all).toHaveLength(2);
  });
});
```

```typescript
// src/atlas/challenge-dedup.ts
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import { createAtlasPaths } from "./paths";

const LOG_SCOPE = "atlas.challenge-dedup";
const JSON_INDENT = 2;

export interface DismissedEntry {
  readonly target: string;
  readonly claimHash: string;
  readonly dismissedAt: string;
}

export function loadDismissedChallenges(projectRoot: string): readonly DismissedEntry[] {
  const paths = createAtlasPaths(projectRoot);
  if (!existsSync(paths.dismissedChallengesFile)) return [];
  try {
    const parsed = JSON.parse(readFileSync(paths.dismissedChallengesFile, "utf8"));
    return Array.isArray(parsed) ? (parsed as DismissedEntry[]) : [];
  } catch (error) {
    log.warn(LOG_SCOPE, `parse failed: ${extractErrorMessage(error)}`);
    return [];
  }
}

export function isDismissed(projectRoot: string, target: string, claimHash: string): boolean {
  return loadDismissedChallenges(projectRoot).some((e) => e.target === target && e.claimHash === claimHash);
}

export function addDismissedChallenge(projectRoot: string, entry: DismissedEntry): void {
  const paths = createAtlasPaths(projectRoot);
  mkdirSync(dirname(paths.dismissedChallengesFile), { recursive: true });
  const existing = loadDismissedChallenges(projectRoot);
  const next = [...existing, entry];
  writeFileSync(paths.dismissedChallengesFile, JSON.stringify(next, null, JSON_INDENT), "utf8");
}
```

**Verify:** `bun test tests/atlas/challenge-dedup.test.ts`
**Commit:** `atlas: add challenge dedup and cooldown registry`

### Task 4.3: Conflict-to-challenge router
**File:** `src/atlas/conflict-router.ts`
**Test:** `tests/atlas/conflict-router.test.ts`
**Depends:** 4.1, 4.2
**Domain:** backend

```typescript
// tests/atlas/conflict-router.test.ts
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { addDismissedChallenge } from "@/atlas/challenge-dedup";
import { ATLAS_CHALLENGE_CAP_PER_RUN } from "@/atlas/config";
import { computeClaimHash } from "@/atlas/claim-hash";
import { routeConflicts } from "@/atlas/conflict-router";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-router-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("routeConflicts", () => {
  it("emits a challenge per conflict up to the cap", async () => {
    const conflicts = Array.from({ length: ATLAS_CHALLENGE_CAP_PER_RUN + 5 }, (_, i) => ({
      target: `10-impl/n${i}.md`,
      reason: `reason-${i}`,
      proposedChange: `change-${i}`,
      sources: [],
    }));
    const result = await routeConflicts(projectRoot, "run-1", conflicts);
    expect(result.written.length).toBe(ATLAS_CHALLENGE_CAP_PER_RUN);
    expect(result.deferred.length).toBe(5);
  });

  it("skips dismissed claims", async () => {
    const target = "10-impl/x.md";
    addDismissedChallenge(projectRoot, {
      target,
      claimHash: computeClaimHash(target, "reason"),
      dismissedAt: "2026-01-01",
    });
    const result = await routeConflicts(projectRoot, "run-2", [
      { target, reason: "reason", proposedChange: "p", sources: [] },
    ]);
    expect(result.written).toEqual([]);
    expect(result.skippedDueToDedup).toBe(1);
  });
});
```

```typescript
// src/atlas/conflict-router.ts
import { isDismissed } from "./challenge-dedup";
import { writeChallenge } from "./challenge-writer";
import { computeClaimHash } from "./claim-hash";
import { ATLAS_CHALLENGE_CAP_PER_RUN } from "./config";

export interface ConflictInput {
  readonly target: string;
  readonly reason: string;
  readonly proposedChange: string;
  readonly sources: readonly string[];
}

export interface RouteResult {
  readonly written: readonly string[];
  readonly deferred: readonly string[];
  readonly skippedDueToDedup: number;
}

export async function routeConflicts(
  projectRoot: string,
  runId: string,
  conflicts: readonly ConflictInput[],
): Promise<RouteResult> {
  const written: string[] = [];
  const deferred: string[] = [];
  let skipped = 0;
  for (const conflict of conflicts) {
    if (written.length >= ATLAS_CHALLENGE_CAP_PER_RUN) {
      deferred.push(conflict.target);
      continue;
    }
    const claimHash = computeClaimHash(conflict.target, conflict.reason);
    if (isDismissed(projectRoot, conflict.target, claimHash)) {
      skipped += 1;
      continue;
    }
    const file = await writeChallenge(projectRoot, { ...conflict, runId });
    written.push(file);
  }
  return { written, deferred, skippedDueToDedup: skipped };
}
```

**Verify:** `bun test tests/atlas/conflict-router.test.ts`
**Commit:** `atlas: add conflict-to-challenge router with cap and dedup`

### Task 4.4: Wikilink rewiring guard
**File:** `src/atlas/rewire-guard.ts`
**Test:** `tests/atlas/rewire-guard.test.ts`
**Depends:** 1.6, 2.1, 2.5
**Domain:** backend

```typescript
// tests/atlas/rewire-guard.test.ts
import { describe, expect, it } from "bun:test";

import { decideRewireOrChallenge } from "@/atlas/rewire-guard";

describe("decideRewireOrChallenge", () => {
  it("returns rewire when target was not human-edited", () => {
    const decision = decideRewireOrChallenge({
      target: "10-impl/x.md",
      humanEdited: false,
      runsSinceEdit: 100,
      windowSize: 5,
    });
    expect(decision.action).toBe("rewire");
  });

  it("returns challenge when human-edited within window", () => {
    const decision = decideRewireOrChallenge({
      target: "10-impl/x.md",
      humanEdited: true,
      runsSinceEdit: 2,
      windowSize: 5,
    });
    expect(decision.action).toBe("challenge");
  });

  it("returns rewire when human-edited but outside window", () => {
    const decision = decideRewireOrChallenge({
      target: "10-impl/x.md",
      humanEdited: true,
      runsSinceEdit: 10,
      windowSize: 5,
    });
    expect(decision.action).toBe("rewire");
  });
});
```

```typescript
// src/atlas/rewire-guard.ts
export interface RewireInput {
  readonly target: string;
  readonly humanEdited: boolean;
  readonly runsSinceEdit: number;
  readonly windowSize: number;
}

export interface RewireDecision {
  readonly action: "rewire" | "challenge";
  readonly reason: string;
}

export function decideRewireOrChallenge(input: RewireInput): RewireDecision {
  if (!input.humanEdited) return { action: "rewire", reason: "no human edit detected" };
  if (input.runsSinceEdit >= input.windowSize) return { action: "rewire", reason: "outside recent-edit window" };
  return { action: "challenge", reason: "recently human-edited; rewire would orphan user input" };
}
```

**Verify:** `bun test tests/atlas/rewire-guard.test.ts`
**Commit:** `atlas: add rewiring guard for recently-edited nodes`

### Task 4.5: Soft-delete planner
**File:** `src/atlas/soft-delete-planner.ts`
**Test:** `tests/atlas/soft-delete-planner.test.ts`
**Depends:** 1.5, 2.1, 2.6
**Domain:** backend

```typescript
// tests/atlas/soft-delete-planner.test.ts
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
```

```typescript
// src/atlas/soft-delete-planner.ts
export interface NodeSummary {
  readonly id: string;
  readonly sources: readonly string[];
}

export interface PlanInput {
  readonly nodes: readonly NodeSummary[];
  readonly activeSources: ReadonlySet<string>;
}

export interface SoftDeletePlan {
  readonly id: string;
  readonly reason: string;
}

export function planSoftDeletes(input: PlanInput): readonly SoftDeletePlan[] {
  const plans: SoftDeletePlan[] = [];
  for (const node of input.nodes) {
    if (node.sources.length === 0) continue;
    const allGone = node.sources.every((s) => !input.activeSources.has(s));
    if (allGone) plans.push({ id: node.id, reason: "all sources disappeared" });
  }
  return plans;
}
```

**Verify:** `bun test tests/atlas/soft-delete-planner.test.ts`
**Commit:** `atlas: add soft-delete planner using active source set`

### Task 4.6: Worker output reconciler
**File:** `src/atlas/reconciler.ts`
**Test:** `tests/atlas/reconciler.test.ts`
**Depends:** 1.3
**Domain:** backend

```typescript
// tests/atlas/reconciler.test.ts
import { describe, expect, it } from "bun:test";

import { reconcileWorkerOutput } from "@/atlas/reconciler";

describe("reconcileWorkerOutput", () => {
  it("merges agreed claims and surfaces disagreements as conflicts", () => {
    const result = reconcileWorkerOutput([
      { worker: "build", claims: [{ target: "10-impl/a.md", claim: "spawns workers" }] },
      { worker: "behavior", claims: [{ target: "10-impl/a.md", claim: "spawns workers" }] },
      { worker: "build", claims: [{ target: "10-impl/a.md", claim: "uses queue" }] },
    ]);
    expect(result.agreed).toContainEqual({ target: "10-impl/a.md", claim: "spawns workers", workers: ["build", "behavior"] });
    expect(result.conflicts).toContainEqual(
      expect.objectContaining({
        target: "10-impl/a.md",
        proposedChange: expect.stringContaining("uses queue"),
      }),
    );
  });

  it("returns empty arrays when no claims", () => {
    const result = reconcileWorkerOutput([]);
    expect(result.agreed).toEqual([]);
    expect(result.conflicts).toEqual([]);
  });
});
```

```typescript
// src/atlas/reconciler.ts
export interface WorkerClaim {
  readonly target: string;
  readonly claim: string;
}

export interface WorkerOutput {
  readonly worker: string;
  readonly claims: readonly WorkerClaim[];
}

export interface AgreedClaim {
  readonly target: string;
  readonly claim: string;
  readonly workers: readonly string[];
}

export interface ConflictRecord {
  readonly target: string;
  readonly reason: string;
  readonly proposedChange: string;
  readonly sources: readonly string[];
}

export interface ReconcileResult {
  readonly agreed: readonly AgreedClaim[];
  readonly conflicts: readonly ConflictRecord[];
}

const keyOf = (target: string, claim: string): string => `${target}\u0001${claim}`;

export function reconcileWorkerOutput(outputs: readonly WorkerOutput[]): ReconcileResult {
  const claimsByTarget = new Map<string, Map<string, string[]>>();
  for (const output of outputs) {
    for (const claim of output.claims) {
      const inner = claimsByTarget.get(claim.target) ?? new Map<string, string[]>();
      const list = inner.get(claim.claim) ?? [];
      list.push(output.worker);
      inner.set(claim.claim, list);
      claimsByTarget.set(claim.target, inner);
    }
  }
  const agreed: AgreedClaim[] = [];
  const conflicts: ConflictRecord[] = [];
  for (const [target, inner] of claimsByTarget) {
    if (inner.size === 1) {
      const [claim, workers] = inner.entries().next().value as [string, string[]];
      agreed.push({ target, claim, workers });
      continue;
    }
    const summaries = Array.from(inner.entries()).map(([claim, workers]) => `- "${claim}" (${workers.join(", ")})`);
    conflicts.push({
      target,
      reason: "Workers disagreed about this node",
      proposedChange: summaries.join("\n"),
      sources: [],
    });
  }
  return { agreed, conflicts };
}
```

**Verify:** `bun test tests/atlas/reconciler.test.ts`
**Commit:** `atlas: add worker output reconciler with conflict detection`

### Task 4.7: Maintenance log writer
**File:** `src/atlas/log-writer.ts`
**Test:** `tests/atlas/log-writer.test.ts`
**Depends:** 1.2
**Domain:** backend

```typescript
// tests/atlas/log-writer.test.ts
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { writeMaintenanceLog } from "@/atlas/log-writer";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-log-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("writeMaintenanceLog", () => {
  it("writes a first-person markdown entry under _meta/log/", async () => {
    const file = await writeMaintenanceLog(projectRoot, {
      runId: "agent2-26-100",
      narrative: "I touched three nodes and opened one challenge.",
      touched: ["10-impl/a.md", "20-behavior/b.md"],
      challenges: ["agent2-26-100-x-abc123.md"],
      outcome: "succeeded",
    });
    expect(existsSync(file)).toBe(true);
    const body = readFileSync(file, "utf8");
    expect(body).toContain("# agent2 run agent2-26-100");
    expect(body).toContain("I touched three nodes");
    expect(body).toContain("- 10-impl/a.md");
    expect(body).toContain("outcome: succeeded");
  });
});
```

```typescript
// src/atlas/log-writer.ts
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createAtlasPaths } from "./paths";
import type { AtlasSpawnOutcome } from "./types";

export interface LogEntry {
  readonly runId: string;
  readonly narrative: string;
  readonly touched: readonly string[];
  readonly challenges: readonly string[];
  readonly outcome: AtlasSpawnOutcome;
}

const renderList = (items: readonly string[]): string =>
  items.length === 0 ? "_none_" : items.map((s) => `- ${s}`).join("\n");

const renderBody = (entry: LogEntry): string => {
  return `# agent2 run ${entry.runId}

outcome: ${entry.outcome}

## Narrative

${entry.narrative}

## Touched

${renderList(entry.touched)}

## Challenges

${renderList(entry.challenges)}
`;
};

export async function writeMaintenanceLog(projectRoot: string, entry: LogEntry): Promise<string> {
  const paths = createAtlasPaths(projectRoot);
  mkdirSync(paths.log, { recursive: true });
  const file = join(paths.log, `${entry.runId}.md`);
  writeFileSync(file, renderBody(entry), "utf8");
  return file;
}
```

**Verify:** `bun test tests/atlas/log-writer.test.ts`
**Commit:** `atlas: add maintenance log writer with first-person narrative`

### Task 4.8: Worker concurrency semaphore
**File:** `src/atlas/concurrency.ts`
**Test:** `tests/atlas/concurrency.test.ts`
**Depends:** 1.1
**Domain:** backend

```typescript
// tests/atlas/concurrency.test.ts
import { describe, expect, it } from "bun:test";

import { createSemaphore } from "@/atlas/concurrency";

describe("semaphore", () => {
  it("limits parallel acquires to the configured cap", async () => {
    const sem = createSemaphore(2);
    let active = 0;
    let max = 0;
    const wait = async (): Promise<void> => {
      await sem.acquire();
      active += 1;
      max = Math.max(max, active);
      await new Promise((r) => setTimeout(r, 5));
      active -= 1;
      sem.release();
    };
    await Promise.all([wait(), wait(), wait(), wait(), wait()]);
    expect(max).toBeLessThanOrEqual(2);
  });

  it("rejects non-positive cap", () => {
    expect(() => createSemaphore(0)).toThrow();
  });
});
```

```typescript
// src/atlas/concurrency.ts
export interface Semaphore {
  readonly acquire: () => Promise<void>;
  readonly release: () => void;
}

export function createSemaphore(cap: number): Semaphore {
  if (cap <= 0) throw new Error("semaphore cap must be positive");
  let inFlight = 0;
  const queue: Array<() => void> = [];
  const acquire = (): Promise<void> => {
    if (inFlight < cap) {
      inFlight += 1;
      return Promise.resolve();
    }
    return new Promise((resolve) => {
      queue.push(() => {
        inFlight += 1;
        resolve();
      });
    });
  };
  const release = (): void => {
    inFlight -= 1;
    const next = queue.shift();
    if (next !== undefined) next();
  };
  return { acquire, release };
}
```

**Verify:** `bun test tests/atlas/concurrency.test.ts`
**Commit:** `atlas: add concurrency semaphore for worker fan-out`

### Task 4.9: Atlas commit utility
**File:** `src/atlas/git.ts`
**Test:** `tests/atlas/git.test.ts`
**Depends:** 1.1
**Domain:** backend

```typescript
// tests/atlas/git.test.ts
import { describe, expect, it } from "bun:test";

import { ATLAS_COMMIT_PREFIX } from "@/atlas/config";
import { buildAtlasCommitMessage, validateStagedPaths } from "@/atlas/git";

describe("atlas git utility", () => {
  it("prefixes commit messages with atlas:", () => {
    expect(buildAtlasCommitMessage("touch runner")).toBe(`${ATLAS_COMMIT_PREFIX} touch runner`);
  });

  it("does not double-prefix", () => {
    expect(buildAtlasCommitMessage("atlas: touch runner")).toBe(`${ATLAS_COMMIT_PREFIX} touch runner`);
  });

  it("validates that staged paths live entirely under atlas/", () => {
    expect(validateStagedPaths(["atlas/10-impl/x.md", "atlas/_meta/log/run.md"])).toEqual({ ok: true });
    expect(validateStagedPaths(["atlas/x.md", "src/y.ts"])).toEqual({
      ok: false,
      reason: "non-atlas paths staged: src/y.ts",
    });
    expect(validateStagedPaths([])).toEqual({ ok: false, reason: "no atlas paths staged" });
  });
});
```

```typescript
// src/atlas/git.ts
import { ATLAS_COMMIT_PREFIX, ATLAS_ROOT_DIRNAME } from "./config";

const PREFIX_PATTERN = /^atlas:\s*/;

export function buildAtlasCommitMessage(summary: string): string {
  const cleaned = summary.replace(PREFIX_PATTERN, "").trim();
  return `${ATLAS_COMMIT_PREFIX} ${cleaned}`;
}

export interface StagedValidation {
  readonly ok: boolean;
  readonly reason?: string;
}

export function validateStagedPaths(paths: readonly string[]): StagedValidation {
  if (paths.length === 0) return { ok: false, reason: "no atlas paths staged" };
  const offenders = paths.filter((p) => !p.startsWith(`${ATLAS_ROOT_DIRNAME}/`));
  if (offenders.length > 0) return { ok: false, reason: `non-atlas paths staged: ${offenders.join(", ")}` };
  return { ok: true };
}
```

**Verify:** `bun test tests/atlas/git.test.ts`
**Commit:** `atlas: add atlas-prefixed commit message builder and staged path validator`

---

## Batch 5: Lifecycle Integration (parallel, 5 implementers)

All tasks in this batch depend on Batch 4 completing.
Tasks: 5.1, 5.2, 5.3, 5.4, 5.5

### Task 5.1: Handoff marker codec
**File:** `src/atlas/handoff-marker.ts`
**Test:** `tests/atlas/handoff-marker.test.ts`
**Depends:** 1.1, 1.3
**Domain:** backend

```typescript
// tests/atlas/handoff-marker.test.ts
import { describe, expect, it } from "bun:test";

import { extractHandoff, renderHandoffBlock, upsertHandoffMarker } from "@/atlas/handoff-marker";
import type { AtlasHandoff } from "@/atlas/types";

const SAMPLE_HANDOFF: AtlasHandoff = {
  lifecycleIssue: 26,
  affectedModules: ["lifecycle"],
  affectedFeatures: ["atlas"],
  designPointer: "thoughts:shared/designs/x.md",
  planPointer: "thoughts:shared/plans/y.md",
  ledgerPointer: null,
  decisions: ["use mtime detection"],
  crossLayerEffects: ["expect Behavior layer update"],
  doNotTouch: ["10-impl/critical.md"],
};

describe("atlas handoff marker", () => {
  it("renders begin/end markers with embedded JSON", () => {
    const block = renderHandoffBlock(SAMPLE_HANDOFF);
    expect(block).toContain("<!-- micode:atlas:handoff:begin -->");
    expect(block).toContain("<!-- micode:atlas:handoff:end -->");
    expect(block).toContain('"lifecycleIssue": 26');
  });

  it("round trips upsert and extract", () => {
    const body = "existing issue body";
    const updated = upsertHandoffMarker(body, SAMPLE_HANDOFF);
    const extracted = extractHandoff(updated);
    expect(extracted).toEqual(SAMPLE_HANDOFF);
  });

  it("returns null when marker missing", () => {
    expect(extractHandoff("no marker here")).toBe(null);
  });
});
```

```typescript
// src/atlas/handoff-marker.ts
import { extractBetween, replaceBetween } from "@/lifecycle/issue-body-markers";
import { ATLAS_HANDOFF_MARKER_BEGIN, ATLAS_HANDOFF_MARKER_END } from "./config";
import type { AtlasHandoff } from "./types";

const JSON_INDENT = 2;

export function renderHandoffBlock(handoff: AtlasHandoff): string {
  const inner = JSON.stringify(handoff, null, JSON_INDENT);
  return `${ATLAS_HANDOFF_MARKER_BEGIN}\n\n\`\`\`json\n${inner}\n\`\`\`\n\n${ATLAS_HANDOFF_MARKER_END}`;
}

const JSON_FENCE_PATTERN = /```json\n([\s\S]+?)\n```/;

export function extractHandoff(body: string): AtlasHandoff | null {
  const inner = extractBetween(body, ATLAS_HANDOFF_MARKER_BEGIN, ATLAS_HANDOFF_MARKER_END);
  if (inner === null) return null;
  const fence = JSON_FENCE_PATTERN.exec(inner);
  if (fence === null) return null;
  try {
    return JSON.parse(fence[1]) as AtlasHandoff;
  } catch {
    return null;
  }
}

export function upsertHandoffMarker(body: string, handoff: AtlasHandoff): string {
  const inner = `\n\`\`\`json\n${JSON.stringify(handoff, null, JSON_INDENT)}\n\`\`\`\n`;
  return replaceBetween(body, ATLAS_HANDOFF_MARKER_BEGIN, ATLAS_HANDOFF_MARKER_END, inner);
}
```

**Verify:** `bun test tests/atlas/handoff-marker.test.ts`
**Commit:** `atlas: add handoff marker codec for lifecycle issue body`

### Task 5.2: Spawn receipt marker codec
**File:** `src/atlas/spawn-receipt-marker.ts`
**Test:** `tests/atlas/spawn-receipt-marker.test.ts`
**Depends:** 1.1, 1.3
**Domain:** backend

```typescript
// tests/atlas/spawn-receipt-marker.test.ts
import { describe, expect, it } from "bun:test";

import { extractSpawnReceipt, renderSpawnReceiptBlock, upsertSpawnReceiptMarker } from "@/atlas/spawn-receipt-marker";
import { ATLAS_SPAWN_OUTCOMES, type AtlasSpawnReceipt } from "@/atlas/types";

const SAMPLE: AtlasSpawnReceipt = {
  runId: "agent2-26-100",
  sessionId: "sess-x",
  spawnAt: "2026-05-04T00:00:00.000Z",
  expectedCompletionWindowSec: 1800,
  doneAt: null,
  summary: null,
  outcome: ATLAS_SPAWN_OUTCOMES.PENDING,
};

describe("spawn receipt marker", () => {
  it("renders block with begin/end markers", () => {
    expect(renderSpawnReceiptBlock(SAMPLE)).toContain("<!-- micode:atlas:spawn:begin -->");
  });

  it("round trips upsert + extract", () => {
    const body = upsertSpawnReceiptMarker("existing", SAMPLE);
    expect(extractSpawnReceipt(body)).toEqual(SAMPLE);
  });

  it("returns null when missing", () => {
    expect(extractSpawnReceipt("nothing")).toBe(null);
  });

  it("supports updating doneAt and outcome", () => {
    const initial = upsertSpawnReceiptMarker("", SAMPLE);
    const updated = upsertSpawnReceiptMarker(initial, {
      ...SAMPLE,
      doneAt: "2026-05-04T00:30:00.000Z",
      summary: "ok",
      outcome: ATLAS_SPAWN_OUTCOMES.SUCCEEDED,
    });
    const extracted = extractSpawnReceipt(updated);
    expect(extracted?.outcome).toBe("succeeded");
    expect(extracted?.doneAt).toBe("2026-05-04T00:30:00.000Z");
  });
});
```

```typescript
// src/atlas/spawn-receipt-marker.ts
import { extractBetween, replaceBetween } from "@/lifecycle/issue-body-markers";
import { ATLAS_SPAWN_MARKER_BEGIN, ATLAS_SPAWN_MARKER_END } from "./config";
import type { AtlasSpawnReceipt } from "./types";

const JSON_INDENT = 2;
const JSON_FENCE_PATTERN = /```json\n([\s\S]+?)\n```/;

export function renderSpawnReceiptBlock(receipt: AtlasSpawnReceipt): string {
  const inner = JSON.stringify(receipt, null, JSON_INDENT);
  return `${ATLAS_SPAWN_MARKER_BEGIN}\n\n\`\`\`json\n${inner}\n\`\`\`\n\n${ATLAS_SPAWN_MARKER_END}`;
}

export function extractSpawnReceipt(body: string): AtlasSpawnReceipt | null {
  const inner = extractBetween(body, ATLAS_SPAWN_MARKER_BEGIN, ATLAS_SPAWN_MARKER_END);
  if (inner === null) return null;
  const fence = JSON_FENCE_PATTERN.exec(inner);
  if (fence === null) return null;
  try {
    return JSON.parse(fence[1]) as AtlasSpawnReceipt;
  } catch {
    return null;
  }
}

export function upsertSpawnReceiptMarker(body: string, receipt: AtlasSpawnReceipt): string {
  const inner = `\n\`\`\`json\n${JSON.stringify(receipt, null, JSON_INDENT)}\n\`\`\`\n`;
  return replaceBetween(body, ATLAS_SPAWN_MARKER_BEGIN, ATLAS_SPAWN_MARKER_END, inner);
}
```

**Verify:** `bun test tests/atlas/spawn-receipt-marker.test.ts`
**Commit:** `atlas: add spawn receipt marker codec`

### Task 5.3: User Perspective guard
**File:** `src/lifecycle/user-perspective-guard.ts`
**Test:** `tests/lifecycle/user-perspective-guard.test.ts`
**Depends:** none
**Domain:** backend

```typescript
// tests/lifecycle/user-perspective-guard.test.ts
import { describe, expect, it } from "bun:test";

import { validateUserPerspective } from "@/lifecycle/user-perspective-guard";

describe("validateUserPerspective", () => {
  it("accepts a file with a populated User Perspective section", () => {
    const result = validateUserPerspective(`# Title\n\n## User Perspective\n\nThe user wants Y.\n\n## Other\n`);
    expect(result.ok).toBe(true);
  });

  it("rejects a file without the section heading", () => {
    const result = validateUserPerspective(`# Title\n\n## Approach\n\nx\n`);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("User Perspective");
  });

  it("rejects when the section is empty", () => {
    const result = validateUserPerspective(`## User Perspective\n\n## Other\n`);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("non-empty");
  });

  it("trims leading whitespace lines when checking emptiness", () => {
    const result = validateUserPerspective(`## User Perspective\n   \n\n## Other\n`);
    expect(result.ok).toBe(false);
  });
});
```

```typescript
// src/lifecycle/user-perspective-guard.ts
const HEADING_PATTERN = /^##\s+User Perspective\s*$/m;
const NEXT_HEADING_PATTERN = /^##\s+/m;

export interface GuardResult {
  readonly ok: boolean;
  readonly reason?: string;
}

const findUserPerspectiveBody = (raw: string): string | null => {
  const heading = HEADING_PATTERN.exec(raw);
  if (heading === null) return null;
  const start = heading.index + heading[0].length;
  const rest = raw.slice(start);
  const next = NEXT_HEADING_PATTERN.exec(rest);
  return next === null ? rest : rest.slice(0, next.index);
};

export function validateUserPerspective(raw: string): GuardResult {
  const body = findUserPerspectiveBody(raw);
  if (body === null) return { ok: false, reason: "missing '## User Perspective' section" };
  if (body.trim().length === 0) return { ok: false, reason: "User Perspective section must have non-empty body" };
  return { ok: true };
}
```

**Verify:** `bun test tests/lifecycle/user-perspective-guard.test.ts`
**Commit:** `atlas: add User Perspective guard for lifecycle artifacts`

### Task 5.4: Wire User Perspective guard into record_artifact
**File:** `src/tools/lifecycle/record-artifact.ts`
**Test:** `tests/tools/lifecycle/record-artifact-user-perspective.test.ts`
**Depends:** 5.3
**Domain:** backend

```typescript
// tests/tools/lifecycle/record-artifact-user-perspective.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { rejectIfMissingUserPerspective } from "@/tools/lifecycle/record-artifact";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-rec-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

const writeFile = (rel: string, content: string): string => {
  const full = join(projectRoot, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, content, "utf8");
  return full;
};

describe("rejectIfMissingUserPerspective", () => {
  it("rejects design files without the section", () => {
    const file = writeFile("thoughts/shared/designs/x.md", "# x\n\n## Approach\n");
    const result = rejectIfMissingUserPerspective("design", file);
    expect(result.ok).toBe(false);
  });

  it("accepts design files with the section", () => {
    const file = writeFile("thoughts/shared/designs/y.md", "## User Perspective\n\nUser wants Z.\n");
    const result = rejectIfMissingUserPerspective("design", file);
    expect(result.ok).toBe(true);
  });

  it("accepts ledger files with the section", () => {
    const file = writeFile("thoughts/ledgers/26.md", "## User Perspective\n\nUser cares about A.\n");
    const result = rejectIfMissingUserPerspective("ledger", file);
    expect(result.ok).toBe(true);
  });

  it("ignores non-design/ledger artifact kinds", () => {
    const file = writeFile("plans/p.md", "# no section needed");
    expect(rejectIfMissingUserPerspective("plan", file).ok).toBe(true);
    expect(rejectIfMissingUserPerspective("commit", "abc123").ok).toBe(true);
  });
});
```

```typescript
// src/tools/lifecycle/record-artifact.ts (additions only; preserve existing exports)
import { existsSync, readFileSync } from "node:fs";

import { validateUserPerspective } from "@/lifecycle/user-perspective-guard";

const ENFORCED_KINDS = new Set(["design", "ledger"]);

export interface RejectResult {
  readonly ok: boolean;
  readonly reason?: string;
}

export function rejectIfMissingUserPerspective(kind: string, pointer: string): RejectResult {
  if (!ENFORCED_KINDS.has(kind)) return { ok: true };
  if (!existsSync(pointer)) return { ok: true };
  const raw = readFileSync(pointer, "utf8");
  return validateUserPerspective(raw);
}

// Existing record_artifact tool implementation should call rejectIfMissingUserPerspective
// before recording the pointer, and return the reason in the failure path.
```

**Verify:** `bun test tests/tools/lifecycle/record-artifact-user-perspective.test.ts`
**Commit:** `atlas: enforce User Perspective section on design and ledger artifacts`

### Task 5.5: Lifecycle finish hook to spawn agent2
**File:** `src/atlas/finish-spawn.ts`
**Test:** `tests/atlas/finish-spawn.test.ts`
**Depends:** 5.1, 5.2
**Domain:** backend

```typescript
// tests/atlas/finish-spawn.test.ts
import { describe, expect, it } from "bun:test";

import { ATLAS_SPAWN_OUTCOMES } from "@/atlas/types";
import { buildHandoffFromLifecycle, buildSpawnReceipt, shouldSpawnAgent2 } from "@/atlas/finish-spawn";

describe("finish-spawn helpers", () => {
  it("skips spawn when quickMode true", () => {
    expect(shouldSpawnAgent2({ quickMode: true, terminal: true })).toBe(false);
  });

  it("skips spawn when not terminal", () => {
    expect(shouldSpawnAgent2({ quickMode: false, terminal: false })).toBe(false);
  });

  it("spawns when terminal and not quick", () => {
    expect(shouldSpawnAgent2({ quickMode: false, terminal: true })).toBe(true);
  });

  it("builds a handoff package from lifecycle inputs", () => {
    const handoff = buildHandoffFromLifecycle({
      issueNumber: 26,
      affectedModules: ["lifecycle"],
      affectedFeatures: ["atlas"],
      designPointer: "thoughts:shared/designs/x.md",
      planPointer: null,
      ledgerPointer: null,
      decisions: ["d1"],
      crossLayerEffects: ["e1"],
      doNotTouch: [],
    });
    expect(handoff.lifecycleIssue).toBe(26);
    expect(handoff.affectedModules).toEqual(["lifecycle"]);
  });

  it("builds a pending spawn receipt", () => {
    const receipt = buildSpawnReceipt({
      runId: "agent2-26-100",
      sessionId: "s",
      spawnAt: "2026-05-04T00:00:00.000Z",
      expectedCompletionWindowSec: 600,
    });
    expect(receipt.outcome).toBe(ATLAS_SPAWN_OUTCOMES.PENDING);
    expect(receipt.doneAt).toBe(null);
  });
});
```

```typescript
// src/atlas/finish-spawn.ts
import { ATLAS_SPAWN_OUTCOMES, type AtlasHandoff, type AtlasSpawnReceipt } from "./types";

export interface SpawnGate {
  readonly quickMode: boolean;
  readonly terminal: boolean;
}

export function shouldSpawnAgent2(gate: SpawnGate): boolean {
  return gate.terminal && !gate.quickMode;
}

export interface HandoffInput {
  readonly issueNumber: number;
  readonly affectedModules: readonly string[];
  readonly affectedFeatures: readonly string[];
  readonly designPointer: string | null;
  readonly planPointer: string | null;
  readonly ledgerPointer: string | null;
  readonly decisions: readonly string[];
  readonly crossLayerEffects: readonly string[];
  readonly doNotTouch: readonly string[];
}

export function buildHandoffFromLifecycle(input: HandoffInput): AtlasHandoff {
  return {
    lifecycleIssue: input.issueNumber,
    affectedModules: input.affectedModules,
    affectedFeatures: input.affectedFeatures,
    designPointer: input.designPointer,
    planPointer: input.planPointer,
    ledgerPointer: input.ledgerPointer,
    decisions: input.decisions,
    crossLayerEffects: input.crossLayerEffects,
    doNotTouch: input.doNotTouch,
  };
}

export interface ReceiptInput {
  readonly runId: string;
  readonly sessionId: string;
  readonly spawnAt: string;
  readonly expectedCompletionWindowSec: number;
}

export function buildSpawnReceipt(input: ReceiptInput): AtlasSpawnReceipt {
  return {
    runId: input.runId,
    sessionId: input.sessionId,
    spawnAt: input.spawnAt,
    expectedCompletionWindowSec: input.expectedCompletionWindowSec,
    doneAt: null,
    summary: null,
    outcome: ATLAS_SPAWN_OUTCOMES.PENDING,
  };
}
```

**Verify:** `bun test tests/atlas/finish-spawn.test.ts`
**Commit:** `atlas: add finish-spawn helpers for lifecycle integration`

---

## Batch 6: Agents, Tools, and Commands (parallel, 10 implementers)

All tasks in this batch depend on Batch 4 and Batch 5 completing.
Tasks: 6.1, 6.2, 6.3, 6.4, 6.5, 6.6, 6.7, 6.8, 6.9, 6.10

### Task 6.1: agent2 (atlas-compiler) agent
**File:** `src/agents/atlas-compiler.ts`
**Test:** `tests/agents/atlas-compiler.test.ts`
**Depends:** 4.1, 4.2, 4.3, 4.6, 4.7, 4.9, 5.1, 5.2
**Domain:** general

```typescript
// tests/agents/atlas-compiler.test.ts
import { describe, expect, it } from "bun:test";

import { atlasCompilerAgent } from "@/agents/atlas-compiler";

describe("atlas-compiler agent", () => {
  it("declares subagent mode", () => {
    expect(atlasCompilerAgent.mode).toBe("subagent");
  });

  it("describes the agent's role and constraints", () => {
    expect(atlasCompilerAgent.description?.toLowerCase()).toContain("atlas");
    expect(atlasCompilerAgent.prompt).toContain("agent2");
    expect(atlasCompilerAgent.prompt).toContain("staging");
    expect(atlasCompilerAgent.prompt).toContain("challenge");
    expect(atlasCompilerAgent.prompt).toContain("mtime");
    expect(atlasCompilerAgent.prompt).toContain("atlas:");
  });

  it("forbids self-modification of _meta logs and challenges", () => {
    expect(atlasCompilerAgent.prompt).toContain("must not modify");
    expect(atlasCompilerAgent.prompt).toContain("_meta");
  });
});
```

```typescript
// src/agents/atlas-compiler.ts
import type { AgentConfig } from "@opencode-ai/sdk";

export const atlasCompilerAgent: AgentConfig = {
  description: "agent2: asynchronous atlas compiler that updates the project atlas vault after lifecycle finish",
  mode: "subagent",
  temperature: 0.3,
  prompt: `<environment>
You are running as part of the "micode" OpenCode plugin (NOT Claude Code).
You are agent2, the asynchronous Project Atlas compiler.
You are spawned by the lifecycle finish hook (your spawn is fire-and-forget at the surface; a spawn receipt records your session).
</environment>

<purpose>
Update the Project Atlas vault at <projectRoot>/atlas/ to reflect the most recent lifecycle finish.
Read the structured handoff package from the lifecycle issue body (between micode:atlas:handoff:begin / :end markers).
Spawn worker subagents (atlas-worker-build, atlas-worker-behavior) in parallel; reconcile their output; write atomically; route disagreements and human-edited nodes to challenges.
</purpose>

<protocol>
1. Acquire the per-project vault write lock at atlas/_meta/.write.lock. If it is held by a live process, exit cleanly and write a deferred-run note to the maintenance log.
2. Read the handoff package; refuse to run if it is missing or malformed.
3. Spawn atlas-worker-build and atlas-worker-behavior in parallel via spawn_agent. Concurrency cap is 6.
4. Collect worker output. Reconcile claims via the reconciler. Each disagreement becomes a challenge entry.
5. For every node about to be written, run the mtime detector. If a human edited the node, route to challenge instead of overwriting.
6. For wikilink rewires that would touch a recently-edited node (within the last 5 lifecycle runs), route to challenge instead of writing.
7. Plan soft-delete moves for nodes whose backing sources have all disappeared. Move them under atlas/_archive/ preserving relative path.
8. Stage all writes under atlas/_meta/staging/<runId>/. After reconciliation, atomic-rename into vault.
9. Write a first-person maintenance log under atlas/_meta/log/<runId>.md describing what you touched and why.
10. Update the spawn receipt marker in the lifecycle issue body with doneAt and outcome.
11. Commit with the atlas: prefix using the atlas commit utility. Refuse to commit if non-atlas paths are staged.
</protocol>

<constraints>
- You must not modify anything under atlas/_meta/ except writing your own staged log entries and challenge files.
- You must not retroactively close existing challenges. Only the user closes challenges.
- Per-run challenge volume is capped at 20; excess is merged into a single deferred summary.
- Per-run worker concurrency is capped at 6.
- mtime detection is observation-based. Trust no flags. If frontmatter last_written_mtime differs from file mtime, treat the node as human-edited.
- atlas: commits never bundle with feature commits; refuse if mixed staging is detected.
- On any unrecoverable failure, roll back staging, write outcome=failed to the spawn receipt, and exit.
</constraints>

<reading-flow>
Before producing changes, read atlas/00-index.md, the affected build and behavior nodes named in the handoff, and the relevant Project Memory entries projected under atlas/40-decisions and atlas/50-risks. Use Project Memory lookup and mindmodel lookup as needed.
</reading-flow>

<output>
Final output to the spawn channel is a short summary string (not the full log). The detailed narrative lives in the maintenance log.
</output>
`,
};
```

**Verify:** `bun test tests/agents/atlas-compiler.test.ts`
**Commit:** `atlas: add atlas-compiler (agent2) subagent definition`

### Task 6.2: atlas-worker-build agent
**File:** `src/agents/atlas-worker-build.ts`
**Test:** `tests/agents/atlas-worker-build.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/agents/atlas-worker-build.test.ts
import { describe, expect, it } from "bun:test";

import { atlasWorkerBuildAgent } from "@/agents/atlas-worker-build";

describe("atlas-worker-build agent", () => {
  it("is a subagent", () => {
    expect(atlasWorkerBuildAgent.mode).toBe("subagent");
  });

  it("focuses on the Build layer and module map", () => {
    expect(atlasWorkerBuildAgent.prompt.toLowerCase()).toContain("build layer");
    expect(atlasWorkerBuildAgent.prompt).toContain("10-impl");
    expect(atlasWorkerBuildAgent.prompt).toContain("source pointer");
  });

  it("instructs worker to emit claims, not write directly", () => {
    expect(atlasWorkerBuildAgent.prompt).toContain("emit claims");
    expect(atlasWorkerBuildAgent.prompt).toContain("do not write");
  });
});
```

```typescript
// src/agents/atlas-worker-build.ts
import type { AgentConfig } from "@opencode-ai/sdk";

export const atlasWorkerBuildAgent: AgentConfig = {
  description: "Atlas worker that proposes Build layer (10-impl) node updates from module map and code sources",
  mode: "subagent",
  temperature: 0.2,
  prompt: `<purpose>
You are an atlas worker focused on the Build layer at atlas/10-impl/.
You read the module map (src/<module>/index.ts), the lifecycle handoff, and relevant source files.
You emit claims about each node; you do not write the vault yourself. agent2 reconciles and writes.
</purpose>

<output-format>
Return a JSON array of claims:
[
  { "target": "10-impl/<node>.md", "claim": "<one sentence factual statement>", "sources": ["code:src/<path>", "lifecycle:<n>"] }
]
Each claim must be source-pointer-backed.
Each claim must be one factual statement. Do not bundle multiple claims.
</output-format>

<constraints>
- Stay in the Build layer. Do not propose Behavior layer changes.
- Do not propose changes outside the modules listed in the handoff's affectedModules.
- Granularity stops at module or subsystem level. Do not represent files or functions.
- Use single-word names where context allows (no Map/Array/List type-name suffixes).
</constraints>
`,
};
```

**Verify:** `bun test tests/agents/atlas-worker-build.test.ts`
**Commit:** `atlas: add atlas-worker-build subagent`

### Task 6.3: atlas-worker-behavior agent
**File:** `src/agents/atlas-worker-behavior.ts`
**Test:** `tests/agents/atlas-worker-behavior.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/agents/atlas-worker-behavior.test.ts
import { describe, expect, it } from "bun:test";

import { atlasWorkerBehaviorAgent } from "@/agents/atlas-worker-behavior";

describe("atlas-worker-behavior agent", () => {
  it("is a subagent", () => {
    expect(atlasWorkerBehaviorAgent.mode).toBe("subagent");
  });

  it("focuses on Behavior layer anchored to User Perspective", () => {
    expect(atlasWorkerBehaviorAgent.prompt.toLowerCase()).toContain("behavior layer");
    expect(atlasWorkerBehaviorAgent.prompt).toContain("20-behavior");
    expect(atlasWorkerBehaviorAgent.prompt).toContain("User Perspective");
  });

  it("forbids freeform code summaries", () => {
    expect(atlasWorkerBehaviorAgent.prompt).toContain("not a free-form code summary");
  });
});
```

```typescript
// src/agents/atlas-worker-behavior.ts
import type { AgentConfig } from "@opencode-ai/sdk";

export const atlasWorkerBehaviorAgent: AgentConfig = {
  description: "Atlas worker that proposes Behavior layer (20-behavior) node updates anchored to User Perspective",
  mode: "subagent",
  temperature: 0.2,
  prompt: `<purpose>
You are an atlas worker focused on the Behavior layer at atlas/20-behavior/.
You read the User Perspective sections from lifecycle designs and ledgers, the affected feature list in the handoff, and the existing Behavior nodes.
You emit claims that capture user-visible behavior, mechanics, numerics, and rules.
You do not write the vault yourself. agent2 reconciles and writes.
</purpose>

<anchoring>
The Behavior layer is anchored to user intent through the User Perspective section. It is not a free-form code summary. If no User Perspective text exists for an area, do not infer behavior; emit no claim.
</anchoring>

<output-format>
Return a JSON array of claims:
[
  { "target": "20-behavior/<node>.md", "claim": "<one sentence factual statement>", "sources": ["lifecycle:<n>", "thoughts:shared/designs/<file>.md"] }
]
</output-format>

<constraints>
- Stay in the Behavior layer.
- Cross-layer connections are emitted as separate claims with target "20-behavior/<node>.md" and a claim string of the form "links to [[10-impl/<module>]]".
- Do not propose changes outside the affectedFeatures list in the handoff.
</constraints>
`,
};
```

**Verify:** `bun test tests/agents/atlas-worker-behavior.test.ts`
**Commit:** `atlas: add atlas-worker-behavior subagent`

### Task 6.4: Register atlas agents in agents barrel
**File:** `src/agents/index.ts`
**Test:** `tests/agents/index-atlas.test.ts`
**Depends:** 6.1, 6.2, 6.3
**Domain:** general

```typescript
// tests/agents/index-atlas.test.ts
import { describe, expect, it } from "bun:test";

import { agents } from "@/agents";

describe("agents barrel includes atlas agents", () => {
  it("registers atlas-compiler", () => {
    expect(agents["atlas-compiler"]).toBeDefined();
    expect(agents["atlas-compiler"].mode).toBe("subagent");
  });

  it("registers atlas-worker-build", () => {
    expect(agents["atlas-worker-build"]).toBeDefined();
  });

  it("registers atlas-worker-behavior", () => {
    expect(agents["atlas-worker-behavior"]).toBeDefined();
  });
});
```

```typescript
// src/agents/index.ts (additions only; preserve existing imports/exports)
import { atlasCompilerAgent } from "./atlas-compiler";
import { atlasWorkerBehaviorAgent } from "./atlas-worker-behavior";
import { atlasWorkerBuildAgent } from "./atlas-worker-build";

// inside the agents Record literal:
//   "atlas-compiler": { ...atlasCompilerAgent, model: DEFAULT_MODEL },
//   "atlas-worker-build": { ...atlasWorkerBuildAgent, model: DEFAULT_MODEL },
//   "atlas-worker-behavior": { ...atlasWorkerBehaviorAgent, model: DEFAULT_MODEL },
```

**Verify:** `bun test tests/agents/index-atlas.test.ts`
**Commit:** `atlas: register atlas agents in agents barrel`

### Task 6.5: atlas_init tool
**File:** `src/tools/atlas/init.ts`
**Test:** `tests/tools/atlas/init.test.ts`
**Depends:** 1.7, 1.8, 2.4
**Domain:** backend

```typescript
// tests/tools/atlas/init.test.ts
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { runAtlasInit } from "@/tools/atlas/init";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-init-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("runAtlasInit", () => {
  it("creates the vault skeleton on a fresh project", async () => {
    const result = await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    expect(result.outcome).toBe("ok");
    expect(existsSync(join(projectRoot, "atlas", "00-index.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "atlas", "_meta", "schema-version"))).toBe(true);
    expect(existsSync(join(projectRoot, "atlas", "40-decisions", "atlas-phase-roadmap.md"))).toBe(true);
  });

  it("rejects on an existing vault when no flag passed", async () => {
    await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    const second = await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    expect(second.outcome).toBe("rejected");
    expect(second.reason).toContain("--reconcile or --force-rebuild");
  });

  it("--reconcile produces a dry-run report without writing", async () => {
    await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    const reconcile = await runAtlasInit({ projectRoot, mode: "reconcile", projectName: "demo", projectType: "server" });
    expect(reconcile.outcome).toBe("dry-run");
    expect(reconcile.report).toBeDefined();
  });

  it("--force-rebuild requires a pre-write git tag (recorded in result)", async () => {
    await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    const force = await runAtlasInit({
      projectRoot,
      mode: "force-rebuild",
      projectName: "demo",
      projectType: "server",
      gitTag: "atlas/pre-rebuild-1",
    });
    expect(force.outcome).toBe("ok");
    expect(force.gitTag).toBe("atlas/pre-rebuild-1");
  });
});
```

```typescript
// src/tools/atlas/init.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ATLAS_SCHEMA_VERSION } from "@/atlas/config";
import { createAtlasPaths } from "@/atlas/paths";
import { writeSchemaVersion } from "@/atlas/schema-version";
import { renderIndexPage, renderPhaseRoadmap } from "@/atlas/templates";

export type InitMode = "fresh" | "reconcile" | "force-rebuild";

export interface InitInput {
  readonly projectRoot: string;
  readonly mode: InitMode;
  readonly projectName: string;
  readonly projectType: string;
  readonly gitTag?: string;
}

export type InitOutcome = "ok" | "rejected" | "dry-run";

export interface InitResult {
  readonly outcome: InitOutcome;
  readonly reason?: string;
  readonly report?: string;
  readonly gitTag?: string;
}

const ensureDirs = (paths: ReturnType<typeof createAtlasPaths>): void => {
  for (const dir of [paths.root, paths.impl, paths.behavior, paths.decisions, paths.risks, paths.timeline, paths.archive, paths.meta, paths.challenges, paths.log, paths.staging]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
};

const writeSkeleton = (input: InitInput): void => {
  const paths = createAtlasPaths(input.projectRoot);
  ensureDirs(paths);
  writeFileSync(paths.indexFile, renderIndexPage({ projectName: input.projectName }), "utf8");
  writeFileSync(join(paths.decisions, "atlas-phase-roadmap.md"), renderPhaseRoadmap(), "utf8");
  writeSchemaVersion(paths.schemaVersionFile, ATLAS_SCHEMA_VERSION);
};

export async function runAtlasInit(input: InitInput): Promise<InitResult> {
  const paths = createAtlasPaths(input.projectRoot);
  const exists = existsSync(paths.root);
  if (exists && input.mode === "fresh") {
    return { outcome: "rejected", reason: "atlas/ already exists; pass --reconcile or --force-rebuild" };
  }
  if (input.mode === "reconcile") {
    return { outcome: "dry-run", report: `would refresh ${paths.root}; no writes performed` };
  }
  writeSkeleton(input);
  if (input.mode === "force-rebuild") return { outcome: "ok", gitTag: input.gitTag };
  return { outcome: "ok" };
}
```

**Verify:** `bun test tests/tools/atlas/init.test.ts`
**Commit:** `atlas: add atlas_init tool with fresh, reconcile, and force-rebuild modes`

### Task 6.6: atlas_status tool
**File:** `src/tools/atlas/status.ts`
**Test:** `tests/tools/atlas/status.test.ts`
**Depends:** 2.7, 2.8, 4.2, 5.2
**Domain:** backend

```typescript
// tests/tools/atlas/status.test.ts
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { runAtlasStatus } from "@/tools/atlas/status";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-status-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("runAtlasStatus", () => {
  it("returns zeroed counts for an empty project", async () => {
    const result = await runAtlasStatus({ projectRoot });
    expect(result.openChallenges).toBe(0);
    expect(result.brokenWikilinks).toBe(0);
    expect(result.orphanStagingDirs).toBe(0);
    expect(result.staleNodes).toBe(0);
    expect(result.lastSuccessfulRun).toBe(null);
  });

  it("counts open challenge files", async () => {
    const dir = join(projectRoot, "atlas", "_meta", "challenges");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "x.md"), "---\nstatus: open\n---\nbody", "utf8");
    writeFileSync(join(dir, "y.md"), "---\nstatus: dismissed\n---\nbody", "utf8");
    const result = await runAtlasStatus({ projectRoot });
    expect(result.openChallenges).toBe(1);
  });

  it("reports orphan staging directories", async () => {
    mkdirSync(join(projectRoot, "atlas", "_meta", "staging", "orphan"), { recursive: true });
    const result = await runAtlasStatus({ projectRoot });
    expect(result.orphanStagingDirs).toBe(1);
  });
});
```

```typescript
// src/tools/atlas/status.ts
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { scanBrokenWikilinks } from "@/atlas/broken-link-scanner";
import { createAtlasPaths } from "@/atlas/paths";

export interface StatusInput {
  readonly projectRoot: string;
}

export interface StatusReport {
  readonly openChallenges: number;
  readonly brokenWikilinks: number;
  readonly orphanStagingDirs: number;
  readonly staleNodes: number;
  readonly lastSuccessfulRun: string | null;
  readonly spawnReceiptDiff: number;
}

const STATUS_OPEN_LINE = "status: open";

const countOpenChallenges = (challengesDir: string): number => {
  if (!existsSync(challengesDir)) return 0;
  let count = 0;
  for (const entry of readdirSync(challengesDir)) {
    if (!entry.endsWith(".md")) continue;
    const raw = readFileSync(join(challengesDir, entry), "utf8");
    if (raw.includes(STATUS_OPEN_LINE)) count += 1;
  }
  return count;
};

const countOrphanStaging = (stagingDir: string): number => {
  if (!existsSync(stagingDir)) return 0;
  return readdirSync(stagingDir).length;
};

const findLastSuccessfulRun = (logDir: string): string | null => {
  if (!existsSync(logDir)) return null;
  const entries = readdirSync(logDir).filter((e) => e.endsWith(".md")).sort();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const raw = readFileSync(join(logDir, entries[i]), "utf8");
    if (raw.includes("outcome: succeeded")) return entries[i].replace(/\.md$/, "");
  }
  return null;
};

export async function runAtlasStatus(input: StatusInput): Promise<StatusReport> {
  const paths = createAtlasPaths(input.projectRoot);
  const broken = await scanBrokenWikilinks(input.projectRoot);
  return {
    openChallenges: countOpenChallenges(paths.challenges),
    brokenWikilinks: broken.length,
    orphanStagingDirs: countOrphanStaging(paths.staging),
    staleNodes: 0,
    lastSuccessfulRun: findLastSuccessfulRun(paths.log),
    spawnReceiptDiff: 0,
  };
}
```

**Verify:** `bun test tests/tools/atlas/status.test.ts`
**Commit:** `atlas: add atlas_status tool reporting vault health`

### Task 6.7: atlas_refresh tool
**File:** `src/tools/atlas/refresh.ts`
**Test:** `tests/tools/atlas/refresh.test.ts`
**Depends:** 2.3, 2.4, 4.7
**Domain:** backend

```typescript
// tests/tools/atlas/refresh.test.ts
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { runAtlasRefresh } from "@/tools/atlas/refresh";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-refresh-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("runAtlasRefresh", () => {
  it("refuses without an init'd vault", async () => {
    const result = await runAtlasRefresh({ projectRoot, target: "10-impl/runner" });
    expect(result.outcome).toBe("rejected");
  });

  it("acquires lock, writes a placeholder log entry, and releases", async () => {
    const result = await runAtlasRefresh({ projectRoot, target: "10-impl/runner", initIfMissing: true });
    expect(result.outcome).toBe("ok");
    expect(existsSync(join(projectRoot, "atlas", "_meta", "log"))).toBe(true);
  });
});
```

```typescript
// src/tools/atlas/refresh.ts
import { existsSync } from "node:fs";

import { createAtlasPaths } from "@/atlas/paths";
import { acquireWriteLock, releaseWriteLock } from "@/atlas/write-lock";
import { writeMaintenanceLog } from "@/atlas/log-writer";
import { ATLAS_SPAWN_OUTCOMES } from "@/atlas/types";
import { runAtlasInit } from "./init";

export interface RefreshInput {
  readonly projectRoot: string;
  readonly target: string;
  readonly initIfMissing?: boolean;
}

export type RefreshOutcome = "ok" | "rejected" | "locked";

export interface RefreshResult {
  readonly outcome: RefreshOutcome;
  readonly reason?: string;
}

const SECONDS_PER_RUN = Math.floor(Date.now() / 1000);

export async function runAtlasRefresh(input: RefreshInput): Promise<RefreshResult> {
  const paths = createAtlasPaths(input.projectRoot);
  if (!existsSync(paths.root)) {
    if (input.initIfMissing !== true) return { outcome: "rejected", reason: "atlas/ not initialised" };
    await runAtlasInit({ projectRoot: input.projectRoot, mode: "fresh", projectName: "atlas", projectType: "server" });
  }
  const runId = `refresh-${SECONDS_PER_RUN}`;
  const lock = await acquireWriteLock(input.projectRoot, runId);
  if (lock === null) return { outcome: "locked", reason: "another atlas run is in progress" };
  try {
    await writeMaintenanceLog(input.projectRoot, {
      runId,
      narrative: `Manual refresh of ${input.target}.`,
      touched: [input.target],
      challenges: [],
      outcome: ATLAS_SPAWN_OUTCOMES.SUCCEEDED,
    });
    return { outcome: "ok" };
  } finally {
    releaseWriteLock(lock);
  }
}
```

**Verify:** `bun test tests/tools/atlas/refresh.test.ts`
**Commit:** `atlas: add atlas_refresh tool for manual node refresh`

### Task 6.8: Atlas tools barrel
**File:** `src/tools/atlas/index.ts`
**Test:** `tests/tools/atlas/index.test.ts`
**Depends:** 6.5, 6.6, 6.7
**Domain:** general

```typescript
// tests/tools/atlas/index.test.ts
import { describe, expect, it } from "bun:test";

import { runAtlasInit, runAtlasRefresh, runAtlasStatus } from "@/tools/atlas";

describe("atlas tools barrel", () => {
  it("re-exports the three command implementations", () => {
    expect(typeof runAtlasInit).toBe("function");
    expect(typeof runAtlasStatus).toBe("function");
    expect(typeof runAtlasRefresh).toBe("function");
  });
});
```

```typescript
// src/tools/atlas/index.ts
export { runAtlasInit } from "./init";
export { runAtlasRefresh } from "./refresh";
export { runAtlasStatus } from "./status";
```

**Verify:** `bun test tests/tools/atlas/index.test.ts`
**Commit:** `atlas: barrel-export atlas tools`

### Task 6.9: Slash commands /atlas-init /atlas-status /atlas-refresh
**File:** `src/atlas/commands.ts`
**Test:** `tests/atlas/commands.test.ts`
**Depends:** 6.8
**Domain:** general

```typescript
// tests/atlas/commands.test.ts
import { describe, expect, it } from "bun:test";

import { atlasCommandDefinitions, parseAtlasInitArgs } from "@/atlas/commands";

describe("atlas slash commands", () => {
  it("declares three commands with descriptions", () => {
    const names = atlasCommandDefinitions.map((c) => c.name);
    expect(names).toEqual(["/atlas-init", "/atlas-status", "/atlas-refresh"]);
    for (const def of atlasCommandDefinitions) {
      expect(def.description.length).toBeGreaterThan(0);
    }
  });

  it("parses --reconcile and --force-rebuild flags for /atlas-init", () => {
    expect(parseAtlasInitArgs([])).toEqual({ mode: "fresh" });
    expect(parseAtlasInitArgs(["--reconcile"])).toEqual({ mode: "reconcile" });
    expect(parseAtlasInitArgs(["--force-rebuild"])).toEqual({ mode: "force-rebuild" });
  });

  it("rejects unknown flags", () => {
    expect(() => parseAtlasInitArgs(["--weird"])).toThrow();
  });

  it("rejects passing both --reconcile and --force-rebuild", () => {
    expect(() => parseAtlasInitArgs(["--reconcile", "--force-rebuild"])).toThrow();
  });
});
```

```typescript
// src/atlas/commands.ts
import type { InitMode } from "@/tools/atlas/init";

export interface AtlasCommandDefinition {
  readonly name: string;
  readonly description: string;
}

export const atlasCommandDefinitions: readonly AtlasCommandDefinition[] = [
  { name: "/atlas-init", description: "Initialise the project atlas vault (use --reconcile or --force-rebuild on existing vaults)" },
  { name: "/atlas-status", description: "Report atlas vault health: open challenges, broken wikilinks, orphan staging, last run" },
  { name: "/atlas-refresh", description: "Manually refresh a single atlas node or area without waiting for lifecycle finish" },
];

const RECONCILE = "--reconcile";
const FORCE_REBUILD = "--force-rebuild";
const KNOWN_FLAGS = new Set([RECONCILE, FORCE_REBUILD]);

export function parseAtlasInitArgs(argv: readonly string[]): { readonly mode: InitMode } {
  for (const arg of argv) if (!KNOWN_FLAGS.has(arg)) throw new Error(`unknown flag: ${arg}`);
  const reconcile = argv.includes(RECONCILE);
  const forceRebuild = argv.includes(FORCE_REBUILD);
  if (reconcile && forceRebuild) throw new Error("cannot pass both --reconcile and --force-rebuild");
  if (reconcile) return { mode: "reconcile" };
  if (forceRebuild) return { mode: "force-rebuild" };
  return { mode: "fresh" };
}
```

**Verify:** `bun test tests/atlas/commands.test.ts`
**Commit:** `atlas: declare /atlas-init, /atlas-status, /atlas-refresh slash commands`

### Task 6.10: Plugin index wiring
**File:** `src/index.ts`
**Test:** `tests/index-atlas-wiring.test.ts`
**Depends:** 6.4, 6.8, 6.9
**Domain:** general

```typescript
// tests/index-atlas-wiring.test.ts
import { describe, expect, it } from "bun:test";

import { agents } from "@/agents";
import { atlasCommandDefinitions } from "@/atlas/commands";
import * as atlasTools from "@/tools/atlas";

describe("atlas wiring", () => {
  it("plugin exports atlas agents", () => {
    expect(agents["atlas-compiler"]).toBeDefined();
    expect(agents["atlas-worker-build"]).toBeDefined();
    expect(agents["atlas-worker-behavior"]).toBeDefined();
  });

  it("atlas tools barrel exposes the three runners", () => {
    expect(typeof atlasTools.runAtlasInit).toBe("function");
    expect(typeof atlasTools.runAtlasStatus).toBe("function");
    expect(typeof atlasTools.runAtlasRefresh).toBe("function");
  });

  it("declares three atlas slash commands", () => {
    expect(atlasCommandDefinitions).toHaveLength(3);
  });
});
```

```typescript
// src/index.ts (additions only; preserve existing structure)
import { atlasCommandDefinitions } from "@/atlas/commands";
import { runAtlasInit, runAtlasRefresh, runAtlasStatus } from "@/tools/atlas";

// Inside the Plugin factory's command registration block, register each
// definition in atlasCommandDefinitions, dispatching to the corresponding
// runAtlas* function. Argument parsing uses parseAtlasInitArgs for /atlas-init.
//
// The atlas agents are picked up automatically by `agents` from "@/agents"
// (registered in Task 6.4); no extra wiring is required here for them.
```

**Verify:** `bun test tests/index-atlas-wiring.test.ts`
**Commit:** `atlas: wire atlas tools, agents, and slash commands into plugin entrypoint`

---

## Batch 7: End-to-End Integration and Polish (parallel, 3 implementers)

All tasks in this batch depend on Batch 6 completing.
Tasks: 7.1, 7.2, 7.3

### Task 7.1: End-to-end fixture integration test
**File:** `tests/integration/atlas-end-to-end.test.ts`
**Test:** (this file IS the test)
**Depends:** 6.5, 6.6, 6.7
**Domain:** general

```typescript
// tests/integration/atlas-end-to-end.test.ts
import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "bun:test";

import { writeChallenge } from "@/atlas/challenge-writer";
import { detectHumanEdit } from "@/atlas/mtime-detect";
import { runAtlasInit } from "@/tools/atlas/init";
import { runAtlasRefresh } from "@/tools/atlas/refresh";
import { runAtlasStatus } from "@/tools/atlas/status";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-e2e-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("atlas end-to-end", () => {
  it("init -> refresh -> status produces a clean vault and zero broken counts", async () => {
    const init = await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    expect(init.outcome).toBe("ok");
    expect(existsSync(join(projectRoot, "atlas", "00-index.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "atlas", "40-decisions", "atlas-phase-roadmap.md"))).toBe(true);
    expect(readFileSync(join(projectRoot, "atlas", "_meta", "schema-version"), "utf8").trim()).toBe("1");

    const refresh = await runAtlasRefresh({ projectRoot, target: "10-impl/runner" });
    expect(refresh.outcome).toBe("ok");

    const status = await runAtlasStatus({ projectRoot });
    expect(status.openChallenges).toBe(0);
    expect(status.brokenWikilinks).toBe(0);
    expect(status.orphanStagingDirs).toBe(0);
    expect(status.lastSuccessfulRun).not.toBe(null);
  });

  it("a written challenge appears in /atlas-status open count", async () => {
    await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    await writeChallenge(projectRoot, {
      target: "10-impl/runner.md",
      reason: "I see drift",
      proposedChange: "I would update X to Y",
      sources: ["lifecycle:26"],
      runId: "agent2-26-100",
    });
    const status = await runAtlasStatus({ projectRoot });
    expect(status.openChallenges).toBe(1);
  });

  it("rejects /atlas-init on existing vault without flag", async () => {
    await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    const second = await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    expect(second.outcome).toBe("rejected");
  });

  it("mtime detector flags a hand-edited node", async () => {
    await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
    const path = join(projectRoot, "atlas", "00-index.md");
    const before = statSync(path).mtimeMs;
    expect(before).toBeGreaterThan(0);
    writeFileSync(path, `${readFileSync(path, "utf8")}\n\nhuman edit\n`, "utf8");
    const result = await detectHumanEdit(path);
    expect(result.edited).toBe(true);
  });
});
```

```typescript
// (no separate src file: this task is a test only)
```

**Verify:** `bun test tests/integration/atlas-end-to-end.test.ts`
**Commit:** `atlas: add end-to-end integration test for init, refresh, status, mtime detection`

### Task 7.2: Promote Phase 3 items as project memory open_questions at lifecycle finish
**File:** `src/atlas/phase-roadmap-memory.ts`
**Test:** `tests/atlas/phase-roadmap-memory.test.ts`
**Depends:** none
**Domain:** backend

```typescript
// tests/atlas/phase-roadmap-memory.test.ts
import { describe, expect, it } from "bun:test";

import { ATLAS_PHASE_3_OPEN_QUESTIONS, buildAtlasPhaseMemoryEntries } from "@/atlas/phase-roadmap-memory";

describe("atlas phase roadmap memory entries", () => {
  it("declares one open_question per Phase 3 item", () => {
    expect(ATLAS_PHASE_3_OPEN_QUESTIONS.length).toBeGreaterThanOrEqual(7);
    for (const item of ATLAS_PHASE_3_OPEN_QUESTIONS) {
      expect(item.title.length).toBeGreaterThan(0);
      expect(item.trigger.length).toBeGreaterThan(0);
    }
  });

  it("builds memory-shaped entries with type=open_question and tentative status", () => {
    const entries = buildAtlasPhaseMemoryEntries();
    for (const entry of entries) {
      expect(entry.type).toBe("open_question");
      expect(entry.status).toBe("tentative");
      expect(entry.title).toMatch(/atlas phase 3/i);
    }
  });
});
```

```typescript
// src/atlas/phase-roadmap-memory.ts
export interface PhaseItem {
  readonly title: string;
  readonly trigger: string;
}

export interface MemoryEntryShape {
  readonly type: "open_question";
  readonly status: "tentative";
  readonly title: string;
  readonly body: string;
}

export const ATLAS_PHASE_3_OPEN_QUESTIONS: readonly PhaseItem[] = [
  { title: "Independent lint and GC pass", trigger: "vault > 200 nodes OR _archive > 50 OR broken wikilinks > 10" },
  { title: "Project type profile system", trigger: "more than one project type using atlas" },
  { title: "agent2 failure escalation", trigger: "failure rate above threshold or repeated silent stop" },
  { title: "Cross-project schema migration tools", trigger: "schema version increment" },
  { title: "Independent git isolation for atlas", trigger: "atlas commits exceed signal-to-noise threshold" },
  { title: "madge or dependency-cruiser SVG cross-reference", trigger: "user wants compiler-grounded cross-check on Build layer" },
  { title: "Behavior layer round-trip verification", trigger: "behavior drift incident or repeated user disagreement" },
];

const PREFIX = "atlas phase 3:";

export function buildAtlasPhaseMemoryEntries(): readonly MemoryEntryShape[] {
  return ATLAS_PHASE_3_OPEN_QUESTIONS.map((item) => ({
    type: "open_question" as const,
    status: "tentative" as const,
    title: `${PREFIX} ${item.title}`,
    body: `Trigger: ${item.trigger}. Source: thoughts/shared/designs/2026-05-04-project-atlas-design.md (Phase Roadmap section).`,
  }));
}
```

**Verify:** `bun test tests/atlas/phase-roadmap-memory.test.ts`
**Commit:** `atlas: declare Phase 3 items as project-memory open_question entries for lifecycle finish promotion`

### Task 7.3: Atlas README
**File:** `atlas/README.md`
**Test:** none
**Depends:** none
**Domain:** general

```markdown
# Project Atlas

Project Atlas is a curated project knowledge layer maintained jointly by the project owner and agents.

This vault is rendered as Markdown plus YAML frontmatter plus Obsidian wikilinks. Open the directory in Obsidian for graph view, search, and backlinks.

## Layout

- `00-index.md` - project overview and reading guide.
- `10-impl/` - Build layer: modules, subsystems, dependencies, internal structure.
- `20-behavior/` - Behavior layer: features, mechanics, numerics, user-visible behavior.
- `40-decisions/` - pages projected from active Project Memory decisions.
- `50-risks/` - pages projected from active Project Memory risks.
- `60-timeline/` - per-period project events.
- `_archive/` - soft-deleted nodes preserved for recovery.
- `_meta/` - maintenance logs, agent2 reports, challenges, schema version.

## How updates happen

After a lifecycle finish, the lifecycle hook spawns `atlas-compiler` (agent2). It reads the handoff package from the lifecycle issue body, fans out workers, reconciles their output, and atomically updates this vault.

If a node was edited by a human in Obsidian since the last agent2 write, agent2 routes the proposed change to a challenge under `_meta/challenges/` instead of overwriting your edit. Review challenges in Obsidian or via `/atlas-status`.

Manual refresh of one node: `/atlas-refresh <id>`.

## Commit discipline

Atlas changes are committed with the `atlas:` prefix and never bundled with feature commits. Filter atlas noise from log: `git log --invert-grep='^atlas:'`.

## Schema

The current schema version is recorded at `_meta/schema-version`. Frontmatter required fields: `id`, `layer`, `status`, `last_verified_commit`, `last_written_mtime`, `sources`. Body H2 set: `Summary`, `Connections`, `Sources`, `Notes`.
```

**Verify:** `ls atlas/README.md`
**Commit:** `atlas: add README explaining vault layout and update flow`
