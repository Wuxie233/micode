---
date: 2026-05-18
topic: "executor-direct script granularity guard"
issue: 96
scope: agents
contract: none
---

# executor-direct Script Granularity Guard Implementation Plan

**Goal:** Add a narrow prompt contract guard that makes "single session" in executor-direct mean one subagent session — not one bash command or one generated multi-purpose script — while keeping legitimate single-purpose mechanical scripts and existing bash/Python capability untouched.

**Architecture:** Three coordinated prompt updates plus a dedicated drift-guard test file. (1) Extend the `executor-direct` subagent prompt with a `<script-granularity-guard>` block that codifies single-session-not-single-script, native-file-ops-first, and the multi-purpose-script ban. (2) Sync the `direct-execution` output-class wording in `commander` and `brainstormer` so callers route by the same contract. (3) Add a project AGENTS.md mirror section guarded by grep-based assertions. All changes are pure prompt strings; no runtime/spawn/lifecycle/reviewer behavior changes.

**Design:** No design.md was committed for this issue; the user-approved design summary is in the issue body and in Project Memory entity `executor-direct-script-granularity-guard` (decisions sourced from `lifecycle:#96`).

**Contract:** `none` (single-domain prompt-only change; no frontend ↔ backend interface).

---

## 行为承诺映射

issue #96 body 与 Project Memory `executor-direct-script-granularity-guard` 列出以下用户可见行为承诺：

- 行为 1（`single session` 含义是 one subagent session，不是 one bash command 或 one generated script）→ 由 Batch 2 Task 2.1 在 `executor-direct.ts` 的新 `<script-granularity-guard>` 块中明文写入；由 Batch 1 Task 1.1 的 `executor-direct-script-granularity.test.ts` 验证。
- 行为 2（executor-direct 保留正常 per-operation tool cadence，不允许把多个语义步骤打包进一个长脚本）→ 由 Batch 2 Task 2.1 在 prompt 中写入"prefer normal per-operation tool cadence"；由 Batch 1 Task 1.1 验证关键字符串落地。
- 行为 3（file mutation 优先用 native read/edit/write，generated 脚本只在窄机械操作时使用）→ 由 Batch 2 Task 2.1 在 prompt 中写入；由 Batch 1 Task 1.1 验证。
- 行为 4（generated script 不允许同时承担 discovery + mutation + verification + reporting 四种职责）→ 由 Batch 2 Task 2.1 在 prompt 中写入明确的"forbidden combinations"语句；由 Batch 1 Task 1.1 验证关键字符串。
- 行为 5（commander 与 brainstormer 的 `direct-execution` 路由说明与 executor-direct 的脚本粒度规则一致）→ 由 Batch 2 Task 2.2 与 Task 2.3 在两个 coordinator 的 `<output-class name="direct-execution">` 块中补一行 cross-reference；由 Batch 1 Task 1.1 用对称 substring 断言守护。
- 行为 6（既有承诺均不被弱化：subagent information gathering、Lens Swarm、executor batch parallelism、question batching、context capsule 行为不变；spawn_agent/runtime/executor reviewer flow 不变；Python/shell 不被禁用）→ 由 Batch 2 三个 task 仅追加 prompt 字段、不修改既有承诺字段保证；由 Batch 1 Task 1.1 加一条"non-regression" 断言：现有 `<not-this-role>` / `<hard-restrictions>` / `<escalation>` 关键 token 仍存在。
- 行为 7（AGENTS.md 项目镜像存在，命名一致，grep-based drift-guard 守护）→ 由 Batch 3 Task 3.1 在 AGENTS.md 追加 `## executor-direct Script Granularity Guard` 段；由 Batch 1 Task 1.1 增加 grep-based 断言读取 AGENTS.md。

**未对应任何 task 的行为**：无。

**Behavior commitment (effect-first 终态汇报对照源)**：用户使用 executor-direct 时，看到的行为变化是：不再产出"先把 ls/grep/python -c 'change'/python -c 'verify' 全揉进一个 bash heredoc"那种巨型脚本；executor-direct 会用 read/edit/write 一步步做，多步操作走多个 tool call，只有真正机械的单一步操作（例如批量文件重命名、批量替换、批量行删除）才允许一段脚本。

---

## Review Policy

- **Reviewer mandatory:** Task 2.1 (executor-direct prompt — direct workflow contract change), Task 2.2 (commander direct-execution output-class — agent routing surface), Task 2.3 (brainstormer direct-execution output-class — agent routing surface), Task 3.1 (AGENTS.md mirror — drift-guard surface). Mandatory reason: agent prompts + direct-execution routing + workflow contract; falls inside the high-risk mandatory list (agent prompts, dispatch routing, planner/executor/reviewer contracts, Behavior/Commitments).
- **Reviewer-skip eligible:** none. Even Task 1.1 (drift-guard test file) is treated reviewer-mandatory by convention because it encodes the contract; the existing whitelist exemptions (prompt wording tweak without contract change / pure type narrowing / pure format) do not apply when the change *is* the contract.
- **Risk observations:** From design summary — risk of weakening normal tool cadence is countered by explicit "preserve per-operation cadence" wording (Task 2.1). Risk of accidentally banning Python/shell is countered by the explicit single-purpose-allowed clause (Task 2.1). Risk of cross-coordinator drift is countered by Task 1.1 asserting on all three source files plus AGENTS.md.

---

## Dependency Graph

```
Batch 1 (parallel): 1.1 [foundation - failing drift-guard test, no deps]
Batch 2 (parallel): 2.1, 2.2, 2.3 [prompt updates - depends on 1.1 having defined the contract via test assertions]
Batch 3 (parallel): 3.1 [AGENTS.md mirror - depends on 2.x landing so wording matches]
```

---

## Batch 1: Foundation (parallel - 1 implementer)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1

### Task 1.1: New drift-guard test file for script granularity guard
**File:** `tests/agents/executor-direct-script-granularity.test.ts`
**Test:** (this task IS the test file; no companion test needed)
**Depends:** none
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — encodes the prompt contract; drift-guard tests for agent-prompt contracts are mandatory reviewer surface.

Write the file fresh. It is a grep-based drift-guard test: it reads the three source files (`executor-direct.ts`, `commander.ts`, `brainstormer.ts`) and `AGENTS.md` as text and asserts on key substrings. This pattern matches the existing `executor-direct-routing.test.ts` style (which is already in the repo).

Place the file at `tests/agents/executor-direct-script-granularity.test.ts`:

```typescript
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { executorDirectAgent } from "../../src/agents/executor-direct";

const REPO_ROOT = join(__dirname, "..", "..");
const COMMANDER_SOURCE = readFileSync(join(REPO_ROOT, "src", "agents", "commander.ts"), "utf-8");
const BRAINSTORMER_SOURCE = readFileSync(join(REPO_ROOT, "src", "agents", "brainstormer.ts"), "utf-8");
const AGENTS_MD = readFileSync(join(REPO_ROOT, "AGENTS.md"), "utf-8");

const EXECUTOR_DIRECT_PROMPT = executorDirectAgent.prompt ?? "";

const findOutputBody = (source: string, output: string, agent: string): string => {
  const match = source.match(
    new RegExp(`<output-class name="${output}" agent="${agent}">([\\s\\S]*?)<\\/output-class>`),
  );

  return match?.[1] ?? "";
};

const DIRECT_EXECUTION_COMMANDER = findOutputBody(COMMANDER_SOURCE, "direct-execution", "executor-direct");
const DIRECT_EXECUTION_BRAINSTORMER = findOutputBody(BRAINSTORMER_SOURCE, "direct-execution", "executor-direct");

describe("executor-direct script granularity guard (issue #96)", () => {
  describe("executor-direct prompt", () => {
    it("contains a script-granularity-guard block", () => {
      expect(EXECUTOR_DIRECT_PROMPT).toContain("<script-granularity-guard");
      expect(EXECUTOR_DIRECT_PROMPT).toContain("</script-granularity-guard>");
    });

    it("clarifies single session means one subagent session, not one bash command or one generated script", () => {
      const prompt = EXECUTOR_DIRECT_PROMPT.toLowerCase();
      expect(prompt).toContain("single session");
      expect(prompt).toContain("one subagent session");
      // Forbidden equivalences explicitly called out:
      expect(prompt).toMatch(/not\s+one\s+bash\s+command/);
      expect(prompt).toMatch(/not\s+one\s+(generated\s+)?script/);
    });

    it("prefers native read/edit/write for file mutation", () => {
      const prompt = EXECUTOR_DIRECT_PROMPT.toLowerCase();
      expect(prompt).toMatch(/prefer\s+native\s+(read\/edit\/write|read,?\s+edit,?\s+write)/);
    });

    it("preserves normal per-operation tool cadence", () => {
      const prompt = EXECUTOR_DIRECT_PROMPT.toLowerCase();
      expect(prompt).toMatch(/per[-\s]operation\s+tool\s+cadence/);
    });

    it("forbids one generated script combining discovery + mutation + verification + reporting", () => {
      const prompt = EXECUTOR_DIRECT_PROMPT.toLowerCase();
      // All four responsibility words must be named in the forbidden-combination rule.
      expect(prompt).toContain("discovery");
      expect(prompt).toContain("mutation");
      expect(prompt).toContain("verification");
      expect(prompt).toContain("reporting");
      // And the rule must explicitly say a script must not combine them.
      expect(prompt).toMatch(/must\s+not\s+combine|never\s+combine|do\s+not\s+combine/);
    });

    it("keeps single-purpose mechanical scripts explicitly allowed (does not ban python/shell)", () => {
      const prompt = EXECUTOR_DIRECT_PROMPT.toLowerCase();
      // The narrow exception must be present.
      expect(prompt).toMatch(/single[-\s]purpose|one\s+narrow\s+mechanical/);
      // Negative assertion: the prompt must NOT outright ban python or shell.
      expect(prompt).not.toMatch(/never\s+use\s+python/);
      expect(prompt).not.toMatch(/never\s+use\s+shell/);
      expect(prompt).not.toMatch(/python\s+is\s+forbidden/);
      expect(prompt).not.toMatch(/shell\s+is\s+forbidden/);
    });
  });

  describe("non-regression on existing executor-direct prompt contract", () => {
    it("still declares the four escalation targets", () => {
      const prompt = EXECUTOR_DIRECT_PROMPT.toLowerCase();
      expect(prompt).toContain("investigator");
      expect(prompt).toContain("planner");
      expect(prompt).toContain("executor");
      expect(prompt).toContain("user confirmation");
    });

    it("still forbids spawn_agent, plans, lifecycle ownership, default commit/push, restart, secret output", () => {
      const prompt = EXECUTOR_DIRECT_PROMPT.toLowerCase();
      expect(prompt).toContain("spawn_agent");
      expect(prompt).toContain("plan");
      expect(prompt).toContain("lifecycle");
      expect(prompt).toContain("commit");
      expect(prompt).toContain("push");
      expect(prompt).toContain("restart");
      expect(prompt).toContain("secret");
    });

    it("still requires the execution-envelope, self-review, verification rules", () => {
      const prompt = EXECUTOR_DIRECT_PROMPT.toLowerCase();
      expect(prompt).toContain("execution envelope");
      expect(prompt).toContain("self-review");
      expect(prompt).toContain("verification");
    });
  });

  describe("commander direct-execution output-class", () => {
    it("declares the executor-direct output-class is present", () => {
      expect(DIRECT_EXECUTION_COMMANDER.length).toBeGreaterThan(0);
    });

    it("references the script-granularity rule (single session is not one script)", () => {
      const body = DIRECT_EXECUTION_COMMANDER.toLowerCase();
      expect(body).toMatch(/script\s+granularity|one\s+subagent\s+session|not\s+one\s+(generated\s+)?script/);
    });
  });

  describe("brainstormer direct-execution output-class", () => {
    it("declares the executor-direct output-class is present", () => {
      expect(DIRECT_EXECUTION_BRAINSTORMER.length).toBeGreaterThan(0);
    });

    it("references the script-granularity rule (single session is not one script)", () => {
      const body = DIRECT_EXECUTION_BRAINSTORMER.toLowerCase();
      expect(body).toMatch(/script\s+granularity|one\s+subagent\s+session|not\s+one\s+(generated\s+)?script/);
    });
  });

  describe("AGENTS.md project mirror", () => {
    it("has the executor-direct Script Granularity Guard section heading", () => {
      expect(AGENTS_MD).toMatch(/^##\s+executor-direct\s+Script\s+Granularity\s+Guard\s*$/m);
    });

    it("documents single-session-is-one-subagent-session, native-file-ops-first, multi-purpose-script-ban", () => {
      const md = AGENTS_MD.toLowerCase();
      expect(md).toMatch(/one\s+subagent\s+session/);
      expect(md).toMatch(/native\s+(read\/edit\/write|read,?\s+edit,?\s+write)/);
      expect(md).toMatch(/discovery.*mutation.*verification.*reporting|多用途|multi[-\s]purpose/s);
    });

    it("names the prompt single-source for drift guard", () => {
      // The mirror must point at src/agents/executor-direct.ts (single source of truth).
      expect(AGENTS_MD).toContain("src/agents/executor-direct.ts");
    });
  });
});
```

**Verify:** `bun test tests/agents/executor-direct-script-granularity.test.ts`

This test MUST fail initially against the current source (it asserts on prompt content and AGENTS.md content that does not yet exist). Verification of the failing state is part of the TDD step. After Batches 2 and 3 land, this test must pass.

**Commit:** `test(agents): add executor-direct script granularity drift guard for issue #96`

---

## Batch 2: Prompt Updates (parallel - 3 implementers)

All tasks in this batch depend on Batch 1 completing (the test file from 1.1 defines the contract these prompts must satisfy).
Tasks: 2.1, 2.2, 2.3

### Task 2.1: Add `<script-granularity-guard>` block to executor-direct prompt
**File:** `src/agents/executor-direct.ts`
**Test:** `tests/agents/executor-direct-script-granularity.test.ts` (created in Task 1.1)
**Depends:** 1.1
**Domain:** general
**Atlas-impact:** none (no atlas/20-behavior node mapped; behavior commitment captured in plan 行为承诺映射 + Project Memory)
**Review policy:** mandatory — agent prompt + workflow contract change. Falls inside the high-risk mandatory list (agent prompts, dispatch routing, workflow contract).

Insert a new `<script-granularity-guard>` block in the prompt template literal between the existing `<hard-restrictions>` block and the existing `<execution-envelope priority="critical">` block. Do NOT remove or rewrite any existing block; this is purely additive.

Exact insertion location: after the closing `</hard-restrictions>` tag (currently line 39 of `src/agents/executor-direct.ts`, immediately before the blank line and `<execution-envelope priority="critical">`).

The block content (paste verbatim into the template literal, preserving the surrounding backtick escape style):

```typescript
<script-granularity-guard priority="critical">
"Single session" means ONE subagent session — it does NOT mean one bash command, one heredoc, or one
generated Python/shell script that batches every step together. You preserve the normal per-operation
tool cadence: each semantic step (read a file, edit a file, run a build, run a test, deploy) is its
own tool call, just like any other subagent.

<rule>For file mutations, prefer native read/edit/write tools over generated scripts. A read tool
call followed by an edit tool call followed by another read for verification is the correct shape.
A Python or shell script that opens a file, mutates it, then re-reads it is the wrong shape unless
the mutation is itself a single narrow mechanical operation (see exception below).</rule>

<rule>A generated Python or shell script is allowed ONLY when it performs ONE narrow mechanical
operation — for example: bulk-renaming N matching files, applying the same regex substitution across
many files, deleting a known set of lines, or producing a deterministic build artifact. The script
does that one operation and exits. It does NOT also discover targets, run verification afterward,
collect logs into a summary, or report status.</rule>

<rule>A generated script MUST NOT combine discovery + mutation + verification + reporting into a
single artifact. Those are four distinct responsibilities and they live in four distinct tool calls
(or fewer; verification may be a single tool call against an existing test runner). If you find
yourself writing a script that does \`find files, edit them, run tests, then print a summary\`,
STOP and break it into separate tool calls instead.</rule>

<rule>Python and shell are NOT banned. The bash tool is enabled and you may write Python scripts
for legitimate single-purpose mechanical work, one-off data conversions, build invocations, or
anything else where a script is the natural shape. The constraint is on responsibility-combination,
not on language choice.</rule>

<rule>The Execution Envelope's "Targets" field and "Verification" field remain authoritative.
Whatever shape your work takes (multiple read/edit calls, a single mechanical script, a sequence of
build commands), it MUST stay inside Targets and MUST satisfy Verification. The script granularity
guard does not relax or widen scope — it only constrains the shape of any generated script.</rule>
</script-granularity-guard>
```

After insertion, the prompt section ordering becomes: `<not-this-role>` → `<hard-restrictions>` → `<script-granularity-guard>` → `<execution-envelope>` → `<process>` → ... (rest unchanged).

Do NOT modify the `tools` config (write, edit, bash remain enabled). Do NOT modify any other prompt block. Do NOT modify the agent description.

**Verify:** `bun test tests/agents/executor-direct-script-granularity.test.ts tests/agents/executor-direct.test.ts`

**Commit:** `feat(agents): add script-granularity-guard to executor-direct prompt (issue #96)`

---

### Task 2.2: Sync `direct-execution` output-class wording in commander
**File:** `src/agents/commander.ts`
**Test:** `tests/agents/executor-direct-script-granularity.test.ts` (created in Task 1.1)
**Depends:** 1.1
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — agent routing surface (commander's output-class block) + workflow contract sync. Falls inside the high-risk mandatory list.

Edit ONE block: the existing `<output-class name="direct-execution" agent="executor-direct">` block (currently lines 503-520 of `src/agents/commander.ts`). Append ONE new paragraph at the end of the existing block content, immediately before the closing `</output-class>` tag.

Exact text to append (preserve the existing block's indentation; the paragraph is two sentences on consecutive lines for readability):

```
  Script granularity: "single session" means ONE subagent session, not one bash command or one
  generated script. executor-direct preserves the normal per-operation tool cadence and prefers
  native read/edit/write for file mutation; a generated Python/shell script is allowed only for
  one narrow mechanical operation and must not combine discovery + mutation + verification +
  reporting. This is the prompt-contract source of truth in src/agents/executor-direct.ts.
```

After insertion, the closing `</output-class>` tag remains as-is. Do NOT modify any other block, any other output-class, or any anti-pattern rule. Do NOT remove or reword the existing paragraphs.

**Verify:** `bun test tests/agents/executor-direct-script-granularity.test.ts tests/agents/executor-direct-routing.test.ts`

**Commit:** `feat(agents): sync direct-execution wording in commander with script granularity guard (issue #96)`

---

### Task 2.3: Sync `direct-execution` output-class wording in brainstormer
**File:** `src/agents/brainstormer.ts`
**Test:** `tests/agents/executor-direct-script-granularity.test.ts` (created in Task 1.1)
**Depends:** 1.1
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — agent routing surface (brainstormer's output-class block) + workflow contract sync. Falls inside the high-risk mandatory list.

Edit ONE block: the existing `<output-class name="direct-execution" agent="executor-direct">` block (currently lines 255-272 of `src/agents/brainstormer.ts`). Append ONE new paragraph at the end of the existing block content, immediately before the closing `</output-class>` tag.

Exact text to append (preserve the existing block's indentation):

```
  Script granularity: "single session" means ONE subagent session, not one bash command or one
  generated script. executor-direct preserves the normal per-operation tool cadence and prefers
  native read/edit/write for file mutation; a generated Python/shell script is allowed only for
  one narrow mechanical operation and must not combine discovery + mutation + verification +
  reporting. This is the prompt-contract source of truth in src/agents/executor-direct.ts.
```

After insertion, the closing `</output-class>` tag remains as-is. Do NOT modify any other block, any other output-class, the `<combinations>` block, or the `<available-subagents>` listing. Do NOT remove or reword the existing paragraphs.

NOTE: This paragraph is intentionally byte-identical to the one appended in commander (Task 2.2). Both coordinators must carry the same wording so the cross-coordinator drift-guard test from Task 1.1 (which asserts on substring presence in both files) passes consistently.

**Verify:** `bun test tests/agents/executor-direct-script-granularity.test.ts tests/agents/executor-direct-routing.test.ts`

**Commit:** `feat(agents): sync direct-execution wording in brainstormer with script granularity guard (issue #96)`

---

## Batch 3: Project AGENTS.md Mirror (parallel - 1 implementer)

All tasks in this batch depend on Batch 2 completing (the AGENTS.md section must reference the wording that has actually landed in the agent prompts).
Tasks: 3.1

### Task 3.1: Add `## executor-direct Script Granularity Guard` section to project AGENTS.md
**File:** `AGENTS.md`
**Test:** `tests/agents/executor-direct-script-granularity.test.ts` (created in Task 1.1)
**Depends:** 2.1, 2.2, 2.3
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — drift-guard surface (the AGENTS.md mirror is what Task 1.1's grep-based test reads to detect divergence between docs and prompts). Falls inside the high-risk mandatory list (any documentation that backs a drift-guard test is part of the prompt contract surface).

Append a new section to `/root/CODE/micode/AGENTS.md`. Insert it immediately after the existing `## Bounded Upstream Continuation Retry` section (ends around line 333) and before the existing `## Knowledge Bootstrap Commands` section (starts at line 335). Use the existing section header style (`## ` + Title Case English heading).

Exact section content to insert (verbatim, including blank lines around it for legibility):

```markdown
## executor-direct Script Granularity Guard

micode 给 `executor-direct` / direct-execution 加一条窄的 prompt 契约：`single session` 指 one subagent session，不是 one bash command 也不是 one generated script。executor-direct 保持正常的 per-operation tool cadence（每个语义步骤一个 tool call），文件改动优先用 native read/edit/write，generated 的 Python/shell 脚本只在做 one narrow mechanical operation（批量重命名、批量正则替换、批量行删除、单次 build artifact 之类）时允许使用，且不得在同一段脚本里同时承担 discovery + mutation + verification + reporting 四种职责。

### 不引入

- 不禁用 Python/shell；bash 工具仍然启用，单一职责脚本仍然合法。
- 不改 spawn_agent / runtime / executor reviewer flow / lifecycle 行为。
- 不弱化既有承诺：subagent 信息采集、Lens Swarm、executor batch parallelism、question batching、context capsule 行为均不变。
- 不引入全局 tool scheduling 协议；本规则只覆盖 executor-direct / direct-execution 这一条窄路径。

### Drift guard

Prompt 单源在 `src/agents/executor-direct.ts` 的 `<script-granularity-guard>` 块。`src/agents/commander.ts` 与 `src/agents/brainstormer.ts` 的 `<output-class name="direct-execution">` 块各自追加一段同义说明用于路由层 cross-reference，但不引入 byte-identical 镜像；`tests/agents/executor-direct-script-granularity.test.ts` 用 grep-based 关键字符串守护：single session / one subagent session / not one bash command / not one generated script / native read/edit/write / per-operation tool cadence / discovery + mutation + verification + reporting 等 token 必须同时出现在 prompt 源、两个 coordinator 的 `direct-execution` 块、以及本节中。本节是 markdown 镜像，命名与段落顺序需保持一致。
```

Do NOT modify any other section. Do NOT renumber or reorder existing sections. The new section sits between `Bounded Upstream Continuation Retry` and `Knowledge Bootstrap Commands`.

**Verify:** `bun test tests/agents/executor-direct-script-granularity.test.ts`

This is the last task; after it lands, all assertions in Task 1.1's test file must pass (drift-guard test now green across prompt source + commander block + brainstormer block + AGENTS.md mirror).

**Commit:** `docs(agents): mirror script granularity guard in project AGENTS.md (issue #96)`
