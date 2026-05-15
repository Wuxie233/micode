---
date: 2026-05-16
topic: "executor-direct-sensitive-routing"
issue: 82
scope: agents
contract: none
---

# Executor-direct 敏感路由小步放宽 Implementation Plan

**Goal:** 让 primary agent 在“用户明确要求 direct + bounded scope + named target + verification + 无高风险语义变化”时可以派 `executor-direct`，同时保留 routing / permissions / lifecycle / deploy / restart / slash command / runtime boot 等高风险变化必须走 lifecycle + planner + executor 的边界。

**Architecture:** 本计划只改 primary agent prompt/routing contract 与测试守卫，不改 lifecycle 工具、不改 lifecycle 状态机、不改 `executor-direct` 本体。Brainstormer 与 Commander 共享同一条“小步放宽”语义：敏感面默认保守，但存在显式窄例外；真正改变路由、权限、lifecycle、deploy/restart policy、slash command contract、runtime boot registration 或跨模块行为的请求仍然强制 plan。

**Design:** `thoughts/shared/designs/2026-05-16-executor-direct-sensitive-routing-design.md`

**Contract:** none

---

## 行为承诺映射

| Behavior / Commitment | Covered by tasks | Notes |
|---|---|---|
| 用户明确要求 direct、目标/验证/副作用边界清楚时，非语义敏感面小修可以跳过 planner 派 `executor-direct` | 1.1, 2.1, 2.2 | 通过 cross-coordinator prompt contract 测试与两个 primary prompt 的 direct-execution 文案实现。 |
| routing、tool permissions、lifecycle、deploy/restart、slash command contract、runtime boot registration 等行为变化仍必须 lifecycle + planner + executor | 1.1, 1.2, 1.3, 2.1, 2.2 | 测试同时覆盖正例和反例，避免窄例外漂移成通用逃生通道。 |
| runtime 源码小修未执行 `bun run deploy:runtime` 时，终态报告必须说明 live runtime 尚未生效 | 1.1, 2.1, 2.2, 3.1 | prompt 明确要求 direct 路由报告 deploy/restart status；Atlas 同步 runtime 行为边界。 |
| 不新增 agent 类型、不新增 runner lane、不改 lifecycle 工具、不改 `executor-direct` 本体 | 1.1, 2.1, 2.2 | 只触碰 `brainstormer.ts`、`commander.ts`、相关 tests 与 Atlas behavior 节点。 |

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2, 1.3 [tests first - no deps]
Batch 2 (parallel): 2.1, 2.2 [primary prompt updates - depends on batch 1]
Batch 3 (parallel): 3.1 [knowledge model update - depends on batch 2]
```

---

## Batch 1: Tests First (parallel - 3 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3

### Task 1.1: Cross-coordinator sensitive direct exception tests
**File:** `tests/agents/executor-direct-routing.test.ts`
**Test:** `tests/agents/executor-direct-routing.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** none

```typescript
// Replace tests/agents/executor-direct-routing.test.ts with this complete file.
// Run it before prompt implementation and confirm the new tests fail, then rerun after Batch 2.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const EXECUTOR_DIRECT_AGENT = "executor-direct";
const EXECUTOR_AGENT = "executor";
const COMMANDER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "commander.ts"), "utf-8");
const BRAINSTORMER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"), "utf-8");
const EXECUTOR_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "executor.ts"), "utf-8");

const COORDINATORS = [
  { name: "commander", source: COMMANDER_SOURCE },
  { name: "brainstormer", source: BRAINSTORMER_SOURCE },
];

const PRESERVED_OUTPUT_CLASSES = [
  { name: "location", agent: "codebase-locator" },
  { name: "explanation", agent: "codebase-analyzer" },
  { name: "diagnosis", agent: "investigator" },
  { name: "mutation", agent: EXECUTOR_AGENT },
] as const;

const HIGH_RISK_SURFACES = [
  "agent routing",
  "tool permissions",
  "lifecycle rules",
  "slash command contract",
  "runtime boot registration",
  "deploy/restart policy",
] as const;

const findOutputAgent = (source: string, output: string): string | undefined => {
  const match = source.match(new RegExp(`<output-class name="${output}" agent="([^"]+)">`));

  return match?.[1];
};

const findOutputBody = (source: string, output: string, agent: string): string => {
  const match = source.match(
    new RegExp(`<output-class name="${output}" agent="${agent}">([\\s\\S]*?)<\\/output-class>`),
  );

  return match?.[1] ?? "";
};

const findBlock = (source: string, blockName: string): string => {
  const match = source.match(new RegExp(`<${blockName}[^>]*>([\\s\\S]*?)<\\/${blockName}>`));

  return match?.[0] ?? "";
};

describe("executor-direct routing contract (cross-coordinator)", () => {
  for (const coord of COORDINATORS) {
    describe(coord.name, () => {
      it("declares direct-execution as the executor-direct output class", () => {
        expect(findOutputAgent(coord.source, "direct-execution")).toBe(EXECUTOR_DIRECT_AGENT);
      });

      it("describes direct-execution as no-plan and bounded or scoped", () => {
        const body = findOutputBody(coord.source, "direct-execution", EXECUTOR_DIRECT_AGENT).toLowerCase();

        expect(body).toContain("no plan");
        expect(body).toMatch(/bounded|scoped/);
      });

      it("preserves existing routing class agent mappings", () => {
        for (const outputClass of PRESERVED_OUTPUT_CLASSES) {
          expect(findOutputAgent(coord.source, outputClass.name)).toBe(outputClass.agent);
        }
      });

      it("registers executor-direct in its agents or subagents listing", () => {
        const agentTag = /<agent\s+name="executor-direct"[^>]*mode="subagent"/.test(coord.source);
        const subagentTag = /<subagent\s+name="executor-direct">/.test(coord.source);

        expect(agentTag || subagentTag).toBe(true);
      });

      it("allows only an explicit bounded direct exception", () => {
        const directBody = findOutputBody(coord.source, "direct-execution", EXECUTOR_DIRECT_AGENT).toLowerCase();

        expect(directBody).toContain("explicit bounded exception");
        expect(directBody).toMatch(/user.*(explicit|direct)|explicit.*user/);
        expect(directBody).toContain("named targets");
        expect(directBody).toContain("verification");
        expect(directBody).toMatch(/no side[-\s]?effect|side[-\s]?effect boundary/);
        expect(directBody).toMatch(/no .*contract|contract.*no/);
      });

      it("keeps high-risk behavior changes plan-driven", () => {
        const combined = `${findBlock(coord.source, "non-trivial-detector")}\n${findOutputBody(
          coord.source,
          "direct-execution",
          EXECUTOR_DIRECT_AGENT,
        )}`.toLowerCase();

        for (const surface of HIGH_RISK_SURFACES) {
          expect(combined).toContain(surface);
        }
        expect(combined).toMatch(/lifecycle \+ planner \+ executor|planner \+ executor/);
      });

      it("requires runtime-source direct fixes to report deploy status", () => {
        const body = findOutputBody(coord.source, "direct-execution", EXECUTOR_DIRECT_AGENT).toLowerCase();

        expect(body).toContain("bun run deploy:runtime");
        expect(body).toMatch(/live opencode runtime|live runtime/);
        expect(body).toMatch(/not (yet )?effective|尚未生效|not deployed/);
      });
    });
  }

  it("both coordinators agree on the executor-direct agent name spelling", () => {
    expect(findOutputAgent(COMMANDER_SOURCE, "direct-execution")).toBe(EXECUTOR_DIRECT_AGENT);
    expect(findOutputAgent(BRAINSTORMER_SOURCE, "direct-execution")).toBe(EXECUTOR_DIRECT_AGENT);
    expect(COMMANDER_SOURCE).not.toMatch(/executor_direct|executordirect/i);
    expect(BRAINSTORMER_SOURCE).not.toMatch(/executor_direct|executordirect/i);
  });

  it("keeps mutation routed to executor, not executor-direct", () => {
    for (const coord of COORDINATORS) {
      expect(findOutputAgent(coord.source, "mutation")).toBe(EXECUTOR_AGENT);
    }
  });

  it("executor prompt declares the plan input contract and executor-direct handoff", () => {
    expect(EXECUTOR_SOURCE).toContain("<input-contract");
    expect(EXECUTOR_SOURCE).toContain("thoughts/shared/plans/");
    expect(EXECUTOR_SOURCE).toContain(EXECUTOR_DIRECT_AGENT);
  });
});
```

```typescript
// Implementation: this task modifies the test file only.
// No production code is changed in Task 1.1.
```

**Verify:** `bun test tests/agents/executor-direct-routing.test.ts`
**Commit:** `test(agents): guard executor-direct sensitive routing exception`

### Task 1.2: Brainstormer detector and intent tests
**File:** `tests/agents/brainstormer.test.ts`
**Test:** `tests/agents/brainstormer.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** none

```typescript
// Edit only the existing brainstormer non-trivial detector / intent tests.
// Keep all existing tests unless the instructions below explicitly replace one.

// 1) Replace the test currently named
//    "forbids executor-direct for agent prompt and slash command surfaces"
// with this test:
it("keeps agent prompt and slash command behavior changes plan-driven", () => {
  const source = readBrainstormerSource().toLowerCase();
  const detector = source.match(/<non-trivial-detector[\s\S]*?<\/non-trivial-detector>/)?.[0] ?? "";

  expect(detector).toContain("agent routing");
  expect(detector).toContain("agent role");
  expect(detector).toContain("slash command contract");
  expect(detector).toMatch(/lifecycle \+ planner \+ executor|planner \+ executor/);
});

// 2) Replace the test currently named
//    "forbids executor-direct for runtime, deploy, and workflow/lifecycle surfaces"
// with this test:
it("keeps runtime boot, deploy/restart policy, permissions, and lifecycle behavior changes plan-driven", () => {
  const source = readBrainstormerSource().toLowerCase();
  const detector = source.match(/<non-trivial-detector[\s\S]*?<\/non-trivial-detector>/)?.[0] ?? "";

  expect(detector).toContain("tool permissions");
  expect(detector).toContain("runtime boot registration");
  expect(detector).toContain("deploy/restart policy");
  expect(detector).toContain("lifecycle rules");
  expect(detector).toMatch(/lifecycle \+ planner \+ executor|planner \+ executor/);
});

// 3) Replace the test currently named
//    "direct-execution output-class declares a forbidden-for sub-list"
// with this test:
it("direct-execution output-class declares the narrow explicit bounded exception", () => {
  const source = readBrainstormerSource();
  const match = source.match(
    /<output-class name="direct-execution" agent="executor-direct">([\s\S]*?)<\/output-class>/,
  );

  expect(match).not.toBeNull();
  const body = (match?.[1] ?? "").toLowerCase();
  expect(body).toContain("explicit bounded exception");
  expect(body).toContain("named targets");
  expect(body).toContain("verification");
  expect(body).toMatch(/no side[-\s]?effect|side[-\s]?effect boundary/);
});

// 4) Replace the test currently named
//    "preserves quick-mode legitimacy for trivial single-file or local-op tasks"
// with this test:
it("preserves direct eligibility for explicit bounded non-behavior sensitive small fixes", () => {
  const source = readBrainstormerSource().toLowerCase();

  expect(source).toContain("explicit bounded exception");
  expect(source).toMatch(/typo|single[-\s]file|local\s+op|small bounded/);
  expect(source).toMatch(/do not change behavior contract|no behavior contract/);
});

// 5) Replace the test currently named
//    "non-trivial-detector forbids silent downgrade to executor-direct"
// with this test:
it("non-trivial-detector rejects silent downgrade while documenting the bounded exception", () => {
  const source = readBrainstormerSource();
  const match = source.match(/<non-trivial-detector[\s\S]*?<\/non-trivial-detector>/);

  expect(match).not.toBeNull();
  const body = (match?.[0] ?? "").toLowerCase();
  expect(body).toContain("executor-direct");
  expect(body).toMatch(/default.*conservative|conservative.*default|默认.*保守/);
  expect(body).toContain("explicit bounded exception");
  expect(body).toMatch(/never silently|do not silently|不能静默/);
});

// 6) Replace the final Chinese intent worked-example test body with this:
it("includes worked examples for bounded direct exception and high-risk plan routing", () => {
  const src = brainstormerSource();
  const block = src.match(/<intent-classification[\s\S]*?<\/intent-classification>/);
  expect(block).not.toBeNull();
  const body = block?.[0] ?? "";

  expect(body).toContain("快速修复");
  expect(body).toContain("设计");
  expect(body).toContain("explicit bounded exception");
  expect(body).toMatch(/agent routing|tool permissions|lifecycle rules|runtime boot registration/);
});
```

```typescript
// Implementation: this task modifies tests only.
// Do not edit src/agents/brainstormer.ts in this task.
```

**Verify:** `bun test tests/agents/brainstormer.test.ts`
**Commit:** `test(agents): update brainstormer sensitive direct guardrails`

### Task 1.3: Commander detector and intent tests
**File:** `tests/agents/commander.test.ts`
**Test:** `tests/agents/commander.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** none

```typescript
// Edit tests/agents/commander.test.ts.
// Keep the existing byte-identical intent block assertion; the prompt updates in Batch 2 must satisfy it.

// 1) Add these helper functions inside describe("commander routing: direct-execution output class", ...),
//    before the first it(...) in that describe block:
function commanderBlock(blockName: string): string {
  return COMMANDER_SOURCE.match(new RegExp(`<${blockName}[^>]*>([\\s\\S]*?)<\\/${blockName}>`))?.[0] ?? "";
}

function commanderOutputBody(output: string, agent: string): string {
  return COMMANDER_SOURCE.match(
    new RegExp(`<output-class name="${output}" agent="${agent}">([\\s\\S]*?)<\\/output-class>`),
  )?.[1] ?? "";
}

// 2) Add these tests inside describe("commander routing: direct-execution output class", ...):
it("documents the same narrow explicit bounded direct exception as brainstormer", () => {
  const body = commanderOutputBody("direct-execution", "executor-direct").toLowerCase();

  expect(body).toContain("explicit bounded exception");
  expect(body).toMatch(/user.*(explicit|direct)|explicit.*user/);
  expect(body).toContain("named targets");
  expect(body).toContain("verification");
  expect(body).toMatch(/no side[-\s]?effect|side[-\s]?effect boundary/);
  expect(body).toMatch(/no .*contract|contract.*no/);
});

it("keeps high-risk behavior changes out of executor-direct", () => {
  const combined = `${commanderBlock("non-trivial-detector")}\n${commanderOutputBody(
    "direct-execution",
    "executor-direct",
  )}`.toLowerCase();

  expect(combined).toContain("agent routing");
  expect(combined).toContain("tool permissions");
  expect(combined).toContain("lifecycle rules");
  expect(combined).toContain("slash command contract");
  expect(combined).toContain("runtime boot registration");
  expect(combined).toContain("deploy/restart policy");
  expect(combined).toMatch(/lifecycle \+ planner \+ executor|planner \+ executor/);
});

it("requires runtime direct fixes to disclose deploy status", () => {
  const body = commanderOutputBody("direct-execution", "executor-direct").toLowerCase();

  expect(body).toContain("bun run deploy:runtime");
  expect(body).toMatch(/live opencode runtime|live runtime/);
  expect(body).toMatch(/not (yet )?effective|尚未生效|not deployed/);
});

// 3) Replace the test currently named
//    "includes a worked example where a forbidden-surface typo classifies as 设计"
// with this test. Keep it in describe("commander Chinese intent classification", ...):
it("includes worked examples for bounded direct exception and high-risk plan routing", () => {
  const src = commanderSource();
  const block = src.match(/<intent-classification[\s\S]*?<\/intent-classification>/);
  expect(block).not.toBeNull();
  const body = block?.[0] ?? "";

  expect(body).toContain("快速修复");
  expect(body).toContain("设计");
  expect(body).toContain("explicit bounded exception");
  expect(body).toMatch(/agent routing|tool permissions|lifecycle rules|runtime boot registration/);
});
```

```typescript
// Implementation: this task modifies tests only.
// Do not edit src/agents/commander.ts in this task.
```

**Verify:** `bun test tests/agents/commander.test.ts`
**Commit:** `test(agents): guard commander sensitive direct routing`

---

## Batch 2: Primary Routing Prompt Updates (parallel - 2 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2

### Task 2.1: Brainstormer sensitive direct routing prompt
**File:** `src/agents/brainstormer.ts`
**Test:** `tests/agents/brainstormer.test.ts`, `tests/agents/executor-direct-routing.test.ts`
**Depends:** 1.1, 1.2
**Domain:** general
**Atlas-impact:** layer-update

```typescript
// In src/agents/brainstormer.ts, replace the entire <non-trivial-detector>...</non-trivial-detector>
// block with this exact block.
<non-trivial-detector priority="HIGHEST">
Before any routing or effort estimation, classify the request by semantic risk, not by line count.
Sensitive surfaces are conservative by default: route them through lifecycle + planner + executor
when the requested change would alter a behavior contract, routing decision, permission boundary,
lifecycle rule, deploy/restart policy, slash command contract, runtime boot registration, or
cross-module workflow.

<direct-sensitive-exception>
There is one narrow explicit bounded exception. A request that mentions a sensitive file or runtime
surface MAY still route to executor-direct only when ALL conditions are true:
- The user explicitly asks for direct/no-plan handling or explicitly rejects plan ceremony.
- The scope is bounded to named targets: exact files, config keys, hosts, or commands.
- Verification is named or an obvious cheapest relevant sanity check exists.
- The change is a non-behavior small fix: typo, wording, local config value correction, missing import,
  or similarly mechanical patch.
- The change does NOT alter behavior contract, agent routing, agent role, tool permissions,
  lifecycle rules, slash command contract, runtime boot registration, deploy/restart policy,
  remote mutation policy, or cross-module behavior.
- The work does not require default commit, push, deploy, restart, GitHub mutation, reviewer cycle,
  or parallel subagents.

If any condition is missing, stay conservative and route through lifecycle + planner + executor.
Never silently downgrade sensitive work into executor-direct.
</direct-sensitive-exception>

<plan-required-surface name="agent-routing-and-permissions">
Changes to agent routing, agent role definitions, output-class mapping, model strategy, tool overrides,
or tool permissions are high-risk behavior changes. They MUST use lifecycle + planner + executor.
</plan-required-surface>

<plan-required-surface name="slash-command-contract">
Changes that add, remove, or modify a slash command name, argument contract, agent mapping, template
side effect, or command registration behavior are high-risk behavior changes. They MUST use lifecycle
+ planner + executor.
</plan-required-surface>

<plan-required-surface name="runtime-boot-registration">
Changes to MCP/server registration logic, runtime boot, plugin handler registration, anything loaded by
the live OpenCode plugin from /root/.micode, or anything that changes how runtime code is registered are
high-risk behavior changes. They MUST use lifecycle + planner + executor.
</plan-required-surface>

<plan-required-surface name="deploy-restart-policy">
Changes to deploy scripts, deploy:runtime helpers, build/release flow, restart policy, or commit/push/deploy
policy are high-risk behavior changes. They MUST use lifecycle + planner + executor.
</plan-required-surface>

<plan-required-surface name="workflow-lifecycle">
Changes under src/lifecycle/, src/hooks/lifecycle/, or any file that participates in lifecycle pre-flight,
issue/worktree state, commit, push, finish, recovery, progress logging, PR creation, or merge strategy are
high-risk behavior changes. They MUST use lifecycle + planner + executor.
</plan-required-surface>

<plan-required-surface name="cross-module">
Any feature whose behavior spans two or more directories under src/, or whose required test surface spans
two or more directories under tests/, needs a plan even if individual edits look small.
</plan-required-surface>

<rule>
If the request matches any plan-required surface, state the classification in one sentence
("This is workflow-sensitive: routing through lifecycle + planner + executor.") and proceed
through the design / planning path. Do not downgrade to executor-direct.
</rule>

<rule>
Quick-mode remains valid for trivial work that touches none of these surfaces. The explicit bounded
exception above is narrower than quick-mode: it exists only for user-requested direct handling of
mechanical, named-target fixes whose semantics and side effects are bounded.
</rule>
</non-trivial-detector>

// In the <intent-classification> block, update the four intent definitions and worked examples
// to match the new exception while preserving byte identity with the commander block.
// Replace only this subpart inside <intent-classification>:
四个意图的语义：
- 快速修复：小而局部的低风险修补（typo、版本号、单行补丁、单文件本地操作），以及满足 explicit bounded exception 的敏感面非行为小修。
- 设计：新功能、架构变更、跨模块改造，或会改变 agent routing、tool permissions、lifecycle rules、slash command contract、runtime boot registration、deploy/restart policy 的高风险行为变化。
- 调试：未知原因、故障诊断、需要 investigator 证据包；用户描述的是症状或异常。
- 运维：状态查询、部署、配置查阅、GitHub/仓库操作、ops 类纯只读或受控命令。

<priority-order>
本声明是 UX 层，不替代真实路由安全。优先级如下，写在 prompt 中是为了让用户看见冲突时谁胜出：
1. plan-required high-risk behavior surfaces（最高，触及即视为"设计"）
2. non-trivial-detector（其次；只有满足 explicit bounded exception 才能降级到 executor-direct）
3. intent-classification（本块，仅决定用户可见的中文声明）

意图和 detector 冲突时，detector 胜出。永远不能用"快速修复"覆盖高风险行为变化。
</priority-order>

// Replace the old worked-example named forbidden-surface-typo with these two worked examples:
<worked-example name="explicit-bounded-sensitive-small-fix">
用户请求："这个不用走 plan，直接把 src/agents/commander.ts 里这个错别字改掉，只改这一个文件，跑 commander.test。"
正确输出第一行："意图: 快速修复。理由: 用户明确要求 direct，目标和验证明确，且属于 explicit bounded exception 的非行为小修。"
</worked-example>

<worked-example name="high-risk-routing-change">
用户请求："顺手改一下 commander 的 agent routing，让某类请求直接进 executor-direct。"
正确输出第一行："意图: 设计。理由: 这会改变 agent routing，属于高风险行为变化，必须走 lifecycle + planner + executor。"
错误输出："意图: 快速修复。"——这是被 non-trivial-detector 显式禁止的降级。
</worked-example>

// In <output-class name="direct-execution" agent="executor-direct">, replace the whole body
// between the opening and closing tags with this exact content:
  During design exploration, if the conversation has converged on a small bounded scope
  with explicit steps, named targets (files / config keys / hosts / commands), named
  verification, and no plan file is needed because a single agent can finish the work
  in one session, route to executor-direct.

  Sensitive surfaces are conservative by default, but there is a narrow explicit bounded
  exception: when the user explicitly asks for direct/no-plan handling, the target and
  verification are named, side-effect boundaries are clear, and the patch does not change
  behavior contract, agent routing, agent role, tool permissions, lifecycle rules, slash
  command contract, runtime boot registration, deploy/restart policy, remote mutation policy,
  or cross-module behavior, executor-direct may handle the mechanical fix.

  executor-direct must report its execution envelope, verification, side effects, and deploy /
  restart status. For runtime source fixes, if it did not run `bun run deploy:runtime`, it must
  say the source was changed but the live OpenCode runtime is not deployed and is not yet effective.
  executor-direct never owns lifecycle state and never spawns subagents.
```

```typescript
// Implementation choice: this is a prompt-only routing contract change.
// Do not edit lifecycle tools/state machine, executor-direct implementation, or runtime deploy scripts.
```

**Verify:** `bun test tests/agents/brainstormer.test.ts tests/agents/executor-direct-routing.test.ts`
**Commit:** `fix(agents): relax brainstormer direct routing guardrails`

### Task 2.2: Commander sensitive direct routing prompt
**File:** `src/agents/commander.ts`
**Test:** `tests/agents/commander.test.ts`, `tests/agents/executor-direct-routing.test.ts`
**Depends:** 1.1, 1.3
**Domain:** general
**Atlas-impact:** layer-update

```typescript
// In src/agents/commander.ts, insert the following block immediately before
// <intent-classification priority="HIGH">. This gives commander the same explicit detector
// that brainstormer already has.
<non-trivial-detector priority="HIGHEST">
Before any routing or effort estimation, classify the request by semantic risk, not by line count.
Sensitive surfaces are conservative by default: route them through lifecycle + planner + executor
when the requested change would alter a behavior contract, routing decision, permission boundary,
lifecycle rule, deploy/restart policy, slash command contract, runtime boot registration, or
cross-module workflow.

<direct-sensitive-exception>
There is one narrow explicit bounded exception. A request that mentions a sensitive file or runtime
surface MAY still route to executor-direct only when ALL conditions are true:
- The user explicitly asks for direct/no-plan handling or explicitly rejects plan ceremony.
- The scope is bounded to named targets: exact files, config keys, hosts, or commands.
- Verification is named or an obvious cheapest relevant sanity check exists.
- The change is a non-behavior small fix: typo, wording, local config value correction, missing import,
  or similarly mechanical patch.
- The change does NOT alter behavior contract, agent routing, agent role, tool permissions,
  lifecycle rules, slash command contract, runtime boot registration, deploy/restart policy,
  remote mutation policy, or cross-module behavior.
- The work does not require default commit, push, deploy, restart, GitHub mutation, reviewer cycle,
  or parallel subagents.

If any condition is missing, stay conservative and route through lifecycle + planner + executor.
Never silently downgrade sensitive work into executor-direct.
</direct-sensitive-exception>

<plan-required-surface name="agent-routing-and-permissions">
Changes to agent routing, agent role definitions, output-class mapping, model strategy, tool overrides,
or tool permissions are high-risk behavior changes. They MUST use lifecycle + planner + executor.
</plan-required-surface>

<plan-required-surface name="slash-command-contract">
Changes that add, remove, or modify a slash command name, argument contract, agent mapping, template
side effect, or command registration behavior are high-risk behavior changes. They MUST use lifecycle
+ planner + executor.
</plan-required-surface>

<plan-required-surface name="runtime-boot-registration">
Changes to MCP/server registration logic, runtime boot, plugin handler registration, anything loaded by
the live OpenCode plugin from /root/.micode, or anything that changes how runtime code is registered are
high-risk behavior changes. They MUST use lifecycle + planner + executor.
</plan-required-surface>

<plan-required-surface name="deploy-restart-policy">
Changes to deploy scripts, deploy:runtime helpers, build/release flow, restart policy, or commit/push/deploy
policy are high-risk behavior changes. They MUST use lifecycle + planner + executor.
</plan-required-surface>

<plan-required-surface name="workflow-lifecycle">
Changes under src/lifecycle/, src/hooks/lifecycle/, or any file that participates in lifecycle pre-flight,
issue/worktree state, commit, push, finish, recovery, progress logging, PR creation, or merge strategy are
high-risk behavior changes. They MUST use lifecycle + planner + executor.
</plan-required-surface>

<plan-required-surface name="cross-module">
Any feature whose behavior spans two or more directories under src/, or whose required test surface spans
two or more directories under tests/, needs a plan even if individual edits look small.
</plan-required-surface>

<rule>
If the request matches any plan-required surface, state the classification in one sentence
("This is workflow-sensitive: routing through lifecycle + planner + executor.") and proceed
through the design / planning path. Do not downgrade to executor-direct.
</rule>

<rule>
Quick-mode remains valid for trivial work that touches none of these surfaces. The explicit bounded
exception above is narrower than quick-mode: it exists only for user-requested direct handling of
mechanical, named-target fixes whose semantics and side effects are bounded.
</rule>
</non-trivial-detector>

// In the <intent-classification> block, make it byte-identical to the brainstormer block after Task 2.1.
// Use the exact replacement snippets from Task 2.1 for:
// - 四个意图的语义
// - <priority-order>
// - worked-example entries explicit-bounded-sensitive-small-fix and high-risk-routing-change

// In <output-class name="direct-execution" agent="executor-direct">, replace the whole body
// between the opening and closing tags with this exact content:
  Requested output is a changed system, BUT no plan exists yet AND the steps are clear
  AND the scope is bounded with named targets (files / config keys / hosts / commands),
  named verification, and a single agent can complete implementation, build/deploy if explicitly
  requested, and verify in one session. No design decisions, no batch dispatch, no reviewer cycle needed.

  Sensitive surfaces are conservative by default, but there is a narrow explicit bounded exception:
  when the user explicitly asks for direct/no-plan handling, the target and verification are named,
  side-effect boundaries are clear, and the patch does not change behavior contract, agent routing,
  agent role, tool permissions, lifecycle rules, slash command contract, runtime boot registration,
  deploy/restart policy, remote mutation policy, or cross-module behavior, executor-direct may handle
  the mechanical fix.

  executor-direct must report its execution envelope, verification, side effects, and deploy / restart
  status. For runtime source fixes, if it did not run `bun run deploy:runtime`, it must say the source
  was changed but the live OpenCode runtime is not deployed and is not yet effective. executor-direct
  does the work itself; it does NOT spawn subagents and does NOT own lifecycle state.

// In <combinations>, replace the existing executor-direct routing rule with this stricter rule:
<rule>If the user asks for a code/config change with clear bounded scope, named targets, explicit verification, no plan file exists, and the request either avoids sensitive surfaces or satisfies the explicit bounded exception, route to executor-direct, NOT executor. The executor refuses inputs without a plan path under thoughts/shared/plans/.</rule>

// Add this anti-pattern inside <anti-patterns>:
<rule>Do NOT use executor-direct for changes to agent routing, tool permissions, lifecycle rules, slash command contract, runtime boot registration, deploy/restart policy, or any behavior contract. Those remain plan-driven even if the diff is small.</rule>
```

```typescript
// Implementation choice: commander receives its own detector block instead of relying on brainstormer.
// This keeps direct routing consistent when commander is the primary entry point.
// Do not edit lifecycle tools/state machine, executor-direct implementation, or runtime deploy scripts.
```

**Verify:** `bun test tests/agents/commander.test.ts tests/agents/executor-direct-routing.test.ts`
**Commit:** `fix(agents): align commander sensitive direct routing`

---

## Batch 3: Shared Knowledge Update (parallel - 1 implementer)

All tasks in this batch depend on Batch 2 completing.
Tasks: 3.1

### Task 3.1: Atlas workflow behavior update
**File:** `atlas/20-behavior/brainstorm-plan-implement-workflow.md`
**Test:** none
**Depends:** 2.1, 2.2
**Domain:** general
**Atlas-impact:** layer-update

```markdown
<!-- Update atlas/20-behavior/brainstorm-plan-implement-workflow.md. -->
<!-- In the Mechanics list, replace the first bullet with the following two bullets. Keep the rest of the file unchanged. -->

- 设计阶段强调 research before opinion，并把设计写入 `thoughts/shared/designs/`；brainstormer 在 finalizing 阶段必须主动产出 design.md 末尾的轻量 BDD 防漂移层 `## Behavior` 段（quick-mode / 运维 / executor-direct / 用户显式跳过时可省略整段）。
- Primary agent 对敏感面采用默认保守规则：改变 `agent routing`、`tool permissions`、`lifecycle rules`、`slash command contract`、`runtime boot registration`、`deploy/restart policy` 或跨模块行为的请求仍走 lifecycle + planner + executor；只有当用户明确要求 direct、目标与验证明确、side-effect boundary 清楚，且只是 typo / wording / local config / missing import 等不改变行为 contract 的机械小修时，才可作为 explicit bounded exception 派 `executor-direct`。runtime 源码小修未执行 `bun run deploy:runtime` 时，终态报告必须说明 live OpenCode runtime 尚未部署生效。
```

```markdown
<!-- Implementation choice: update only the behavior node that already describes the visible workflow. -->
<!-- Do not create a new Atlas node for this small-step relaxation. -->
```

**Verify:** `bun test tests/agents/brainstormer.test.ts tests/agents/commander.test.ts tests/agents/executor-direct-routing.test.ts`
**Commit:** `docs(atlas): record bounded executor-direct routing behavior`
