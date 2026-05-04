---
date: 2026-05-04
topic: "atlas-init cold orchestrator"
issue: 33
scope: atlas
contract: none
---

# /atlas-init Cold Orchestrator Implementation Plan

**Goal:** Rewrite `/atlas-init` as a comprehensive cold-start orchestrator that performs broad project discovery, synthesizes a vault plan, optionally asks grouped Octto questions, fans out worker agents in parallel, and writes a directly-usable Obsidian vault in one run, with no dependence on lifecycle handoff markers or issue ids.

**Architecture:** Cold init is a self-contained orchestration entry point that runs at the runtime level (it can use micode internals, including spawn-agent-style fan-out and Octto session creation). It is deliberately decoupled from `atlas-compiler` (which remains the lifecycle-finish incremental path). The orchestrator runs five phases: (1) parallel discovery over code, thoughts, lifecycle, mindmodel, project memory; (2) synthesis into a vault plan listing nodes per layer; (3) optional Octto question batch generated from synthesis gaps, grouped and skippable; (4) parallel worker fan-out to draft per-layer node content using the existing semaphore + staging + atomic-rename protocol; (5) commit phase that materializes the index, timeline, decisions, risks, build, and behavior nodes into `atlas/`. Behavior layer content is allowed to be inferred when User Perspective signal is weak, but the prose explicitly marks itself as inferred/draft and points back to its source artifacts in natural language (no confidence frontmatter field).

**Design:** `thoughts/shared/designs/2026-05-04-project-atlas-design.md` (sections "/atlas-init Command", "Behavior layer cold-start") plus the operational expectations stated by the user in issue #33.

**Contract:** none (single-domain, all backend/general; no frontend tasks).

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2, 1.3, 1.4, 1.5, 1.6 [foundation - no deps]
Batch 2 (parallel): 2.1, 2.2, 2.3, 2.4 [orchestrator pieces - depend on batch 1]
Batch 3 (parallel): 3.1, 3.2, 3.3, 3.4, 3.5, 3.6 [worker agents + writers - depend on batch 2]
Batch 4 (sequential): 4.1, 4.2, 4.3 [integration - depend on batch 3]
```

---

## Batch 1: Foundation (parallel - 6 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6

### Task 1.1: Cold-init types and shared interfaces
**File:** `src/atlas/cold-init/types.ts`
**Test:** none (pure type module)
**Depends:** none
**Domain:** general

```typescript
import type { AtlasLayer } from "@/atlas/types";

export interface ColdInitDiscovery {
  readonly projectName: string;
  readonly projectRoot: string;
  readonly modules: readonly DiscoveredModule[];
  readonly designs: readonly DiscoveredArtifact[];
  readonly plans: readonly DiscoveredArtifact[];
  readonly ledgers: readonly DiscoveredArtifact[];
  readonly lifecycleRecords: readonly DiscoveredLifecycle[];
  readonly mindmodelEntries: readonly DiscoveredArtifact[];
  readonly projectMemoryDecisions: readonly DiscoveredMemoryEntry[];
  readonly projectMemoryRisks: readonly DiscoveredMemoryEntry[];
  readonly projectMemoryOpenQuestions: readonly DiscoveredMemoryEntry[];
  readonly readmeSummary: string | null;
  readonly architectureSummary: string | null;
}

export interface DiscoveredModule {
  readonly name: string;
  readonly pointer: string;
  readonly responsibility: string;
  readonly relativePath: string;
}

export interface DiscoveredArtifact {
  readonly pointer: string;
  readonly relativePath: string;
  readonly title: string;
  readonly excerpt: string;
}

export interface DiscoveredLifecycle {
  readonly pointer: string;
  readonly issueNumber: number;
  readonly state: string;
  readonly designPointers: readonly string[];
  readonly planPointers: readonly string[];
  readonly ledgerPointers: readonly string[];
}

export interface DiscoveredMemoryEntry {
  readonly pointer: string;
  readonly id: string;
  readonly title: string;
  readonly body: string;
  readonly status: string;
}

export interface PlannedNode {
  readonly id: string;
  readonly layer: AtlasLayer;
  readonly relativePath: string;
  readonly title: string;
  readonly summary: string;
  readonly sources: readonly string[];
  readonly connections: readonly string[];
  readonly inferred: boolean;
}

export interface VaultPlan {
  readonly indexNode: PlannedNode;
  readonly buildNodes: readonly PlannedNode[];
  readonly behaviorNodes: readonly PlannedNode[];
  readonly decisionNodes: readonly PlannedNode[];
  readonly riskNodes: readonly PlannedNode[];
  readonly timelineNodes: readonly PlannedNode[];
}

export interface ColdInitOptions {
  readonly askQuestions: boolean;
  readonly questionTimeoutMs: number;
}

export interface ColdInitOutcome {
  readonly status: "ok" | "rejected" | "dry-run";
  readonly reason?: string;
  readonly nodesWritten: number;
  readonly questionsAsked: number;
  readonly stagingDir: string | null;
  readonly logPath: string | null;
}
```

**Verify:** `bun run typecheck`
**Commit:** `feat(atlas): add cold-init type module`

### Task 1.2: Cold-init config constants
**File:** `src/atlas/cold-init/config.ts`
**Test:** `tests/atlas/cold-init/config.test.ts`
**Depends:** none
**Domain:** general

Decision: configure all cold-init tunables in one place so they can be tuned without touching orchestration logic. Naming follows `src/atlas/config.ts` style (UPPER_SNAKE_CASE module-level constants exported individually).

```typescript
// src/atlas/cold-init/config.ts
export const COLD_INIT_WORKER_CONCURRENCY_MAX = 6;
export const COLD_INIT_QUESTION_TIMEOUT_MS = 10 * 60 * 1000;
export const COLD_INIT_QUESTION_GROUP_MIN = 1;
export const COLD_INIT_QUESTION_GROUP_MAX = 12;
export const COLD_INIT_DESIGN_EXCERPT_CHARS = 600;
export const COLD_INIT_README_EXCERPT_CHARS = 1200;
export const COLD_INIT_RUN_ID_PREFIX = "cold-init";
export const COLD_INIT_DEFAULT_PROJECT_TYPE = "generic";
```

```typescript
// tests/atlas/cold-init/config.test.ts
import { describe, expect, it } from "bun:test";

import {
  COLD_INIT_DESIGN_EXCERPT_CHARS,
  COLD_INIT_QUESTION_GROUP_MAX,
  COLD_INIT_QUESTION_GROUP_MIN,
  COLD_INIT_QUESTION_TIMEOUT_MS,
  COLD_INIT_README_EXCERPT_CHARS,
  COLD_INIT_RUN_ID_PREFIX,
  COLD_INIT_WORKER_CONCURRENCY_MAX,
} from "@/atlas/cold-init/config";

describe("cold-init config", () => {
  it("worker concurrency cap is positive", () => {
    expect(COLD_INIT_WORKER_CONCURRENCY_MAX).toBeGreaterThan(0);
  });

  it("question timeout is at least one minute", () => {
    expect(COLD_INIT_QUESTION_TIMEOUT_MS).toBeGreaterThanOrEqual(60_000);
  });

  it("question group bounds are sane", () => {
    expect(COLD_INIT_QUESTION_GROUP_MIN).toBeGreaterThanOrEqual(1);
    expect(COLD_INIT_QUESTION_GROUP_MAX).toBeGreaterThan(COLD_INIT_QUESTION_GROUP_MIN);
  });

  it("excerpt sizes are positive", () => {
    expect(COLD_INIT_DESIGN_EXCERPT_CHARS).toBeGreaterThan(0);
    expect(COLD_INIT_README_EXCERPT_CHARS).toBeGreaterThan(0);
  });

  it("run id prefix is stable", () => {
    expect(COLD_INIT_RUN_ID_PREFIX).toBe("cold-init");
  });
});
```

**Verify:** `bun test tests/atlas/cold-init/config.test.ts`
**Commit:** `feat(atlas): add cold-init config constants`

### Task 1.3: README and ARCHITECTURE summary collector
**File:** `src/atlas/cold-init/sources/project-survey.ts`
**Test:** `tests/atlas/cold-init/sources/project-survey.test.ts`
**Depends:** none
**Domain:** general

Decision: cold init must read the project's existing top-level documentation (`README.md`, `ARCHITECTURE.md`, `CODE_STYLE.md`, `package.json`) so workers have a high-signal seed without having to redo `/init`. Excerpt size capped via `COLD_INIT_README_EXCERPT_CHARS`.

```typescript
// src/atlas/cold-init/sources/project-survey.ts
import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { COLD_INIT_README_EXCERPT_CHARS } from "@/atlas/cold-init/config";

export interface ProjectSurvey {
  readonly projectName: string;
  readonly readmeSummary: string | null;
  readonly architectureSummary: string | null;
  readonly codeStyleSummary: string | null;
  readonly packageManifest: PackageManifestSummary | null;
}

export interface PackageManifestSummary {
  readonly kind: "node" | "python" | "rust" | "go" | "unknown";
  readonly name: string | null;
  readonly description: string | null;
  readonly scripts: readonly string[];
}

const README_CANDIDATES = ["README.md", "README.MD", "Readme.md", "readme.md"] as const;

const truncate = (raw: string): string => {
  if (raw.length <= COLD_INIT_README_EXCERPT_CHARS) return raw;
  return `${raw.slice(0, COLD_INIT_README_EXCERPT_CHARS)}...`;
};

const readFirstExisting = (projectRoot: string, names: readonly string[]): string | null => {
  for (const name of names) {
    const full = join(projectRoot, name);
    if (existsSync(full)) return truncate(readFileSync(full, "utf8"));
  }
  return null;
};

const readPackageManifest = (projectRoot: string): PackageManifestSummary | null => {
  const candidates: ReadonlyArray<readonly [string, PackageManifestSummary["kind"]]> = [
    ["package.json", "node"],
    ["pyproject.toml", "python"],
    ["Cargo.toml", "rust"],
    ["go.mod", "go"],
  ];
  for (const [name, kind] of candidates) {
    const full = join(projectRoot, name);
    if (!existsSync(full)) continue;
    if (kind !== "node") return { kind, name: null, description: null, scripts: [] };
    try {
      const parsed = JSON.parse(readFileSync(full, "utf8")) as {
        name?: unknown;
        description?: unknown;
        scripts?: Record<string, unknown>;
      };
      const scripts = parsed.scripts ? Object.keys(parsed.scripts) : [];
      return {
        kind: "node",
        name: typeof parsed.name === "string" ? parsed.name : null,
        description: typeof parsed.description === "string" ? parsed.description : null,
        scripts,
      };
    } catch {
      return { kind: "node", name: null, description: null, scripts: [] };
    }
  }
  return null;
};

export async function collectProjectSurvey(projectRoot: string): Promise<ProjectSurvey> {
  return {
    projectName: basename(projectRoot),
    readmeSummary: readFirstExisting(projectRoot, README_CANDIDATES),
    architectureSummary: readFirstExisting(projectRoot, ["ARCHITECTURE.md"]),
    codeStyleSummary: readFirstExisting(projectRoot, ["CODE_STYLE.md"]),
    packageManifest: readPackageManifest(projectRoot),
  };
}
```

```typescript
// tests/atlas/cold-init/sources/project-survey.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectProjectSurvey } from "@/atlas/cold-init/sources/project-survey";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "cold-init-survey-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("collectProjectSurvey", () => {
  it("returns null fields when no documentation present", async () => {
    const survey = await collectProjectSurvey(projectRoot);
    expect(survey.readmeSummary).toBeNull();
    expect(survey.architectureSummary).toBeNull();
    expect(survey.packageManifest).toBeNull();
  });

  it("captures README content when present", async () => {
    writeFileSync(join(projectRoot, "README.md"), "# Hello\n\nA project.", "utf8");
    const survey = await collectProjectSurvey(projectRoot);
    expect(survey.readmeSummary).toContain("Hello");
  });

  it("parses package.json name and scripts", async () => {
    writeFileSync(
      join(projectRoot, "package.json"),
      JSON.stringify({ name: "demo", description: "x", scripts: { test: "bun test" } }),
      "utf8",
    );
    const survey = await collectProjectSurvey(projectRoot);
    expect(survey.packageManifest?.kind).toBe("node");
    expect(survey.packageManifest?.name).toBe("demo");
    expect(survey.packageManifest?.scripts).toContain("test");
  });
});
```

**Verify:** `bun test tests/atlas/cold-init/sources/project-survey.test.ts`
**Commit:** `feat(atlas): add cold-init project survey collector`

### Task 1.4: Lifecycle history collector (history-mode, no handoff dependency)
**File:** `src/atlas/cold-init/sources/lifecycle-history.ts`
**Test:** `tests/atlas/cold-init/sources/lifecycle-history.test.ts`
**Depends:** none
**Domain:** general

Decision: cold init does NOT read `micode:atlas:handoff` markers. Instead, it walks `thoughts/lifecycle/*.json` directly to derive a chronological list of past lifecycle records, regardless of state. This is purely historical reading; it neither writes nor reacts to lifecycle markers.

```typescript
// src/atlas/cold-init/sources/lifecycle-history.ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

const LIFECYCLE_DIR = join("thoughts", "lifecycle");
const JSON_SUFFIX = ".json";
const LOG_SCOPE = "atlas.cold-init.lifecycle";

export interface LifecycleHistoryEntry {
  readonly pointer: string;
  readonly issueNumber: number;
  readonly title: string;
  readonly state: string;
  readonly designPointers: readonly string[];
  readonly planPointers: readonly string[];
  readonly ledgerPointers: readonly string[];
  readonly modifiedAtMs: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const readPointers = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((p): p is string => typeof p === "string");
};

const readNumber = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return Number.NaN;
};

const readString = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

const parseEntry = (raw: string, modifiedAtMs: number): LifecycleHistoryEntry | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const artifacts = isRecord(parsed.artifacts) ? parsed.artifacts : {};
    const issueNumber = readNumber(parsed.issueNumber);
    if (Number.isNaN(issueNumber)) return null;
    return {
      pointer: `lifecycle:${issueNumber}`,
      issueNumber,
      title: readString(parsed.title) || readString(parsed.summary),
      state: readString(parsed.state),
      designPointers: readPointers(artifacts.design),
      planPointers: readPointers(artifacts.plan),
      ledgerPointers: readPointers(artifacts.ledger),
      modifiedAtMs,
    };
  } catch (error) {
    log.warn(LOG_SCOPE, `parse failed: ${extractErrorMessage(error)}`);
    return null;
  }
};

export async function collectLifecycleHistory(projectRoot: string): Promise<readonly LifecycleHistoryEntry[]> {
  const dir = join(projectRoot, LIFECYCLE_DIR);
  if (!existsSync(dir)) return [];
  const out: LifecycleHistoryEntry[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(JSON_SUFFIX)) continue;
    const full = join(dir, name);
    const raw = readFileSync(full, "utf8");
    const stat = statSync(full);
    const entry = parseEntry(raw, stat.mtimeMs);
    if (entry !== null) out.push(entry);
  }
  return out.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);
}
```

```typescript
// tests/atlas/cold-init/sources/lifecycle-history.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectLifecycleHistory } from "@/atlas/cold-init/sources/lifecycle-history";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "cold-init-lh-"));
  mkdirSync(join(projectRoot, "thoughts", "lifecycle"), { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("collectLifecycleHistory", () => {
  it("returns empty when no lifecycle dir", async () => {
    const empty = mkdtempSync(join(tmpdir(), "no-lc-"));
    const out = await collectLifecycleHistory(empty);
    expect(out).toHaveLength(0);
    rmSync(empty, { recursive: true, force: true });
  });

  it("parses lifecycle records and sorts by mtime desc", async () => {
    writeFileSync(
      join(projectRoot, "thoughts", "lifecycle", "1.json"),
      JSON.stringify({
        issueNumber: 1,
        title: "first",
        state: "closed",
        artifacts: { design: ["thoughts/shared/designs/a.md"], plan: [], ledger: [] },
      }),
      "utf8",
    );
    writeFileSync(
      join(projectRoot, "thoughts", "lifecycle", "2.json"),
      JSON.stringify({
        issueNumber: 2,
        title: "second",
        state: "in_progress",
        artifacts: { design: [], plan: ["thoughts/shared/plans/b.md"], ledger: [] },
      }),
      "utf8",
    );
    const out = await collectLifecycleHistory(projectRoot);
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.pointer.startsWith("lifecycle:"))).toBe(true);
  });

  it("skips malformed records", async () => {
    writeFileSync(join(projectRoot, "thoughts", "lifecycle", "bad.json"), "not json", "utf8");
    const out = await collectLifecycleHistory(projectRoot);
    expect(out).toHaveLength(0);
  });
});
```

**Verify:** `bun test tests/atlas/cold-init/sources/lifecycle-history.test.ts`
**Commit:** `feat(atlas): add cold-init lifecycle history collector`

### Task 1.5: Design and plan excerpt collector
**File:** `src/atlas/cold-init/sources/artifact-excerpts.ts`
**Test:** `tests/atlas/cold-init/sources/artifact-excerpts.test.ts`
**Depends:** none
**Domain:** general

Decision: extends the existing `src/atlas/sources/thoughts.ts` (which only returns paths) by also reading the file, extracting the H1 title, and a leading excerpt. Workers in batch 3 use these excerpts to seed Behavior and Decision node drafts without re-reading large files repeatedly.

```typescript
// src/atlas/cold-init/sources/artifact-excerpts.ts
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { COLD_INIT_DESIGN_EXCERPT_CHARS } from "@/atlas/cold-init/config";

const H1_PATTERN = /^#\s+(.+)$/m;
const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n/;
const MARKDOWN_SUFFIX = ".md";

export type ArtifactKind = "design" | "plan" | "ledger";

export interface ArtifactExcerpt {
  readonly pointer: string;
  readonly relativePath: string;
  readonly kind: ArtifactKind;
  readonly title: string;
  readonly excerpt: string;
}

const stripFrontmatter = (raw: string): string => raw.replace(FRONTMATTER_PATTERN, "");

const extractTitle = (raw: string, fallback: string): string => {
  const match = H1_PATTERN.exec(stripFrontmatter(raw));
  return match !== null ? match[1].trim() : fallback;
};

const extractExcerpt = (raw: string): string => {
  const stripped = stripFrontmatter(raw).trim();
  if (stripped.length <= COLD_INIT_DESIGN_EXCERPT_CHARS) return stripped;
  return `${stripped.slice(0, COLD_INIT_DESIGN_EXCERPT_CHARS)}...`;
};

const collectKind = (
  projectRoot: string,
  segments: readonly string[],
  kind: ArtifactKind,
  out: ArtifactExcerpt[],
): void => {
  const dir = join(projectRoot, ...segments);
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(MARKDOWN_SUFFIX)) continue;
    const full = join(dir, entry);
    if (!statSync(full).isFile()) continue;
    const rel = relative(projectRoot, full);
    const raw = readFileSync(full, "utf8");
    out.push({
      pointer: `thoughts:${rel.split("thoughts/")[1] ?? rel}`,
      relativePath: rel,
      kind,
      title: extractTitle(raw, entry.replace(MARKDOWN_SUFFIX, "")),
      excerpt: extractExcerpt(raw),
    });
  }
};

export async function collectArtifactExcerpts(projectRoot: string): Promise<readonly ArtifactExcerpt[]> {
  const out: ArtifactExcerpt[] = [];
  collectKind(projectRoot, ["thoughts", "shared", "designs"], "design", out);
  collectKind(projectRoot, ["thoughts", "shared", "plans"], "plan", out);
  collectKind(projectRoot, ["thoughts", "ledgers"], "ledger", out);
  return out;
}
```

```typescript
// tests/atlas/cold-init/sources/artifact-excerpts.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectArtifactExcerpts } from "@/atlas/cold-init/sources/artifact-excerpts";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "cold-init-art-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("collectArtifactExcerpts", () => {
  it("returns empty when no thoughts dir", async () => {
    const out = await collectArtifactExcerpts(projectRoot);
    expect(out).toHaveLength(0);
  });

  it("extracts title from H1 and tags kind", async () => {
    const dir = join(projectRoot, "thoughts", "shared", "designs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "feature.md"), "---\ndate: 2026-01-01\n---\n\n# Feature Title\n\nBody here.", "utf8");
    const out = await collectArtifactExcerpts(projectRoot);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Feature Title");
    expect(out[0].kind).toBe("design");
    expect(out[0].pointer).toContain("shared/designs/feature.md");
  });

  it("falls back to filename when no H1", async () => {
    const dir = join(projectRoot, "thoughts", "shared", "plans");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plain.md"), "no heading body", "utf8");
    const out = await collectArtifactExcerpts(projectRoot);
    expect(out[0].title).toBe("plain");
  });
});
```

**Verify:** `bun test tests/atlas/cold-init/sources/artifact-excerpts.test.ts`
**Commit:** `feat(atlas): add cold-init artifact excerpt collector`

### Task 1.6: Atlas runId factory
**File:** `src/atlas/cold-init/run-id.ts`
**Test:** `tests/atlas/cold-init/run-id.test.ts`
**Depends:** none
**Domain:** general

Decision: cold init has its own runId namespace separate from lifecycle-finish runs. Uses prefix `cold-init-` plus a millisecond timestamp plus a short random suffix to allow concurrent invocations on the same machine without collision. Returns the same shape as the existing staging manager expects.

```typescript
// src/atlas/cold-init/run-id.ts
import { randomBytes } from "node:crypto";

import { COLD_INIT_RUN_ID_PREFIX } from "@/atlas/cold-init/config";

const RANDOM_BYTES = 4;

export function createColdInitRunId(): string {
  const ts = Date.now().toString(36);
  const rnd = randomBytes(RANDOM_BYTES).toString("hex");
  return `${COLD_INIT_RUN_ID_PREFIX}-${ts}-${rnd}`;
}
```

```typescript
// tests/atlas/cold-init/run-id.test.ts
import { describe, expect, it } from "bun:test";

import { COLD_INIT_RUN_ID_PREFIX } from "@/atlas/cold-init/config";
import { createColdInitRunId } from "@/atlas/cold-init/run-id";

describe("createColdInitRunId", () => {
  it("starts with the cold-init prefix", () => {
    expect(createColdInitRunId().startsWith(`${COLD_INIT_RUN_ID_PREFIX}-`)).toBe(true);
  });

  it("produces unique ids across calls", () => {
    const a = createColdInitRunId();
    const b = createColdInitRunId();
    expect(a).not.toBe(b);
  });
});
```

**Verify:** `bun test tests/atlas/cold-init/run-id.test.ts`
**Commit:** `feat(atlas): add cold-init run id factory`

---

## Batch 2: Orchestrator Core (parallel - 4 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2, 2.3, 2.4

### Task 2.1: Discovery aggregator
**File:** `src/atlas/cold-init/discover.ts`
**Test:** `tests/atlas/cold-init/discover.test.ts`
**Depends:** 1.1, 1.3, 1.4, 1.5
**Domain:** general

Decision: discover aggregates ALL source collectors in parallel. It does NOT call subagents (that is the orchestrator's job). It is pure I/O against the filesystem so it can be unit-tested cheaply. It also reuses the existing `src/atlas/sources/module-map.ts`, `mindmodel.ts`, and `project-memory.ts` collectors so we do not duplicate logic.

```typescript
// src/atlas/cold-init/discover.ts
import type { ColdInitDiscovery, DiscoveredArtifact, DiscoveredMemoryEntry, DiscoveredModule } from "@/atlas/cold-init/types";
import { collectArtifactExcerpts } from "@/atlas/cold-init/sources/artifact-excerpts";
import { collectLifecycleHistory } from "@/atlas/cold-init/sources/lifecycle-history";
import { collectProjectSurvey } from "@/atlas/cold-init/sources/project-survey";
import { collectMindmodelSources } from "@/atlas/sources/mindmodel";
import { collectModuleEntries } from "@/atlas/sources/module-map";
import {
  collectProjectMemorySources,
  type ProjectMemoryEntry,
} from "@/atlas/sources/project-memory";

export interface ProjectMemoryReader {
  readonly list: () => Promise<readonly ProjectMemoryEntry[]>;
}

export interface DiscoverInput {
  readonly projectRoot: string;
  readonly projectMemory: ProjectMemoryReader;
}

const toDiscoveredModule = (m: { name: string; pointer: string; responsibility: string; relativePath: string }): DiscoveredModule => ({
  name: m.name,
  pointer: m.pointer,
  responsibility: m.responsibility,
  relativePath: m.relativePath,
});

const toDiscoveredArtifact = (a: { pointer: string; relativePath: string; title?: string; excerpt?: string }): DiscoveredArtifact => ({
  pointer: a.pointer,
  relativePath: a.relativePath,
  title: a.title ?? a.relativePath,
  excerpt: a.excerpt ?? "",
});

const toDiscoveredMemoryEntry = (p: { pointer: string; entry: ProjectMemoryEntry }): DiscoveredMemoryEntry => ({
  pointer: p.pointer,
  id: p.entry.id,
  title: p.entry.title,
  body: p.entry.body,
  status: p.entry.status,
});

export async function discoverProject(input: DiscoverInput): Promise<ColdInitDiscovery> {
  const [survey, modules, artifacts, lifecycle, mindmodel, memory] = await Promise.all([
    collectProjectSurvey(input.projectRoot),
    collectModuleEntries(input.projectRoot),
    collectArtifactExcerpts(input.projectRoot),
    collectLifecycleHistory(input.projectRoot),
    collectMindmodelSources(input.projectRoot),
    collectProjectMemorySources(input.projectMemory),
  ]);

  return {
    projectName: survey.projectName,
    projectRoot: input.projectRoot,
    modules: modules.map(toDiscoveredModule),
    designs: artifacts.filter((a) => a.kind === "design").map(toDiscoveredArtifact),
    plans: artifacts.filter((a) => a.kind === "plan").map(toDiscoveredArtifact),
    ledgers: artifacts.filter((a) => a.kind === "ledger").map(toDiscoveredArtifact),
    lifecycleRecords: lifecycle.map((l) => ({
      pointer: l.pointer,
      issueNumber: l.issueNumber,
      state: l.state,
      designPointers: l.designPointers,
      planPointers: l.planPointers,
      ledgerPointers: l.ledgerPointers,
    })),
    mindmodelEntries: mindmodel.map((m) => toDiscoveredArtifact({ ...m, title: m.relativePath, excerpt: "" })),
    projectMemoryDecisions: memory.decisions.map(toDiscoveredMemoryEntry),
    projectMemoryRisks: memory.risks.map(toDiscoveredMemoryEntry),
    projectMemoryOpenQuestions: memory.openQuestions.map(toDiscoveredMemoryEntry),
    readmeSummary: survey.readmeSummary,
    architectureSummary: survey.architectureSummary,
  };
}
```

```typescript
// tests/atlas/cold-init/discover.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { discoverProject } from "@/atlas/cold-init/discover";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "discover-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("discoverProject", () => {
  it("returns a discovery shape on an empty project", async () => {
    const out = await discoverProject({ projectRoot, projectMemory: { list: async () => [] } });
    expect(out.projectRoot).toBe(projectRoot);
    expect(out.modules).toHaveLength(0);
    expect(out.lifecycleRecords).toHaveLength(0);
  });

  it("aggregates modules and designs", async () => {
    mkdirSync(join(projectRoot, "src", "alpha"), { recursive: true });
    writeFileSync(join(projectRoot, "src", "alpha", "index.ts"), "// alpha module\n", "utf8");
    mkdirSync(join(projectRoot, "thoughts", "shared", "designs"), { recursive: true });
    writeFileSync(join(projectRoot, "thoughts", "shared", "designs", "x.md"), "# X\n\nbody", "utf8");
    writeFileSync(join(projectRoot, "README.md"), "# demo\n", "utf8");
    const out = await discoverProject({ projectRoot, projectMemory: { list: async () => [] } });
    expect(out.modules.length).toBeGreaterThanOrEqual(1);
    expect(out.designs.length).toBeGreaterThanOrEqual(1);
    expect(out.readmeSummary).toContain("demo");
  });

  it("propagates project memory decisions and risks", async () => {
    const out = await discoverProject({
      projectRoot,
      projectMemory: {
        list: async () => [
          { id: "d1", type: "decision", title: "use X", body: "...", status: "active" },
          { id: "r1", type: "risk", title: "drift", body: "...", status: "active" },
          { id: "q1", type: "open_question", title: "unknown", body: "...", status: "open" },
        ],
      },
    });
    expect(out.projectMemoryDecisions).toHaveLength(1);
    expect(out.projectMemoryRisks).toHaveLength(1);
    expect(out.projectMemoryOpenQuestions).toHaveLength(1);
  });
});
```

**Verify:** `bun test tests/atlas/cold-init/discover.test.ts`
**Commit:** `feat(atlas): add cold-init discovery aggregator`

### Task 2.2: Vault plan synthesizer
**File:** `src/atlas/cold-init/synthesize.ts`
**Test:** `tests/atlas/cold-init/synthesize.test.ts`
**Depends:** 1.1
**Domain:** general

Decision: synthesis is deterministic and rule-based, not LLM-driven. The orchestrator (Batch 2.4) and worker agents (Batch 3.1-3.5) are responsible for generating prose. Synthesis decides WHICH nodes to plan, in which layer, and where they live in the vault. Inferred Behavior nodes (those derived without a User Perspective section) carry `inferred: true` so the writer can prepend a "draft inference" preamble in natural language.

Rules:
- One Build node per discovered module under `10-impl/<module>.md`.
- One Behavior node per closed lifecycle record that has a design pointer; if none, fall back to one Behavior node per design file (marked `inferred: true`).
- One Decision node per project memory decision plus one for the phase roadmap (preserved from existing template).
- One Risk node per project memory risk; if none, plan a single placeholder index page only.
- One Timeline node per closed lifecycle record (chronological feed) plus a `60-timeline/index.md` index.
- Index node `00-index.md` always planned.
- Cross-layer wikilink connections wired statically: each Behavior node links to the Build node(s) of the modules its design touches by lexical match on module name.

```typescript
// src/atlas/cold-init/synthesize.ts
import { ATLAS_LAYERS } from "@/atlas/types";
import type {
  ColdInitDiscovery,
  PlannedNode,
  VaultPlan,
} from "@/atlas/cold-init/types";

const slugify = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64) || "untitled";

const planIndex = (d: ColdInitDiscovery): PlannedNode => ({
  id: "index",
  layer: ATLAS_LAYERS.DECISION,
  relativePath: "00-index.md",
  title: d.projectName,
  summary: d.readmeSummary ?? `Project atlas for ${d.projectName}.`,
  sources: d.readmeSummary !== null ? ["code:README.md"] : [],
  connections: [],
  inferred: false,
});

const planBuildNodes = (d: ColdInitDiscovery): readonly PlannedNode[] =>
  d.modules.map((m) => ({
    id: `10-impl/${m.name}`,
    layer: ATLAS_LAYERS.IMPL,
    relativePath: `10-impl/${m.name}.md`,
    title: m.name,
    summary: m.responsibility,
    sources: [m.pointer],
    connections: [],
    inferred: false,
  }));

const findRelatedBuildIds = (text: string, modules: readonly { readonly name: string }[]): readonly string[] => {
  const lower = text.toLowerCase();
  return modules
    .filter((m) => lower.includes(m.name.toLowerCase()))
    .map((m) => `10-impl/${m.name}`);
};

const planBehaviorNodes = (d: ColdInitDiscovery): readonly PlannedNode[] => {
  const out: PlannedNode[] = [];
  const closed = d.lifecycleRecords.filter((r) => r.state === "closed" || r.state === "merging");
  if (closed.length > 0) {
    for (const lc of closed) {
      const seedDesign = d.designs.find((dd) => lc.designPointers.includes(dd.pointer));
      const title = seedDesign?.title ?? `Lifecycle ${lc.issueNumber}`;
      out.push({
        id: `20-behavior/lifecycle-${lc.issueNumber}`,
        layer: ATLAS_LAYERS.BEHAVIOR,
        relativePath: `20-behavior/lifecycle-${lc.issueNumber}.md`,
        title,
        summary: seedDesign?.excerpt ?? "Behavior derived from lifecycle record.",
        sources: [lc.pointer, ...lc.designPointers.map((p) => `thoughts:${p.replace(/^thoughts\//, "")}`)],
        connections: findRelatedBuildIds(`${title} ${seedDesign?.excerpt ?? ""}`, d.modules),
        inferred: seedDesign === undefined,
      });
    }
    return out;
  }
  for (const design of d.designs) {
    out.push({
      id: `20-behavior/${slugify(design.title)}`,
      layer: ATLAS_LAYERS.BEHAVIOR,
      relativePath: `20-behavior/${slugify(design.title)}.md`,
      title: design.title,
      summary: design.excerpt,
      sources: [design.pointer],
      connections: findRelatedBuildIds(`${design.title} ${design.excerpt}`, d.modules),
      inferred: true,
    });
  }
  return out;
};

const PHASE_ROADMAP_NODE: PlannedNode = {
  id: "decision/atlas-phase-roadmap",
  layer: ATLAS_LAYERS.DECISION,
  relativePath: "40-decisions/atlas-phase-roadmap.md",
  title: "Atlas phase roadmap",
  summary: "Canonical record of what is in scope for the current phase.",
  sources: ["thoughts:shared/designs/2026-05-04-project-atlas-design.md"],
  connections: [],
  inferred: false,
};

const planDecisionNodes = (d: ColdInitDiscovery): readonly PlannedNode[] => {
  const memory = d.projectMemoryDecisions.map((m) => ({
    id: `40-decisions/${slugify(m.id)}`,
    layer: ATLAS_LAYERS.DECISION,
    relativePath: `40-decisions/${slugify(m.id)}.md`,
    title: m.title,
    summary: m.body,
    sources: [m.pointer],
    connections: [],
    inferred: false,
  } as PlannedNode));
  return [PHASE_ROADMAP_NODE, ...memory];
};

const planRiskNodes = (d: ColdInitDiscovery): readonly PlannedNode[] =>
  d.projectMemoryRisks.map((m) => ({
    id: `50-risks/${slugify(m.id)}`,
    layer: ATLAS_LAYERS.RISK,
    relativePath: `50-risks/${slugify(m.id)}.md`,
    title: m.title,
    summary: m.body,
    sources: [m.pointer],
    connections: [],
    inferred: false,
  }));

const planTimelineNodes = (d: ColdInitDiscovery): readonly PlannedNode[] => {
  const records = d.lifecycleRecords
    .filter((r) => r.state === "closed" || r.state === "merging")
    .map<PlannedNode>((r) => ({
      id: `60-timeline/lifecycle-${r.issueNumber}`,
      layer: ATLAS_LAYERS.TIMELINE,
      relativePath: `60-timeline/lifecycle-${r.issueNumber}.md`,
      title: `Lifecycle ${r.issueNumber}`,
      summary: `State at last write: ${r.state}.`,
      sources: [r.pointer],
      connections: [`20-behavior/lifecycle-${r.issueNumber}`],
      inferred: false,
    }));
  const indexNode: PlannedNode = {
    id: "60-timeline/index",
    layer: ATLAS_LAYERS.TIMELINE,
    relativePath: "60-timeline/index.md",
    title: "Project timeline",
    summary: `Chronological feed of ${records.length} lifecycle record(s).`,
    sources: [],
    connections: records.map((r) => r.id),
    inferred: false,
  };
  return [indexNode, ...records];
};

export function synthesizeVaultPlan(discovery: ColdInitDiscovery): VaultPlan {
  return {
    indexNode: planIndex(discovery),
    buildNodes: planBuildNodes(discovery),
    behaviorNodes: planBehaviorNodes(discovery),
    decisionNodes: planDecisionNodes(discovery),
    riskNodes: planRiskNodes(discovery),
    timelineNodes: planTimelineNodes(discovery),
  };
}
```

```typescript
// tests/atlas/cold-init/synthesize.test.ts
import { describe, expect, it } from "bun:test";

import { synthesizeVaultPlan } from "@/atlas/cold-init/synthesize";
import type { ColdInitDiscovery } from "@/atlas/cold-init/types";

const emptyDiscovery: ColdInitDiscovery = {
  projectName: "demo",
  projectRoot: "/tmp/demo",
  modules: [],
  designs: [],
  plans: [],
  ledgers: [],
  lifecycleRecords: [],
  mindmodelEntries: [],
  projectMemoryDecisions: [],
  projectMemoryRisks: [],
  projectMemoryOpenQuestions: [],
  readmeSummary: null,
  architectureSummary: null,
};

describe("synthesizeVaultPlan", () => {
  it("always plans an index node", () => {
    const plan = synthesizeVaultPlan(emptyDiscovery);
    expect(plan.indexNode.relativePath).toBe("00-index.md");
  });

  it("plans one build node per module", () => {
    const plan = synthesizeVaultPlan({
      ...emptyDiscovery,
      modules: [
        { name: "alpha", pointer: "code:src/alpha", responsibility: "x", relativePath: "src/alpha" },
        { name: "beta", pointer: "code:src/beta", responsibility: "y", relativePath: "src/beta" },
      ],
    });
    expect(plan.buildNodes).toHaveLength(2);
    expect(plan.buildNodes.map((n) => n.id).sort()).toEqual(["10-impl/alpha", "10-impl/beta"]);
  });

  it("falls back to design-derived behavior nodes when no closed lifecycle exists", () => {
    const plan = synthesizeVaultPlan({
      ...emptyDiscovery,
      designs: [
        { pointer: "thoughts:shared/designs/x.md", relativePath: "thoughts/shared/designs/x.md", title: "X feature", excerpt: "" },
      ],
    });
    expect(plan.behaviorNodes).toHaveLength(1);
    expect(plan.behaviorNodes[0].inferred).toBe(true);
  });

  it("emits closed-lifecycle behavior nodes with cross-layer connections", () => {
    const plan = synthesizeVaultPlan({
      ...emptyDiscovery,
      modules: [{ name: "alpha", pointer: "code:src/alpha", responsibility: "x", relativePath: "src/alpha" }],
      designs: [
        { pointer: "thoughts:shared/designs/alpha.md", relativePath: "thoughts/shared/designs/alpha.md", title: "alpha rework", excerpt: "rework alpha" },
      ],
      lifecycleRecords: [
        { pointer: "lifecycle:1", issueNumber: 1, state: "closed", designPointers: ["thoughts:shared/designs/alpha.md"], planPointers: [], ledgerPointers: [] },
      ],
    });
    expect(plan.behaviorNodes).toHaveLength(1);
    expect(plan.behaviorNodes[0].connections).toContain("10-impl/alpha");
    expect(plan.behaviorNodes[0].inferred).toBe(false);
  });

  it("always plans the phase roadmap decision node", () => {
    const plan = synthesizeVaultPlan(emptyDiscovery);
    expect(plan.decisionNodes.some((n) => n.id === "decision/atlas-phase-roadmap")).toBe(true);
  });
});
```

**Verify:** `bun test tests/atlas/cold-init/synthesize.test.ts`
**Commit:** `feat(atlas): add cold-init vault plan synthesizer`

### Task 2.3: Octto question batch generator
**File:** `src/atlas/cold-init/questions.ts`
**Test:** `tests/atlas/cold-init/questions.test.ts`
**Depends:** 1.1, 1.2
**Domain:** general

Decision: cold init does not hard-cap at 5 questions. It generates questions from synthesis gaps in three groups, each independently skippable. The orchestrator pushes the whole batch to Octto in one `start_session` call. The user can ignore any question and the orchestrator proceeds with synthesis defaults. This module returns the question payload without performing the Octto call (so it can be unit-tested without a live session).

Groups:
- Project intent (always 2-3 questions): one-line project pitch, primary user, deployment shape
- Behavior anchors (one per inferred Behavior node): "what user-visible behavior does this represent?" with a `skip` option recommended
- Risk and open question prompts (one per project memory open question): allow user to elaborate or skip

```typescript
// src/atlas/cold-init/questions.ts
import { COLD_INIT_QUESTION_GROUP_MAX, COLD_INIT_QUESTION_GROUP_MIN } from "@/atlas/cold-init/config";
import type { ColdInitDiscovery, VaultPlan } from "@/atlas/cold-init/types";

export type ColdInitQuestionType = "ask_text" | "pick_one" | "confirm";

export interface ColdInitQuestion {
  readonly id: string;
  readonly group: "intent" | "behavior" | "risk";
  readonly type: ColdInitQuestionType;
  readonly question: string;
  readonly context?: string;
  readonly options?: ReadonlyArray<{ readonly id: string; readonly label: string }>;
  readonly skippable: boolean;
  readonly defaultAnswer: string | null;
}

const intentQuestions = (d: ColdInitDiscovery): readonly ColdInitQuestion[] => [
  {
    id: "intent.pitch",
    group: "intent",
    type: "ask_text",
    question: `In one sentence, what is ${d.projectName} for?`,
    context: d.readmeSummary ?? undefined,
    skippable: true,
    defaultAnswer: null,
  },
  {
    id: "intent.user",
    group: "intent",
    type: "ask_text",
    question: "Who is the primary user (human role or other agent)?",
    skippable: true,
    defaultAnswer: null,
  },
  {
    id: "intent.shape",
    group: "intent",
    type: "pick_one",
    question: "Which deployment shape is closest?",
    options: [
      { id: "lib", label: "library or SDK" },
      { id: "cli", label: "CLI tool" },
      { id: "service", label: "long-running service" },
      { id: "plugin", label: "plugin/extension to another runtime" },
      { id: "other", label: "other / mixed" },
    ],
    skippable: true,
    defaultAnswer: "other",
  },
];

const behaviorQuestions = (plan: VaultPlan): readonly ColdInitQuestion[] => {
  return plan.behaviorNodes
    .filter((n) => n.inferred)
    .map<ColdInitQuestion>((n) => ({
      id: `behavior.${n.id}`,
      group: "behavior",
      type: "ask_text",
      question: `What user-visible behavior does "${n.title}" represent? (skip to keep the inferred draft)`,
      context: n.summary,
      skippable: true,
      defaultAnswer: null,
    }));
};

const riskQuestions = (d: ColdInitDiscovery): readonly ColdInitQuestion[] => {
  return d.projectMemoryOpenQuestions.map<ColdInitQuestion>((q) => ({
    id: `risk.${q.id}`,
    group: "risk",
    type: "ask_text",
    question: `Open question from project memory: "${q.title}". Anything to record before atlas-init writes the risk page?`,
    context: q.body,
    skippable: true,
    defaultAnswer: null,
  }));
};

export interface QuestionBatch {
  readonly questions: readonly ColdInitQuestion[];
  readonly truncated: boolean;
}

export function buildQuestionBatch(d: ColdInitDiscovery, plan: VaultPlan): QuestionBatch {
  const all = [...intentQuestions(d), ...behaviorQuestions(plan), ...riskQuestions(d)];
  if (all.length < COLD_INIT_QUESTION_GROUP_MIN) {
    return { questions: all, truncated: false };
  }
  if (all.length <= COLD_INIT_QUESTION_GROUP_MAX) {
    return { questions: all, truncated: false };
  }
  return {
    questions: [
      ...all.slice(0, 3),
      ...all.filter((q) => q.group !== "intent").slice(0, COLD_INIT_QUESTION_GROUP_MAX - 3),
    ],
    truncated: true,
  };
}
```

```typescript
// tests/atlas/cold-init/questions.test.ts
import { describe, expect, it } from "bun:test";

import { buildQuestionBatch } from "@/atlas/cold-init/questions";
import { synthesizeVaultPlan } from "@/atlas/cold-init/synthesize";
import type { ColdInitDiscovery } from "@/atlas/cold-init/types";

const emptyDiscovery: ColdInitDiscovery = {
  projectName: "demo",
  projectRoot: "/tmp/demo",
  modules: [],
  designs: [],
  plans: [],
  ledgers: [],
  lifecycleRecords: [],
  mindmodelEntries: [],
  projectMemoryDecisions: [],
  projectMemoryRisks: [],
  projectMemoryOpenQuestions: [],
  readmeSummary: null,
  architectureSummary: null,
};

describe("buildQuestionBatch", () => {
  it("always emits the three intent questions", () => {
    const plan = synthesizeVaultPlan(emptyDiscovery);
    const batch = buildQuestionBatch(emptyDiscovery, plan);
    const intent = batch.questions.filter((q) => q.group === "intent");
    expect(intent.length).toBe(3);
  });

  it("emits a behavior question per inferred behavior node", () => {
    const discovery: ColdInitDiscovery = {
      ...emptyDiscovery,
      designs: [
        { pointer: "thoughts:shared/designs/a.md", relativePath: "thoughts/shared/designs/a.md", title: "A feature", excerpt: "" },
        { pointer: "thoughts:shared/designs/b.md", relativePath: "thoughts/shared/designs/b.md", title: "B feature", excerpt: "" },
      ],
    };
    const plan = synthesizeVaultPlan(discovery);
    const batch = buildQuestionBatch(discovery, plan);
    const behavior = batch.questions.filter((q) => q.group === "behavior");
    expect(behavior.length).toBe(2);
    expect(behavior.every((q) => q.skippable)).toBe(true);
  });

  it("emits a risk question per open project-memory question", () => {
    const discovery: ColdInitDiscovery = {
      ...emptyDiscovery,
      projectMemoryOpenQuestions: [
        { pointer: "pm:q1", id: "q1", title: "drift?", body: "?", status: "open" },
      ],
    };
    const plan = synthesizeVaultPlan(discovery);
    const batch = buildQuestionBatch(discovery, plan);
    expect(batch.questions.some((q) => q.group === "risk")).toBe(true);
  });
});
```

**Verify:** `bun test tests/atlas/cold-init/questions.test.ts`
**Commit:** `feat(atlas): add cold-init octto question generator`

### Task 2.4: Cold-init orchestrator (no agent dispatch yet)
**File:** `src/atlas/cold-init/orchestrator.ts`
**Test:** `tests/atlas/cold-init/orchestrator.test.ts`
**Depends:** 1.1, 1.2, 1.6, 2.1, 2.2, 2.3
**Domain:** general

Decision: the orchestrator is the heart of cold init but it depends only on injected callbacks for the two side-effecting concerns (asking questions, and rendering+writing nodes). This keeps it unit-testable without spinning up Octto or filesystem fan-out. The actual node writers (Batch 3) and the runtime wiring (Batch 4) inject real implementations.

The orchestrator:
1. Reads discovery via `discoverProject`.
2. Synthesizes a plan via `synthesizeVaultPlan`.
3. Optionally calls `askQuestions` (the caller decides whether Octto is wired up). The orchestrator does NOT block the cold-init outcome on user answers; if `askQuestions` returns null or rejects, planning continues with defaults.
4. Calls `writeVault` with the plan and the (possibly-empty) answer map.
5. Returns a `ColdInitOutcome`.

```typescript
// src/atlas/cold-init/orchestrator.ts
import { discoverProject, type ProjectMemoryReader } from "@/atlas/cold-init/discover";
import type { ColdInitOptions, ColdInitOutcome, VaultPlan } from "@/atlas/cold-init/types";
import { buildQuestionBatch, type ColdInitQuestion } from "@/atlas/cold-init/questions";
import { createColdInitRunId } from "@/atlas/cold-init/run-id";
import { synthesizeVaultPlan } from "@/atlas/cold-init/synthesize";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

const LOG_SCOPE = "atlas.cold-init";

export type AnswerMap = Readonly<Record<string, string>>;

export interface OrchestratorDeps {
  readonly projectMemory: ProjectMemoryReader;
  readonly askQuestions: ((batch: readonly ColdInitQuestion[]) => Promise<AnswerMap | null>) | null;
  readonly writeVault: (input: {
    readonly projectRoot: string;
    readonly runId: string;
    readonly plan: VaultPlan;
    readonly answers: AnswerMap;
  }) => Promise<{ readonly nodesWritten: number; readonly stagingDir: string; readonly logPath: string }>;
}

export interface OrchestratorInput {
  readonly projectRoot: string;
  readonly options: ColdInitOptions;
}

export async function runColdInit(input: OrchestratorInput, deps: OrchestratorDeps): Promise<ColdInitOutcome> {
  const runId = createColdInitRunId();
  log.info(LOG_SCOPE, `cold init starting (runId=${runId}, root=${input.projectRoot})`);

  const discovery = await discoverProject({ projectRoot: input.projectRoot, projectMemory: deps.projectMemory });
  const plan = synthesizeVaultPlan(discovery);
  const batch = buildQuestionBatch(discovery, plan);

  let answers: AnswerMap = {};
  let questionsAsked = 0;
  if (input.options.askQuestions && deps.askQuestions !== null && batch.questions.length > 0) {
    try {
      const got = await deps.askQuestions(batch.questions);
      if (got !== null) {
        answers = got;
        questionsAsked = batch.questions.length;
      }
    } catch (error) {
      log.warn(LOG_SCOPE, `askQuestions failed, continuing with defaults: ${extractErrorMessage(error)}`);
    }
  }

  const written = await deps.writeVault({ projectRoot: input.projectRoot, runId, plan, answers });
  log.info(LOG_SCOPE, `cold init complete (nodesWritten=${written.nodesWritten})`);

  return {
    status: "ok",
    nodesWritten: written.nodesWritten,
    questionsAsked,
    stagingDir: written.stagingDir,
    logPath: written.logPath,
  };
}
```

```typescript
// tests/atlas/cold-init/orchestrator.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runColdInit } from "@/atlas/cold-init/orchestrator";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "orch-"));
  mkdirSync(join(projectRoot, "src", "alpha"), { recursive: true });
  writeFileSync(join(projectRoot, "src", "alpha", "index.ts"), "// alpha module\n", "utf8");
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("runColdInit", () => {
  it("returns ok and reports nodesWritten without asking when askQuestions=false", async () => {
    let asked = 0;
    const out = await runColdInit(
      { projectRoot, options: { askQuestions: false, questionTimeoutMs: 1000 } },
      {
        projectMemory: { list: async () => [] },
        askQuestions: async () => {
          asked += 1;
          return {};
        },
        writeVault: async () => ({ nodesWritten: 4, stagingDir: "/tmp/x", logPath: "/tmp/x/log.md" }),
      },
    );
    expect(out.status).toBe("ok");
    expect(out.nodesWritten).toBe(4);
    expect(asked).toBe(0);
  });

  it("invokes askQuestions and forwards the returned answers", async () => {
    let received: Record<string, string> | null = null;
    const out = await runColdInit(
      { projectRoot, options: { askQuestions: true, questionTimeoutMs: 1000 } },
      {
        projectMemory: { list: async () => [] },
        askQuestions: async () => ({ "intent.pitch": "Demo project" }),
        writeVault: async (i) => {
          received = { ...i.answers };
          return { nodesWritten: 5, stagingDir: "/tmp/y", logPath: "/tmp/y/log.md" };
        },
      },
    );
    expect(out.questionsAsked).toBeGreaterThan(0);
    expect(received).toEqual({ "intent.pitch": "Demo project" });
  });

  it("continues when askQuestions throws", async () => {
    const out = await runColdInit(
      { projectRoot, options: { askQuestions: true, questionTimeoutMs: 1000 } },
      {
        projectMemory: { list: async () => [] },
        askQuestions: async () => {
          throw new Error("octto down");
        },
        writeVault: async () => ({ nodesWritten: 1, stagingDir: "/tmp/z", logPath: "/tmp/z/log.md" }),
      },
    );
    expect(out.status).toBe("ok");
  });
});
```

**Verify:** `bun test tests/atlas/cold-init/orchestrator.test.ts`
**Commit:** `feat(atlas): add cold-init orchestrator`

---

## Batch 3: Worker Agents and Node Writers (parallel - 6 implementers)

All tasks in this batch depend on Batch 2 completing.
Tasks: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6

### Task 3.1: Cold-init node renderer (per-layer)
**File:** `src/atlas/cold-init/renderer.ts`
**Test:** `tests/atlas/cold-init/renderer.test.ts`
**Depends:** 2.2
**Domain:** general

Decision: rendering is purely a formatting concern; it converts a `PlannedNode` plus optional answer text into the Markdown body. Inferred Behavior nodes get a natural-language preamble such as "This page is an early draft inferred from the design source(s) listed below; refine it during the next lifecycle pass." The preamble replaces any need for a `confidence` frontmatter field.

```typescript
// src/atlas/cold-init/renderer.ts
import { serializeFrontmatter } from "@/atlas/frontmatter";
import {
  ATLAS_NODE_STATUSES,
  type AtlasFrontmatter,
} from "@/atlas/types";
import { formatWikilink } from "@/atlas/wikilink";
import type { PlannedNode } from "@/atlas/cold-init/types";

const renderH2 = (title: string, body: string): string => `## ${title}\n\n${body}\n`;
const bullet = (items: readonly string[]): string =>
  items.length === 0 ? "_none_" : items.map((s) => `- ${s}`).join("\n");

const inferredPreamble =
  "This page is an early draft inferred from the source(s) listed below. " +
  "Refine the prose during the next lifecycle pass; do not treat the wording as authoritative.";

export interface RenderInput {
  readonly node: PlannedNode;
  readonly userNote: string | null;
  readonly lastVerifiedCommit: string;
  readonly lastWrittenMtime: number;
}

export function renderColdInitNode(input: RenderInput): string {
  const fm: AtlasFrontmatter = {
    id: input.node.id,
    layer: input.node.layer,
    status: ATLAS_NODE_STATUSES.ACTIVE,
    last_verified_commit: input.lastVerifiedCommit,
    last_written_mtime: input.lastWrittenMtime,
    sources: input.node.sources,
    extras: {},
  };
  const summary = input.node.inferred ? `${inferredPreamble}\n\n${input.node.summary}` : input.node.summary;
  const sections: string[] = [
    `# ${input.node.title}\n`,
    renderH2("Summary", summary || "_seed summary; refine in a follow-up_"),
  ];
  if (input.userNote !== null && input.userNote.trim().length > 0) {
    sections.push(renderH2("User notes", input.userNote.trim()));
  }
  sections.push(renderH2("Connections", bullet(input.node.connections.map(formatWikilink))));
  sections.push(renderH2("Sources", bullet(input.node.sources)));
  sections.push(renderH2("Notes", "_none_"));
  return serializeFrontmatter(fm, sections.join("\n"));
}
```

```typescript
// tests/atlas/cold-init/renderer.test.ts
import { describe, expect, it } from "bun:test";

import { ATLAS_LAYERS } from "@/atlas/types";
import { renderColdInitNode } from "@/atlas/cold-init/renderer";

describe("renderColdInitNode", () => {
  it("renders a non-inferred node without the draft preamble", () => {
    const out = renderColdInitNode({
      node: {
        id: "10-impl/alpha",
        layer: ATLAS_LAYERS.IMPL,
        relativePath: "10-impl/alpha.md",
        title: "alpha",
        summary: "Handles X.",
        sources: ["code:src/alpha"],
        connections: [],
        inferred: false,
      },
      userNote: null,
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    expect(out).toContain("# alpha");
    expect(out).toContain("Handles X.");
    expect(out).not.toContain("early draft inferred");
  });

  it("prepends a draft preamble for inferred nodes", () => {
    const out = renderColdInitNode({
      node: {
        id: "20-behavior/x",
        layer: ATLAS_LAYERS.BEHAVIOR,
        relativePath: "20-behavior/x.md",
        title: "x",
        summary: "Inferred from design.",
        sources: ["thoughts:shared/designs/x.md"],
        connections: ["10-impl/alpha"],
        inferred: true,
      },
      userNote: "User said: this is X.",
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    expect(out).toContain("early draft inferred");
    expect(out).toContain("[[10-impl/alpha]]");
    expect(out).toContain("User notes");
  });
});
```

**Verify:** `bun test tests/atlas/cold-init/renderer.test.ts`
**Commit:** `feat(atlas): add cold-init node renderer`

### Task 3.2: Vault writer (atomic staging-then-rename)
**File:** `src/atlas/cold-init/vault-writer.ts`
**Test:** `tests/atlas/cold-init/vault-writer.test.ts`
**Depends:** 1.1, 2.2, 3.1
**Domain:** general

Decision: cold init reuses the existing staging + atomic rename protocol so a partial failure rolls back cleanly. It also writes a first-person maintenance log under `atlas/_meta/log/<runId>.md` describing what cold init touched. The schema-version file is written last.

```typescript
// src/atlas/cold-init/vault-writer.ts
import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { ATLAS_SCHEMA_VERSION } from "@/atlas/config";
import { createAtlasPaths } from "@/atlas/paths";
import { commitStagedPages, stagePageWrite } from "@/atlas/page-writer";
import { writeSchemaVersion } from "@/atlas/schema-version";
import { createStagingManager } from "@/atlas/staging";
import { renderColdInitNode } from "@/atlas/cold-init/renderer";
import type { AnswerMap } from "@/atlas/cold-init/orchestrator";
import type { PlannedNode, VaultPlan } from "@/atlas/cold-init/types";

const noteFor = (node: PlannedNode, answers: AnswerMap): string | null => {
  const direct = answers[node.id] ?? answers[`behavior.${node.id}`] ?? answers[`risk.${node.id}`];
  return typeof direct === "string" && direct.trim().length > 0 ? direct : null;
};

const ensureDir = (dir: string): void => {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
};

const stageNode = (
  staging: ReturnType<typeof createStagingManager>,
  paths: ReturnType<typeof createAtlasPaths>,
  node: PlannedNode,
  answers: AnswerMap,
  nowMs: number,
): void => {
  const target = join(paths.root, node.relativePath);
  ensureDir(dirname(target));
  const body = renderColdInitNode({
    node,
    userNote: noteFor(node, answers),
    lastVerifiedCommit: "",
    lastWrittenMtime: nowMs,
  });
  stagePageWrite(staging, target, body);
};

const collectAllNodes = (plan: VaultPlan): readonly PlannedNode[] => [
  plan.indexNode,
  ...plan.buildNodes,
  ...plan.behaviorNodes,
  ...plan.decisionNodes,
  ...plan.riskNodes,
  ...plan.timelineNodes,
];

const writeMaintenanceLog = (logDir: string, runId: string, plan: VaultPlan, answersCount: number): string => {
  ensureDir(logDir);
  const path = join(logDir, `${runId}.md`);
  const all = collectAllNodes(plan);
  const lines = [
    `# Cold init run ${runId}`,
    "",
    `I wrote ${all.length} nodes across the build, behavior, decision, risk, and timeline layers.`,
    `I incorporated ${answersCount} user-provided notes from Octto.`,
    "",
    "## Nodes written",
    ...all.map((n) => `- ${n.relativePath}${n.inferred ? " (inferred draft)" : ""}`),
  ];
  writeFileSync(path, lines.join("\n"), "utf8");
  return path;
};

export interface WriteVaultInput {
  readonly projectRoot: string;
  readonly runId: string;
  readonly plan: VaultPlan;
  readonly answers: AnswerMap;
}

export interface WriteVaultResult {
  readonly nodesWritten: number;
  readonly stagingDir: string;
  readonly logPath: string;
}

export async function writeVault(input: WriteVaultInput): Promise<WriteVaultResult> {
  const paths = createAtlasPaths(input.projectRoot);
  for (const dir of [paths.root, paths.impl, paths.behavior, paths.decisions, paths.risks, paths.timeline, paths.archive, paths.meta, paths.challenges, paths.log, paths.staging]) {
    ensureDir(dir);
  }
  const staging = createStagingManager(input.projectRoot, input.runId);
  staging.create();
  const nowMs = Date.now();
  const all = collectAllNodes(input.plan);
  try {
    for (const node of all) stageNode(staging, paths, node, input.answers, nowMs);
    await commitStagedPages(staging);
    writeSchemaVersion(paths.schemaVersionFile, ATLAS_SCHEMA_VERSION);
    const logPath = writeMaintenanceLog(paths.log, input.runId, input.plan, Object.keys(input.answers).length);
    return { nodesWritten: all.length, stagingDir: staging.dir, logPath };
  } catch (error) {
    staging.rollback();
    throw error;
  }
}
```

```typescript
// tests/atlas/cold-init/vault-writer.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ATLAS_LAYERS } from "@/atlas/types";
import { writeVault } from "@/atlas/cold-init/vault-writer";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "vault-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("writeVault", () => {
  it("writes index, build, behavior, decision, risk, timeline nodes and the schema version file", async () => {
    const out = await writeVault({
      projectRoot,
      runId: "cold-init-test",
      plan: {
        indexNode: {
          id: "index",
          layer: ATLAS_LAYERS.DECISION,
          relativePath: "00-index.md",
          title: "demo",
          summary: "x",
          sources: [],
          connections: [],
          inferred: false,
        },
        buildNodes: [
          {
            id: "10-impl/alpha",
            layer: ATLAS_LAYERS.IMPL,
            relativePath: "10-impl/alpha.md",
            title: "alpha",
            summary: "x",
            sources: [],
            connections: [],
            inferred: false,
          },
        ],
        behaviorNodes: [],
        decisionNodes: [
          {
            id: "decision/atlas-phase-roadmap",
            layer: ATLAS_LAYERS.DECISION,
            relativePath: "40-decisions/atlas-phase-roadmap.md",
            title: "roadmap",
            summary: "x",
            sources: [],
            connections: [],
            inferred: false,
          },
        ],
        riskNodes: [],
        timelineNodes: [],
      },
      answers: {},
    });
    expect(out.nodesWritten).toBe(3);
    expect(existsSync(join(projectRoot, "atlas", "00-index.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "atlas", "10-impl", "alpha.md"))).toBe(true);
    expect(existsSync(join(projectRoot, "atlas", "_meta", "schema-version"))).toBe(true);
    expect(existsSync(out.logPath)).toBe(true);
  });

  it("incorporates user notes in node body when answers map provides them", async () => {
    await writeVault({
      projectRoot,
      runId: "cold-init-test",
      plan: {
        indexNode: {
          id: "index",
          layer: ATLAS_LAYERS.DECISION,
          relativePath: "00-index.md",
          title: "demo",
          summary: "x",
          sources: [],
          connections: [],
          inferred: false,
        },
        buildNodes: [],
        behaviorNodes: [
          {
            id: "20-behavior/feature",
            layer: ATLAS_LAYERS.BEHAVIOR,
            relativePath: "20-behavior/feature.md",
            title: "feature",
            summary: "draft",
            sources: [],
            connections: [],
            inferred: true,
          },
        ],
        decisionNodes: [],
        riskNodes: [],
        timelineNodes: [],
      },
      answers: { "behavior.20-behavior/feature": "User said: this is the X flow." },
    });
    const body = readFileSync(join(projectRoot, "atlas", "20-behavior", "feature.md"), "utf8");
    expect(body).toContain("User notes");
    expect(body).toContain("X flow");
  });
});
```

**Verify:** `bun test tests/atlas/cold-init/vault-writer.test.ts`
**Commit:** `feat(atlas): add cold-init vault writer`

### Task 3.3: Cold-init worker agent definitions
**File:** `src/agents/atlas-cold-build.ts`
**Test:** none (agent prompt definitions; behavior is exercised at integration time)
**Depends:** 1.1
**Domain:** general

Decision: separate agent prompts for cold-init workers so they do NOT carry the lifecycle/handoff vocabulary that the existing `atlas-worker-build` and `atlas-worker-behavior` prompts assume. These agents are spawned by the cold-init orchestrator at runtime via `spawn_agent` to enrich seed summaries with code-derived prose, but the orchestrator falls back gracefully to the deterministic synthesizer summaries if the spawn fails.

```typescript
// src/agents/atlas-cold-build.ts
import type { AgentConfig } from "@opencode-ai/sdk";

export const atlasColdBuildAgent: AgentConfig = {
  description: "Cold-init Build-layer worker: enrich one 10-impl/<module>.md draft from source code",
  mode: "subagent",
  temperature: 0.3,
  prompt: `<environment>
You are a Project Atlas cold-init worker for the Build layer.
You are spawned by the cold-init orchestrator (NOT by lifecycle finish). There is no handoff marker. There is no issue id.
</environment>

<purpose>
You are given one module name and its source folder. Read enough source to write a one-paragraph factual summary of what the module does, plus 3-6 bullet points naming its public exports and responsibilities.
Do not invent behavior. If something is unclear, say so in plain language.
</purpose>

<output-format>
Return Markdown. Do not include frontmatter, do not include a top-level H1, do not include a Sources section. The orchestrator owns frontmatter and section skeleton.
</output-format>

<constraints>
- Stay in the Build layer (file responsibilities, exports, internal contracts).
- Do not propose Behavior layer claims.
- Use single-word names where context allows.
- Keep total length under 60 lines.
</constraints>
`,
};
```

**Verify:** `bun run typecheck`
**Commit:** `feat(atlas): add cold-init Build worker agent`

### Task 3.4: Cold-init Behavior worker agent
**File:** `src/agents/atlas-cold-behavior.ts`
**Test:** none
**Depends:** 1.1
**Domain:** general

Decision: this prompt explicitly permits inferred drafting when no User Perspective signal exists, but requires the agent to label the result as inferred in natural language so the writer's preamble plus the agent's prose stay consistent.

```typescript
// src/agents/atlas-cold-behavior.ts
import type { AgentConfig } from "@opencode-ai/sdk";

export const atlasColdBehaviorAgent: AgentConfig = {
  description: "Cold-init Behavior-layer worker: draft one 20-behavior/<topic>.md from designs and lifecycle artifacts",
  mode: "subagent",
  temperature: 0.4,
  prompt: `<environment>
You are a Project Atlas cold-init worker for the Behavior layer.
You are spawned by the cold-init orchestrator. There is no handoff marker. There is no issue id.
</environment>

<purpose>
Given a topic name plus the relevant design or lifecycle excerpts, draft a Behavior page that captures user-visible mechanics, numerics, and rules.
If a User Perspective section exists, anchor your prose to it.
If no User Perspective signal exists, draft an inferred summary and explicitly say so in your prose using natural language such as "this is an inferred draft, refine in the next lifecycle pass". Do not invent specific numbers; if the source does not state a value, write "(value not stated in source)".
</purpose>

<output-format>
Return Markdown. Do not include frontmatter, do not include a top-level H1, do not include a Sources section. The orchestrator owns frontmatter and section skeleton.
</output-format>

<constraints>
- Stay in the Behavior layer.
- Cross-layer connections may be mentioned in prose using [[10-impl/<module>]] wikilink form.
- Keep total length under 80 lines.
</constraints>
`,
};
```

**Verify:** `bun run typecheck`
**Commit:** `feat(atlas): add cold-init Behavior worker agent`

### Task 3.5: Register cold-init agents in the agent map
**File:** `src/agents/index.ts`
**Test:** `tests/agents/index.test.ts` (extend if it exists; otherwise add minimal smoke check)
**Depends:** 3.3, 3.4
**Domain:** general

Decision: register `atlas-cold-build` and `atlas-cold-behavior` alongside the existing atlas agents. Keep the existing `atlas-worker-build` / `atlas-worker-behavior` entries untouched (they remain the lifecycle-finish path).

```typescript
// Edits to src/agents/index.ts (illustrative diff; the implementer applies it as a real edit):

import { atlasColdBehaviorAgent } from "./atlas-cold-behavior";
import { atlasColdBuildAgent } from "./atlas-cold-build";

// Inside the `agents` record, after the existing atlas entries:
"atlas-cold-build": { ...atlasColdBuildAgent, model: DEFAULT_MODEL },
"atlas-cold-behavior": { ...atlasColdBehaviorAgent, model: DEFAULT_MODEL },
```

```typescript
// tests/agents/cold-init-registration.test.ts (new file)
import { describe, expect, it } from "bun:test";

import { agents } from "@/agents/index";

describe("cold-init agent registration", () => {
  it("registers atlas-cold-build", () => {
    expect(agents["atlas-cold-build"]).toBeDefined();
  });

  it("registers atlas-cold-behavior", () => {
    expect(agents["atlas-cold-behavior"]).toBeDefined();
  });

  it("keeps the lifecycle-finish atlas-worker agents intact", () => {
    expect(agents["atlas-worker-build"]).toBeDefined();
    expect(agents["atlas-worker-behavior"]).toBeDefined();
  });
});
```

**Verify:** `bun test tests/agents/cold-init-registration.test.ts`
**Commit:** `feat(atlas): register cold-init worker agents`

### Task 3.6: Octto question-batch adapter
**File:** `src/atlas/cold-init/octto-adapter.ts`
**Test:** `tests/atlas/cold-init/octto-adapter.test.ts`
**Depends:** 2.3
**Domain:** general

Decision: this adapter converts a `ColdInitQuestion[]` into the Octto session-question payload shape expected by `octtoSessionStore.startSession` (the session store is created in `src/index.ts`). It also defines a typed `OcttoQuestionAsker` interface so the orchestrator can be wired without leaking Octto types. The actual Octto session creation is performed by the integration code in Batch 4.

The adapter is unit-testable because it only transforms shapes; it never touches the network.

```typescript
// src/atlas/cold-init/octto-adapter.ts
import type { ColdInitQuestion } from "@/atlas/cold-init/questions";

export interface OcttoQuestionPayload {
  readonly type: "ask_text" | "pick_one" | "confirm";
  readonly config: {
    readonly question: string;
    readonly context?: string;
    readonly options?: ReadonlyArray<{ readonly id: string; readonly label: string }>;
    readonly allowCancel?: boolean;
  };
  readonly questionKey: string;
}

const groupHeader = (group: ColdInitQuestion["group"]): string => {
  if (group === "intent") return "[Project intent] ";
  if (group === "behavior") return "[Behavior anchor] ";
  return "[Risk / open question] ";
};

export function toOcttoPayloads(questions: readonly ColdInitQuestion[]): readonly OcttoQuestionPayload[] {
  return questions.map((q) => ({
    type: q.type,
    config: {
      question: `${groupHeader(q.group)}${q.question}`,
      context: q.context,
      options: q.options,
      allowCancel: q.skippable,
    },
    questionKey: q.id,
  }));
}
```

```typescript
// tests/atlas/cold-init/octto-adapter.test.ts
import { describe, expect, it } from "bun:test";

import type { ColdInitQuestion } from "@/atlas/cold-init/questions";
import { toOcttoPayloads } from "@/atlas/cold-init/octto-adapter";

const intent: ColdInitQuestion = {
  id: "intent.pitch",
  group: "intent",
  type: "ask_text",
  question: "What is X for?",
  skippable: true,
  defaultAnswer: null,
};

describe("toOcttoPayloads", () => {
  it("prepends a group label to the question text", () => {
    const out = toOcttoPayloads([intent]);
    expect(out[0].config.question).toContain("[Project intent]");
  });

  it("propagates the question key for answer correlation", () => {
    const out = toOcttoPayloads([intent]);
    expect(out[0].questionKey).toBe("intent.pitch");
  });

  it("marks skippable questions with allowCancel=true", () => {
    const out = toOcttoPayloads([intent]);
    expect(out[0].config.allowCancel).toBe(true);
  });
});
```

**Verify:** `bun test tests/atlas/cold-init/octto-adapter.test.ts`
**Commit:** `feat(atlas): add cold-init octto adapter`

---

## Batch 4: Integration (sequential - 1 implementer at a time)

All tasks in this batch depend on Batch 3 completing.
Tasks: 4.1, 4.2, 4.3

### Task 4.1: Replace `runAtlasInit` with the cold-init orchestrator
**File:** `src/tools/atlas/init.ts`
**Test:** `tests/tools/atlas/init.test.ts` (existing; update assertions to match new behavior)
**Depends:** 2.4, 3.2
**Domain:** general

Decision: keep the public `InitMode` and `InitResult` types for backwards compatibility with `parseAtlasInitArgs` and the registered `/atlas-init` command. Rewrite the body so that:
- `fresh` mode: rejects if `atlas/` exists; otherwise runs the orchestrator with `askQuestions` enabled (the actual Octto wiring is provided by the integration in 4.2 via dependency injection).
- `reconcile` mode: still returns a dry-run report (lifecycle-finish atlas-compiler owns this path; cold init does not write).
- `force-rebuild` mode: removes the existing `atlas/` directory contents (preserving the path) and runs the orchestrator with the user-supplied git tag recorded in the result. This satisfies the existing test that expects `gitTag` echoed back.

To keep the unit test for this file deterministic and isolated from runtime wiring, accept an optional `deps` parameter; production calls will pass real deps from `src/index.ts`. The existing test continues to work because it can pass deps that stub Octto and use the real writer.

```typescript
// src/tools/atlas/init.ts
import { existsSync, rmSync } from "node:fs";

import { createAtlasPaths } from "@/atlas/paths";
import { runColdInit, type OrchestratorDeps } from "@/atlas/cold-init/orchestrator";
import { writeVault } from "@/atlas/cold-init/vault-writer";

export type InitMode = "fresh" | "reconcile" | "force-rebuild";

export interface InitInput {
  readonly projectRoot: string;
  readonly mode: InitMode;
  readonly projectName: string;
  readonly projectType: string;
  readonly gitTag?: string;
  readonly deps?: Partial<OrchestratorDeps>;
}

export type InitOutcome = "ok" | "rejected" | "dry-run";

export interface InitResult {
  readonly outcome: InitOutcome;
  readonly reason?: string;
  readonly report?: string;
  readonly gitTag?: string;
  readonly nodesWritten?: number;
  readonly questionsAsked?: number;
  readonly logPath?: string;
}

const defaultDeps: OrchestratorDeps = {
  projectMemory: { list: async () => [] },
  askQuestions: null,
  writeVault: async (i) => writeVault({ projectRoot: i.projectRoot, runId: i.runId, plan: i.plan, answers: i.answers }),
};

export async function runAtlasInit(input: InitInput): Promise<InitResult> {
  const paths = createAtlasPaths(input.projectRoot);
  const exists = existsSync(paths.root);
  if (exists && input.mode === "fresh") {
    return { outcome: "rejected", reason: "atlas/ already exists; pass --reconcile or --force-rebuild" };
  }
  if (input.mode === "reconcile") {
    return { outcome: "dry-run", report: `would refresh ${paths.root}; lifecycle-finish atlas-compiler owns reconcile` };
  }
  if (input.mode === "force-rebuild" && exists) {
    rmSync(paths.root, { recursive: true, force: true });
  }
  const deps: OrchestratorDeps = { ...defaultDeps, ...(input.deps ?? {}) };
  const outcome = await runColdInit(
    { projectRoot: input.projectRoot, options: { askQuestions: deps.askQuestions !== null, questionTimeoutMs: 0 } },
    deps,
  );
  return {
    outcome: "ok",
    gitTag: input.gitTag,
    nodesWritten: outcome.nodesWritten,
    questionsAsked: outcome.questionsAsked,
    logPath: outcome.logPath ?? undefined,
  };
}
```

The existing `tests/tools/atlas/init.test.ts` already covers:
- fresh creates skeleton (now: cold init writes nodes; the test should additionally assert `nodesWritten >= 1`).
- existing vault rejects on bare fresh.
- reconcile produces dry-run.
- force-rebuild echoes git tag.

Update those assertions to match the cold-init behavior. Add one new test that verifies `--force-rebuild` clears the prior vault before re-running:

```typescript
// addition to tests/tools/atlas/init.test.ts
it("--force-rebuild removes the prior vault before running cold init", async () => {
  await runAtlasInit({ projectRoot, mode: "fresh", projectName: "demo", projectType: "server" });
  const beforeRebuildIndex = readFileSync(join(projectRoot, "atlas", "00-index.md"), "utf8");
  writeFileSync(join(projectRoot, "atlas", "00-index.md"), `${beforeRebuildIndex}\nLOCAL EDIT`, "utf8");
  const force = await runAtlasInit({
    projectRoot,
    mode: "force-rebuild",
    projectName: "demo",
    projectType: "server",
    gitTag: "atlas/pre-rebuild-1",
  });
  expect(force.outcome).toBe("ok");
  const after = readFileSync(join(projectRoot, "atlas", "00-index.md"), "utf8");
  expect(after).not.toContain("LOCAL EDIT");
});
```

(The implementer should add the `readFileSync, writeFileSync` imports and the `join` import if they are not already present.)

**Verify:** `bun test tests/tools/atlas/init.test.ts`
**Commit:** `feat(atlas): rewrite /atlas-init as cold orchestrator entry`

### Task 4.2: Wire Octto question asker and project-memory reader into `/atlas-init`
**File:** `src/index.ts`
**Test:** none (integration; covered by manual smoke + existing index.ts type-check coverage)
**Depends:** 4.1, 3.6
**Domain:** general

Decision: this is the only place where cold init touches the live Octto session store and the project-memory store. The change is localized to the `runAtlasCommand` function around the `ATLAS_INIT_COMMAND` branch.

Steps the implementer performs:

1. Above the `ATLAS_COMMAND_PREFIX` block, import the helpers:
```typescript
import { toOcttoPayloads } from "@/atlas/cold-init/octto-adapter";
import type { OrchestratorDeps } from "@/atlas/cold-init/orchestrator";
import { writeVault } from "@/atlas/cold-init/vault-writer";
```

2. Build the deps inside `runAtlasCommand` (or a small helper next to it) before calling `runAtlasInit`:
```typescript
const buildColdInitDeps = (ctx: PluginInput): OrchestratorDeps => {
  return {
    projectMemory: {
      list: async () => {
        // Use the existing project_memory reader exposed on ctx tools, OR fall back to empty.
        // The implementer wires this to the actual project-memory list API used elsewhere in src/index.ts.
        return [];
      },
    },
    askQuestions: async (questions) => {
      const sessionId = `atlas-init-${Date.now().toString(36)}`;
      try {
        const payloads = toOcttoPayloads(questions);
        const start = await octtoSessionStore.startSession({
          sessionId,
          parentSessionId: ctx.sessionID,
          questions: payloads.map((p) => ({ type: p.type, config: p.config, key: p.questionKey })),
        });
        const answers: Record<string, string> = {};
        for (const _ of payloads) {
          const next = await octtoSessionStore.getNextAnswer(start.sessionId);
          if (next === null) break;
          answers[next.key] = String(next.value ?? "");
        }
        await octtoSessionStore.endSession(start.sessionId);
        return answers;
      } catch {
        return null;
      }
    },
    writeVault: async (i) => writeVault({ projectRoot: i.projectRoot, runId: i.runId, plan: i.plan, answers: i.answers }),
  };
};
```

3. In the `ATLAS_INIT_COMMAND` branch, pass `deps: buildColdInitDeps(ctx)` into `runAtlasInit`:
```typescript
if (command === ATLAS_INIT_COMMAND) {
  const parsed = parseAtlasInitArgs(splitAtlasArgs(input.arguments));
  const result = await runAtlasInit({
    projectRoot: ctx.directory,
    mode: parsed.mode,
    projectName: basename(ctx.directory),
    projectType: ATLAS_PROJECT_TYPE,
    deps: buildColdInitDeps(ctx),
  });
  appendAtlasCommandPart(input, output, formatAtlasCommandResult(command, result));
  return;
}
```

Notes for the implementer:
- The Octto session store's exact answer-collection method may be `getNextAnswer`, `awaitAnswer`, or similar; check `src/octto/session/sessions.ts` for the real name and adapt the call. The contract here is: push all questions, then collect answers in any order until the session ends or the user cancels.
- Project-memory list: if `src/index.ts` already constructs a project-memory store object before the atlas command branch, reuse it. Otherwise, leave the `list: async () => []` stub for now; the orchestrator and synthesizer behave correctly with an empty list, only fewer decision/risk nodes get planned.
- Do NOT remove or alter the existing `atlas-compiler` lifecycle-finish call sites elsewhere in the codebase. Cold init and lifecycle finish are independent.

**Verify:** `bun run typecheck && bun run check`
**Commit:** `feat(atlas): wire octto and project-memory into /atlas-init`

### Task 4.3: Update phase roadmap and command description copy
**File:** `src/atlas/templates.ts`, `src/atlas/commands.ts`
**Test:** `tests/atlas/templates.test.ts`, `tests/atlas/commands.test.ts` (update assertions if they hard-code prior copy)
**Depends:** 4.1, 4.2
**Domain:** general

Decision: bring the copy in line with the new behavior. The phase roadmap previously listed "/atlas-init --reconcile and --force-rebuild" under Phase 2. Add a one-line note that as of this change `/atlas-init` performs a comprehensive cold start that does not depend on lifecycle handoff. The `/atlas-init` command description in `commands.ts` updates to reflect cold-start scope.

```typescript
// src/atlas/commands.ts (description update)
{
  name: "/atlas-init",
  description:
    "Cold-start the project atlas vault: discover, plan, optionally ask Octto questions, and write a usable Obsidian vault (use --reconcile or --force-rebuild on existing vaults)",
},
```

```typescript
// src/atlas/templates.ts (phase roadmap addendum, appended inside the existing Phase 2 narrative)
"`/atlas-init` is a comprehensive cold-start orchestrator independent of lifecycle handoff;",
```

If the existing `tests/atlas/templates.test.ts` snapshots the rendered text, update the snapshot to include the new line. If it asserts substring presence, simply add a new substring assertion for "comprehensive cold-start orchestrator". For `tests/atlas/commands.test.ts`, update any equality assertion on the `/atlas-init` description to match.

**Verify:** `bun test tests/atlas/templates.test.ts tests/atlas/commands.test.ts`
**Commit:** `docs(atlas): update /atlas-init copy for cold orchestrator`

---

## Verification (run after Batch 4)

- `bun run check` (full quality gate: biome + eslint + tsc + bun test)
- Manual smoke: in a sample project worktree without an `atlas/` directory, run `/atlas-init`. Confirm the orchestrator emits a discovery summary, optionally pushes Octto questions, fans out workers, and produces `atlas/00-index.md`, `atlas/10-impl/<module>.md` for each src module, `atlas/20-behavior/<topic>.md` per inferred topic, `atlas/40-decisions/atlas-phase-roadmap.md`, `atlas/50-risks/` index, `atlas/60-timeline/` summary, and `atlas/_meta/schema-version`. Vault must open in Obsidian without broken wikilinks.
- Confirm `/atlas-init --reconcile` still produces a dry-run report.
- Confirm `/atlas-init --force-rebuild` produces a fresh vault and records the supplied git tag.
- Confirm `atlas-compiler` (lifecycle finish) is untouched and still reads the handoff marker.
