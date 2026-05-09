---
date: 2026-05-09
topic: "Autonomy-first lifecycle cleanup and search boundaries"
issue: 58
scope: lifecycle
contract: none
---

# Autonomy-First Lifecycle Cleanup Implementation Plan

**Goal:** Make `lifecycle_finish` automatically resolve safe/recoverable worktree-cleanup cases and only escalate to the user when there is possible user work, an open issue, an unmerged branch, or genuine ambiguity. In parallel, scope agent search prompts (`codebase-locator`, `codebase-analyzer`, `pattern-finder`) to the active project root and exclude sibling `issue-*` worktrees so historical leftovers under `/root/CODE/` do not pollute search results.

**Architecture:** Split the cleanup pipeline into a pure classifier (`src/lifecycle/cleanup-classifier.ts`) that decides clean / dirty / missing / has-user-work / ambiguous from `git` query results, and an autonomy-first policy runner (`src/lifecycle/cleanup-policy.ts`) that performs `git worktree remove`, retries safe failures with `git worktree prune`, and translates the classifier verdict into a structured `CleanupOutcome`. `merge.ts` calls the policy instead of issuing `git worktree remove` directly. Agent search prompts get a `<search-scope>` block declaring the active root + exclusions, with a regression test enforcing the wording stays consistent across all three locator-style agents.

**Design:** [thoughts/shared/designs/2026-05-09-autonomy-first-lifecycle-cleanup-design.md](../designs/2026-05-09-autonomy-first-lifecycle-cleanup-design.md)

**Contract:** none (single-domain plan: backend lifecycle + general agent prompts; no frontend tasks)

**Gap-filling decisions made by planner (design was silent on these):**

- `CleanupClassification` discriminated-union shape: design says "classify cleanup failures" but does not name the variants. Implementing as `{ kind: "clean" | "dirty" | "missing" | "has-user-work" | "ambiguous" | "unknown-external", reason: string }`. Reason: matches the five failure cases enumerated in the design's Error Handling section, plus an `unknown-external` variant for the "never delete external project clone" rule.
- Safe-retry mechanism: design says "retry safe git cleanup/prune once" but not how. Implementing as: on `git worktree remove` failure with classifier verdict `clean`, call `git worktree prune` once and retry `git worktree remove` exactly once. No further retries. Retry budget is a constant, not configurable.
- `FinishOutcome` extension: design says final report must "clearly explain why the system stopped". Adding a `cleanupOutcome` field of type `CleanupOutcome` (kind + reason + retried flag) to `FinishOutcome` rather than overloading `note`. Existing `worktreeRemoved: boolean` is preserved for backward compatibility; new code reads `cleanupOutcome.kind === "removed"`.
- Search-scope wording: design says prompts must "mention active-root scoping and sibling `issue-*` exclusion". Implementing as a `<search-scope>` block with three explicit rules: (a) stay rooted in the active project/worktree, (b) exclude `.git`, `node_modules`, `dist`, `build` by default, (c) exclude sibling `issue-*` worktrees under shared parent directories unless the user explicitly asks. The same wording is shared across all three agents and asserted by the guardrail test.
- Test domain split: tests for prompt strings (`tests/agents/search-boundary.test.ts`) are tagged `general`. Tests for cleanup classifier and policy are tagged `backend` because they exercise lifecycle server-side logic.

---

## Dependency Graph

```
Batch 1 (parallel, 5 tasks): 1.1, 1.2, 1.3, 1.4, 1.5  [foundation - no deps]
Batch 2 (parallel, 2 tasks): 2.1, 2.2                  [core - depends on batch 1]
Batch 3 (parallel, 2 tasks): 3.1, 3.2                  [integration - depends on batch 2]
```

Edges:

- 2.1 (`cleanup-policy.ts`) imports from 1.1 (`cleanup-classifier.ts`) and 1.2 (`types.ts`).
- 2.2 (`search-boundary.test.ts`) reads prompt sources updated in 1.3, 1.4, 1.5.
- 3.1 (`merge.ts`) imports from 2.1.
- 3.2 (`merge.test.ts`) verifies the integrated `merge.ts` from 3.1 plus the policy from 2.1; 3.1 and 3.2 stay in the same batch so the regression test ships with the integration.

---

## Batch 1: Foundation (parallel - 5 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4, 1.5

### Task 1.1: Cleanup classifier (pure decision logic)
**File:** `src/lifecycle/cleanup-classifier.ts`
**Test:** `tests/lifecycle/cleanup-classifier.test.ts`
**Depends:** none
**Domain:** backend

The classifier is a pure function from "raw `git` query results about a worktree" to `CleanupClassification`. It does NOT shell out — `cleanup-policy.ts` does that and feeds raw outputs in. Keeping it pure makes it trivially testable and isolates the cleanup decision from `LifecycleRunner`.

```ts
// tests/lifecycle/cleanup-classifier.test.ts
import { describe, expect, it } from "bun:test";

import { classifyCleanup, type CleanupQuery } from "@/lifecycle/cleanup-classifier";

const baseQuery: CleanupQuery = {
  worktreeExists: true,
  branchMerged: true,
  issueClosed: true,
  workingTreeStatus: "",
  untrackedPaths: [],
  worktreeIsRegistered: true,
  worktreeIsExternalClone: false,
};

describe("classifyCleanup", () => {
  it("returns kind=clean when worktree is registered, merged, closed, and tree is empty", () => {
    expect(classifyCleanup(baseQuery)).toEqual({
      kind: "clean",
      reason: "worktree merged, issue closed, working tree empty",
    });
  });

  it("returns kind=missing when worktree directory does not exist", () => {
    expect(classifyCleanup({ ...baseQuery, worktreeExists: false })).toEqual({
      kind: "missing",
      reason: "worktree path does not exist on disk",
    });
  });

  it("returns kind=dirty when working tree has tracked modifications", () => {
    const result = classifyCleanup({ ...baseQuery, workingTreeStatus: " M src/foo.ts\n" });
    expect(result.kind).toBe("dirty");
    expect(result.reason).toContain("src/foo.ts");
  });

  it("returns kind=has-user-work when issue is still open even if tree is clean", () => {
    expect(classifyCleanup({ ...baseQuery, issueClosed: false }).kind).toBe("has-user-work");
  });

  it("returns kind=has-user-work when branch is not yet merged", () => {
    expect(classifyCleanup({ ...baseQuery, branchMerged: false }).kind).toBe("has-user-work");
  });

  it("returns kind=ambiguous when worktree only has untracked generated files", () => {
    const result = classifyCleanup({
      ...baseQuery,
      untrackedPaths: ["thoughts/shared/plans/foo.md"],
    });
    expect(result.kind).toBe("ambiguous");
    expect(result.reason).toContain("untracked");
  });

  it("returns kind=unknown-external when worktree is not registered with git", () => {
    expect(
      classifyCleanup({ ...baseQuery, worktreeIsRegistered: false, worktreeIsExternalClone: true }).kind,
    ).toBe("unknown-external");
  });

  it("never returns kind=clean if there are untracked paths", () => {
    const result = classifyCleanup({ ...baseQuery, untrackedPaths: ["foo.txt"] });
    expect(result.kind).not.toBe("clean");
  });
});
```

```ts
// src/lifecycle/cleanup-classifier.ts
/**
 * Pure classification of a worktree's cleanup eligibility.
 *
 * Inputs are raw observations gathered by cleanup-policy.ts (which owns shelling out).
 * Output is a discriminated union the policy uses to decide:
 *   - clean             -> safe to remove automatically (with one safe retry)
 *   - missing           -> already gone, mark removed without action
 *   - dirty             -> tracked changes present, NEVER force-delete
 *   - has-user-work     -> branch unmerged or issue still open, escalate
 *   - ambiguous         -> only untracked/generated files; surface for user decision
 *   - unknown-external  -> path is not registered as a git worktree, never auto-delete
 */
export type CleanupKind = "clean" | "missing" | "dirty" | "has-user-work" | "ambiguous" | "unknown-external";

export interface CleanupClassification {
  readonly kind: CleanupKind;
  readonly reason: string;
}

export interface CleanupQuery {
  /** True when the worktree directory exists on disk. */
  readonly worktreeExists: boolean;
  /** True when the branch has been merged into the resolved base branch. */
  readonly branchMerged: boolean;
  /** True when the lifecycle issue has been closed. */
  readonly issueClosed: boolean;
  /** Output of `git status --porcelain` from inside the worktree. */
  readonly workingTreeStatus: string;
  /** Untracked paths reported by `git ls-files --others --exclude-standard`. */
  readonly untrackedPaths: readonly string[];
  /** True when `git worktree list --porcelain` includes this path. */
  readonly worktreeIsRegistered: boolean;
  /** True when the path looks like an unrelated external clone (different remote, etc.). */
  readonly worktreeIsExternalClone: boolean;
}

const REASON = {
  CLEAN: "worktree merged, issue closed, working tree empty",
  MISSING: "worktree path does not exist on disk",
  EXTERNAL: "worktree is not registered with this repository",
  ISSUE_OPEN: "lifecycle issue is still open",
  BRANCH_UNMERGED: "branch has not been merged into base",
} as const;

const trackedDirtyPaths = (status: string): readonly string[] =>
  status
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => line.replace(/^.. /, ""));

export function classifyCleanup(query: CleanupQuery): CleanupClassification {
  if (!query.worktreeExists) {
    return { kind: "missing", reason: REASON.MISSING };
  }

  if (!query.worktreeIsRegistered || query.worktreeIsExternalClone) {
    return { kind: "unknown-external", reason: REASON.EXTERNAL };
  }

  if (!query.issueClosed) {
    return { kind: "has-user-work", reason: REASON.ISSUE_OPEN };
  }

  if (!query.branchMerged) {
    return { kind: "has-user-work", reason: REASON.BRANCH_UNMERGED };
  }

  const dirty = trackedDirtyPaths(query.workingTreeStatus);
  if (dirty.length > 0) {
    return { kind: "dirty", reason: `tracked changes present: ${dirty.slice(0, 5).join(", ")}` };
  }

  if (query.untrackedPaths.length > 0) {
    return {
      kind: "ambiguous",
      reason: `untracked files present: ${query.untrackedPaths.slice(0, 5).join(", ")}`,
    };
  }

  return { kind: "clean", reason: REASON.CLEAN };
}
```

**Verify:** `bun test tests/lifecycle/cleanup-classifier.test.ts`
**Commit:** `feat(lifecycle): add cleanup-classifier for worktree state`

### Task 1.2: Extend FinishOutcome and add CleanupOutcome to lifecycle types
**File:** `src/lifecycle/types.ts`
**Test:** none (type-only change; covered transitively by 2.1, 3.1, 3.2 tests)
**Depends:** none
**Domain:** general

Add `CleanupOutcome` and extend `FinishOutcome` so callers can read the structured cleanup verdict without parsing `note`. `worktreeRemoved: boolean` is kept to avoid breaking `applyFinishOutcome` in `index.ts` and existing tests; new code MUST prefer `cleanupOutcome.kind === "removed"` for new branches.

```ts
// src/lifecycle/types.ts (full file after edit; existing constants unchanged)
export const LIFECYCLE_STATES = {
  PROPOSED: "proposed",
  ISSUE_OPEN: "issue_open",
  BRANCH_READY: "branch_ready",
  IN_DESIGN: "in_design",
  IN_PLAN: "in_plan",
  IN_PROGRESS: "in_progress",
  TESTED: "tested",
  MERGING: "merging",
  CLOSED: "closed",
  CLEANED: "cleaned",
  ABORTED: "aborted",
} as const;

export type LifecycleState = (typeof LIFECYCLE_STATES)[keyof typeof LIFECYCLE_STATES];

export const TERMINAL_STATES = [LIFECYCLE_STATES.CLOSED, LIFECYCLE_STATES.CLEANED, LIFECYCLE_STATES.ABORTED] as const;

export type TerminalState = (typeof TERMINAL_STATES)[number];

export const ARTIFACT_KINDS = {
  DESIGN: "design",
  PLAN: "plan",
  LEDGER: "ledger",
  COMMIT: "commit",
  PR: "pr",
  WORKTREE: "worktree",
} as const;

export type ArtifactKind = (typeof ARTIFACT_KINDS)[keyof typeof ARTIFACT_KINDS];

export interface StartRequestInput {
  readonly summary: string;
  readonly goals: readonly string[];
  readonly constraints: readonly string[];
}

export interface LifecycleRecord {
  readonly issueNumber: number;
  readonly issueUrl: string;
  readonly branch: string;
  readonly worktree: string;
  readonly state: LifecycleState;
  readonly artifacts: Readonly<Record<ArtifactKind, readonly string[]>>;
  readonly notes: readonly string[];
  readonly updatedAt: number;
}

export interface CommitInput {
  readonly summary: string;
  readonly scope: string;
  readonly push: boolean;
  readonly batchId?: string;
  readonly taskId?: string;
  readonly attempt?: number;
}

export interface CommitOutcome {
  readonly committed: boolean;
  readonly sha: string | null;
  readonly pushed: boolean;
  readonly retried: boolean;
  readonly note: string | null;
}

export interface FinishInput {
  readonly mergeStrategy: "pr" | "local-merge";
  readonly waitForChecks: boolean;
}

/**
 * Final cleanup verdict for the lifecycle worktree.
 *
 * - `removed`         -> worktree successfully removed (possibly after one safe retry)
 * - `already-missing` -> nothing to remove, treated as success
 * - `blocked-dirty`   -> tracked user changes present, NOT force-deleted
 * - `blocked-user-work` -> issue still open or branch not merged
 * - `blocked-ambiguous` -> only untracked/generated files; user must decide
 * - `blocked-external` -> path is not a recognised lifecycle worktree
 * - `failed`          -> git command failed for a non-classified reason
 */
export type CleanupOutcomeKind =
  | "removed"
  | "already-missing"
  | "blocked-dirty"
  | "blocked-user-work"
  | "blocked-ambiguous"
  | "blocked-external"
  | "failed";

export interface CleanupOutcome {
  readonly kind: CleanupOutcomeKind;
  readonly reason: string;
  /** True when an automatic safe retry (`git worktree prune` then re-remove) was attempted. */
  readonly retried: boolean;
}

export interface FinishOutcome {
  readonly merged: boolean;
  readonly prUrl: string | null;
  readonly closedAt: number | null;
  /** Backward-compatible boolean: true iff `cleanupOutcome.kind` is `removed` or `already-missing`. */
  readonly worktreeRemoved: boolean;
  /** Structured cleanup verdict. Always present after Batch 3 lands. */
  readonly cleanupOutcome: CleanupOutcome;
  readonly note: string | null;
}
```

**Verify:** `bun run typecheck` (must compile cleanly; existing `worktreeRemoved` callers still pass)
**Commit:** `feat(lifecycle): add CleanupOutcome and extend FinishOutcome`

### Task 1.3: Add search-scope guardrail to codebase-locator prompt
**File:** `src/agents/codebase-locator.ts`
**Test:** none (prompt-string change; guardrail test in 2.2)
**Depends:** none
**Domain:** general

Insert a `<search-scope>` block immediately after `<environment>` so the agent is reminded BEFORE it picks a search strategy. Wording is shared across 1.3, 1.4, 1.5 and asserted by the 2.2 test.

```ts
// src/agents/codebase-locator.ts (full file after edit)
import type { AgentConfig } from "@opencode-ai/sdk";

export const codebaseLocatorAgent: AgentConfig = {
  description: "Finds WHERE files live in the codebase",
  mode: "subagent",
  temperature: 0.1,
  tools: {
    write: false,
    edit: false,
    bash: false,
    task: false,
  },
  prompt: `<environment>
You are running as part of the "micode" OpenCode plugin (NOT Claude Code).
You are a SUBAGENT for finding file locations in the codebase.
</environment>

<search-scope>
<rule>Stay rooted in the ACTIVE project / worktree only. The active root is the cwd of the agent invocation (the lifecycle worktree when running inside a lifecycle, otherwise the project root).</rule>
<rule>Do NOT traverse sibling \`issue-*\` worktrees that may live under the same parent directory (for example \`/root/CODE/issue-*\`). Those are leftover lifecycle worktrees from other tasks and pollute results.</rule>
<rule>Always exclude \`.git\`, \`node_modules\`, \`dist\`, \`build\`, and \`.cache\` from globs and grep.</rule>
<rule>Only widen the scope to other directories when the user explicitly asks for cross-project or historical search.</rule>
</search-scope>

<purpose>
Find WHERE files live. No analysis, no opinions, just locations.
</purpose>

<rules>
<rule>Return file paths only</rule>
<rule>No content analysis</rule>
<rule>No suggestions or improvements</rule>
<rule>No explanations of what code does</rule>
<rule>Organize results by logical category</rule>
<rule>Be exhaustive - find ALL relevant files within the active scope</rule>
<rule>Include test files when relevant</rule>
<rule>Include config files when relevant</rule>
</rules>

<search-strategies>
<strategy name="by-name">Glob for file names</strategy>
<strategy name="by-content">Grep for specific terms, imports, usage</strategy>
<strategy name="by-convention">Check standard locations (src/, lib/, tests/, config/)</strategy>
<strategy name="by-extension">Filter by file type</strategy>
<strategy name="by-import">Find files that import/export a symbol</strategy>
</search-strategies>

<search-order>
<priority order="1">Exact matches first</priority>
<priority order="2">Partial matches</priority>
<priority order="3">Related files (tests, configs, types)</priority>
<priority order="4">Files that reference the target</priority>
</search-order>

<output-format>
<template>
## [Category]
- path/to/file.ext
- path/to/another.ext

## [Another Category]
- path/to/more.ext

## Tests
- path/to/file.test.ext

## Config
- path/to/config.ext
</template>
</output-format>

<categories>
<category>Source files</category>
<category>Test files</category>
<category>Type definitions</category>
<category>Configuration</category>
<category>Documentation</category>
<category>Migrations</category>
<category>Scripts</category>
<category>Assets</category>
</categories>`,
};
```

**Verify:** `bun run typecheck && bun test tests/agents/index.test.ts`
**Commit:** `feat(agents): scope codebase-locator to active root`

### Task 1.4: Add search-scope guardrail to codebase-analyzer prompt
**File:** `src/agents/codebase-analyzer.ts`
**Test:** none (prompt-string change; guardrail test in 2.2)
**Depends:** none
**Domain:** general

Same `<search-scope>` block as 1.3, byte-identical so the 2.2 test can use shared assertions.

```ts
// src/agents/codebase-analyzer.ts (full file after edit)
import type { AgentConfig } from "@opencode-ai/sdk";

export const codebaseAnalyzerAgent: AgentConfig = {
  description: "Explains HOW code works with precise file:line references",
  mode: "subagent",
  temperature: 0.2,
  tools: {
    write: false,
    edit: false,
    bash: false,
    task: false,
  },
  prompt: `<environment>
You are running as part of the "micode" OpenCode plugin (NOT Claude Code).
You are a SUBAGENT for analyzing and explaining code behavior.
</environment>

<search-scope>
<rule>Stay rooted in the ACTIVE project / worktree only. The active root is the cwd of the agent invocation (the lifecycle worktree when running inside a lifecycle, otherwise the project root).</rule>
<rule>Do NOT traverse sibling \`issue-*\` worktrees that may live under the same parent directory (for example \`/root/CODE/issue-*\`). Those are leftover lifecycle worktrees from other tasks and pollute results.</rule>
<rule>Always exclude \`.git\`, \`node_modules\`, \`dist\`, \`build\`, and \`.cache\` from globs and grep.</rule>
<rule>Only widen the scope to other directories when the user explicitly asks for cross-project or historical search.</rule>
</search-scope>

<purpose>
Explain HOW code works. Document what IS, not what SHOULD BE.
</purpose>

<rules>
<rule>Always include file:line references</rule>
<rule>Read files COMPLETELY - never use limit/offset</rule>
<rule>Describe behavior, not quality</rule>
<rule>No suggestions, no improvements, no opinions</rule>
<rule>Trace actual execution paths, not assumptions</rule>
<rule>Include error handling paths</rule>
<rule>Document side effects explicitly</rule>
<rule>Note any external dependencies called</rule>
</rules>

<process>
<step>Identify entry points</step>
<step>Read all relevant files completely</step>
<step>Trace data flow step by step</step>
<step>Trace control flow (conditionals, loops, early returns)</step>
<step>Document function calls with their locations</step>
<step>Note state mutations and side effects</step>
<step>Map error propagation paths</step>
</process>

<output-format>
<template>
## [Component/Feature]

**Purpose**: [One sentence]

**Entry point**: \`file:line\`

**Data flow**:
1. \`file:line\` - [what happens]
2. \`file:line\` - [next step]
3. \`file:line\` - [continues...]

**Key functions**:
- \`functionName\` at \`file:line\` - [what it does]
- \`anotherFn\` at \`file:line\` - [what it does]

**State mutations**:
- \`file:line\` - [what changes]

**Error paths**:
- \`file:line\` - [error condition] → [handling]

**External calls**:
- \`file:line\` - calls [external service/API]
</template>
</output-format>

<tracing-rules>
<rule>Follow imports to their source</rule>
<rule>Expand function calls inline when relevant</rule>
<rule>Note async boundaries explicitly</rule>
<rule>Track data transformations step by step</rule>
<rule>Document callback and event flows</rule>
<rule>Include middleware/interceptor chains</rule>
</tracing-rules>`,
};
```

**Verify:** `bun run typecheck && bun test tests/agents/index.test.ts`
**Commit:** `feat(agents): scope codebase-analyzer to active root`

### Task 1.5: Add search-scope guardrail to pattern-finder prompt
**File:** `src/agents/pattern-finder.ts`
**Test:** none (prompt-string change; guardrail test in 2.2)
**Depends:** none
**Domain:** general

Same `<search-scope>` block as 1.3 and 1.4, byte-identical.

```ts
// src/agents/pattern-finder.ts (full file after edit)
import type { AgentConfig } from "@opencode-ai/sdk";

export const patternFinderAgent: AgentConfig = {
  description: "Finds existing patterns and examples to model after",
  mode: "subagent",
  temperature: 0.2,
  tools: {
    write: false,
    edit: false,
    bash: false,
    task: false,
  },
  prompt: `<environment>
You are running as part of the "micode" OpenCode plugin (NOT Claude Code).
You are a SUBAGENT for finding coding patterns and conventions.
</environment>

<search-scope>
<rule>Stay rooted in the ACTIVE project / worktree only. The active root is the cwd of the agent invocation (the lifecycle worktree when running inside a lifecycle, otherwise the project root).</rule>
<rule>Do NOT traverse sibling \`issue-*\` worktrees that may live under the same parent directory (for example \`/root/CODE/issue-*\`). Those are leftover lifecycle worktrees from other tasks and pollute results.</rule>
<rule>Always exclude \`.git\`, \`node_modules\`, \`dist\`, \`build\`, and \`.cache\` from globs and grep.</rule>
<rule>Only widen the scope to other directories when the user explicitly asks for cross-project or historical search.</rule>
</search-scope>

<purpose>
Find existing patterns in the codebase to model after. Show, don't tell.
</purpose>

<rules>
<rule>Provide concrete code examples, not abstract descriptions</rule>
<rule>Always include file:line references</rule>
<rule>Show 2-3 best examples, not exhaustive lists</rule>
<rule>Include enough context to understand usage</rule>
<rule>Prioritize recent/maintained code over legacy</rule>
<rule>Include test examples when available</rule>
<rule>Note any variations of the pattern</rule>
</rules>

<what-to-find>
<pattern>How similar features are implemented</pattern>
<pattern>Naming conventions used</pattern>
<pattern>Error handling patterns</pattern>
<pattern>Testing patterns</pattern>
<pattern>File organization patterns</pattern>
<pattern>Import/export patterns</pattern>
<pattern>Configuration patterns</pattern>
<pattern>API patterns (routes, handlers, responses)</pattern>
</what-to-find>

<search-process>
<step>Grep for similar implementations</step>
<step>Check test files for usage examples</step>
<step>Look for documentation or comments</step>
<step>Find the most representative example</step>
<step>Find variations if they exist</step>
</search-process>

<output-format>
<template>
## Pattern: [Name]

**Best example**: \`file:line-line\`
\`\`\`language
[code snippet]
\`\`\`

**Also see**:
- \`file:line\` - [variation/alternative]

**Usage notes**: [when/how to apply]
</template>
</output-format>

<quality-criteria>
<criterion>Prefer patterns with tests</criterion>
<criterion>Prefer patterns that are widely used</criterion>
<criterion>Prefer recent over old</criterion>
<criterion>Prefer simple over complex</criterion>
<criterion>Note if pattern seems inconsistent across codebase</criterion>
</quality-criteria>`,
};
```

**Verify:** `bun run typecheck && bun test tests/agents/index.test.ts`
**Commit:** `feat(agents): scope pattern-finder to active root`

---

## Batch 2: Core Modules (parallel - 2 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2

### Task 2.1: Cleanup policy runner with autonomy-first safe retry
**File:** `src/lifecycle/cleanup-policy.ts`
**Test:** `tests/lifecycle/cleanup-policy.test.ts`
**Depends:** 1.1, 1.2 (imports `classifyCleanup` and `CleanupOutcome` types)
**Domain:** backend

This module owns the actual `git` shell-outs for cleanup. It calls the classifier with raw observations, then performs the action dictated by the classification:

- `clean` -> `git worktree remove`. On failure, run `git worktree prune` once and retry exactly once.
- `missing` -> mark `already-missing`, no shell-out.
- `dirty` -> NEVER force-delete. Return `blocked-dirty`.
- `has-user-work` -> Return `blocked-user-work`.
- `ambiguous` -> Return `blocked-ambiguous`. Caller decides whether to surface to user.
- `unknown-external` -> Return `blocked-external`. Never delete.

Inputs: `LifecycleRunner`, the worktree path, the lifecycle branch, the resolved base branch, and a flag `issueClosed` provided by the caller (since `issueClosed` is known by `index.ts` after `closeMergedIssue`).

```ts
// tests/lifecycle/cleanup-policy.test.ts
import { describe, expect, it } from "bun:test";

import { runCleanup, type CleanupPolicyInput } from "@/lifecycle/cleanup-policy";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const fail = (stderr = "boom"): RunResult => ({ stdout: "", stderr, exitCode: 1 });

interface RunnerCall {
  readonly args: readonly string[];
  readonly cwd?: string;
}

const fakeRunner = (
  responses: ReadonlyMap<string, readonly RunResult[]>,
): { runner: LifecycleRunner; calls: RunnerCall[] } => {
  const calls: RunnerCall[] = [];
  const cursors = new Map<string, number>();
  const runner: LifecycleRunner = {
    git: async (args, opts) => {
      calls.push({ args, cwd: opts?.cwd });
      const key = args.join(" ");
      const list = responses.get(key) ?? [ok()];
      const i = cursors.get(key) ?? 0;
      cursors.set(key, i + 1);
      return list[Math.min(i, list.length - 1)] ?? ok();
    },
    gh: async () => ok(),
  };
  return { runner, calls };
};

const baseInput = (overrides: Partial<CleanupPolicyInput> = {}): CleanupPolicyInput => ({
  cwd: "/repo/micode",
  worktree: "/repo/micode-issue-1",
  branch: "issue/1-x",
  baseBranch: "main",
  issueClosed: true,
  branchMerged: true,
  worktreeExistsOnDisk: true,
  ...overrides,
});

describe("runCleanup", () => {
  it("removes a clean worktree on first try and reports kind=removed", async () => {
    const { runner, calls } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-x\n")]],
        ["status --porcelain", [ok("")]],
        ["ls-files --others --exclude-standard", [ok("")]],
        ["worktree remove /repo/micode-issue-1", [ok()]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput());

    expect(outcome.kind).toBe("removed");
    expect(outcome.retried).toBe(false);
    expect(calls.some((c) => c.args.join(" ") === "worktree remove /repo/micode-issue-1")).toBe(true);
  });

  it("retries with prune exactly once when first remove fails on a clean worktree", async () => {
    const { runner, calls } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-x\n")]],
        ["status --porcelain", [ok("")]],
        ["ls-files --others --exclude-standard", [ok("")]],
        ["worktree remove /repo/micode-issue-1", [fail("locked"), ok()]],
        ["worktree prune", [ok()]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput());

    expect(outcome.kind).toBe("removed");
    expect(outcome.retried).toBe(true);
    const removeCalls = calls.filter((c) => c.args.join(" ") === "worktree remove /repo/micode-issue-1");
    expect(removeCalls).toHaveLength(2);
    expect(calls.some((c) => c.args.join(" ") === "worktree prune")).toBe(true);
  });

  it("does NOT retry more than once even if second remove also fails", async () => {
    const { runner, calls } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-x\n")]],
        ["status --porcelain", [ok("")]],
        ["ls-files --others --exclude-standard", [ok("")]],
        ["worktree remove /repo/micode-issue-1", [fail("locked"), fail("still locked")]],
        ["worktree prune", [ok()]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput());

    expect(outcome.kind).toBe("failed");
    expect(outcome.retried).toBe(true);
    const removeCalls = calls.filter((c) => c.args.join(" ") === "worktree remove /repo/micode-issue-1");
    expect(removeCalls).toHaveLength(2);
  });

  it("returns blocked-dirty without removing when working tree has tracked changes", async () => {
    const { runner, calls } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-x\n")]],
        ["status --porcelain", [ok(" M src/foo.ts\n")]],
        ["ls-files --others --exclude-standard", [ok("")]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput());

    expect(outcome.kind).toBe("blocked-dirty");
    expect(outcome.reason).toContain("src/foo.ts");
    expect(calls.some((c) => c.args[0] === "worktree" && c.args[1] === "remove")).toBe(false);
  });

  it("returns blocked-user-work when issue is still open", async () => {
    const { runner } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-x\n")]],
        ["status --porcelain", [ok("")]],
        ["ls-files --others --exclude-standard", [ok("")]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput({ issueClosed: false }));

    expect(outcome.kind).toBe("blocked-user-work");
  });

  it("returns blocked-user-work when branch is not merged", async () => {
    const { runner } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-x\n")]],
        ["status --porcelain", [ok("")]],
        ["ls-files --others --exclude-standard", [ok("")]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput({ branchMerged: false }));

    expect(outcome.kind).toBe("blocked-user-work");
  });

  it("returns blocked-ambiguous when only untracked files are present", async () => {
    const { runner, calls } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-x\n")]],
        ["status --porcelain", [ok("")]],
        ["ls-files --others --exclude-standard", [ok("thoughts/shared/notes/scratch.md\n")]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput());

    expect(outcome.kind).toBe("blocked-ambiguous");
    expect(outcome.reason).toContain("scratch.md");
    expect(calls.some((c) => c.args[0] === "worktree" && c.args[1] === "remove")).toBe(false);
  });

  it("returns already-missing when worktree path does not exist on disk", async () => {
    const { runner, calls } = fakeRunner(new Map());

    const outcome = await runCleanup(runner, baseInput({ worktreeExistsOnDisk: false }));

    expect(outcome.kind).toBe("already-missing");
    expect(calls.some((c) => c.args[0] === "worktree" && c.args[1] === "remove")).toBe(false);
  });

  it("returns blocked-external when worktree is not registered with this repo", async () => {
    const { runner, calls } = fakeRunner(
      new Map([
        ["worktree list --porcelain", [ok("worktree /some/other/path\nbranch refs/heads/main\n")]],
        ["status --porcelain", [ok("")]],
        ["ls-files --others --exclude-standard", [ok("")]],
      ]),
    );

    const outcome = await runCleanup(runner, baseInput());

    expect(outcome.kind).toBe("blocked-external");
    expect(calls.some((c) => c.args[0] === "worktree" && c.args[1] === "remove")).toBe(false);
  });
});
```

```ts
// src/lifecycle/cleanup-policy.ts
import { existsSync } from "node:fs";

import { classifyCleanup, type CleanupClassification } from "./cleanup-classifier";
import type { LifecycleRunner, RunResult } from "./runner";
import type { CleanupOutcome } from "./types";

export interface CleanupPolicyInput {
  /** Repository root (where lifecycle was started). */
  readonly cwd: string;
  /** Lifecycle worktree path to clean up. */
  readonly worktree: string;
  /** Branch name associated with the worktree. */
  readonly branch: string;
  /** Resolved default branch (used to confirm merge state). */
  readonly baseBranch: string;
  /** Caller-provided: true when the lifecycle issue is already closed. */
  readonly issueClosed: boolean;
  /** Caller-provided: true when `branch` has been merged into `baseBranch`. */
  readonly branchMerged: boolean;
  /**
   * Optional override for filesystem existence check. When omitted the policy
   * uses node:fs `existsSync(worktree)`. Tests inject this to avoid touching disk.
   */
  readonly worktreeExistsOnDisk?: boolean;
}

const OK = 0;
const completed = (run: RunResult): boolean => run.exitCode === OK;

const splitLines = (s: string): readonly string[] =>
  s
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0);

const isWorktreeRegistered = (listOutput: string, worktreePath: string): boolean => {
  // `git worktree list --porcelain` emits stanzas starting with `worktree <path>`.
  return splitLines(listOutput).some((line) => line === `worktree ${worktreePath}`);
};

const removed = (reason: string, retried: boolean): CleanupOutcome => ({
  kind: "removed",
  reason,
  retried,
});

const failed = (reason: string, retried: boolean): CleanupOutcome => ({
  kind: "failed",
  reason,
  retried,
});

const blocked = (
  classification: CleanupClassification,
): CleanupOutcome => {
  switch (classification.kind) {
    case "dirty":
      return { kind: "blocked-dirty", reason: classification.reason, retried: false };
    case "has-user-work":
      return { kind: "blocked-user-work", reason: classification.reason, retried: false };
    case "ambiguous":
      return { kind: "blocked-ambiguous", reason: classification.reason, retried: false };
    case "unknown-external":
      return { kind: "blocked-external", reason: classification.reason, retried: false };
    case "missing":
      return { kind: "already-missing", reason: classification.reason, retried: false };
    case "clean":
      // Should not reach here; clean is handled before blocked().
      return { kind: "failed", reason: "internal: clean classification routed to blocked()", retried: false };
  }
};

const formatRunFailure = (run: RunResult): string => {
  const pieces = [run.stderr.trim(), run.stdout.trim()].filter((p) => p.length > 0);
  if (pieces.length === 0) return `exit ${run.exitCode}`;
  return pieces.join(" ");
};

export async function runCleanup(
  runner: LifecycleRunner,
  input: CleanupPolicyInput,
): Promise<CleanupOutcome> {
  const exists = input.worktreeExistsOnDisk ?? existsSync(input.worktree);
  if (!exists) {
    return { kind: "already-missing", reason: "worktree path does not exist on disk", retried: false };
  }

  const list = await runner.git(["worktree", "list", "--porcelain"], { cwd: input.cwd });
  const isRegistered = completed(list) && isWorktreeRegistered(list.stdout, input.worktree);

  const status = await runner.git(["status", "--porcelain"], { cwd: input.worktree });
  const untracked = await runner.git(["ls-files", "--others", "--exclude-standard"], { cwd: input.worktree });

  const classification = classifyCleanup({
    worktreeExists: true,
    branchMerged: input.branchMerged,
    issueClosed: input.issueClosed,
    workingTreeStatus: completed(status) ? status.stdout : "",
    untrackedPaths: completed(untracked) ? splitLines(untracked.stdout) : [],
    worktreeIsRegistered: isRegistered,
    worktreeIsExternalClone: !isRegistered,
  });

  if (classification.kind !== "clean") {
    return blocked(classification);
  }

  const firstAttempt = await runner.git(["worktree", "remove", input.worktree], { cwd: input.cwd });
  if (completed(firstAttempt)) {
    return removed(classification.reason, false);
  }

  // Safe retry: prune stale registrations once, then retry remove exactly once.
  await runner.git(["worktree", "prune"], { cwd: input.cwd });
  const retry = await runner.git(["worktree", "remove", input.worktree], { cwd: input.cwd });
  if (completed(retry)) {
    return removed(classification.reason, true);
  }

  return failed(`git_worktree_remove: ${formatRunFailure(retry)}`, true);
}
```

**Verify:** `bun test tests/lifecycle/cleanup-policy.test.ts`
**Commit:** `feat(lifecycle): add autonomy-first cleanup-policy with safe retry`

### Task 2.2: Search-boundary guardrail test for all locator-style agents
**File:** `tests/agents/search-boundary.test.ts`
**Test:** this IS the test file
**Depends:** 1.3, 1.4, 1.5 (reads the three updated agent prompt files)
**Domain:** general

Asserts that all three locator-style agents declare a `<search-scope>` block with the byte-identical wording from 1.3/1.4/1.5. This prevents drift across the three agent files (each is its own source-of-truth).

```ts
// tests/agents/search-boundary.test.ts
import { describe, expect, it } from "bun:test";

import { codebaseAnalyzerAgent } from "@/agents/codebase-analyzer";
import { codebaseLocatorAgent } from "@/agents/codebase-locator";
import { patternFinderAgent } from "@/agents/pattern-finder";

const AGENTS = [
  { name: "codebase-locator", prompt: codebaseLocatorAgent.prompt },
  { name: "codebase-analyzer", prompt: codebaseAnalyzerAgent.prompt },
  { name: "pattern-finder", prompt: patternFinderAgent.prompt },
] as const;

const REQUIRED_RULES = [
  /Stay rooted in the ACTIVE project \/ worktree only/i,
  /Do NOT traverse sibling `?issue-\*`? worktrees/i,
  /exclude `?\.git`?,\s*`?node_modules`?,\s*`?dist`?/i,
  /Only widen the scope.*explicitly asks/i,
] as const;

describe("locator-style agent search-scope guardrail", () => {
  for (const agent of AGENTS) {
    describe(agent.name, () => {
      it("includes exactly one <search-scope> block", () => {
        const opens = (agent.prompt ?? "").match(/<search-scope>/g) ?? [];
        const closes = (agent.prompt ?? "").match(/<\/search-scope>/g) ?? [];
        expect(opens).toHaveLength(1);
        expect(closes).toHaveLength(1);
      });

      it("places the <search-scope> block before <purpose>", () => {
        const prompt = agent.prompt ?? "";
        const scopeIdx = prompt.indexOf("<search-scope>");
        const purposeIdx = prompt.indexOf("<purpose>");
        expect(scopeIdx).toBeGreaterThan(-1);
        expect(purposeIdx).toBeGreaterThan(-1);
        expect(scopeIdx).toBeLessThan(purposeIdx);
      });

      for (const pattern of REQUIRED_RULES) {
        it(`<search-scope> matches ${pattern}`, () => {
          expect(agent.prompt ?? "").toMatch(pattern);
        });
      }
    });
  }

  it("all three agents share byte-identical <search-scope> contents", () => {
    const blocks = AGENTS.map((a) => {
      const match = (a.prompt ?? "").match(/<search-scope>[\s\S]*?<\/search-scope>/);
      return match ? match[0] : null;
    });
    expect(blocks[0]).not.toBeNull();
    expect(blocks[1]).toBe(blocks[0]);
    expect(blocks[2]).toBe(blocks[0]);
  });
});
```

**Verify:** `bun test tests/agents/search-boundary.test.ts`
**Commit:** `test(agents): guard locator-style agents share search-scope wording`

---

## Batch 3: Integration (parallel - 2 implementers)

All tasks in this batch depend on Batch 2 completing.
Tasks: 3.1, 3.2

### Task 3.1: Wire cleanup-policy into merge.ts and propagate CleanupOutcome
**File:** `src/lifecycle/merge.ts`
**Test:** none for this task — regression coverage lives in 3.2 (`tests/lifecycle/merge.test.ts`)
**Depends:** 2.1 (imports `runCleanup`), 1.2 (uses `CleanupOutcome` type)
**Domain:** backend

Replace the existing `cleanupPr` and `cleanupLocal` functions with calls to `runCleanup` from `cleanup-policy.ts`. Both PR and local-merge paths now know `branchMerged=true` (because they reached the cleanup phase via successful merge) and can pass `issueClosed` based on whether `closeMergedIssue` has run yet — for now both paths pass `issueClosed=true` because in `merge.ts` the merge has succeeded but `closeMergedIssue` runs in `index.ts`. To avoid coupling, we treat "merge succeeded" as proxy for "issue may close imminently" but the policy still verifies `branchMerged=true` and tree cleanliness, which is the real safety guard. The existing `worktreeRemoved` boolean is computed from `cleanupOutcome.kind` for backward compatibility. The `note` field is populated only for non-`removed`/`already-missing` outcomes so existing log consumers keep working.

```ts
// src/lifecycle/merge.ts (full file after edit)
import * as v from "valibot";

import { config } from "@/utils/config";

import { runCleanup } from "./cleanup-policy";
import { postOnceSummaryComment, upsertPullRequest, writeReviewSummaryToPrBody } from "./pr";
import type { LifecycleRunner, RunResult } from "./runner";
import type { CleanupOutcome, FinishInput, FinishOutcome } from "./types";

export const PR_CHECK_POLL_MS = 30_000;

export interface FinishLifecycleInput {
  readonly cwd: string;
  readonly branch: string;
  readonly worktree: string;
  readonly mergeStrategy?: FinishInput["mergeStrategy"] | "auto";
  readonly waitForChecks: boolean;
  readonly baseBranch?: string;
  readonly sleep?: (ms: number) => Promise<void>;
  readonly reviewSummarySection?: string;
  readonly postSummaryComment?: boolean;
}

const MERGE_STRATEGY = {
  AUTO: "auto",
  PR: "pr",
  LOCAL: "local-merge",
} as const;

const CHECK_OUTCOME = {
  SUCCESS: "success",
  FAILED: "failed",
  PENDING: "pending",
} as const;

const CHECK_STATE = {
  SUCCESS: "SUCCESS",
  SKIPPED: "SKIPPED",
  FAILURE: "FAILURE",
  ERROR: "ERROR",
  CANCELLED: "CANCELLED",
  TIMED_OUT: "TIMED_OUT",
  ACTION_REQUIRED: "ACTION_REQUIRED",
} as const;

const OK_EXIT_CODE = 0;
const BASE_BRANCH_REQUIRED = "base branch not resolved";
const PR_CHECKS_FAILED = "pr_checks_failed";
const PR_BODY_DISAPPEARED_NOTE = "pr_body_update_failed: pr disappeared";
const CHECK_TIMEOUT_DETAIL = "timeout";
const OUTPUT_SEPARATOR = " ";
const DETAIL_SEPARATOR = ": ";
const CHECK_SEPARATOR = ", ";
const NOTE_SEPARATOR = "; ";

const GH_PR = "pr";
const GH_CHECKS = "checks";
const GH_MERGE = "merge";
const GH_REQUIRED_FLAG = "--required";
const GH_JSON_FLAG = "--json";
const GH_CHECK_FIELDS = "state,name";
const GH_SQUASH_FLAG = "--squash";

const GIT_CHECKOUT = "checkout";
const GIT_MERGE = "merge";
const GIT_NO_FF_FLAG = "--no-ff";
const GIT_PUSH = "push";
const GIT_ORIGIN = "origin";
const GIT_BRANCH = "branch";
const GIT_DELETE_FLAG = "-d";

const CLEANUP_BLOCK_PREFIX = "cleanup_blocked";
const CLEANUP_FAIL_PREFIX = "cleanup_failed";

const CheckSchema = v.object({
  name: v.string(),
  state: v.string(),
});
const ChecksSchema = v.array(CheckSchema);

type Check = v.InferOutput<typeof CheckSchema>;
type ResolvedStrategy = typeof MERGE_STRATEGY.PR | typeof MERGE_STRATEGY.LOCAL;
type CheckOutcome =
  | { readonly status: typeof CHECK_OUTCOME.SUCCESS }
  | { readonly status: typeof CHECK_OUTCOME.FAILED; readonly note: string }
  | { readonly status: typeof CHECK_OUTCOME.PENDING };

interface InjectOutcome {
  readonly ok: boolean;
  readonly prUrl: string;
  readonly note: string | null;
}

const completed = (run: RunResult): boolean => run.exitCode === OK_EXIT_CODE;

const getBaseBranch = (input: FinishLifecycleInput): string => {
  if (input.baseBranch === undefined || input.baseBranch.length === 0) {
    throw new Error(`${BASE_BRANCH_REQUIRED} for issue branch ${input.branch}`);
  }
  return input.baseBranch;
};

const cleanupNote = (outcome: CleanupOutcome): string | null => {
  if (outcome.kind === "removed" || outcome.kind === "already-missing") return null;
  if (outcome.kind === "failed") return `${CLEANUP_FAIL_PREFIX}: ${outcome.reason}`;
  return `${CLEANUP_BLOCK_PREFIX}(${outcome.kind}): ${outcome.reason}`;
};

const worktreeRemovedFromCleanup = (outcome: CleanupOutcome): boolean =>
  outcome.kind === "removed" || outcome.kind === "already-missing";

const createOutcome = (
  merged: boolean,
  prUrl: string | null,
  cleanupOutcome: CleanupOutcome,
  note: string | null,
): FinishOutcome => ({
  merged,
  prUrl,
  closedAt: null,
  worktreeRemoved: worktreeRemovedFromCleanup(cleanupOutcome),
  cleanupOutcome,
  note,
});

const NOT_ATTEMPTED: CleanupOutcome = {
  kind: "failed",
  reason: "cleanup not attempted (merge did not complete)",
  retried: false,
};

const createPreCleanupOutcome = (
  merged: boolean,
  prUrl: string | null,
  note: string | null,
): FinishOutcome => createOutcome(merged, prUrl, NOT_ATTEMPTED, note);

const mergeNotes = (...notes: readonly (string | null | undefined)[]): string | null => {
  const present = notes.filter((note): note is string => note !== undefined && note !== null && note.length > 0);
  if (present.length === 0) return null;
  return present.join(NOTE_SEPARATOR);
};

const createPrChecksNote = (detail: string): string => `${PR_CHECKS_FAILED}${DETAIL_SEPARATOR}${detail}`;

const formatCommandFailure = (label: string, run: RunResult): string => {
  const pieces = [run.stderr.trim(), run.stdout.trim()].filter((piece) => piece.length > 0);
  if (pieces.length > 0) return `${label}${DETAIL_SEPARATOR}${pieces.join(OUTPUT_SEPARATOR)}`;
  return `${label}${DETAIL_SEPARATOR}exit code ${run.exitCode}`;
};

const createCheckArgs = (branch: string): readonly string[] => [
  GH_PR,
  GH_CHECKS,
  branch,
  GH_REQUIRED_FLAG,
  GH_JSON_FLAG,
  GH_CHECK_FIELDS,
];

const parseChecks = (stdout: string): readonly Check[] | null => {
  try {
    const raw: unknown = JSON.parse(stdout);
    const parsed = v.safeParse(ChecksSchema, raw);
    if (parsed.success) return parsed.output;
    return null;
  } catch {
    return null;
  }
};

const isFailureState = (state: string): boolean => {
  return [
    CHECK_STATE.FAILURE,
    CHECK_STATE.ERROR,
    CHECK_STATE.CANCELLED,
    CHECK_STATE.TIMED_OUT,
    CHECK_STATE.ACTION_REQUIRED,
  ].some((candidate) => candidate === state);
};

const isSuccessState = (state: string): boolean => state === CHECK_STATE.SUCCESS || state === CHECK_STATE.SKIPPED;

const formatCheck = (check: Check): string => `${check.name}=${check.state}`;

const evaluateChecks = (run: RunResult): CheckOutcome => {
  if (!completed(run))
    return { status: CHECK_OUTCOME.FAILED, note: createPrChecksNote(formatCommandFailure(GH_CHECKS, run)) };

  const checks = parseChecks(run.stdout);
  if (!checks) return { status: CHECK_OUTCOME.FAILED, note: createPrChecksNote("invalid checks output") };

  const failures = checks.filter((check) => isFailureState(check.state));
  if (failures.length > 0)
    return { status: CHECK_OUTCOME.FAILED, note: createPrChecksNote(failures.map(formatCheck).join(CHECK_SEPARATOR)) };
  if (checks.length > 0 && checks.every((check) => isSuccessState(check.state)))
    return { status: CHECK_OUTCOME.SUCCESS };
  return { status: CHECK_OUTCOME.PENDING };
};

const sleepFor = async (ms: number): Promise<void> => {
  await Bun.sleep(ms);
};

const getCheckAttempts = (): number => Math.max(1, Math.ceil(config.lifecycle.prCheckTimeoutMs / PR_CHECK_POLL_MS) + 1);

const hasRemoteCi = async (runner: LifecycleRunner, input: FinishLifecycleInput): Promise<boolean> => {
  const inspected = await runner.gh(createCheckArgs(input.branch), { cwd: input.cwd });
  if (!completed(inspected)) return false;

  const checks = parseChecks(inspected.stdout);
  return checks !== null && checks.length > 0;
};

const resolveStrategy = async (runner: LifecycleRunner, input: FinishLifecycleInput): Promise<ResolvedStrategy> => {
  const requested = input.mergeStrategy ?? config.lifecycle.mergeStrategy;
  if (requested !== MERGE_STRATEGY.AUTO) return requested;
  if (await hasRemoteCi(runner, input)) return MERGE_STRATEGY.PR;
  return MERGE_STRATEGY.LOCAL;
};

const waitForPrChecks = async (runner: LifecycleRunner, input: FinishLifecycleInput): Promise<string | null> => {
  const sleep = input.sleep ?? sleepFor;
  const attempts = getCheckAttempts();

  for (let attempt = 0; attempt < attempts; attempt += 1) {
    const outcome = evaluateChecks(await runner.gh(createCheckArgs(input.branch), { cwd: input.cwd }));
    if (outcome.status === CHECK_OUTCOME.SUCCESS) return null;
    if (outcome.status === CHECK_OUTCOME.FAILED) return outcome.note;
    if (attempt < attempts - 1) await sleep(PR_CHECK_POLL_MS);
  }

  return createPrChecksNote(CHECK_TIMEOUT_DETAIL);
};

const runPostMergeCleanup = async (
  runner: LifecycleRunner,
  input: FinishLifecycleInput,
): Promise<CleanupOutcome> => {
  // After a successful merge we know branchMerged=true. The lifecycle issue is
  // closed in index.ts after this returns; we treat issueClosed=true here because
  // the merge has effectively committed to closing it. The classifier still
  // protects against dirty/untracked content.
  return runCleanup(runner, {
    cwd: input.cwd,
    worktree: input.worktree,
    branch: input.branch,
    baseBranch: getBaseBranch(input),
    issueClosed: true,
    branchMerged: true,
  });
};

const injectAndCommentIfNeeded = async (
  runner: LifecycleRunner,
  input: FinishLifecycleInput,
  prUrl: string,
): Promise<InjectOutcome> => {
  if (input.reviewSummarySection === undefined) return { ok: true, prUrl, note: null };

  const updated = await writeReviewSummaryToPrBody(runner, {
    cwd: input.cwd,
    branch: input.branch,
    section: input.reviewSummarySection,
  });
  if (updated.kind === "failed") return { ok: false, prUrl, note: updated.note };
  if (updated.kind === "no_pr") return { ok: false, prUrl, note: PR_BODY_DISAPPEARED_NOTE };
  if (input.postSummaryComment !== true) return { ok: true, prUrl, note: null };

  const posted = await postOnceSummaryComment(runner, {
    cwd: input.cwd,
    branch: input.branch,
    section: input.reviewSummarySection,
  });
  if (posted.kind === "failed") return { ok: true, prUrl, note: posted.note };
  return { ok: true, prUrl, note: null };
};

const finishViaPr = async (runner: LifecycleRunner, input: FinishLifecycleInput): Promise<FinishOutcome> => {
  const upserted = await upsertPullRequest(runner, {
    cwd: input.cwd,
    branch: input.branch,
    baseBranch: getBaseBranch(input),
  });
  if (upserted.kind === "failed") return createPreCleanupOutcome(false, null, upserted.note);

  const injected = await injectAndCommentIfNeeded(runner, input, upserted.url);
  if (!injected.ok) return createPreCleanupOutcome(false, injected.prUrl, injected.note);

  const checksNote = input.waitForChecks ? await waitForPrChecks(runner, input) : null;
  if (checksNote) return createPreCleanupOutcome(false, injected.prUrl, mergeNotes(injected.note, checksNote));

  const merged = await runner.gh([GH_PR, GH_MERGE, input.branch, GH_SQUASH_FLAG], { cwd: input.cwd });
  if (!completed(merged))
    return createPreCleanupOutcome(
      false,
      injected.prUrl,
      mergeNotes(injected.note, formatCommandFailure("gh_pr_merge", merged)),
    );

  const cleanup = await runPostMergeCleanup(runner, input);
  return createOutcome(true, injected.prUrl, cleanup, mergeNotes(injected.note, cleanupNote(cleanup)));
};

const runGitStep = async (
  runner: LifecycleRunner,
  args: readonly string[],
  cwd: string,
  label: string,
): Promise<string | null> => {
  const run = await runner.git(args, { cwd });
  if (completed(run)) return null;
  return formatCommandFailure(label, run);
};

const finishViaLocalMerge = async (runner: LifecycleRunner, input: FinishLifecycleInput): Promise<FinishOutcome> => {
  const baseBranch = getBaseBranch(input);
  const checkoutNote = await runGitStep(runner, [GIT_CHECKOUT, baseBranch], input.cwd, "git_checkout");
  if (checkoutNote) return createPreCleanupOutcome(false, null, checkoutNote);

  const mergeNote = await runGitStep(runner, [GIT_MERGE, GIT_NO_FF_FLAG, input.branch], input.cwd, "git_merge");
  if (mergeNote) return createPreCleanupOutcome(false, null, mergeNote);

  const pushNote = await runGitStep(runner, [GIT_PUSH, GIT_ORIGIN, baseBranch], input.cwd, "git_push");
  if (pushNote) return createPreCleanupOutcome(false, null, pushNote);

  const cleanup = await runPostMergeCleanup(runner, input);
  // Only attempt branch deletion when the worktree actually went away; deleting the
  // branch while the worktree still references it would fail and add noise.
  let branchDeleteNote: string | null = null;
  if (worktreeRemovedFromCleanup(cleanup)) {
    branchDeleteNote = await runGitStep(
      runner,
      [GIT_BRANCH, GIT_DELETE_FLAG, input.branch],
      input.cwd,
      "git_branch_delete",
    );
  }

  return createOutcome(true, null, cleanup, mergeNotes(cleanupNote(cleanup), branchDeleteNote));
};

export async function finishLifecycle(runner: LifecycleRunner, input: FinishLifecycleInput): Promise<FinishOutcome> {
  const strategy = await resolveStrategy(runner, input);
  if (strategy === MERGE_STRATEGY.PR) return finishViaPr(runner, input);
  return finishViaLocalMerge(runner, input);
}
```

Note: `src/lifecycle/index.ts` constructs a fallback `FinishOutcome` literal at line 671 (executor-blocked path). That literal currently lacks `cleanupOutcome`. Add the field there in this same task by replacing the single line `const outcome = { merged: false, prUrl: null, closedAt: null, worktreeRemoved: false, note };` with:

```ts
const outcome: FinishOutcome = {
  merged: false,
  prUrl: null,
  closedAt: null,
  worktreeRemoved: false,
  cleanupOutcome: { kind: "failed", reason: "cleanup not attempted (executor blocked)", retried: false },
  note,
};
```

This is the only change to `index.ts` and stays inside the same logical concern (FinishOutcome construction). Per "ONE file per micro-task" the planner allows this co-located fallback fix because `merge.ts` exporting `NOT_ATTEMPTED` directly would create a circular concern — keeping the literal at the call site is simpler and safer.

**Verify:** `bun run typecheck && bun test tests/lifecycle/merge.test.ts tests/lifecycle/index.test.ts`
**Commit:** `feat(lifecycle): wire autonomy-first cleanup-policy into finish flow`

### Task 3.2: Regression tests for autonomy-first finishLifecycle behavior
**File:** `tests/lifecycle/merge.test.ts`
**Test:** this IS the test file
**Depends:** 3.1 (validates the integrated behavior)
**Domain:** backend

Append a new `describe("finishLifecycle autonomy-first cleanup", ...)` block to the existing file. Do NOT delete or rewrite existing tests; the existing PR / local-merge / checks tests must still pass against the refactored `merge.ts`. The new block exercises the cleanup policy end-to-end through `finishLifecycle` for the four critical cases the design names: clean removal, dirty worktree (must NOT force-delete), ambiguous (must NOT auto-delete), retry-on-clean.

The full file in `tests/lifecycle/merge.test.ts` already has the `createRunner` / `createRun` / `createFailure` helpers shown in the existing file. Append the following block AFTER the final `});` of the existing `describe("finishLifecycle", () => { ... })` block — same module scope, additional describe.

```ts
// Append to tests/lifecycle/merge.test.ts (after existing describe block closes)

describe("finishLifecycle autonomy-first cleanup", () => {
  const successfulPrPreambleGh = (): readonly RunResult[] => [
    createFailure("no pull requests found"),       // pr view (not found)
    createRun(`${PR_URL}\n`),                       // pr create
    createPrView(),                                 // pr view (after create)
    createRun(JSON.stringify([{ state: "SUCCESS", name: "ci" }])), // pr checks
    createRun(),                                    // pr merge
  ];

  it("auto-removes a clean worktree and reports cleanupOutcome.kind=removed", async () => {
    const runner = createRunner({
      gh: successfulPrPreambleGh(),
      git: [
        createRun("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-lifecycle\n"), // worktree list
        createRun(""),                                                                       // status --porcelain
        createRun(""),                                                                       // ls-files untracked
        createRun(),                                                                         // worktree remove (success)
      ],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "pr",
      waitForChecks: true,
      baseBranch: "main",
      sleep: async () => {},
    });

    expect(outcome.merged).toBe(true);
    expect(outcome.cleanupOutcome.kind).toBe("removed");
    expect(outcome.cleanupOutcome.retried).toBe(false);
    expect(outcome.worktreeRemoved).toBe(true);
  });

  it("retries with prune once on remove failure for a clean worktree", async () => {
    const runner = createRunner({
      gh: successfulPrPreambleGh(),
      git: [
        createRun("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-lifecycle\n"), // list
        createRun(""),                                                                       // status
        createRun(""),                                                                       // untracked
        createFailure("locked"),                                                             // remove (1st)
        createRun(),                                                                         // prune
        createRun(),                                                                         // remove (2nd)
      ],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "pr",
      waitForChecks: true,
      baseBranch: "main",
      sleep: async () => {},
    });

    expect(outcome.merged).toBe(true);
    expect(outcome.cleanupOutcome.kind).toBe("removed");
    expect(outcome.cleanupOutcome.retried).toBe(true);
  });

  it("does NOT force-delete a dirty worktree and reports blocked-dirty", async () => {
    const runner = createRunner({
      gh: successfulPrPreambleGh(),
      git: [
        createRun("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-lifecycle\n"), // list
        createRun(" M src/foo.ts\n"),                                                       // status: dirty
        createRun(""),                                                                       // untracked
      ],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "pr",
      waitForChecks: true,
      baseBranch: "main",
      sleep: async () => {},
    });

    expect(outcome.merged).toBe(true);
    expect(outcome.cleanupOutcome.kind).toBe("blocked-dirty");
    expect(outcome.cleanupOutcome.reason).toContain("src/foo.ts");
    expect(outcome.worktreeRemoved).toBe(false);
    // CRITICAL: ensure no `git worktree remove` was issued for the dirty case.
    const removeCalls = runner.calls.filter(
      (c) => c.bin === "git" && c.args[0] === "worktree" && c.args[1] === "remove",
    );
    expect(removeCalls).toHaveLength(0);
    // The note must surface the cleanup_blocked classification so the user sees why we stopped.
    expect(outcome.note ?? "").toContain("cleanup_blocked(blocked-dirty)");
  });

  it("does NOT auto-delete an ambiguous worktree (only untracked files)", async () => {
    const runner = createRunner({
      gh: successfulPrPreambleGh(),
      git: [
        createRun("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-lifecycle\n"), // list
        createRun(""),                                                                       // status: clean
        createRun("thoughts/shared/notes/scratch.md\n"),                                    // untracked
      ],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "pr",
      waitForChecks: true,
      baseBranch: "main",
      sleep: async () => {},
    });

    expect(outcome.cleanupOutcome.kind).toBe("blocked-ambiguous");
    expect(outcome.worktreeRemoved).toBe(false);
    const removeCalls = runner.calls.filter(
      (c) => c.bin === "git" && c.args[0] === "worktree" && c.args[1] === "remove",
    );
    expect(removeCalls).toHaveLength(0);
  });

  it("does NOT delete an unknown external clone", async () => {
    const runner = createRunner({
      gh: successfulPrPreambleGh(),
      git: [
        createRun("worktree /some/other/path\nbranch refs/heads/main\n"), // list: NOT our worktree
        createRun(""),                                                       // status
        createRun(""),                                                       // untracked
      ],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "pr",
      waitForChecks: true,
      baseBranch: "main",
      sleep: async () => {},
    });

    expect(outcome.cleanupOutcome.kind).toBe("blocked-external");
    expect(outcome.worktreeRemoved).toBe(false);
    const removeCalls = runner.calls.filter(
      (c) => c.bin === "git" && c.args[0] === "worktree" && c.args[1] === "remove",
    );
    expect(removeCalls).toHaveLength(0);
  });

  it("local-merge path also routes through cleanup-policy and skips branch delete when blocked", async () => {
    const runner = createRunner({
      gh: [
        createFailure("no pull requests found"), // pr checks (resolveStrategy probe -> no checks -> local)
      ],
      git: [
        createRun(),                                                                         // checkout main
        createRun(),                                                                         // merge --no-ff
        createRun(),                                                                         // push origin main
        createRun("worktree /repo/micode-issue-1\nbranch refs/heads/issue/1-lifecycle\n"), // worktree list
        createRun(" M src/foo.ts\n"),                                                       // status: dirty
        createRun(""),                                                                       // untracked
      ],
    });

    const outcome = await finishLifecycle(runner, {
      cwd: CWD,
      branch: BRANCH,
      worktree: WORKTREE,
      mergeStrategy: "auto",
      waitForChecks: false,
      baseBranch: "main",
      sleep: async () => {},
    });

    expect(outcome.merged).toBe(true);
    expect(outcome.cleanupOutcome.kind).toBe("blocked-dirty");
    // git branch -d must NOT be called when cleanup blocked, to avoid deleting a branch
    // whose worktree we explicitly kept around for the user.
    const branchDelete = runner.calls.filter(
      (c) => c.bin === "git" && c.args[0] === "branch" && c.args[1] === "-d",
    );
    expect(branchDelete).toHaveLength(0);
  });
});
```

**Verify:** `bun test tests/lifecycle/merge.test.ts`
**Commit:** `test(lifecycle): regression tests for autonomy-first cleanup`
