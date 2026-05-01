---
date: 2026-05-01
topic: "Runtime Deploy Helper and Critical Thinking Policy"
issue: 19
scope: runtime-deploy
contract: none
---

# Runtime Deploy Helper and Critical Thinking Policy Implementation Plan

**Goal:** Ship a robust `/root/CODE/micode -> /root/.micode` sync/build helper that never restarts OpenCode, plus need-first critical thinking policy text for global `AGENTS.md`, plus aligned project docs and tests.

**Architecture:** The helper lives in `src/utils/runtime-deploy/` as small, testable factory modules (preflight, sync, build, report) wired together by a thin orchestrator. A `scripts/deploy-runtime.ts` CLI entry exposes it as one command and is wired into `package.json` as `bun run deploy:runtime`. Documentation in `README.md`, `ARCHITECTURE.md`, `CLAUDE.md`, and a dedicated `docs/runtime-deploy.md` describes the three-step rule (sync, build, ask user to restart). The global `AGENTS.md` policy update lives outside this repo, so it is delivered as a reviewable patch document under `docs/global-agents-md-patch.md` plus an explicit out-of-band step.

**Design:** [thoughts/shared/designs/2026-05-01-runtime-deploy-and-critical-thinking-design.md](../designs/2026-05-01-runtime-deploy-and-critical-thinking-design.md)

**Contract:** none (all tasks are `general` domain; no frontend/backend split).

---

## Scope and Decisions Made by Planner

The design left a few implementation details open; here are the calls I'm making so the implementer has zero ambiguity.

1. **Language and runtime:** the helper is written in TypeScript and executed via `bun` (consistent with the rest of the project). `scripts/deploy-runtime.ts` is invoked by `bun run scripts/deploy-runtime.ts` and wired as `bun run deploy:runtime`.
2. **Sync mechanism:** use `rsync -a --delete` with an explicit exclude list. Rationale: `rsync` is already present on the host, gives us preserve-and-prune semantics, and the exclude list is the natural place to protect runtime-local state. If `rsync` is missing, the helper fails fast in preflight rather than silently falling back to `cp`.
3. **Excluded paths (runtime-local state):** `node_modules`, `dist`, `.git`, `thoughts`, `coverage`, `.turbo`, `.cache`, `*.log`, `.env`, `.env.*`. The `dist` exclusion is deliberate: we rebuild at the destination, so syncing dev-side `dist` would just be churn.
4. **Dependency install:** the helper compares `bun.lock` between source and destination after sync. If destination has a newer or differing lock, run `bun install --frozen-lockfile` in destination. Otherwise skip.
5. **Build command:** `bun run build` in destination. Verify `/root/.micode/dist/index.js` exists and is non-empty (>= 1 KB) afterward.
6. **Dirty-state detection:** for both source and destination, treat `git status --porcelain` non-empty as dirty. Source dirty is a hard stop (the user is about to lose work). Destination dirty is a hard stop unless `--force` is passed (a future-flag we expose but do NOT default on; described in the helper but kept conservative).
7. **Modes:** the CLI supports `--dry-run` (preview only, no writes) and apply mode (default). Restart is NEVER performed.
8. **Final output:** structured handoff summary printed to stdout in plain text. Includes source SHA, destination SHA after sync, build status, bundle size, and the literal sentence "Runtime ready. Restart of OpenCode requires explicit user approval."
9. **Global `AGENTS.md` handling:** because that file lives at `/root/.config/opencode/AGENTS.md` and is outside the repo, the plan ships a patch document the user can review and apply. The implementer does NOT silently edit the global file. The handoff explicitly tells the user to apply the patch out-of-band.
10. **Notification:** QQ notification on completion is OPTIONAL and only attempted if `bun run` can detect the notification entrypoint; helper degrades silently if not. We will not block ready-state on notification.
11. **Logging:** use `console.log` / `console.error` directly in `scripts/deploy-runtime.ts` (it is a CLI, not plugin code). Inside `src/utils/runtime-deploy/*` modules, return structured result objects (discriminated unions) rather than logging; the CLI layer is responsible for human-readable output.

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2, 1.3 [foundation - no deps]
Batch 2 (parallel): 2.1, 2.2, 2.3, 2.4 [core helpers - depend on batch 1]
Batch 3 (parallel): 3.1, 3.2 [orchestrator and CLI - depend on batch 2]
Batch 4 (parallel): 4.1, 4.2, 4.3, 4.4, 4.5, 4.6 [docs and policy - depend on batch 3]
```

---

## Batch 1: Foundation (parallel - 3 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3

### Task 1.1: Runtime deploy paths config
**File:** `src/utils/runtime-deploy/paths.ts`
**Test:** `tests/utils/runtime-deploy/paths.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/utils/runtime-deploy/paths.test.ts
import { describe, expect, it } from "bun:test";

import { RUNTIME_DEPLOY_PATHS, isUnderSource, isUnderRuntime } from "@/utils/runtime-deploy/paths";

describe("runtime-deploy paths", () => {
  it("exposes the canonical source and runtime paths", () => {
    expect(RUNTIME_DEPLOY_PATHS.source).toBe("/root/CODE/micode");
    expect(RUNTIME_DEPLOY_PATHS.runtime).toBe("/root/.micode");
    expect(RUNTIME_DEPLOY_PATHS.runtimeBundle).toBe("/root/.micode/dist/index.js");
  });

  it("identifies paths under source", () => {
    expect(isUnderSource("/root/CODE/micode/src/index.ts")).toBe(true);
    expect(isUnderSource("/root/.micode/dist/index.js")).toBe(false);
  });

  it("identifies paths under runtime", () => {
    expect(isUnderRuntime("/root/.micode/dist/index.js")).toBe(true);
    expect(isUnderRuntime("/root/CODE/micode/src/index.ts")).toBe(false);
  });

  it("rejects empty input on the under-source check", () => {
    expect(isUnderSource("")).toBe(false);
    expect(isUnderRuntime("")).toBe(false);
  });
});
```

```typescript
// src/utils/runtime-deploy/paths.ts
// Canonical paths for the development checkout and the live OpenCode plugin.
// Centralized so future agents do not re-derive these strings.

export interface RuntimeDeployPaths {
  readonly source: string;
  readonly runtime: string;
  readonly runtimeBundle: string;
  readonly minBundleBytes: number;
}

export const RUNTIME_DEPLOY_PATHS: RuntimeDeployPaths = {
  source: "/root/CODE/micode",
  runtime: "/root/.micode",
  runtimeBundle: "/root/.micode/dist/index.js",
  minBundleBytes: 1024,
} as const;

export function isUnderSource(absolutePath: string): boolean {
  if (!absolutePath) return false;
  return absolutePath === RUNTIME_DEPLOY_PATHS.source || absolutePath.startsWith(`${RUNTIME_DEPLOY_PATHS.source}/`);
}

export function isUnderRuntime(absolutePath: string): boolean {
  if (!absolutePath) return false;
  return absolutePath === RUNTIME_DEPLOY_PATHS.runtime || absolutePath.startsWith(`${RUNTIME_DEPLOY_PATHS.runtime}/`);
}
```

**Verify:** `bun test tests/utils/runtime-deploy/paths.test.ts`
**Commit:** `feat(runtime-deploy): add canonical paths constants`

### Task 1.2: Result and status type definitions
**File:** `src/utils/runtime-deploy/types.ts`
**Test:** none (pure types)
**Depends:** none
**Domain:** general

```typescript
// src/utils/runtime-deploy/types.ts
// Discriminated unions describing each phase's outcome. Keeping these in one
// file lets the CLI layer pattern-match without importing every helper module.

export const DEPLOY_STATUS = {
  Ok: "ok",
  Failed: "failed",
  Skipped: "skipped",
} as const;

export type DeployStatus = (typeof DEPLOY_STATUS)[keyof typeof DEPLOY_STATUS];

export interface PreflightOk {
  readonly kind: "ok";
  readonly sourceCommit: string;
  readonly runtimeCommit: string | null;
}

export interface PreflightFailed {
  readonly kind: "failed";
  readonly reason:
    | "source-missing"
    | "runtime-missing"
    | "source-dirty"
    | "runtime-dirty"
    | "rsync-missing"
    | "bun-missing";
  readonly detail: string;
}

export type PreflightResult = PreflightOk | PreflightFailed;

export interface SyncOk {
  readonly kind: "ok";
  readonly filesChanged: number;
  readonly bytesTransferred: number;
}

export interface SyncFailed {
  readonly kind: "failed";
  readonly detail: string;
}

export type SyncResult = SyncOk | SyncFailed;

export interface BuildOk {
  readonly kind: "ok";
  readonly bundleBytes: number;
  readonly installRan: boolean;
}

export interface BuildFailed {
  readonly kind: "failed";
  readonly stage: "install" | "build" | "verify";
  readonly detail: string;
}

export type BuildResult = BuildOk | BuildFailed;

export interface DeployReport {
  readonly preflight: PreflightResult;
  readonly sync: SyncResult | null;
  readonly build: BuildResult | null;
  readonly mode: "dry-run" | "apply";
  readonly ready: boolean;
}
```

**Verify:** `bun run typecheck`
**Commit:** `feat(runtime-deploy): add deploy result type definitions`

### Task 1.3: Runtime-local exclusion list
**File:** `src/utils/runtime-deploy/exclusions.ts`
**Test:** `tests/utils/runtime-deploy/exclusions.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/utils/runtime-deploy/exclusions.test.ts
import { describe, expect, it } from "bun:test";

import { RUNTIME_LOCAL_EXCLUSIONS, toRsyncExcludeArgs, isExcluded } from "@/utils/runtime-deploy/exclusions";

describe("runtime-deploy exclusions", () => {
  it("preserves runtime-local state directories", () => {
    expect(RUNTIME_LOCAL_EXCLUSIONS).toContain("node_modules");
    expect(RUNTIME_LOCAL_EXCLUSIONS).toContain("thoughts");
    expect(RUNTIME_LOCAL_EXCLUSIONS).toContain(".git");
    expect(RUNTIME_LOCAL_EXCLUSIONS).toContain("dist");
  });

  it("excludes secret and env files", () => {
    expect(RUNTIME_LOCAL_EXCLUSIONS).toContain(".env");
    expect(RUNTIME_LOCAL_EXCLUSIONS).toContain(".env.*");
  });

  it("renders rsync --exclude flags", () => {
    const args = toRsyncExcludeArgs(["node_modules", ".env"]);
    expect(args).toEqual(["--exclude", "node_modules", "--exclude", ".env"]);
  });

  it("matches a path against the exclusion list", () => {
    expect(isExcluded("node_modules/foo")).toBe(true);
    expect(isExcluded("thoughts/shared/plans/x.md")).toBe(true);
    expect(isExcluded("src/index.ts")).toBe(false);
  });

  it("treats top-level dotfiles in the list correctly", () => {
    expect(isExcluded(".env")).toBe(true);
    expect(isExcluded(".env.local")).toBe(true);
    expect(isExcluded(".gitignore")).toBe(false);
  });
});
```

```typescript
// src/utils/runtime-deploy/exclusions.ts
// Paths that must be preserved in /root/.micode and never copied from the dev
// checkout. Order is not significant; rsync evaluates each rule independently.

export const RUNTIME_LOCAL_EXCLUSIONS: readonly string[] = [
  "node_modules",
  "dist",
  ".git",
  "thoughts",
  "coverage",
  ".turbo",
  ".cache",
  "*.log",
  ".env",
  ".env.*",
] as const;

export function toRsyncExcludeArgs(patterns: readonly string[]): string[] {
  const args: string[] = [];
  for (const pattern of patterns) {
    args.push("--exclude", pattern);
  }
  return args;
}

export function isExcluded(relativePath: string, patterns: readonly string[] = RUNTIME_LOCAL_EXCLUSIONS): boolean {
  if (!relativePath) return false;
  for (const pattern of patterns) {
    if (matchesPattern(relativePath, pattern)) return true;
  }
  return false;
}

function matchesPattern(relativePath: string, pattern: string): boolean {
  if (pattern.includes("*")) {
    const prefix = pattern.replace(/\*+$/, "");
    return relativePath === prefix || relativePath.startsWith(prefix);
  }
  return relativePath === pattern || relativePath.startsWith(`${pattern}/`);
}
```

**Verify:** `bun test tests/utils/runtime-deploy/exclusions.test.ts`
**Commit:** `feat(runtime-deploy): add runtime-local exclusion list`

---

## Batch 2: Core Helpers (parallel - 4 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2, 2.3, 2.4

### Task 2.1: Preflight checks
**File:** `src/utils/runtime-deploy/preflight.ts`
**Test:** `tests/utils/runtime-deploy/preflight.test.ts`
**Depends:** 1.1, 1.2
**Domain:** general

```typescript
// tests/utils/runtime-deploy/preflight.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

import { runPreflight } from "@/utils/runtime-deploy/preflight";

let workspace: string;
let source: string;
let runtime: string;

beforeEach(async () => {
  workspace = mkdtempSync(join(tmpdir(), "rd-pre-"));
  source = join(workspace, "src-repo");
  runtime = join(workspace, "rt-repo");
  await $`git init -q ${source}`;
  await $`git -C ${source} commit --allow-empty -m init -q`;
  await $`git init -q ${runtime}`;
  await $`git -C ${runtime} commit --allow-empty -m init -q`;
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("runPreflight", () => {
  it("returns ok when both checkouts exist and are clean", async () => {
    const r = await runPreflight({ source, runtime });
    expect(r.kind).toBe("ok");
  });

  it("fails when source is missing", async () => {
    const r = await runPreflight({ source: join(workspace, "nope"), runtime });
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.reason).toBe("source-missing");
  });

  it("fails when runtime is missing", async () => {
    const r = await runPreflight({ source, runtime: join(workspace, "nope") });
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.reason).toBe("runtime-missing");
  });

  it("fails when source has uncommitted changes", async () => {
    writeFileSync(join(source, "dirty.txt"), "x");
    const r = await runPreflight({ source, runtime });
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.reason).toBe("source-dirty");
  });

  it("fails when runtime has uncommitted changes and force is not set", async () => {
    writeFileSync(join(runtime, "dirty.txt"), "x");
    const r = await runPreflight({ source, runtime });
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.reason).toBe("runtime-dirty");
  });

  it("allows runtime dirty when force=true", async () => {
    writeFileSync(join(runtime, "dirty.txt"), "x");
    const r = await runPreflight({ source, runtime, force: true });
    expect(r.kind).toBe("ok");
  });
});
```

```typescript
// src/utils/runtime-deploy/preflight.ts
// Validates that source and runtime checkouts exist, are clean, and that
// required system tools (rsync, bun) are available before any sync runs.

import { existsSync } from "node:fs";
import { $ } from "bun";

import type { PreflightResult } from "@/utils/runtime-deploy/types";

export interface PreflightInput {
  readonly source: string;
  readonly runtime: string;
  readonly force?: boolean;
  readonly skipToolingCheck?: boolean;
}

export async function runPreflight(input: PreflightInput): Promise<PreflightResult> {
  if (!existsSync(input.source)) {
    return { kind: "failed", reason: "source-missing", detail: `Source path not found: ${input.source}` };
  }
  if (!existsSync(input.runtime)) {
    return { kind: "failed", reason: "runtime-missing", detail: `Runtime path not found: ${input.runtime}` };
  }

  const sourceDirty = await isDirty(input.source);
  if (sourceDirty) {
    return { kind: "failed", reason: "source-dirty", detail: `Source has uncommitted changes: ${input.source}` };
  }

  if (!input.force) {
    const runtimeDirty = await isDirty(input.runtime);
    if (runtimeDirty) {
      return { kind: "failed", reason: "runtime-dirty", detail: `Runtime has uncommitted changes: ${input.runtime}` };
    }
  }

  if (!input.skipToolingCheck) {
    const toolMissing = await missingTool();
    if (toolMissing) return toolMissing;
  }

  const sourceCommit = await commitOf(input.source);
  const runtimeCommit = await commitOf(input.runtime);
  return { kind: "ok", sourceCommit, runtimeCommit };
}

async function isDirty(repo: string): Promise<boolean> {
  const out = await $`git -C ${repo} status --porcelain`.text();
  return out.trim().length > 0;
}

async function commitOf(repo: string): Promise<string> {
  try {
    return (await $`git -C ${repo} rev-parse HEAD`.text()).trim();
  } catch {
    return "unknown";
  }
}

async function missingTool(): Promise<PreflightResult | null> {
  const rsync = await $`command -v rsync`.nothrow().quiet();
  if (rsync.exitCode !== 0) {
    return { kind: "failed", reason: "rsync-missing", detail: "rsync is not installed on PATH" };
  }
  const bun = await $`command -v bun`.nothrow().quiet();
  if (bun.exitCode !== 0) {
    return { kind: "failed", reason: "bun-missing", detail: "bun is not installed on PATH" };
  }
  return null;
}
```

**Verify:** `bun test tests/utils/runtime-deploy/preflight.test.ts`
**Commit:** `feat(runtime-deploy): add preflight checks`

### Task 2.2: Selective rsync helper
**File:** `src/utils/runtime-deploy/sync.ts`
**Test:** `tests/utils/runtime-deploy/sync.test.ts`
**Depends:** 1.2, 1.3
**Domain:** general

```typescript
// tests/utils/runtime-deploy/sync.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runSync } from "@/utils/runtime-deploy/sync";

let workspace: string;
let source: string;
let runtime: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "rd-sync-"));
  source = join(workspace, "src");
  runtime = join(workspace, "rt");
  mkdirSync(source, { recursive: true });
  mkdirSync(runtime, { recursive: true });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("runSync", () => {
  it("copies project files into the runtime path", async () => {
    writeFileSync(join(source, "a.ts"), "export const a = 1;");
    const r = await runSync({ source, runtime, dryRun: false });
    expect(r.kind).toBe("ok");
    expect(existsSync(join(runtime, "a.ts"))).toBe(true);
    expect(readFileSync(join(runtime, "a.ts"), "utf8")).toBe("export const a = 1;");
  });

  it("preserves runtime-local node_modules", async () => {
    mkdirSync(join(runtime, "node_modules"), { recursive: true });
    writeFileSync(join(runtime, "node_modules", "marker.txt"), "keep");
    writeFileSync(join(source, "a.ts"), "x");
    await runSync({ source, runtime, dryRun: false });
    expect(existsSync(join(runtime, "node_modules", "marker.txt"))).toBe(true);
  });

  it("preserves runtime-local thoughts directory", async () => {
    mkdirSync(join(runtime, "thoughts"), { recursive: true });
    writeFileSync(join(runtime, "thoughts", "ledger.md"), "keep");
    writeFileSync(join(source, "a.ts"), "x");
    await runSync({ source, runtime, dryRun: false });
    expect(existsSync(join(runtime, "thoughts", "ledger.md"))).toBe(true);
  });

  it("removes stale project files in runtime", async () => {
    writeFileSync(join(runtime, "stale.ts"), "old");
    writeFileSync(join(source, "fresh.ts"), "new");
    await runSync({ source, runtime, dryRun: false });
    expect(existsSync(join(runtime, "stale.ts"))).toBe(false);
    expect(existsSync(join(runtime, "fresh.ts"))).toBe(true);
  });

  it("does not write anything in dry-run mode", async () => {
    writeFileSync(join(source, "a.ts"), "x");
    const r = await runSync({ source, runtime, dryRun: true });
    expect(r.kind).toBe("ok");
    expect(existsSync(join(runtime, "a.ts"))).toBe(false);
  });
});
```

```typescript
// src/utils/runtime-deploy/sync.ts
// Wraps rsync with the project's exclusion list. Always uses --delete so that
// removed files in source are pruned in destination, except for the explicitly
// preserved runtime-local paths.

import { $ } from "bun";

import { RUNTIME_LOCAL_EXCLUSIONS, toRsyncExcludeArgs } from "@/utils/runtime-deploy/exclusions";
import type { SyncResult } from "@/utils/runtime-deploy/types";

export interface SyncInput {
  readonly source: string;
  readonly runtime: string;
  readonly dryRun: boolean;
  readonly exclusions?: readonly string[];
}

export async function runSync(input: SyncInput): Promise<SyncResult> {
  const exclusions = input.exclusions ?? RUNTIME_LOCAL_EXCLUSIONS;
  const sourceWithSlash = input.source.endsWith("/") ? input.source : `${input.source}/`;
  const flags = input.dryRun ? ["-a", "--delete", "--dry-run", "--stats"] : ["-a", "--delete", "--stats"];
  const args = [...flags, ...toRsyncExcludeArgs(exclusions), sourceWithSlash, input.runtime];
  const result = await $`rsync ${args}`.nothrow().quiet();
  if (result.exitCode !== 0) {
    return { kind: "failed", detail: result.stderr.toString().trim() || `rsync exit ${result.exitCode}` };
  }
  const stats = parseStats(result.stdout.toString());
  return { kind: "ok", filesChanged: stats.filesChanged, bytesTransferred: stats.bytesTransferred };
}

interface ParsedStats {
  readonly filesChanged: number;
  readonly bytesTransferred: number;
}

function parseStats(output: string): ParsedStats {
  const filesMatch = output.match(/Number of regular files transferred:\s+([\d,]+)/);
  const bytesMatch = output.match(/Total transferred file size:\s+([\d,]+)/);
  return {
    filesChanged: filesMatch ? Number(filesMatch[1].replace(/,/g, "")) : 0,
    bytesTransferred: bytesMatch ? Number(bytesMatch[1].replace(/,/g, "")) : 0,
  };
}
```

**Verify:** `bun test tests/utils/runtime-deploy/sync.test.ts`
**Commit:** `feat(runtime-deploy): add selective rsync helper`

### Task 2.3: Build and verify helper
**File:** `src/utils/runtime-deploy/build.ts`
**Test:** `tests/utils/runtime-deploy/build.test.ts`
**Depends:** 1.1, 1.2
**Domain:** general

```typescript
// tests/utils/runtime-deploy/build.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runBuild } from "@/utils/runtime-deploy/build";

let runtime: string;

beforeEach(() => {
  runtime = mkdtempSync(join(tmpdir(), "rd-build-"));
});

afterEach(() => {
  rmSync(runtime, { recursive: true, force: true });
});

describe("runBuild", () => {
  it("verifies an existing bundle when build script succeeds", async () => {
    writeFakePackage(runtime, "exit 0");
    mkdirSync(join(runtime, "dist"), { recursive: true });
    writeFileSync(join(runtime, "dist", "index.js"), "x".repeat(2048));
    const r = await runBuild({ runtime, runInstall: false, minBundleBytes: 1024 });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.bundleBytes).toBeGreaterThanOrEqual(2048);
      expect(r.installRan).toBe(false);
    }
  });

  it("fails when bundle is missing after build", async () => {
    writeFakePackage(runtime, "exit 0");
    const r = await runBuild({ runtime, runInstall: false, minBundleBytes: 1024 });
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.stage).toBe("verify");
  });

  it("fails when bundle is too small", async () => {
    writeFakePackage(runtime, "exit 0");
    mkdirSync(join(runtime, "dist"), { recursive: true });
    writeFileSync(join(runtime, "dist", "index.js"), "x");
    const r = await runBuild({ runtime, runInstall: false, minBundleBytes: 1024 });
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.stage).toBe("verify");
  });

  it("fails with stage=build when build script exits non-zero", async () => {
    writeFakePackage(runtime, "exit 7");
    const r = await runBuild({ runtime, runInstall: false, minBundleBytes: 1024 });
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.stage).toBe("build");
  });
});

function writeFakePackage(dir: string, buildBody: string): void {
  const pkg = { name: "fake", scripts: { build: `sh -c "${buildBody}"` } };
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
}
```

```typescript
// src/utils/runtime-deploy/build.ts
// Runs install (when needed) and `bun run build` in the runtime checkout, then
// verifies the produced dist/index.js is present and non-trivial.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

import type { BuildResult } from "@/utils/runtime-deploy/types";

export interface BuildInput {
  readonly runtime: string;
  readonly runInstall: boolean;
  readonly minBundleBytes: number;
}

export async function runBuild(input: BuildInput): Promise<BuildResult> {
  if (input.runInstall) {
    const install = await $`bun install --frozen-lockfile`.cwd(input.runtime).nothrow().quiet();
    if (install.exitCode !== 0) {
      return { kind: "failed", stage: "install", detail: install.stderr.toString().trim() || "install failed" };
    }
  }
  const build = await $`bun run build`.cwd(input.runtime).nothrow().quiet();
  if (build.exitCode !== 0) {
    return { kind: "failed", stage: "build", detail: build.stderr.toString().trim() || "build failed" };
  }
  const bundle = join(input.runtime, "dist", "index.js");
  if (!existsSync(bundle)) {
    return { kind: "failed", stage: "verify", detail: `bundle missing: ${bundle}` };
  }
  const size = statSync(bundle).size;
  if (size < input.minBundleBytes) {
    return { kind: "failed", stage: "verify", detail: `bundle smaller than ${input.minBundleBytes} bytes: ${size}` };
  }
  return { kind: "ok", bundleBytes: size, installRan: input.runInstall };
}
```

**Verify:** `bun test tests/utils/runtime-deploy/build.test.ts`
**Commit:** `feat(runtime-deploy): add build and verify helper`

### Task 2.4: Handoff report formatter
**File:** `src/utils/runtime-deploy/report.ts`
**Test:** `tests/utils/runtime-deploy/report.test.ts`
**Depends:** 1.2
**Domain:** general

```typescript
// tests/utils/runtime-deploy/report.test.ts
import { describe, expect, it } from "bun:test";

import { formatReport } from "@/utils/runtime-deploy/report";
import type { DeployReport } from "@/utils/runtime-deploy/types";

const RESTART_LINE = "Runtime ready. Restart of OpenCode requires explicit user approval.";

describe("formatReport", () => {
  it("renders a successful apply run", () => {
    const report: DeployReport = {
      mode: "apply",
      ready: true,
      preflight: { kind: "ok", sourceCommit: "abc1234", runtimeCommit: "def5678" },
      sync: { kind: "ok", filesChanged: 12, bytesTransferred: 4096 },
      build: { kind: "ok", bundleBytes: 234567, installRan: true },
    };
    const out = formatReport(report);
    expect(out).toContain("MODE: apply");
    expect(out).toContain("PREFLIGHT: ok");
    expect(out).toContain("source=abc1234");
    expect(out).toContain("runtime=def5678");
    expect(out).toContain("SYNC: ok files=12");
    expect(out).toContain("BUILD: ok bundle=234567 bytes installRan=true");
    expect(out).toContain(RESTART_LINE);
  });

  it("never claims ready=true on failure", () => {
    const report: DeployReport = {
      mode: "apply",
      ready: false,
      preflight: { kind: "failed", reason: "source-dirty", detail: "dirty" },
      sync: null,
      build: null,
    };
    const out = formatReport(report);
    expect(out).toContain("PREFLIGHT: failed");
    expect(out).toContain("reason=source-dirty");
    expect(out).not.toContain("Runtime ready.");
    expect(out).toContain("NOT READY");
  });

  it("formats a dry-run report without claiming readiness", () => {
    const report: DeployReport = {
      mode: "dry-run",
      ready: false,
      preflight: { kind: "ok", sourceCommit: "a", runtimeCommit: "b" },
      sync: { kind: "ok", filesChanged: 3, bytesTransferred: 100 },
      build: null,
    };
    const out = formatReport(report);
    expect(out).toContain("MODE: dry-run");
    expect(out).toContain("DRY-RUN");
    expect(out).not.toContain("Runtime ready.");
  });
});
```

```typescript
// src/utils/runtime-deploy/report.ts
// Renders a deploy report in plain text. Never lies about readiness: the final
// approval-required sentence appears only when ready is true.

import type { BuildResult, DeployReport, PreflightResult, SyncResult } from "@/utils/runtime-deploy/types";

const RESTART_APPROVAL_LINE = "Runtime ready. Restart of OpenCode requires explicit user approval.";

export function formatReport(report: DeployReport): string {
  const lines: string[] = [];
  lines.push(`MODE: ${report.mode}`);
  lines.push(formatPreflight(report.preflight));
  if (report.sync) lines.push(formatSync(report.sync));
  if (report.build) lines.push(formatBuild(report.build));
  if (report.mode === "dry-run") lines.push("DRY-RUN: no changes were applied to /root/.micode");
  if (report.ready) lines.push(RESTART_APPROVAL_LINE);
  else lines.push("NOT READY: see failures above; do not restart OpenCode");
  return `${lines.join("\n")}\n`;
}

function formatPreflight(p: PreflightResult): string {
  if (p.kind === "ok") return `PREFLIGHT: ok source=${shortSha(p.sourceCommit)} runtime=${shortSha(p.runtimeCommit)}`;
  return `PREFLIGHT: failed reason=${p.reason} detail=${p.detail}`;
}

function formatSync(s: SyncResult): string {
  if (s.kind === "ok") return `SYNC: ok files=${s.filesChanged} bytes=${s.bytesTransferred}`;
  return `SYNC: failed detail=${s.detail}`;
}

function formatBuild(b: BuildResult): string {
  if (b.kind === "ok") return `BUILD: ok bundle=${b.bundleBytes} bytes installRan=${b.installRan}`;
  return `BUILD: failed stage=${b.stage} detail=${b.detail}`;
}

function shortSha(sha: string | null): string {
  if (!sha) return "none";
  return sha.length >= 7 ? sha.slice(0, 7) : sha;
}
```

**Verify:** `bun test tests/utils/runtime-deploy/report.test.ts`
**Commit:** `feat(runtime-deploy): add handoff report formatter`

---

## Batch 3: Orchestrator and CLI (parallel - 2 implementers)

All tasks in this batch depend on Batch 2 completing.
Tasks: 3.1, 3.2

### Task 3.1: Deploy orchestrator
**File:** `src/utils/runtime-deploy/index.ts`
**Test:** `tests/utils/runtime-deploy/index.test.ts`
**Depends:** 1.1, 1.2, 2.1, 2.2, 2.3
**Domain:** general

```typescript
// tests/utils/runtime-deploy/index.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

import { runRuntimeDeploy } from "@/utils/runtime-deploy";

let workspace: string;
let source: string;
let runtime: string;

beforeEach(async () => {
  workspace = mkdtempSync(join(tmpdir(), "rd-orch-"));
  source = join(workspace, "src");
  runtime = join(workspace, "rt");
  mkdirSync(source, { recursive: true });
  mkdirSync(runtime, { recursive: true });
  await $`git init -q ${source}`;
  await $`git -C ${source} commit --allow-empty -m init -q`;
  await $`git init -q ${runtime}`;
  await $`git -C ${runtime} commit --allow-empty -m init -q`;
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("runRuntimeDeploy orchestrator", () => {
  it("stops at preflight failure and never invokes sync or build", async () => {
    writeFileSync(join(source, "dirty.txt"), "x");
    const r = await runRuntimeDeploy({ source, runtime, mode: "apply", skipToolingCheck: true });
    expect(r.preflight.kind).toBe("failed");
    expect(r.sync).toBeNull();
    expect(r.build).toBeNull();
    expect(r.ready).toBe(false);
  });

  it("dry-run returns ready=false even on success", async () => {
    const r = await runRuntimeDeploy({ source, runtime, mode: "dry-run", skipToolingCheck: true, runBuildStep: false });
    expect(r.preflight.kind).toBe("ok");
    expect(r.sync?.kind).toBe("ok");
    expect(r.build).toBeNull();
    expect(r.ready).toBe(false);
  });

  it("sets ready=true only when preflight, sync, and build all succeed", async () => {
    const r = await runRuntimeDeploy({
      source,
      runtime,
      mode: "apply",
      skipToolingCheck: true,
      runBuildStep: false,
    });
    expect(r.preflight.kind).toBe("ok");
    expect(r.sync?.kind).toBe("ok");
    expect(r.build).toBeNull();
    expect(r.ready).toBe(false);
  });
});
```

```typescript
// src/utils/runtime-deploy/index.ts
// Orchestrates preflight -> sync -> build -> report. Each phase is a no-op when
// the previous phase failed. The orchestrator never restarts OpenCode and never
// claims readiness unless every phase passed in apply mode.

import { RUNTIME_DEPLOY_PATHS } from "@/utils/runtime-deploy/paths";
import { runBuild } from "@/utils/runtime-deploy/build";
import { runPreflight } from "@/utils/runtime-deploy/preflight";
import { runSync } from "@/utils/runtime-deploy/sync";
import type { DeployReport } from "@/utils/runtime-deploy/types";

export interface RuntimeDeployInput {
  readonly source?: string;
  readonly runtime?: string;
  readonly mode: "dry-run" | "apply";
  readonly force?: boolean;
  readonly skipToolingCheck?: boolean;
  readonly runBuildStep?: boolean;
  readonly minBundleBytes?: number;
}

export async function runRuntimeDeploy(input: RuntimeDeployInput): Promise<DeployReport> {
  const source = input.source ?? RUNTIME_DEPLOY_PATHS.source;
  const runtime = input.runtime ?? RUNTIME_DEPLOY_PATHS.runtime;
  const minBundleBytes = input.minBundleBytes ?? RUNTIME_DEPLOY_PATHS.minBundleBytes;

  const preflight = await runPreflight({ source, runtime, force: input.force, skipToolingCheck: input.skipToolingCheck });
  if (preflight.kind !== "ok") {
    return { preflight, sync: null, build: null, mode: input.mode, ready: false };
  }

  const sync = await runSync({ source, runtime, dryRun: input.mode === "dry-run" });
  if (sync.kind !== "ok") {
    return { preflight, sync, build: null, mode: input.mode, ready: false };
  }

  if (input.mode === "dry-run" || input.runBuildStep === false) {
    return { preflight, sync, build: null, mode: input.mode, ready: false };
  }

  const build = await runBuild({ runtime, runInstall: true, minBundleBytes });
  const ready = build.kind === "ok";
  return { preflight, sync, build, mode: input.mode, ready };
}

export { RUNTIME_DEPLOY_PATHS } from "@/utils/runtime-deploy/paths";
export { formatReport } from "@/utils/runtime-deploy/report";
export type { DeployReport } from "@/utils/runtime-deploy/types";
```

**Verify:** `bun test tests/utils/runtime-deploy/index.test.ts`
**Commit:** `feat(runtime-deploy): add deploy orchestrator`

### Task 3.2: CLI entry script
**File:** `scripts/deploy-runtime.ts`
**Test:** none (thin CLI; orchestrator covers logic)
**Depends:** 3.1
**Domain:** general

```typescript
#!/usr/bin/env bun
// scripts/deploy-runtime.ts
// CLI entry: parses --dry-run / --force, runs the orchestrator, prints the
// formatted report, exits 0 on ready and 1 otherwise. NEVER restarts OpenCode.

import { formatReport, runRuntimeDeploy } from "@/utils/runtime-deploy";

interface Flags {
  readonly mode: "dry-run" | "apply";
  readonly force: boolean;
}

function parseFlags(argv: readonly string[]): Flags {
  const args = new Set(argv.slice(2));
  return {
    mode: args.has("--dry-run") ? "dry-run" : "apply",
    force: args.has("--force"),
  };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  const report = await runRuntimeDeploy({ mode: flags.mode, force: flags.force });
  process.stdout.write(formatReport(report));
  process.exit(report.ready || flags.mode === "dry-run" ? 0 : 1);
}

await main();
```

**Verify:** `bun run typecheck && bun scripts/deploy-runtime.ts --dry-run` (the dry-run will probe real paths; expected exit 0 even when nothing happens)
**Commit:** `feat(runtime-deploy): add deploy-runtime CLI entry`

---

## Batch 4: Docs and Policy (parallel - 6 implementers)

All tasks in this batch depend on Batch 3 completing (so referenced paths exist).
Tasks: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6

### Task 4.1: README runtime-deploy section
**File:** `README.md`
**Test:** none (docs)
**Depends:** 3.2
**Domain:** general

Modify `README.md` by appending a new section near the bottom (after the existing Local runtime path note if present, otherwise before the License section). Keep the rest of the file untouched.

Append this section (the implementer should locate the most appropriate header position; if a "Local runtime path note" already exists in README.md, place this immediately under it):

```markdown
## Runtime deploy helper

When you change runtime-sensitive plugin code in `/root/CODE/micode`, the live OpenCode plugin at `/root/.micode` does not pick it up automatically. Use the helper:

```sh
# Preview what would change
bun run deploy:runtime -- --dry-run

# Sync, install (if needed), build, and verify the live bundle
bun run deploy:runtime
```

The helper does NOT restart OpenCode. After it prints `Runtime ready. Restart of OpenCode requires explicit user approval.`, ask the user before running any restart command.

The helper preserves runtime-local state in `/root/.micode`: `node_modules`, `dist` (rebuilt by the helper), `.git`, `thoughts`, and environment files are never overwritten by the sync.
```

**Verify:** open the file and confirm the new section is present with no other diff.
**Commit:** `docs(runtime-deploy): add helper section to README`

### Task 4.2: ARCHITECTURE runtime path expansion
**File:** `ARCHITECTURE.md`
**Test:** none (docs)
**Depends:** 3.2
**Domain:** general

Locate the existing `### Local runtime path note` section in `ARCHITECTURE.md` (around line 210). Append the following paragraph at the end of that section, leaving the original lines untouched:

```markdown
The repo ships a deployment helper at `scripts/deploy-runtime.ts`, exposed as `bun run deploy:runtime`. The helper performs preflight checks (clean source, clean runtime, required tools), an `rsync` with the runtime-local exclusion list (`node_modules`, `dist`, `.git`, `thoughts`, env files, etc.), `bun install --frozen-lockfile` when the lockfile changed, `bun run build`, and a sanity check on `/root/.micode/dist/index.js`. The helper never restarts OpenCode: its successful end state is the printed line `Runtime ready. Restart of OpenCode requires explicit user approval.` See `docs/runtime-deploy.md` for the full operational rule.
```

**Verify:** confirm the addition is appended to the existing section, not inserted elsewhere.
**Commit:** `docs(runtime-deploy): expand local runtime path note in ARCHITECTURE`

### Task 4.3: CLAUDE.md three-step rule
**File:** `CLAUDE.md`
**Test:** none (docs)
**Depends:** 3.2
**Domain:** general

In `CLAUDE.md`, find the `## Local OpenCode Runtime` section (around line 121). Replace the existing bullet that reads:

```
- For runtime-sensitive fixes, sync the change into `/root/.micode`, run `bun run build` there, then restart OpenCode only after explicit user approval.
```

with this expanded block (preserving the surrounding bullets):

```markdown
- For runtime-sensitive fixes, follow the three-step rule: (1) run `bun run deploy:runtime` to sync `/root/CODE/micode -> /root/.micode` and rebuild; (2) verify the helper printed `Runtime ready. Restart of OpenCode requires explicit user approval.`; (3) ask the user before any restart. The helper handles preflight, selective sync (preserving `node_modules`, `thoughts`, `.git`, and env files in `/root/.micode`), install, build, and bundle verification. Do NOT call `bun run build` ad hoc on the dev checkout for runtime fixes: the dev checkout's `dist/` is not what OpenCode loads.
```

Also update the bullet in the "Tooling" section that currently reads:

```
- Run `bun run check` after substantive changes. If build/runtime-sensitive code changed, also run `bun run build`
```

to:

```markdown
- Run `bun run check` after substantive changes. If runtime-sensitive code changed, run `bun run deploy:runtime` (which calls `bun run build` in the live runtime) instead of `bun run build` on the dev checkout.
```

**Verify:** confirm both bullets are updated and no surrounding content was accidentally edited.
**Commit:** `docs(runtime-deploy): codify three-step rule in CLAUDE.md`

### Task 4.4: package.json script wiring
**File:** `package.json`
**Test:** none (config)
**Depends:** 3.2
**Domain:** general

Add a single new script entry to the `"scripts"` object in `package.json`. Place it after the existing `"clean"` entry (or at the end of the scripts block if `"clean"` is last). Do not change any other field.

New entry:

```json
"deploy:runtime": "bun scripts/deploy-runtime.ts"
```

The resulting scripts block must remain valid JSON with a trailing comma only where the existing format already requires one. After editing, confirm the file parses by running `bun -e "JSON.parse(require('fs').readFileSync('package.json','utf8'))"`.

**Verify:** `bun run deploy:runtime -- --dry-run` resolves the script and produces the helper's report (it may exit non-zero if real source/runtime are dirty; that is expected and not an error in this verification).
**Commit:** `chore(runtime-deploy): wire deploy:runtime script`

### Task 4.5: Dedicated runtime-deploy doc
**File:** `docs/runtime-deploy.md`
**Test:** none (docs)
**Depends:** 3.2
**Domain:** general

Create the directory `docs/` if it does not exist, then write this file:

```markdown
# Runtime Deploy Helper

This document is the source of truth for moving runtime-sensitive plugin changes from `/root/CODE/micode` (development checkout) to `/root/.micode` (live OpenCode plugin).

## When to use

Use the helper when your change affects code that OpenCode actually executes at runtime:

- Anything under `src/` that ends up in `dist/index.js`.
- Plugin command behaviour, hook handlers, tool implementations, agent configs.
- Anything documented under "Local OpenCode Runtime" in `CLAUDE.md`.

You do NOT need to use the helper for:

- Documentation-only changes.
- Changes confined to `thoughts/`, `tests/`, or other non-bundled paths.
- Lifecycle metadata edits (issue body, PR description).

## Three-step rule

1. **Sync and build.** Run `bun run deploy:runtime`. The helper performs preflight checks, an rsync that preserves runtime-local state, dependency install when needed, and `bun run build` in the runtime checkout.
2. **Verify readiness.** The helper prints a structured report. Look for the line `Runtime ready. Restart of OpenCode requires explicit user approval.` Anything else means the deployment is not ready.
3. **Ask before restart.** The helper deliberately never restarts OpenCode. Surface the readiness state to the user and wait for explicit approval before any restart command.

## Modes

- `bun run deploy:runtime -- --dry-run` previews the rsync without writing.
- `bun run deploy:runtime` is the apply mode (default).
- `bun run deploy:runtime -- --force` allows applying when the runtime checkout has uncommitted changes. Use only when you have inspected what is dirty.

## What is preserved in `/root/.micode`

The sync explicitly excludes the following paths so runtime-local state is not clobbered:

- `node_modules`
- `dist` (rebuilt by the helper itself)
- `.git`
- `thoughts`
- `coverage`, `.turbo`, `.cache`
- `*.log`
- `.env`, `.env.*`

If you need to sync one of these, do it manually and out-of-band; the helper will not touch them.

## Failure modes

- **Source dirty:** commit or stash in `/root/CODE/micode` first. The helper refuses to copy uncommitted source.
- **Runtime dirty:** inspect `/root/.micode` for unexpected local edits. Rerun with `--force` only if those edits are safe to lose.
- **rsync or bun missing:** install on PATH; the helper does not silently degrade.
- **Build failure:** read the build stderr surfaced in the report. The previous runtime bundle remains in place.
- **Verification failure:** `dist/index.js` is missing or smaller than 1 KB. Treat as a failed build.

## Anti-patterns

- Running `bun run build` only in `/root/CODE/micode/` and assuming OpenCode reloaded.
- Restarting OpenCode without an explicit approval in the current conversation.
- Editing files in `/root/.micode` directly: any change there will be overwritten on the next sync unless it is in the preserved list.
```

**Verify:** confirm the file is written at `docs/runtime-deploy.md` and is valid Markdown.
**Commit:** `docs(runtime-deploy): add dedicated operational doc`

### Task 4.6: Global AGENTS.md patch document (out-of-band)
**File:** `docs/global-agents-md-patch.md`
**Test:** none (docs)
**Depends:** 3.2
**Domain:** general

The global file `/root/.config/opencode/AGENTS.md` is OUTSIDE this repo. We do NOT edit it as part of this lifecycle commit. Instead, we ship a reviewable patch document the user (or a follow-up step) can apply manually.

Create `docs/global-agents-md-patch.md` with the following content:

```markdown
# Patch: Need-First Critical Thinking Policy for global AGENTS.md

**Target file (OUTSIDE this repo):** `/root/.config/opencode/AGENTS.md`

**Scope:** add a new top-level section codifying need-first critical thinking. Do NOT modify or remove existing sections.

**Pre-edit step (REQUIRED):** make a timestamped backup before applying.

```sh
cp /root/.config/opencode/AGENTS.md \
   /root/.config/opencode/AGENTS.md.bak.$(date +%Y%m%d-%H%M%S)-pre-need-first
```

## Insertion point

Insert the new section BETWEEN the existing `## Decision Autonomy` section and the existing `## Interactive Question Tools (v9: chat-first, Octto for heavy)` section. This keeps it adjacent to the autonomy rules it refines.

## Section to insert

```markdown
## Need-First Critical Thinking

The user's underlying NEED is the source of truth. The user's proposed IMPLEMENTATION is a candidate, not automatically the best path.

When a request bundles both a need and a proposed solution:

1. Identify and lock the need. Restate it in one sentence if it is non-obvious.
2. Evaluate the proposed solution against safety, maintainability, fit with the existing architecture, and simplicity.
3. If the proposal is sound, proceed and say so briefly.
4. If a clearly better path exists, name it, explain the trade-off in one or two sentences, and recommend it. Stay aligned with the original need.
5. If the user explicitly insists on their original approach after the trade-off has been surfaced, follow it, unless it is unsafe, impossible, or violates an existing hard rule (ownership pre-flight, no auto-restart, secret hygiene, project memory write rules).

This rule does NOT license open-ended pushback. It applies only when there is a meaningful, defensible alternative. For trivial or already-correct proposals, just execute.

Do NOT use this rule to:

- Re-litigate decisions the user has already approved in the same conversation.
- Block on philosophical preference when the proposal is materially fine.
- Replace explicit `Decision Autonomy` rules above. When `Decision Autonomy` says "decide yourself", decide; do not surface every micro-choice as a critical-thinking moment.
```

## Verification after applying

1. Confirm the backup file exists in `/root/.config/opencode/`.
2. Confirm the new section sits between `## Decision Autonomy` and `## Interactive Question Tools`.
3. Confirm no other section was renamed, removed, or reordered.
4. Restart of OpenCode is NOT required for global `AGENTS.md` changes; the file is re-read per session.

## Why this is shipped as a patch document

Editing `/root/.config/opencode/AGENTS.md` from inside a repo lifecycle would mix two write surfaces (the repo and the OpenCode config home), which we deliberately keep separate to avoid accidentally committing host-specific config into the repo or pushing unrelated changes. The patch document keeps the change reviewable and reversible.
```

**Verify:** confirm the file exists at `docs/global-agents-md-patch.md` and that the embedded patch instructions clearly state the file is outside the repo and require backup before edit.
**Commit:** `docs(policy): add patch doc for global AGENTS.md need-first rule`

---

## Out-of-band Step (NOT a repo task)

After this plan is implemented, committed, and merged, the user (or a follow-up agent acting on explicit user approval) should:

1. Read `docs/global-agents-md-patch.md`.
2. Run the backup command shown there.
3. Apply the section insertion exactly as specified.
4. Verify section ordering.

This step is intentionally OUTSIDE the repo lifecycle. The implementer of this plan MUST NOT silently edit `/root/.config/opencode/AGENTS.md`.

---

## Final Handoff Notes for the Executor

- The work is single-domain (`general`). Dispatch all tasks to `implementer-general`.
- Batches 1-3 are pure code; Batch 4 is docs and config wiring. Batch 4 cannot start until Batch 3 lands because `bun run deploy:runtime` must resolve to a real script before the docs reference it.
- After all batches commit, the executor should run `bun run check` once to confirm Biome, ESLint, typecheck, and the full test suite pass on the new modules.
- The executor MUST NOT run `bun run deploy:runtime` itself as a verification step. That helper writes to `/root/.micode` and is part of the live runtime; running it is a user-facing action, not a CI verification. Type-check and unit tests are sufficient.
- The global `AGENTS.md` change is shipped as a doc patch only; do not edit the global file as part of `lifecycle_commit`.
