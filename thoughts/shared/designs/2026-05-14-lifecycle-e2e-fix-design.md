---
date: 2026-05-14
topic: "修复 3 个 pre-existing lifecycle E2E 测试 fail"
status: validated
issue: 77
---

## 承诺清单 / Commitments

> brainstormer 在 understanding 阶段提炼的用户原始要求 + sub-decisions 已确认。

用户原话：
- "3 个 lifecycle E2E 测试 pre-existing fail 仍未修（上次 issue #69 留下）：建议单独 lifecycle 处理"

5 个 sub-decisions 已 batched ask 并获用户「可以 你推进吧」确认（在前序对话中）：

1. 测试 1 & 2 修复策略 = **A**（扩展 fake runner pure mock，不动生产代码）
2. 测试 3 promoteOnLifecycleFinish 处理 = **A**（测试 beforeEach 临时 override，不动 config 默认值）
3. 加 regression test = **是**（确保未来重构不再退化）
4. 顺序 = 修复 B 在修复 A 之后（本 lifecycle 即修复 B）
5. 不扩展 scope（不重构 lifecycle E2E 整体架构）

本次提交承诺：
- 改 `tests/integration/lifecycle-end-to-end.test.ts` 的 fake runner 拦截 worktree/merge/fetch/status/ls-files/branch -d 命令
- 改 `tests/integration/project-memory-lifecycle-finish.test.ts` 的 beforeEach/afterEach 临时 override `promoteOnLifecycleFinish`
- 修复后 3 个测试通过
- 不动生产代码（不改 lifecycle/merge/temp-worktree/cleanup-policy 等）
- 不改 config 默认值
- 不引入新 byte-identical 镜像

## Problem Statement

3 个 lifecycle E2E 测试稳定 fail，从 issue #69 / #73 / #75 历次 PR CI 都报出来。pre-existing 与本次修复完全无关，但卡 CI 导致 lifecycle_finish 走 PR 路径时反复需要 admin merge 绕过。

**测试 1 & 2**（`tests/integration/lifecycle-end-to-end.test.ts`）：

- "lifecycle scripted end-to-end > runs the lifecycle tools through local merge and cleanup"（line 233-263）
- "lifecycle scripted end-to-end > renders all four artifact pointers into the issue body across the full chain"（line 265-310）

失败 expectation：
- `expect(finishOutput).toContain("## Lifecycle finished")` (line 242)
- `expect(record.state).toBe(LIFECYCLE_STATES.CLEANED)` (line 248)
- `expect(runner.edits.at(-1)).toContain("state: cleaned")` (line 261, 307)
- `expect(reloaded.state).toBe(LIFECYCLE_STATES.CLEANED)` (line 310)

根因（investigator 已确认）：fake runner 把所有非 push 的 git 命令委托给真实 git（line 107-108）。`finishViaLocalMerge` 调用 `git worktree add /tmp/<X>-merge-issue-1 main`，临时仓库 main 已被 HEAD 检出，git 拒绝同分支多 worktree → `createTempMergeWorktree` 返回 failed → finish 返回 `merged: false` → state 不变 cleaned → header 是 "## Lifecycle finish failed"。

**测试 3**（`tests/integration/project-memory-lifecycle-finish.test.ts`）：

- "project memory lifecycle finish E2E > keeps lifecycle finish successful while promoting active lifecycle memory"

失败 expectation：
- `expect(record?.notes.some((note) => note.startsWith(PROMOTED_NOTE))).toBe(true)` (line 191)

根因：测试期望 finish 后 record.notes 包含 `memory_promoted` 前缀的 note，但 `config.projectMemory.promoteOnLifecycleFinish` 默认 false，`promoteFinishedRecord` 因此直接 return，不追加 note（`src/lifecycle/index.ts:562`）。测试代码本身没 override 这个 config。

## Constraints

- 不动生产代码：`src/lifecycle/merge.ts` / `src/lifecycle/recovery/temp-worktree.ts` / `src/lifecycle/index.ts` / `src/lifecycle/cleanup-policy.ts` 全部保持不变
- 不改 `src/utils/config.ts` 的 `promoteOnLifecycleFinish` 默认值（保持 false，AGENTS.md Project Memory Active Maintenance 边界）
- 不破坏 `tests/lifecycle/atlas-boundary.test.ts`
- 不破坏 `tests/lifecycle/project-memory-boundary.test.ts`（config 默认值不动）
- 不破坏 `tests/lifecycle/promote-on-finish.test.ts`（已有 override pattern 不变）
- 不引入新 byte-identical 镜像
- 不动 Atlas / Project Memory schema / .mindmodel/
- 不扩展 scope：只修这 3 个 fail，不重构 lifecycle E2E 架构
- fake runner 扩展后的 git command 拦截逻辑必须有清晰注释（避免未来 reader 迷惑）

## Approach

**测试 1 & 2 策略**：扩展 `lifecycle-end-to-end.test.ts` 第 98-118 行 createRunner 函数的 git handler，从「除 push 外全部 runGit 真实执行」改成「拦截 lifecycle finish 路径会调的全部命令，返回成功 / 空 / 特定 stdout」。

需要拦截的命令（基于 investigator 追代码确认 `finishViaLocalMerge` 路径会调的）：
- `worktree add` → 返回成功
- `worktree remove` → 返回成功
- `worktree list` → 返回空 stdout 或合理伪造
- `worktree prune` → 返回成功
- `fetch` → 返回成功
- `merge --ff-only` → 返回成功
- `merge --no-ff` → 返回成功
- `branch -d` → 返回成功
- `status --porcelain` → 返回空 stdout（干净状态）
- `ls-files` → 返回空（无 untracked）

保留：
- `rev-parse HEAD` 当前测试已经返回 fake hash，继续保留
- `remote get-url origin` 继续保留（如果有）
- `push` 继续返回成功

这样 `finishViaLocalMerge` 一路成功 → outcome.merged=true → state 推到 cleaned → 测试通过。

**测试 3 策略**：在 `project-memory-lifecycle-finish.test.ts` 的 beforeEach 临时设置 `config.projectMemory.promoteOnLifecycleFinish = true`，afterEach 恢复 false。参考 micode 现有 pattern `tests/lifecycle/promote-on-finish.test.ts:138`。

理由：
- 不改 config 默认值（保持 AGENTS.md 边界）
- 不改生产代码
- 测试自身明确想验证 promotion 行为，override 是测试的合法手段

## Architecture

无新组件，只改测试文件。

```
tests/integration/lifecycle-end-to-end.test.ts
  ├─ createRunner() 函数（line 98-118）
  │   └─ git handler:
  │       - 扩展 if 分支拦截更多命令
  │       - 移除「除 push 外全部 runGit 真实执行」的兜底
  │
  └─ 现有两个失败测试 case 直接受益（无需改 expectation）

tests/integration/project-memory-lifecycle-finish.test.ts
  ├─ beforeEach（line 111-123）
  │   ├─ 加：保存原 promoteOnLifecycleFinish 值
  │   └─ 加：临时设置为 true
  │
  └─ afterEach（line 125 附近）
      └─ 加：恢复原值
```

## Components

### Component 1: lifecycle-end-to-end.test.ts fake runner 扩展

文件：`tests/integration/lifecycle-end-to-end.test.ts`
位置：`createRunner` 函数 git handler（约 line 98-118）

修改方式：在现有 `git: async (args, options) => { ... }` 内部按顺序判断命令：

```
if (push) → 成功
else if (rev-parse HEAD) → 返回 fake hash
else if (remote get-url origin) → 返回 mock origin url
else if (worktree add/remove/list/prune) → 成功/空/合理
else if (fetch) → 成功
else if (merge --ff-only / --no-ff) → 成功
else if (branch -d) → 成功
else if (status --porcelain) → 空 stdout（clean）
else if (ls-files) → 空
else → fallback（保留 runGit 兜底以防漏 case；但加 console.warn 提示）
```

注释清晰标明每个 case 为什么这么拦截 + 实际生产代码里在哪里调这个命令。

### Component 2: project-memory-lifecycle-finish.test.ts override

文件：`tests/integration/project-memory-lifecycle-finish.test.ts`
位置：beforeEach + afterEach 块

```
let originalPromoteFlag: boolean;

beforeEach(() => {
  ...existing setup...
  originalPromoteFlag = config.projectMemory.promoteOnLifecycleFinish;
  (config.projectMemory as { promoteOnLifecycleFinish: boolean }).promoteOnLifecycleFinish = true;
});

afterEach(() => {
  ...existing teardown...
  (config.projectMemory as { promoteOnLifecycleFinish: boolean }).promoteOnLifecycleFinish = originalPromoteFlag;
});
```

参考 `tests/lifecycle/promote-on-finish.test.ts:138` 的 cast 写法保持 type safety。

## Data Flow

无新数据流。只修改测试 fixture 的 git command mock 行为 + config override 范围。

## Error Handling

- fake runner 扩展后保留 fallback runGit 路径 + console.warn（防止漏拦截某个命令导致测试静默失败）
- afterEach 恢复 config 即使 beforeEach 失败也要恢复（用 try/finally 模式）

## Testing Strategy

### 主要修复目标

- `tests/integration/lifecycle-end-to-end.test.ts` 的 2 个失败 test case 通过
- `tests/integration/project-memory-lifecycle-finish.test.ts` 的 1 个失败 test case 通过

### 不变

- 全部 drift-guard 测试（atlas-mental-model / project-memory-protocol / effect-first-reporting / specialist-routing / behavior-layer / sub-decision-and-checkoff / agents-md-knowledge-bootstrap / agents-md-lifecycle-recovery）
- `tests/lifecycle/atlas-boundary.test.ts`
- `tests/lifecycle/project-memory-boundary.test.ts`
- `tests/lifecycle/promote-on-finish.test.ts`

### 验收

修复后：
- `bun test tests/integration/lifecycle-end-to-end.test.ts` 全绿
- `bun test tests/integration/project-memory-lifecycle-finish.test.ts` 全绿
- `bun run check` 整体不退化（pre-existing fail 应减少 3 个）

## Open Questions

1. **fake runner pure mock 后是否丢失某些真实集成场景的覆盖**：原 fake runner 委托真实 git 的意图可能是想测「真实 git 行为下 lifecycle 是否正确」。改 pure mock 后这层覆盖消失。但 investigator 调研显示当前测试本来就是 mock 端到端集成（push 已经被拦截），改成 pure mock 不算降级，只是修正与现实不符的混合策略。

2. **如果未来 lifecycle 实现增加新的 git 命令调用**：fake runner 的 fallback console.warn 会提示漏拦截，但测试不 fail。这是个软警告，依赖人眼。未来可考虑改成 strict fail，但本次不引入。

## Behavior

- 跑 `bun test tests/integration/lifecycle-end-to-end.test.ts` 时，先前失败的 2 个 test case 现在通过：finish 返回 merged=true、record.state=cleaned、issue body 含 "state: cleaned" 与 "## Lifecycle finished"
- 跑 `bun test tests/integration/project-memory-lifecycle-finish.test.ts` 时，先前失败的 1 个 test case 现在通过：record.notes 含 `memory_promoted` 前缀 entry
- 全局 `bun run check` 中 lifecycle E2E 3 个 fail 消失（其它 pre-existing fail 不在本 scope）
- 未来 PR lifecycle_finish 走 PR 路径时，CI 不再因为这 3 个测试 fail 而需要 admin merge 绕过
- 验收方式：本 lifecycle 自身 PR #(将分配) 的 CI 应该全绿（如果还有其它 pre-existing fail 也会显著减少；如果完全绿，lifecycle_finish 自动走 PR merge 不需要 admin merge）

> Atlas 关联：本次修复属于测试基础设施修复，不构成长期心智模型变化，**不维护 atlas/20-behavior 节点**。Project Memory 也不 promote decision（无长期取舍）。Atlas status: no-change · Project Memory status: read-only。
