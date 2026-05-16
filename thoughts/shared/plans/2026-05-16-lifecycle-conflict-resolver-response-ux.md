---
date: 2026-05-16
topic: "lifecycle-conflict-resolver-response-ux"
issue: 85
scope: lifecycle
contract: none
---

# Lifecycle Conflict Resolver and Decision-Minimal Response UX Implementation Plan

**Goal:** Make lifecycle `merge_conflict` recovery continue through a bounded AI resolver when safe, route semantic ambiguity through the built-in `question` tool, and enforce decision-minimal user-facing reports across lifecycle-capable agents.

**Architecture:** Implement the lifecycle side as reusable conflict context/scope/resume helpers plus a read-only lost-update audit utility, then wire those helpers into local-merge finish retry semantics. Implement the agent side as shared prompt fragments injected into primary/coordinator/leaf prompts so commander and brainstormer keep byte-identical drift guards while user-visible output stays decision-minimal.

**Design:** `/root/CODE/issue-85-lifecycle/thoughts/shared/designs/2026-05-16-lifecycle-conflict-resolver-response-ux-design.md`

**Contract:** none — this is an internal workflow/tooling change with no frontend/backend HTTP interface.

**Reviewer coverage:** mandatory for every task. This plan touches lifecycle merge/recovery, agent prompts, safety boundaries, docs mirrors, and drift guards; executor must not skip reviewer for any task in this plan.

---

## 行为承诺映射

| Design commitment / Behavior | Covered by tasks | Reviewer policy |
| --- | --- | --- |
| 可安全处理的 Git conflict 自动进入受限 AI resolver，而不是默认打断用户 | 1.1, 1.2, 2.1, 2.2, 3.1, 3.2, 4.1 | mandatory: lifecycle recovery + prompt behavior |
| resolver 只允许 conflict files + 少量直接相关测试/类型/调用点；语义不明必须阻塞 | 1.1, 1.2, 2.1, 2.2, 2.7, 4.1 | mandatory: safety boundary |
| 需要用户决策时默认使用 built-in `question` tool，plain chat 仅超轻量/降级 | 1.5, 3.1, 3.2, 3.3, 3.4, 4.2 | mandatory: interaction contract |
| 用户可见回复 decision-minimal，不 dump raw recovery hints / subagent raw reports / reviewer checklist / git logs | 1.4, 2.6, 2.7, 3.1, 3.2, 3.3, 3.4, 3.5, 4.2 | mandatory: response UX |
| 提供只读审计路径区分 force-push / squash 错觉 / 语义覆盖 / lifecycle 外手工操作 | 1.3, 2.4, 2.5, 3.1, 4.3 | mandatory: read-only safety |
| 安全边界：no force push / no force-with-lease / no reset hard / no no-verify / no deleting user files / no auto restart | 1.2, 2.1, 2.2, 2.6, 3.1, 3.2, 3.6, 4.1 | mandatory: hard safety |

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2, 1.3, 1.4, 1.5 [foundation helpers and prompt fragments]
Batch 2 (parallel): 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7 [core lifecycle/tool/coordinator integrations]
Batch 3 (parallel): 3.1, 3.2, 3.3, 3.4, 3.5, 3.6 [primary/leaf prompt and docs mirror integrations]
Batch 4 (parallel): 4.1, 4.2, 4.3 [cross-cutting regression/drift tests]
```

---

## Batch 1: Foundation (parallel - 5 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4, 1.5

### Task 1.1: Conflict Resolver Context Model
**File:** `src/lifecycle/conflict-context.ts`
**Test:** `tests/lifecycle/conflict-context.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** layer-update

```typescript
import { describe, expect, it } from "bun:test";

import {
  buildConflictResolverContext,
  CONFLICT_RESOLVER_FORBIDDEN_OPERATIONS,
  isDirectlyRelatedResolverPath,
} from "@/lifecycle/conflict-context";
import { buildHint } from "@/lifecycle/recovery/hint";

describe("conflict resolver context", () => {
  it("builds a minimal resolver context from a merge_conflict recovery hint", () => {
    const hint = buildHint({
      failureKind: "merge_conflict",
      recommendedNextAction: "resolve_conflicts",
      summary: "2 conflicts",
      issueNumber: 85,
      branch: "issue/85-lifecycle-conflict-resolver-response-ux",
      worktree: "/tmp/micode-merge-issue-85",
      conflictFiles: ["src/lifecycle/merge.ts", "src/lifecycle/types.ts"],
    });

    const context = buildConflictResolverContext(hint, { baseBranch: "main" });

    expect(context).toEqual({
      issueNumber: 85,
      branch: "issue/85-lifecycle-conflict-resolver-response-ux",
      baseBranch: "main",
      tempWorktree: "/tmp/micode-merge-issue-85",
      conflictFiles: ["src/lifecycle/merge.ts", "src/lifecycle/types.ts"],
      allowedFiles: ["src/lifecycle/merge.ts", "src/lifecycle/types.ts"],
      allowedExpansionKinds: ["test", "type", "call-site"],
      forbiddenOperations: CONFLICT_RESOLVER_FORBIDDEN_OPERATIONS,
      requiresSemanticQuestion: true,
      maxValidationRepairRounds: 2,
    });
  });

  it("rejects non merge_conflict hints and incomplete hints", () => {
    expect(() => buildConflictResolverContext(buildHint({ failureKind: "push_failed", recommendedNextAction: "retry_finish", summary: "push" }))).toThrow(
      /merge_conflict/,
    );
    expect(() => buildConflictResolverContext(buildHint({ failureKind: "merge_conflict", recommendedNextAction: "resolve_conflicts", summary: "missing" }))).toThrow(
      /worktree.*conflict_files.*issue_number/i,
    );
  });

  it("classifies only small directly-related expansion paths as allowed candidates", () => {
    const conflictFiles = ["src/lifecycle/merge.ts"];

    expect(isDirectlyRelatedResolverPath("tests/lifecycle/merge.test.ts", conflictFiles)).toBe(true);
    expect(isDirectlyRelatedResolverPath("src/lifecycle/types.ts", conflictFiles)).toBe(true);
    expect(isDirectlyRelatedResolverPath("src/lifecycle/index.ts", conflictFiles)).toBe(true);
    expect(isDirectlyRelatedResolverPath("src/agents/commander.ts", conflictFiles)).toBe(false);
    expect(isDirectlyRelatedResolverPath("package.json", conflictFiles)).toBe(false);
  });
});
```

```typescript
import type { LifecycleRecoveryHint } from "./recovery/hint";

export const CONFLICT_RESOLVER_FORBIDDEN_OPERATIONS = [
  "git push --force",
  "git push --force-with-lease",
  "git reset --hard",
  "git commit --no-verify",
  "deleting user files",
  "auto-restarting OpenCode",
] as const;

export const CONFLICT_RESOLVER_ALLOWED_EXPANSION_KINDS = ["test", "type", "call-site"] as const;

export type ConflictResolverAllowedExpansionKind = (typeof CONFLICT_RESOLVER_ALLOWED_EXPANSION_KINDS)[number];

export interface ConflictResolverContext {
  readonly issueNumber: number;
  readonly branch: string;
  readonly baseBranch: string | null;
  readonly tempWorktree: string;
  readonly conflictFiles: readonly string[];
  readonly allowedFiles: readonly string[];
  readonly allowedExpansionKinds: readonly ConflictResolverAllowedExpansionKind[];
  readonly forbiddenOperations: typeof CONFLICT_RESOLVER_FORBIDDEN_OPERATIONS;
  readonly requiresSemanticQuestion: boolean;
  readonly maxValidationRepairRounds: number;
}

export interface BuildConflictResolverContextOptions {
  readonly baseBranch?: string | null;
  readonly maxValidationRepairRounds?: number;
}

const DEFAULT_MAX_VALIDATION_REPAIR_ROUNDS = 2;
const TEST_PATH_RE = /(^|\/)tests?\/|\.test\.[cm]?[jt]sx?$|_test\.go$/;
const TYPE_PATH_RE = /(^|\/)(types|schemas|contracts)\.[cm]?[jt]s$|(^|\/)types\//;
const INDEX_OR_CALLSITE_RE = /(^|\/)index\.[cm]?[jt]s$|(^|\/)runner\.[cm]?[jt]s$|(^|\/)tool\.[cm]?[jt]s$/;

const normalizePath = (path: string): string => path.replaceAll("\\", "/").replace(/^\.\//, "");

const basenameWithoutExt = (path: string): string => {
  const normalized = normalizePath(path);
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  return name.replace(/(\.test)?\.[^.]+$/, "");
};

const dirOf = (path: string): string => {
  const normalized = normalizePath(path);
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
};

const unique = (items: readonly string[]): readonly string[] => [...new Set(items.map(normalizePath))];

export function isDirectlyRelatedResolverPath(candidate: string, conflictFiles: readonly string[]): boolean {
  const normalized = normalizePath(candidate);
  const conflicts = unique(conflictFiles);
  if (conflicts.includes(normalized)) return true;

  const candidateBase = basenameWithoutExt(normalized);
  const sameStem = conflicts.some((file) => basenameWithoutExt(file) === candidateBase);
  if (TEST_PATH_RE.test(normalized) && sameStem) return true;

  const sameDirectory = conflicts.some((file) => dirOf(file) === dirOf(normalized));
  if (sameDirectory && TYPE_PATH_RE.test(normalized)) return true;
  if (sameDirectory && INDEX_OR_CALLSITE_RE.test(normalized)) return true;
  return false;
}

export function buildConflictResolverContext(
  hint: LifecycleRecoveryHint,
  options: BuildConflictResolverContextOptions = {},
): ConflictResolverContext {
  if (hint.failureKind !== "merge_conflict" || hint.recommendedNextAction !== "resolve_conflicts") {
    throw new Error("conflict resolver context requires a merge_conflict/resolve_conflicts recovery hint");
  }
  if (hint.issueNumber === null || hint.worktree === null || hint.conflictFiles.length === 0) {
    throw new Error("merge_conflict hint must include issue_number, worktree, and conflict_files");
  }

  const conflictFiles = unique(hint.conflictFiles);
  return {
    issueNumber: hint.issueNumber,
    branch: hint.branch ?? `issue/${hint.issueNumber}`,
    baseBranch: options.baseBranch ?? null,
    tempWorktree: hint.worktree,
    conflictFiles,
    allowedFiles: conflictFiles,
    allowedExpansionKinds: CONFLICT_RESOLVER_ALLOWED_EXPANSION_KINDS,
    forbiddenOperations: CONFLICT_RESOLVER_FORBIDDEN_OPERATIONS,
    requiresSemanticQuestion: true,
    maxValidationRepairRounds: options.maxValidationRepairRounds ?? DEFAULT_MAX_VALIDATION_REPAIR_ROUNDS,
  };
}
```

**Verify:** `bun test tests/lifecycle/conflict-context.test.ts`
**Commit:** `feat(lifecycle): add conflict resolver context model`

### Task 1.2: Conflict Resolver Scope Guard
**File:** `src/lifecycle/conflict-scope.ts`
**Test:** `tests/lifecycle/conflict-scope.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** layer-update

```typescript
import { describe, expect, it } from "bun:test";

import { evaluateConflictResolverScope } from "@/lifecycle/conflict-scope";

describe("conflict resolver scope guard", () => {
  it("allows conflict files and a small number of directly related tests/types/call sites", () => {
    const result = evaluateConflictResolverScope({
      conflictFiles: ["src/lifecycle/merge.ts"],
      modifiedFiles: ["src/lifecycle/merge.ts", "tests/lifecycle/merge.test.ts", "src/lifecycle/types.ts"],
    });

    expect(result).toEqual({
      status: "allowed",
      extraFiles: ["tests/lifecycle/merge.test.ts", "src/lifecycle/types.ts"],
      reasons: [
        "tests/lifecycle/merge.test.ts: direct test for conflicted file src/lifecycle/merge.ts",
        "src/lifecycle/types.ts: type/schema/call-site in conflicted directory src/lifecycle",
      ],
    });
  });

  it("blocks unrelated files and excessive scope expansion", () => {
    expect(
      evaluateConflictResolverScope({
        conflictFiles: ["src/lifecycle/merge.ts"],
        modifiedFiles: ["src/lifecycle/merge.ts", "src/agents/commander.ts"],
      }),
    ).toMatchObject({ status: "blocked", blockedFiles: ["src/agents/commander.ts"] });

    expect(
      evaluateConflictResolverScope({
        conflictFiles: ["src/lifecycle/merge.ts"],
        modifiedFiles: [
          "src/lifecycle/merge.ts",
          "tests/lifecycle/merge.test.ts",
          "src/lifecycle/types.ts",
          "src/lifecycle/index.ts",
          "src/lifecycle/runner.ts",
        ],
        maxExtraFiles: 2,
      }),
    ).toMatchObject({ status: "blocked", reason: "too_many_extra_files" });
  });
});
```

```typescript
import { isDirectlyRelatedResolverPath } from "./conflict-context";

export type ConflictResolverScopeResult =
  | { readonly status: "allowed"; readonly extraFiles: readonly string[]; readonly reasons: readonly string[] }
  | {
      readonly status: "blocked";
      readonly reason: "unrelated_files" | "too_many_extra_files";
      readonly extraFiles: readonly string[];
      readonly blockedFiles: readonly string[];
      readonly reasons: readonly string[];
    };

export interface ConflictResolverScopeInput {
  readonly conflictFiles: readonly string[];
  readonly modifiedFiles: readonly string[];
  readonly maxExtraFiles?: number;
}

const DEFAULT_MAX_EXTRA_FILES = 3;

const normalize = (path: string): string => path.replaceAll("\\", "/").replace(/^\.\//, "");

const unique = (items: readonly string[]): readonly string[] => [...new Set(items.map(normalize))];

const directory = (path: string): string => {
  const normalized = normalize(path);
  const index = normalized.lastIndexOf("/");
  return index < 0 ? "" : normalized.slice(0, index);
};

const stem = (path: string): string => {
  const normalized = normalize(path);
  const name = normalized.slice(normalized.lastIndexOf("/") + 1);
  return name.replace(/(\.test)?\.[^.]+$/, "");
};

const reasonFor = (file: string, conflictFiles: readonly string[]): string => {
  const directTest = conflictFiles.find((conflict) => stem(conflict) === stem(file) && /(^|\/)tests?\/|\.test\./.test(file));
  if (directTest) return `${file}: direct test for conflicted file ${directTest}`;
  const sameDir = conflictFiles.find((conflict) => directory(conflict) === directory(file));
  if (sameDir) return `${file}: type/schema/call-site in conflicted directory ${directory(sameDir)}`;
  return `${file}: directly related to conflicted files`;
};

export function evaluateConflictResolverScope(input: ConflictResolverScopeInput): ConflictResolverScopeResult {
  const conflictFiles = unique(input.conflictFiles);
  const modifiedFiles = unique(input.modifiedFiles);
  const maxExtraFiles = input.maxExtraFiles ?? DEFAULT_MAX_EXTRA_FILES;
  const extraFiles = modifiedFiles.filter((file) => !conflictFiles.includes(file));
  const blockedFiles = extraFiles.filter((file) => !isDirectlyRelatedResolverPath(file, conflictFiles));
  const reasons = extraFiles.filter((file) => !blockedFiles.includes(file)).map((file) => reasonFor(file, conflictFiles));

  if (blockedFiles.length > 0) {
    return { status: "blocked", reason: "unrelated_files", extraFiles, blockedFiles, reasons };
  }
  if (extraFiles.length > maxExtraFiles) {
    return { status: "blocked", reason: "too_many_extra_files", extraFiles, blockedFiles: [], reasons };
  }
  return { status: "allowed", extraFiles, reasons };
}
```

**Verify:** `bun test tests/lifecycle/conflict-scope.test.ts`
**Commit:** `feat(lifecycle): guard conflict resolver scope`

### Task 1.3: Lost Update Audit Model
**File:** `src/lifecycle/lost-update-audit.ts`
**Test:** `tests/lifecycle/lost-update-audit.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** layer-update

```typescript
import { describe, expect, it } from "bun:test";

import { classifyLostUpdateEvidence, createLostUpdateAuditPlan } from "@/lifecycle/lost-update-audit";

describe("lost update audit", () => {
  it("creates a read-only audit plan", () => {
    const plan = createLostUpdateAuditPlan({ issueNumber: 85, baseBranch: "main", suspectedBranch: "issue/85-x" });

    expect(plan.steps.every((step) => step.readOnly)).toBe(true);
    expect(plan.steps.map((step) => step.command)).toEqual([
      "git log --graph --decorate --oneline --all --boundary",
      "git reflog show --date=iso origin/main",
      "gh pr list --state all --search issue/85",
      "gh issue view 85 --comments",
    ]);
  });

  it("classifies evidence without asserting unavailable facts", () => {
    expect(classifyLostUpdateEvidence({ reflogShowsForcedUpdate: true })).toEqual({ kind: "force-push-evidence", confidence: "high" });
    expect(classifyLostUpdateEvidence({ squashMergeDetected: true })).toEqual({ kind: "squash-history-confusion", confidence: "medium" });
    expect(classifyLostUpdateEvidence({ contentChangedWithoutHistoryRewrite: true })).toEqual({ kind: "semantic-overwrite", confidence: "medium" });
    expect(classifyLostUpdateEvidence({ manualRemoteMutationDetected: true })).toEqual({ kind: "manual-remote-mutation", confidence: "medium" });
    expect(classifyLostUpdateEvidence({})).toEqual({ kind: "inconclusive", confidence: "low" });
  });
});
```

```typescript
export type LostUpdateAuditKind =
  | "force-push-evidence"
  | "squash-history-confusion"
  | "semantic-overwrite"
  | "manual-remote-mutation"
  | "push-rejection-race"
  | "inconclusive";

export interface LostUpdateAuditStep {
  readonly title: string;
  readonly command: string;
  readonly readOnly: true;
  readonly looksFor: string;
}

export interface LostUpdateAuditPlanInput {
  readonly issueNumber: number;
  readonly baseBranch: string;
  readonly suspectedBranch?: string | null;
}

export interface LostUpdateAuditPlan {
  readonly issueNumber: number;
  readonly baseBranch: string;
  readonly suspectedBranch: string | null;
  readonly steps: readonly LostUpdateAuditStep[];
  readonly limitation: string;
}

export interface LostUpdateEvidenceInput {
  readonly reflogShowsForcedUpdate?: boolean;
  readonly squashMergeDetected?: boolean;
  readonly contentChangedWithoutHistoryRewrite?: boolean;
  readonly manualRemoteMutationDetected?: boolean;
  readonly pushRejectedBeforeMissingContent?: boolean;
}

export interface LostUpdateClassification {
  readonly kind: LostUpdateAuditKind;
  readonly confidence: "high" | "medium" | "low";
}

export function createLostUpdateAuditPlan(input: LostUpdateAuditPlanInput): LostUpdateAuditPlan {
  return {
    issueNumber: input.issueNumber,
    baseBranch: input.baseBranch,
    suspectedBranch: input.suspectedBranch ?? null,
    limitation:
      "This audit is read-only and evidence-based. Without remote provider audit logs it cannot prove that force-push never happened.",
    steps: [
      {
        title: "Compare visible branch topology",
        command: "git log --graph --decorate --oneline --all --boundary",
        readOnly: true,
        looksFor: "history rewrite symptoms, missing issue branch commits, and squash merge topology",
      },
      {
        title: "Inspect remote-tracking reflog",
        command: `git reflog show --date=iso origin/${input.baseBranch}`,
        readOnly: true,
        looksFor: "forced-update markers or non-fast-forward origin/main movement visible locally",
      },
      {
        title: "Inspect PR history",
        command: `gh pr list --state all --search issue/${input.issueNumber}`,
        readOnly: true,
        looksFor: "squash merge, manual merge, closed-without-merge, or review comments explaining overwrite",
      },
      {
        title: "Inspect lifecycle issue comments",
        command: `gh issue view ${input.issueNumber} --comments`,
        readOnly: true,
        looksFor: "push rejection, lifecycle recovery, manual intervention, or resolver notes",
      },
    ],
  };
}

export function classifyLostUpdateEvidence(input: LostUpdateEvidenceInput): LostUpdateClassification {
  if (input.reflogShowsForcedUpdate) return { kind: "force-push-evidence", confidence: "high" };
  if (input.squashMergeDetected) return { kind: "squash-history-confusion", confidence: "medium" };
  if (input.contentChangedWithoutHistoryRewrite) return { kind: "semantic-overwrite", confidence: "medium" };
  if (input.manualRemoteMutationDetected) return { kind: "manual-remote-mutation", confidence: "medium" };
  if (input.pushRejectedBeforeMissingContent) return { kind: "push-rejection-race", confidence: "medium" };
  return { kind: "inconclusive", confidence: "low" };
}
```

**Verify:** `bun test tests/lifecycle/lost-update-audit.test.ts`
**Commit:** `feat(lifecycle): add read-only lost update audit model`

### Task 1.4: Decision-Minimal Response Protocol Fragment
**File:** `src/agents/decision-minimal-response.ts`
**Test:** `tests/agents/decision-minimal-response.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** layer-update

```typescript
import { describe, expect, it } from "bun:test";

import { DECISION_MINIMAL_RESPONSE_PROTOCOL } from "@/agents/decision-minimal-response";

describe("decision-minimal response protocol", () => {
  it("keeps user-facing output focused on decisions, acceptance, and next steps", () => {
    expect(DECISION_MINIMAL_RESPONSE_PROTOCOL).toContain("decision-minimal");
    expect(DECISION_MINIMAL_RESPONSE_PROTOCOL).toContain("decision");
    expect(DECISION_MINIMAL_RESPONSE_PROTOCOL).toContain("acceptance");
    expect(DECISION_MINIMAL_RESPONSE_PROTOCOL).toContain("next-step");
  });

  it("forbids raw internal diagnostics in user-facing reports", () => {
    for (const phrase of ["raw recovery hint", "subagent raw reports", "reviewer checklist", "git logs"]) {
      expect(DECISION_MINIMAL_RESPONSE_PROTOCOL).toContain(phrase);
    }
  });

  it("requires internal artifact storage instead of chat dumping", () => {
    expect(DECISION_MINIMAL_RESPONSE_PROTOCOL).toMatch(/artifact|lifecycle progress|ledger|plan/i);
  });
});
```

```typescript
export const DECISION_MINIMAL_RESPONSE_PROTOCOL = `<decision-minimal-response priority="critical" description="User-facing reports expose only decision, acceptance, and next-step information">
<purpose>
User-visible responses are for decisions, acceptance, and next steps. Internal diagnostics remain available in artifacts, lifecycle progress, plans, ledgers, reviewer reports, or subagent reports, but are not dumped into chat by default.
</purpose>

<user-visible-allowlist>
<item>Final decision or blocked decision needed from the user.</item>
<item>User-visible impact / expected behavior.</item>
<item>Acceptance checks the user can run or inspect.</item>
<item>Immediate next-step options when action is required.</item>
<item>Compact references to artifact paths, issue numbers, commit hashes, or PR URLs.</item>
</user-visible-allowlist>

<user-visible-denylist>
<item>raw recovery hint</item>
<item>subagent raw reports</item>
<item>reviewer checklist</item>
<item>git logs</item>
<item>full command stdout/stderr unless the user explicitly asks for process detail</item>
</user-visible-denylist>

<rules>
<rule>When a tool returns a recovery hint, parse it internally and show only the decision-relevant summary, options, and next step.</rule>
<rule>When a subagent returns a long report, synthesize compact facts; do not paste the report raw into user chat.</rule>
<rule>When reviewer output is relevant, expose only whether it approved, requested changes, or found a blocker; keep detailed checklist internal.</rule>
<rule>For blocked states, lead with what decision or external action is needed, then include compact context.</rule>
<rule>If the user explicitly asks for detailed logs, provide scoped excerpts and avoid secrets.</rule>
</rules>
</decision-minimal-response>`;
```

**Verify:** `bun test tests/agents/decision-minimal-response.test.ts`
**Commit:** `feat(agents): add decision-minimal response protocol`

### Task 1.5: Question-First Decision Protocol Fragment
**File:** `src/agents/question-first-decision.ts`
**Test:** `tests/agents/question-first-decision.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** layer-update

```typescript
import { describe, expect, it } from "bun:test";

import { QUESTION_FIRST_DECISION_PROTOCOL } from "@/agents/question-first-decision";

describe("question-first decision protocol", () => {
  it("makes built-in question the default for real user decisions", () => {
    expect(QUESTION_FIRST_DECISION_PROTOCOL).toMatch(/built-in `question` tool|内置 `question` tool/);
    expect(QUESTION_FIRST_DECISION_PROTOCOL).toContain("default");
  });

  it("keeps plain chat limited to ultra-light notification and fallback", () => {
    expect(QUESTION_FIRST_DECISION_PROTOCOL).toContain("plain chat");
    expect(QUESTION_FIRST_DECISION_PROTOCOL).toContain("ultra-light");
    expect(QUESTION_FIRST_DECISION_PROTOCOL).toContain("fallback");
  });

  it("defines conflict decision options with a recommended default and safe pause", () => {
    expect(QUESTION_FIRST_DECISION_PROTOCOL).toContain("preserve both semantics");
    expect(QUESTION_FIRST_DECISION_PROTOCOL).toContain("user-supplied business choice");
    expect(QUESTION_FIRST_DECISION_PROTOCOL).toContain("pause and preserve temp worktree");
  });
});
```

```typescript
export const QUESTION_FIRST_DECISION_PROTOCOL = `<question-first-decision priority="critical" description="Real user decisions default to the built-in question tool">
<purpose>
When automation needs a real user decision, use the built-in `question` tool broadly. Plain chat is only for ultra-light notification with no choice, or as a fallback when the built-in question tool is unavailable.
</purpose>

<rules>
<rule>Use the built-in `question` tool for semantic conflict choices, destructive confirmations, workflow forks, and any decision with multiple options.</rule>
<rule>Each question must include only decision-needed context: blocker, affected scope, recommended option, alternatives, and safe pause path.</rule>
<rule>Do not include raw recovery hint, full git output, reviewer checklist, or subagent raw reports in the question text.</rule>
<rule>If the built-in `question` tool is unavailable, fall back to a concise numbered plain-chat question with the same options.</rule>
</rules>

<conflict-decision-options>
<option id="preserve-both" recommended="true">preserve both semantics when compatible, then continue resolver validation</option>
<option id="prefer-base">prefer the current base/main side for this conflicted behavior</option>
<option id="prefer-issue">prefer the issue branch side for this conflicted behavior</option>
<option id="user-choice">user-supplied business choice: user provides the missing semantic rule before continuing</option>
<option id="pause">pause and preserve temp worktree for manual inspection</option>
</conflict-decision-options>
</question-first-decision>`;
```

**Verify:** `bun test tests/agents/question-first-decision.test.ts`
**Commit:** `feat(agents): add question-first decision protocol`

---

## Batch 2: Core Modules (parallel - 7 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 2.7

### Task 2.1: Local Merge Resume After Resolved Conflict
**File:** `src/lifecycle/merge.ts`
**Test:** `tests/lifecycle/merge-conflict-resume.test.ts`
**Depends:** 1.1, 1.2
**Domain:** general
**Atlas-impact:** layer-update

```typescript
import { describe, expect, it } from "bun:test";

import { finishLifecycle } from "@/lifecycle/merge";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const FAIL = (stderr = "failed"): RunResult => ({ stdout: "", stderr, exitCode: 1 });

interface Call {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

const createRunner = (responses: ReadonlyMap<string, readonly RunResult[]>): { runner: LifecycleRunner; calls: Call[] } => {
  const calls: Call[] = [];
  const cursors = new Map<string, number>();
  const next = (args: readonly string[]): RunResult => {
    const key = args.join(" ");
    const list = responses.get(key);
    const index = cursors.get(key) ?? 0;
    cursors.set(key, index + 1);
    return list?.[Math.min(index, list.length - 1)] ?? OK();
  };

  return {
    calls,
    runner: {
      git: async (args, options) => {
        calls.push({ bin: "git", args, cwd: options?.cwd });
        return next(args);
      },
      gh: async (args, options) => {
        calls.push({ bin: "gh", args, cwd: options?.cwd });
        return next(args);
      },
    },
  };
};

const commandList = (calls: readonly Call[]): readonly string[] => calls.map((call) => call.args.join(" "));

describe("finishLifecycle resolved conflict continuation", () => {
  it("continues an in-progress temp merge when conflicts are already resolved", async () => {
    const responses = new Map<string, readonly RunResult[]>([
      ["pr checks issue/85-x --required --json state,name", [OK("[]")]],
      ["worktree add /tmp/micode-merge-issue-85 main", [FAIL("already exists")]],
      ["status --porcelain", [OK("M  src/lifecycle/merge.ts\n")]],
      ["diff --name-only --diff-filter=U", [OK("")]],
      ["commit -m merge issue/85-x: resolve lifecycle conflicts", [OK()]],
      ["push origin main", [OK()]],
      ["worktree remove --force /tmp/micode-merge-issue-85", [OK()]],
      ["worktree list --porcelain", [OK("worktree /repo/issue-85\n")]],
      ["worktree remove /repo/issue-85", [OK()]],
      ["ls-files --others --exclude-standard", [OK()]],
      ["branch -d issue/85-x", [OK()]],
    ]);
    const { runner, calls } = createRunner(responses);

    const outcome = await finishLifecycle(runner, {
      cwd: "/repo/micode",
      branch: "issue/85-x",
      worktree: "/repo/issue-85",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });

    expect(outcome.merged).toBe(true);
    expect(outcome.recoveryHint).toBeUndefined();
    expect(commandList(calls)).toContain("commit -m merge issue/85-x: resolve lifecycle conflicts");
    expect(commandList(calls)).toContain("push origin main");
    expect(commandList(calls).some((command) => command.includes("--force-with-lease"))).toBe(false);
    expect(commandList(calls).some((command) => command.includes("--no-verify"))).toBe(false);
    expect(commandList(calls).some((command) => command.startsWith("reset --hard"))).toBe(false);
  });

  it("returns merge_conflict again when the preserved temp worktree still has unresolved conflicts", async () => {
    const responses = new Map<string, readonly RunResult[]>([
      ["pr checks issue/85-x --required --json state,name", [OK("[]")]],
      ["worktree add /tmp/micode-merge-issue-85 main", [FAIL("already exists")]],
      ["status --porcelain", [OK("UU src/lifecycle/merge.ts\n")]],
      ["diff --name-only --diff-filter=U", [OK("src/lifecycle/merge.ts\n")]],
    ]);
    const { runner } = createRunner(responses);

    const outcome = await finishLifecycle(runner, {
      cwd: "/repo/micode",
      branch: "issue/85-x",
      worktree: "/repo/issue-85",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });

    expect(outcome.merged).toBe(false);
    expect(outcome.recoveryHint?.failureKind).toBe("merge_conflict");
    expect(outcome.recoveryHint?.conflictFiles).toEqual(["src/lifecycle/merge.ts"]);
  });
});
```

```typescript
// Modify the existing file, do not rewrite it wholesale.
// 1. Import/equivalent-use the conflict helpers added in Batch 1 where useful:
//    import { evaluateConflictResolverScope } from "./conflict-scope";
//
// 2. Add constants near the existing git constants:
//    const GIT_DIFF = "diff";
//    const GIT_NAME_ONLY = "--name-only";
//    const GIT_UNMERGED_FILTER = "--diff-filter=U";
//    const GIT_COMMIT = "commit";
//    const GIT_MESSAGE_FLAG = "-m";
//    const RESOLVED_CONFLICT_COMMIT_PREFIX = "merge";
//
// 3. Extend prepareTempMergeWorktree so `git worktree add /tmp/micode-merge-issue-N main`
//    failure can be treated as "existing temp merge worktree" ONLY when that temp worktree
//    has an in-progress merge state visible through git status/diff checks. Do not treat any
//    arbitrary worktree-add failure as safe.
//
// 4. Add helper:
//    const readUnmergedFiles = async (runner, worktree) => runner.git([GIT_DIFF, GIT_NAME_ONLY, GIT_UNMERGED_FILTER], { cwd: worktree })
//    Parse stdout into non-empty normalized paths. Fall back to readMergeConflicts if diff fails.
//
// 5. Add helper:
//    const commitResolvedConflictMerge = async (runner, input, worktree) =>
//      runGitStep(runner, [GIT_COMMIT, GIT_MESSAGE_FLAG, `merge ${input.branch}: resolve lifecycle conflicts`], worktree, "git_commit_resolved_conflicts")
//    No --no-verify. No force flags. No reset.
//
// 6. In finishViaLocalMerge, when prepareTempMergeWorktree returns an existing preserved temp worktree:
//    - read unresolved conflict files.
//    - if any remain, return createMergeConflictOutcome with those files.
//    - if none remain, evaluate modified scope using evaluateConflictResolverScope({ conflictFiles: original conflictFiles if known else [], modifiedFiles: status porcelain paths }).
//      If scope is blocked, return merge_conflict/ask-user style hint summary without committing.
//    - commit the resolved merge, then continue through pushMergedBaseBranch, temp worktree removal, post-merge cleanup, branch delete.
//
// 7. Preserve existing behavior when the temp worktree is newly created: fetch origin/base, ff-only, merge --no-ff issue branch, then push.
//
// 8. Keep all existing tests passing: no checkout main in primary cwd, no reset --hard, no force push, no --no-verify.
```

**Verify:** `bun test tests/lifecycle/merge-conflict-resume.test.ts tests/lifecycle/merge-temp-worktree.test.ts tests/lifecycle/recovery-safety-boundary.test.ts`
**Commit:** `feat(lifecycle): resume local merge after resolved conflicts`

### Task 2.2: Lifecycle Conflict Scope Enforcement Test
**File:** `tests/lifecycle/merge-conflict-scope.test.ts`
**Test:** `tests/lifecycle/merge-conflict-scope.test.ts`
**Depends:** 1.1, 1.2
**Domain:** general
**Atlas-impact:** none

```typescript
import { describe, expect, it } from "bun:test";

import { finishLifecycle } from "@/lifecycle/merge";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const FAIL = (stderr = "failed"): RunResult => ({ stdout: "", stderr, exitCode: 1 });

interface Call {
  readonly args: readonly string[];
  readonly cwd?: string;
}

const runnerWith = (responses: ReadonlyMap<string, readonly RunResult[]>): { runner: LifecycleRunner; calls: Call[] } => {
  const calls: Call[] = [];
  const cursors = new Map<string, number>();
  const next = (args: readonly string[]): RunResult => {
    const key = args.join(" ");
    const list = responses.get(key);
    const index = cursors.get(key) ?? 0;
    cursors.set(key, index + 1);
    return list?.[Math.min(index, list.length - 1)] ?? OK();
  };
  return {
    calls,
    runner: {
      git: async (args, options) => {
        calls.push({ args, cwd: options?.cwd });
        return next(args);
      },
      gh: async () => OK("[]"),
    },
  };
};

describe("local merge resolver scope enforcement", () => {
  it("blocks resolved temp merges that changed unrelated files", async () => {
    const responses = new Map<string, readonly RunResult[]>([
      ["worktree add /tmp/micode-merge-issue-85 main", [FAIL("already exists")]],
      ["diff --name-only --diff-filter=U", [OK("")]],
      ["status --porcelain", [OK("M  src/lifecycle/merge.ts\nM  src/agents/commander.ts\n")]],
    ]);
    const { runner, calls } = runnerWith(responses);

    const outcome = await finishLifecycle(runner, {
      cwd: "/repo/micode",
      branch: "issue/85-x",
      worktree: "/repo/issue-85",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });

    expect(outcome.merged).toBe(false);
    expect(outcome.recoveryHint?.failureKind).toBe("merge_conflict");
    expect(outcome.note).toContain("scope");
    expect(calls.map((call) => call.args.join(" "))).not.toContain("commit -m merge issue/85-x: resolve lifecycle conflicts");
  });
});
```

```typescript
// No implementation file: this is a regression test for Task 2.1's `src/lifecycle/merge.ts` behavior.
```

**Verify:** `bun test tests/lifecycle/merge-conflict-scope.test.ts`
**Commit:** `test(lifecycle): cover conflict resolver scope enforcement`

### Task 2.3: Lifecycle Finish Tool Compact Conflict Output
**File:** `src/tools/lifecycle/finish.ts`
**Test:** `tests/tools/lifecycle/finish-conflict-ux.test.ts`
**Depends:** 1.1, 1.4
**Domain:** general
**Atlas-impact:** layer-update

```typescript
import { describe, expect, it } from "bun:test";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";

import type { FinishOutcome, LifecycleHandle } from "@/lifecycle";
import { buildHint } from "@/lifecycle/recovery/hint";
import { createLifecycleFinishTool } from "@/tools/lifecycle/finish";

const TOOL_CONTEXT = {} as unknown as ToolContext;

const stringify = (outcome: ToolResult): string => (typeof outcome === "string" ? outcome : outcome.output);

const executeFinish = async (outcome: FinishOutcome): Promise<string> => {
  const handle: Pick<LifecycleHandle, "finish"> = { finish: async () => outcome };
  const tool = createLifecycleFinishTool(handle);
  const exec = tool.execute.bind(tool) as unknown as (raw: unknown, ctx: ToolContext) => Promise<ToolResult>;
  return stringify(await exec({ issue_number: 85, merge_strategy: "auto", wait_for_checks: false }, TOOL_CONTEXT));
};

describe("lifecycle_finish conflict UX", () => {
  it("keeps tool output parseable while adding compact conflict summary", async () => {
    const md = await executeFinish({
      merged: false,
      prUrl: null,
      closedAt: null,
      worktreeRemoved: false,
      cleanupOutcome: { kind: "failed", reason: "cleanup not attempted", retried: false },
      note: "merge_conflict",
      recoveryHint: buildHint({
        failureKind: "merge_conflict",
        recommendedNextAction: "resolve_conflicts",
        summary: "merge conflicts in 1 file",
        issueNumber: 85,
        branch: "issue/85-x",
        worktree: "/tmp/micode-merge-issue-85",
        conflictFiles: ["src/lifecycle/merge.ts"],
      }),
    });

    expect(md).toContain("## Lifecycle finish failed");
    expect(md).toContain("### Conflict resolver context");
    expect(md).toContain("resolver may edit conflict files plus directly related tests/types/call sites");
    expect(md).toContain("### Recovery hint");
    expect(md).toContain("**failure_kind:** `merge_conflict`");
  });
});
```

```typescript
// Modify existing `src/tools/lifecycle/finish.ts` only.
// Add a compact `### Conflict resolver context` section when outcome.recoveryHint?.failureKind === "merge_conflict".
// The section must include:
// - temp worktree path
// - conflict files count/list
// - resolver scope sentence: conflict files plus directly related tests/types/call sites
// - semantic ambiguity sentence: user decision required through built-in question tool
// Keep the existing `### Recovery hint` suffix unchanged so coordinator prompts/tests can still parse it.
```

**Verify:** `bun test tests/tools/lifecycle/finish-conflict-ux.test.ts tests/lifecycle/finish-recovery.test.ts`
**Commit:** `feat(lifecycle): summarize conflict resolver context in finish tool`

### Task 2.4: Lost Update Audit Tool
**File:** `src/tools/lifecycle/lost-update-audit.ts`
**Test:** `tests/tools/lifecycle/lost-update-audit.test.ts`
**Depends:** 1.3
**Domain:** general
**Atlas-impact:** new-node

```typescript
import { describe, expect, it } from "bun:test";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";

import { createLifecycleLostUpdateAuditTool } from "@/tools/lifecycle/lost-update-audit";

const ctx = {} as ToolContext;
const stringify = (result: ToolResult): string => (typeof result === "string" ? result : result.output);

describe("lifecycle_lost_update_audit tool", () => {
  it("renders only read-only audit commands and limitations", async () => {
    const tool = createLifecycleLostUpdateAuditTool();
    const exec = tool.execute.bind(tool) as unknown as (raw: unknown, ctx: ToolContext) => Promise<ToolResult>;
    const md = stringify(await exec({ issue_number: 85, base_branch: "main", suspected_branch: "issue/85-x" }, ctx));

    expect(md).toContain("## Lost update audit plan");
    expect(md).toContain("read-only");
    expect(md).toContain("git reflog show --date=iso origin/main");
    expect(md).toContain("gh issue view 85 --comments");
    expect(md).not.toContain("push --force");
    expect(md).not.toContain("reset --hard");
    expect(md).not.toContain("--no-verify");
  });
});
```

```typescript
import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { createLostUpdateAuditPlan } from "@/lifecycle/lost-update-audit";

const LINE_BREAK = "\n";

export function createLifecycleLostUpdateAuditTool(): ToolDefinition {
  return tool({
    description:
      "Create a lightweight read-only audit plan for suspected historical lost updates / force-push confusion. Does not mutate git or GitHub state.",
    args: {
      issue_number: tool.schema.number().describe("Lifecycle issue number to audit"),
      base_branch: tool.schema.string().optional().describe("Base branch to inspect, defaults to main"),
      suspected_branch: tool.schema.string().optional().describe("Optional issue branch suspected of losing updates"),
    },
    execute: async (args) => {
      const plan = createLostUpdateAuditPlan({
        issueNumber: args.issue_number,
        baseBranch: args.base_branch ?? "main",
        suspectedBranch: args.suspected_branch ?? null,
      });

      return [
        "## Lost update audit plan",
        "",
        `Issue: #${plan.issueNumber}`,
        `Base branch: ${plan.baseBranch}`,
        `Suspected branch: ${plan.suspectedBranch ?? "-"}`,
        "",
        "All steps are read-only. Do not run recovery or rewrite history from this audit output.",
        "",
        ...plan.steps.flatMap((step, index) => [
          `${index + 1}. **${step.title}**`,
          `   - Command: \`${step.command}\``,
          `   - Looks for: ${step.looksFor}`,
          `   - Read-only: ${step.readOnly ? "yes" : "no"}`,
        ]),
        "",
        `Limitation: ${plan.limitation}`,
      ].join(LINE_BREAK);
    },
  });
}
```

**Verify:** `bun test tests/tools/lifecycle/lost-update-audit.test.ts`
**Commit:** `feat(lifecycle): add read-only lost update audit tool`

### Task 2.5: Lifecycle Tool Index Wiring
**File:** `src/tools/lifecycle/index.ts`
**Test:** `tests/tools/lifecycle/index-lost-update-audit.test.ts`
**Depends:** 2.4
**Domain:** general
**Atlas-impact:** layer-update

```typescript
import { describe, expect, it } from "bun:test";

import { createLifecycleTools } from "@/tools/lifecycle";

describe("lifecycle tool index lost update audit wiring", () => {
  it("registers lifecycle_lost_update_audit", () => {
    const tools = createLifecycleTools({} as never);
    expect(Object.keys(tools)).toContain("lifecycle_lost_update_audit");
  });
});
```

```typescript
// Modify existing `src/tools/lifecycle/index.ts` only.
// Import `createLifecycleLostUpdateAuditTool` from `./lost-update-audit`.
// Add `lifecycle_lost_update_audit: createLifecycleLostUpdateAuditTool()` to the returned tool map.
// This tool has no LifecycleHandle dependency because it only renders a read-only audit plan.
```

**Verify:** `bun test tests/tools/lifecycle/index-lost-update-audit.test.ts tests/tools/lifecycle/index.test.ts tests/tools/lifecycle/index-wiring.test.ts`
**Commit:** `feat(lifecycle): register lost update audit tool`

### Task 2.6: Executor Conflict Recovery Prompt
**File:** `src/agents/executor.ts`
**Test:** `tests/agents/executor-conflict-recovery.test.ts`
**Depends:** 1.4, 1.5, 2.1
**Domain:** general
**Atlas-impact:** layer-update

```typescript
import { describe, expect, it } from "bun:test";

import { executorAgent } from "@/agents/executor";

const PROMPT = executorAgent.prompt ?? "";

describe("executor conflict recovery prompt", () => {
  it("parses merge_conflict recovery hints into a bounded resolver flow", () => {
    expect(PROMPT).toContain("merge_conflict");
    expect(PROMPT).toContain("conflict resolver flow");
    expect(PROMPT).toContain("temp worktree");
    expect(PROMPT).toContain("conflict files");
  });

  it("enforces resolver scope and mandatory reviewer coverage", () => {
    expect(PROMPT).toContain("directly related tests/types/call sites");
    expect(PROMPT).toContain("semantic ambiguity");
    expect(PROMPT).toContain("reviewer mandatory");
    expect(PROMPT).not.toContain("skip reviewer for conflict resolver");
  });

  it("keeps unsafe recovery shortcuts forbidden", () => {
    expect(PROMPT).toContain("--force-with-lease");
    expect(PROMPT).toContain("reset --hard");
    expect(PROMPT).toContain("--no-verify");
  });
});
```

```typescript
// Modify existing `src/agents/executor.ts` only.
// Add imports for DECISION_MINIMAL_RESPONSE_PROTOCOL and QUESTION_FIRST_DECISION_PROTOCOL, then inject them near the other cross-cutting protocols.
// Update lifecycle commit/finalization prompt rules:
// - When lifecycle_commit/lifecycle_finish output contains `failure_kind=merge_conflict`, executor must build a compact conflict resolver flow.
// - Resolver work happens in the temp worktree from the hint.
// - Allowed file scope: conflict files plus small directly related tests/types/call sites; unrelated or broad expansion is blocked.
// - Semantic ambiguity must be escalated as compact facts for primary to ask via built-in question tool; executor itself should not dump raw hints to user.
// - High-risk conflict resolver tasks are reviewer mandatory; no reviewer skip is allowed.
// - Keep existing `Never call lifecycle_finish` rule for normal executor completion unless executor already owns a documented recovery continuation in this prompt.
// - Never use force push, force-with-lease, reset hard, no-verify, rm/delete user files, or restart.
```

**Verify:** `bun test tests/agents/executor-conflict-recovery.test.ts tests/agents/executor-lifecycle-recovery.test.ts tests/agents/executor-prompt.test.ts`
**Commit:** `feat(agents): teach executor conflict resolver recovery`

### Task 2.7: Reviewer Conflict Scope Prompt
**File:** `src/agents/reviewer.ts`
**Test:** `tests/agents/reviewer-conflict-scope.test.ts`
**Depends:** 1.2, 1.4
**Domain:** general
**Atlas-impact:** layer-update

```typescript
import { describe, expect, it } from "bun:test";

import { reviewerAgent } from "@/agents/reviewer";

const PROMPT = reviewerAgent.prompt ?? "";

describe("reviewer conflict scope prompt", () => {
  it("requires conflict resolver scope validation", () => {
    expect(PROMPT).toContain("conflict resolver scope");
    expect(PROMPT).toContain("conflict files");
    expect(PROMPT).toContain("directly related tests/types/call sites");
  });

  it("escalates semantic ambiguity and raw-output leakage", () => {
    expect(PROMPT).toContain("semantic ambiguity");
    expect(PROMPT).toContain("decision-minimal");
    expect(PROMPT).toContain("raw recovery hint");
  });
});
```

```typescript
// Modify existing `src/agents/reviewer.ts` only.
// Add/import DECISION_MINIMAL_RESPONSE_PROTOCOL if reviewer currently lacks it, or add a reviewer-specific subsection that references the same protocol.
// Add conflict resolver review policy:
// - If a task touches lifecycle conflict resolution, check modified files against allowed conflict scope.
// - APPROVE only when edits are limited to conflict files or directly related tests/types/call sites and the rationale is present.
// - REQUEST_CHANGES when unrelated files are modified, broad expansion lacks rationale, or safety boundaries are crossed.
// - Mark semantic ambiguity as CHANGES REQUESTED with compact `Sub-decision observation: missing` / conflict decision facts.
// - Check user-facing text does not expose raw recovery hint, full git output, reviewer checklist, or subagent raw reports.
// Preserve the existing final-marker rule: verdict MUST appear as the LAST line exactly once.
```

**Verify:** `bun test tests/agents/reviewer-conflict-scope.test.ts tests/agents/reviewer-prompt.test.ts tests/agents/sub-decision-and-checkoff.test.ts`
**Commit:** `feat(agents): require reviewer conflict scope checks`

---

## Batch 3: Prompt and Docs Integration (parallel - 6 implementers)

All tasks in this batch depend on Batch 2 completing.
Tasks: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6

### Task 3.1: Commander Lifecycle Conflict Recovery Prompt
**File:** `src/agents/commander.ts`
**Test:** `tests/agents/commander-conflict-recovery.test.ts`
**Depends:** 1.4, 1.5, 2.3, 2.4
**Domain:** general
**Atlas-impact:** layer-update

```typescript
import { describe, expect, it } from "bun:test";

import { COMMANDER_PROMPT } from "@/agents/commander";

const actionMap = COMMANDER_PROMPT.match(/<action-map>[\s\S]*?<\/action-map>/)?.[0] ?? "";

describe("commander conflict recovery UX", () => {
  it("auto-routes merge_conflict to a bounded conflict resolver instead of halting", () => {
    expect(actionMap).toContain("merge_conflict");
    expect(actionMap).toContain("conflict resolver flow");
    expect(actionMap.includes("Do NOT auto-resolve. Halt")).toBe(false);
  });

  it("uses built-in question for semantic ambiguity and keeps output decision-minimal", () => {
    expect(COMMANDER_PROMPT).toContain("QUESTION_FIRST_DECISION_PROTOCOL");
    expect(COMMANDER_PROMPT).toContain("DECISION_MINIMAL_RESPONSE_PROTOCOL");
    expect(COMMANDER_PROMPT).toContain("built-in question");
    expect(COMMANDER_PROMPT).toContain("raw recovery hint");
  });

  it("mentions lost update audit as read-only", () => {
    expect(COMMANDER_PROMPT).toContain("lifecycle_lost_update_audit");
    expect(COMMANDER_PROMPT).toContain("read-only");
  });
});
```

```typescript
// Modify existing `src/agents/commander.ts` only.
// 1. Import the two Batch 1 prompt fragments:
//    import { DECISION_MINIMAL_RESPONSE_PROTOCOL } from "./decision-minimal-response";
//    import { QUESTION_FIRST_DECISION_PROTOCOL } from "./question-first-decision";
//
// 2. Inject both protocol constants near effect-first / lifecycle recovery rules so the literal token names appear in source.
//
// 3. Update <bounded-recovery-loop><action-map> merge_conflict row:
//    - Replace "Tell the user temp worktree/conflict files. Do NOT auto-resolve. Halt".
//    - New behavior: parse worktree/conflict_files, start bounded conflict resolver flow in temp worktree, allow conflict files plus directly related tests/types/call sites, require reviewer, then retry lifecycle_finish with same args.
//    - If resolver reports semantic ambiguity/scope expansion/validation exhaustion, use built-in question tool with compact options; plain chat only fallback.
//    - Never expose raw recovery hint in user-facing chat.
//
// 4. Add a read-only audit rule: when user asks whether an old lifecycle "lost updates" or force-pushed, call `lifecycle_lost_update_audit` or present its read-only steps; never rewrite history from audit.
//
// 5. Preserve byte-identical constraints by making equivalent edits in Task 3.2 for brainstormer action-map/effect-first content where tests require it.
```

**Verify:** `bun test tests/agents/commander-conflict-recovery.test.ts tests/agents/lifecycle-recovery-prompt.test.ts tests/agents/commander-lifecycle-recovery.test.ts`
**Commit:** `feat(agents): route commander merge conflicts to resolver flow`

### Task 3.2: Brainstormer Lifecycle Conflict Recovery Prompt
**File:** `src/agents/brainstormer.ts`
**Test:** `tests/agents/brainstormer-conflict-recovery.test.ts`
**Depends:** 1.4, 1.5, 2.3, 2.4
**Domain:** general
**Atlas-impact:** layer-update

```typescript
import { describe, expect, it } from "bun:test";

import { BRAINSTORMER_PROMPT } from "@/agents/brainstormer";
import { COMMANDER_PROMPT } from "@/agents/commander";

const extract = (source: string, tag: string): string => source.match(new RegExp(`<${tag}>[\\s\\S]*?<\\/${tag}>`))?.[0] ?? "";

describe("brainstormer conflict recovery UX", () => {
  it("keeps commander and brainstormer action-map byte-identical after conflict resolver update", () => {
    expect(extract(BRAINSTORMER_PROMPT, "action-map")).toBe(extract(COMMANDER_PROMPT, "action-map"));
  });

  it("contains question-first and decision-minimal protocols", () => {
    expect(BRAINSTORMER_PROMPT).toContain("QUESTION_FIRST_DECISION_PROTOCOL");
    expect(BRAINSTORMER_PROMPT).toContain("DECISION_MINIMAL_RESPONSE_PROTOCOL");
    expect(BRAINSTORMER_PROMPT).toContain("conflict resolver flow");
  });
});
```

```typescript
// Modify existing `src/agents/brainstormer.ts` only.
// Mirror Task 3.1's lifecycle recovery changes where commander/brainstormer drift guards require byte identity:
// - Import and inject DECISION_MINIMAL_RESPONSE_PROTOCOL and QUESTION_FIRST_DECISION_PROTOCOL.
// - Update the <bounded-recovery-loop><action-map> merge_conflict row to the exact same text as commander.
// - Ensure the <effect-first-reporting> block remains byte-identical to commander if edited; preferably do not edit it directly.
// - Add read-only lost-update audit guidance if brainstormer handles terminal lifecycle recovery/audit summaries.
```

**Verify:** `bun test tests/agents/brainstormer-conflict-recovery.test.ts tests/agents/lifecycle-recovery-prompt.test.ts tests/agents/effect-first-reporting.test.ts`
**Commit:** `feat(agents): keep brainstormer conflict recovery aligned`

### Task 3.3: Octto Decision-Minimal and Question-First Prompt
**File:** `src/agents/octto.ts`
**Test:** `tests/agents/octto-decision-minimal.test.ts`
**Depends:** 1.4, 1.5
**Domain:** general
**Atlas-impact:** layer-update

```typescript
import { describe, expect, it } from "bun:test";

import { octtoAgent } from "@/agents/octto";

const PROMPT = octtoAgent.prompt ?? "";

describe("octto decision-minimal response UX", () => {
  it("injects decision-minimal and question-first protocols", () => {
    expect(PROMPT).toContain("DECISION_MINIMAL_RESPONSE_PROTOCOL");
    expect(PROMPT).toContain("QUESTION_FIRST_DECISION_PROTOCOL");
  });

  it("keeps octto effect-first block semantically aligned but workflow-specific", () => {
    expect(PROMPT).toContain("预期表现");
    expect(PROMPT).toContain("你可以怎么验收");
    expect(PROMPT).toMatch(/brainstorm|end_brainstorm|session/i);
  });
});
```

```typescript
// Modify existing `src/agents/octto.ts` only.
// Import/inject DECISION_MINIMAL_RESPONSE_PROTOCOL and QUESTION_FIRST_DECISION_PROTOCOL.
// Add octto-specific rule: long review/session artifacts stay in octto/thoughts artifacts; terminal user chat only carries decision/acceptance/next-step summary.
// Do not make octto effect-first block byte-identical to commander; existing tests require semantic alignment but workflow-specific wording.
```

**Verify:** `bun test tests/agents/octto-decision-minimal.test.ts tests/agents/effect-first-reporting.test.ts`
**Commit:** `feat(agents): apply decision-minimal UX to octto`

### Task 3.4: Planner Prompt Contract for Response UX and Reviewer Coverage
**File:** `src/agents/planner.ts`
**Test:** `tests/agents/planner-response-ux.test.ts`
**Depends:** 1.4, 1.5
**Domain:** general
**Atlas-impact:** layer-update

```typescript
import { describe, expect, it } from "bun:test";

import { plannerAgent } from "@/agents/planner";

const PROMPT = plannerAgent.prompt ?? "";

describe("planner response UX planning rules", () => {
  it("requires behavior commitment mapping and decision-minimal response tasks", () => {
    expect(PROMPT).toContain("行为承诺映射");
    expect(PROMPT).toContain("decision-minimal");
    expect(PROMPT).toContain("question tool");
  });

  it("marks high-risk workflow/lifecycle/prompt surfaces as reviewer mandatory", () => {
    expect(PROMPT).toContain("reviewer mandatory");
    expect(PROMPT).toContain("workflow/lifecycle");
    expect(PROMPT).toContain("agent prompts");
  });
});
```

```typescript
// Modify existing `src/agents/planner.ts` only.
// Add planning rules that future plans must:
// - include `## 行为承诺映射` when the design has Behavior/Commitments;
// - map response-UX commitments to tasks, not just lifecycle code;
// - mark workflow/lifecycle, agent prompt, recovery, safety, and decision-minimal response changes as reviewer mandatory;
// - avoid exposing raw recovery hints in plan handoff text intended for users;
// - keep question tool as default for real user decision tasks.
// Do not break existing planner skeleton markers or output format tests.
```

**Verify:** `bun test tests/agents/planner-response-ux.test.ts tests/agents/planner.test.ts tests/agents/planner-lifecycle-recovery.test.ts`
**Commit:** `feat(agents): require response UX mapping in planner`

### Task 3.5: Implementer Compact Escalation Prompt
**File:** `src/agents/implementer.ts`
**Test:** `tests/agents/implementer-decision-minimal.test.ts`
**Depends:** 1.4
**Domain:** general
**Atlas-impact:** layer-update

```typescript
import { describe, expect, it } from "bun:test";

import { implementerAgent } from "@/agents/implementer";

const PROMPT = implementerAgent.prompt ?? "";

describe("implementer compact escalation", () => {
  it("keeps leaf escalation compact and internal", () => {
    expect(PROMPT).toContain("decision-minimal");
    expect(PROMPT).toContain("compact facts");
    expect(PROMPT).toContain("raw recovery hint");
  });

  it("does not tell implementer to ask the user directly", () => {
    expect(PROMPT).not.toMatch(/ask the user directly/i);
  });
});
```

```typescript
// Modify existing `src/agents/implementer.ts` only.
// Add leaf-agent escalation rules:
// - Implementers do not face the user; they return compact facts to executor.
// - For semantic ambiguity use a single-line escalation such as `Decision observation: needed — <scope> — <choice required>`.
// - Do not paste raw recovery hints, git logs, or reviewer checklists into final implementer reports.
// - For conflict resolver tasks, report modified files and scope rationale compactly.
```

**Verify:** `bun test tests/agents/implementer-decision-minimal.test.ts tests/agents/implementer-domain.test.ts`
**Commit:** `feat(agents): compact implementer escalation output`

### Task 3.6: AGENTS.md Mirror Update
**File:** `AGENTS.md`
**Test:** `tests/agents/agents-md-conflict-response-ux.test.ts`
**Depends:** 3.1, 3.2, 3.3, 3.4, 3.5
**Domain:** general
**Atlas-impact:** layer-update

```typescript
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const AGENTS_MD = readFileSync("AGENTS.md", "utf8");

describe("AGENTS.md conflict resolver and response UX mirror", () => {
  it("documents auto conflict resolver recovery and semantic question fallback", () => {
    expect(AGENTS_MD).toContain("conflict resolver");
    expect(AGENTS_MD).toContain("merge_conflict");
    expect(AGENTS_MD).toContain("built-in question");
    expect(AGENTS_MD).toContain("semantic ambiguity");
  });

  it("documents decision-minimal response contract", () => {
    expect(AGENTS_MD).toContain("decision-minimal");
    expect(AGENTS_MD).toContain("raw recovery hint");
    expect(AGENTS_MD).toContain("subagent raw reports");
  });

  it("preserves hard safety boundaries and read-only lost update audit", () => {
    expect(AGENTS_MD).toContain("no force push");
    expect(AGENTS_MD).toContain("--force-with-lease");
    expect(AGENTS_MD).toContain("reset --hard");
    expect(AGENTS_MD).toContain("lost-update audit");
    expect(AGENTS_MD).toContain("read-only");
  });
});
```

```markdown
<!-- Modify the existing `AGENTS.md`, do not rewrite it wholesale. -->

Add/update mirror text under the existing lifecycle recovery / response reporting sections:

- `merge_conflict` + `resolve_conflicts` now means: primary/coordinator starts bounded conflict resolver flow in the temp worktree instead of immediately halting.
- Resolver scope: conflict files plus small directly related tests/types/call sites; broad or unrelated expansion blocks.
- Semantic ambiguity: built-in `question` tool with compact options; plain chat only ultra-light/fallback.
- Decision-minimal response contract: user chat includes only decision, acceptance, and next-step information; raw recovery hint, subagent raw reports, reviewer checklist, and git logs stay internal unless explicitly requested.
- Lost-update audit is read-only and distinguishes force-push evidence, squash history confusion, semantic overwrite, push rejection race, and manual remote mutation without rewriting history.
- Preserve hard safety: no force push, no force-with-lease, no reset hard, no no-verify, no deleting user files, no auto restart.
```

**Verify:** `bun test tests/agents/agents-md-conflict-response-ux.test.ts tests/agents/agents-md-lifecycle-recovery.test.ts tests/agents/effect-first-reporting.test.ts`
**Commit:** `docs(agents): mirror conflict resolver response UX rules`

---

## Batch 4: Cross-Cutting Regression Guards (parallel - 3 implementers)

All tasks in this batch depend on Batch 3 completing.
Tasks: 4.1, 4.2, 4.3

### Task 4.1: End-to-End Conflict Resolver Recovery Guard
**File:** `tests/lifecycle/conflict-resolver-end-to-end.test.ts`
**Test:** `tests/lifecycle/conflict-resolver-end-to-end.test.ts`
**Depends:** 2.1, 2.2, 2.3, 2.6, 2.7
**Domain:** general
**Atlas-impact:** none

```typescript
import { describe, expect, it } from "bun:test";

import { evaluateConflictResolverScope } from "@/lifecycle/conflict-scope";
import { finishLifecycle } from "@/lifecycle/merge";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const FAIL = (stderr = "failed"): RunResult => ({ stdout: "", stderr, exitCode: 1 });

interface Call {
  readonly args: readonly string[];
  readonly cwd?: string;
}

const createRunner = (responses: ReadonlyMap<string, readonly RunResult[]>): { runner: LifecycleRunner; calls: Call[] } => {
  const calls: Call[] = [];
  const cursors = new Map<string, number>();
  const next = (args: readonly string[]): RunResult => {
    const key = args.join(" ");
    const list = responses.get(key);
    const index = cursors.get(key) ?? 0;
    cursors.set(key, index + 1);
    return list?.[Math.min(index, list.length - 1)] ?? OK();
  };
  return {
    calls,
    runner: {
      git: async (args, options) => {
        calls.push({ args, cwd: options?.cwd });
        return next(args);
      },
      gh: async () => OK("[]"),
    },
  };
};

describe("conflict resolver recovery end-to-end guard", () => {
  it("blocks first on unresolved conflict, then succeeds after direct-scope resolver edits", async () => {
    const first = createRunner(
      new Map([
        ["worktree add /tmp/micode-merge-issue-85 main", [OK()]],
        ["fetch origin main", [OK()]],
        ["merge --ff-only origin/main", [OK()]],
        ["merge --no-ff issue/85-x", [FAIL("CONFLICT")]],
        ["status --porcelain", [OK("UU src/lifecycle/merge.ts\n")]],
      ]),
    );

    const blocked = await finishLifecycle(first.runner, {
      cwd: "/repo/micode",
      branch: "issue/85-x",
      worktree: "/repo/issue-85",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });

    expect(blocked.merged).toBe(false);
    expect(blocked.recoveryHint?.failureKind).toBe("merge_conflict");
    expect(evaluateConflictResolverScope({ conflictFiles: ["src/lifecycle/merge.ts"], modifiedFiles: ["src/lifecycle/merge.ts", "tests/lifecycle/merge.test.ts"] }).status).toBe("allowed");

    const second = createRunner(
      new Map([
        ["worktree add /tmp/micode-merge-issue-85 main", [FAIL("already exists")]],
        ["diff --name-only --diff-filter=U", [OK("")]],
        ["status --porcelain", [OK("M  src/lifecycle/merge.ts\nM  tests/lifecycle/merge.test.ts\n")]],
        ["commit -m merge issue/85-x: resolve lifecycle conflicts", [OK()]],
        ["push origin main", [OK()]],
        ["worktree remove --force /tmp/micode-merge-issue-85", [OK()]],
        ["worktree list --porcelain", [OK("worktree /repo/issue-85\n")]],
        ["worktree remove /repo/issue-85", [OK()]],
        ["ls-files --others --exclude-standard", [OK()]],
        ["branch -d issue/85-x", [OK()]],
      ]),
    );

    const finished = await finishLifecycle(second.runner, {
      cwd: "/repo/micode",
      branch: "issue/85-x",
      worktree: "/repo/issue-85",
      mergeStrategy: "local-merge",
      waitForChecks: false,
      baseBranch: "main",
    });

    expect(finished.merged).toBe(true);
    const commands = second.calls.map((call) => call.args.join(" "));
    expect(commands).toContain("push origin main");
    expect(commands.some((command) => command.includes("--force-with-lease"))).toBe(false);
    expect(commands.some((command) => command.includes("--no-verify"))).toBe(false);
    expect(commands.some((command) => command.startsWith("reset --hard"))).toBe(false);
  });
});
```

```typescript
// No implementation file: this is a cross-cutting regression test for Tasks 1.1, 1.2, 2.1, and 2.3.
```

**Verify:** `bun test tests/lifecycle/conflict-resolver-end-to-end.test.ts`
**Commit:** `test(lifecycle): guard conflict resolver end-to-end recovery`

### Task 4.2: Decision-Minimal Prompt Injection Drift Guard
**File:** `tests/agents/decision-minimal-injection.test.ts`
**Test:** `tests/agents/decision-minimal-injection.test.ts`
**Depends:** 3.1, 3.2, 3.3, 3.4, 3.5, 3.6
**Domain:** general
**Atlas-impact:** none

```typescript
import { describe, expect, it } from "bun:test";

import { BRAINSTORMER_PROMPT } from "@/agents/brainstormer";
import { COMMANDER_PROMPT } from "@/agents/commander";
import { executorAgent } from "@/agents/executor";
import { implementerAgent } from "@/agents/implementer";
import { octtoAgent } from "@/agents/octto";
import { plannerAgent } from "@/agents/planner";
import { reviewerAgent } from "@/agents/reviewer";

const PROMPTS = {
  commander: COMMANDER_PROMPT,
  brainstormer: BRAINSTORMER_PROMPT,
  octto: octtoAgent.prompt ?? "",
  planner: plannerAgent.prompt ?? "",
  executor: executorAgent.prompt ?? "",
  reviewer: reviewerAgent.prompt ?? "",
  implementer: implementerAgent.prompt ?? "",
};

const extractBlock = (source: string, tag: string): string => source.match(new RegExp(`<${tag}[^>]*>[\\s\\S]*?<\\/${tag}>`))?.[0] ?? "";

describe("decision-minimal prompt injection", () => {
  it("injects decision-minimal response guidance into all relevant agents", () => {
    for (const [name, prompt] of Object.entries(PROMPTS)) {
      expect(prompt, name).toContain("decision-minimal");
      expect(prompt, name).toContain("raw recovery hint");
    }
  });

  it("injects question-first guidance into decision-owning agents", () => {
    for (const [name, prompt] of Object.entries({ commander: COMMANDER_PROMPT, brainstormer: BRAINSTORMER_PROMPT, octto: PROMPTS.octto, executor: PROMPTS.executor })) {
      expect(prompt, name).toContain("built-in question");
      expect(prompt, name).toContain("plain chat");
    }
  });

  it("preserves commander/brainstormer byte-identical guarded blocks", () => {
    expect(extractBlock(COMMANDER_PROMPT, "action-map")).toBe(extractBlock(BRAINSTORMER_PROMPT, "action-map"));
    expect(extractBlock(COMMANDER_PROMPT, "effect-first-reporting")).toBe(extractBlock(BRAINSTORMER_PROMPT, "effect-first-reporting"));
  });
});
```

```typescript
// No implementation file: this is a drift guard for prompt edits in Batch 3.
```

**Verify:** `bun test tests/agents/decision-minimal-injection.test.ts tests/agents/effect-first-reporting.test.ts tests/agents/lifecycle-recovery-prompt.test.ts`
**Commit:** `test(agents): guard decision-minimal prompt injection`

### Task 4.3: Lost Update Audit Safety Regression
**File:** `tests/lifecycle/lost-update-audit-safety.test.ts`
**Test:** `tests/lifecycle/lost-update-audit-safety.test.ts`
**Depends:** 2.4, 2.5, 3.1, 3.6
**Domain:** general
**Atlas-impact:** none

```typescript
import { describe, expect, it } from "bun:test";

import { createLostUpdateAuditPlan } from "@/lifecycle/lost-update-audit";
import { createLifecycleTools } from "@/tools/lifecycle";

describe("lost update audit safety", () => {
  it("never suggests mutating git or GitHub commands", () => {
    const plan = createLostUpdateAuditPlan({ issueNumber: 85, baseBranch: "main", suspectedBranch: "issue/85-x" });
    const commands = plan.steps.map((step) => step.command);

    expect(commands.every((command) => !/^git push\b/.test(command))).toBe(true);
    expect(commands.every((command) => !command.includes("--force"))).toBe(true);
    expect(commands.every((command) => !command.includes("reset --hard"))).toBe(true);
    expect(commands.every((command) => !/^gh pr merge\b/.test(command))).toBe(true);
    expect(commands.every((command) => !/^gh issue edit\b/.test(command))).toBe(true);
  });

  it("is available from lifecycle tools without requiring a lifecycle handle mutation path", () => {
    const tools = createLifecycleTools({} as never);
    expect(tools.lifecycle_lost_update_audit).toBeDefined();
  });
});
```

```typescript
// No implementation file: this is a safety regression for Tasks 1.3, 2.4, and 2.5.
```

**Verify:** `bun test tests/lifecycle/lost-update-audit-safety.test.ts tests/tools/lifecycle/lost-update-audit.test.ts`
**Commit:** `test(lifecycle): guard lost update audit safety`
