---
date: 2026-05-14
topic: "修复 3 个 pre-existing lifecycle E2E 测试 fail"
issue: 77
scope: lifecycle
contract: none
---

# Lifecycle E2E 测试修复 Implementation Plan

**Goal:** 把 `tests/integration/lifecycle-end-to-end.test.ts` 和 `tests/integration/project-memory-lifecycle-finish.test.ts` 内 3 个 pre-existing fail 修绿，不动生产代码。

**Architecture:** 纯测试修复。改动 1：扩展 `lifecycle-end-to-end.test.ts` 内 `createRunner` 的 git handler 为 pure mock，拦截 worktree / merge / fetch / status / ls-files / branch -d 等命令，使 `finishViaLocalMerge` 一路成功。改动 2：在 `project-memory-lifecycle-finish.test.ts` 的 beforeEach/afterEach 临时 override `config.projectMemory.promoteOnLifecycleFinish = true`，复用 `tests/lifecycle/promote-on-finish.test.ts` 既有 cast 写法。

**Design:** `thoughts/shared/designs/2026-05-14-lifecycle-e2e-fix-design.md`

**Contract:** none（plan 内全部 task 同域 general，纯测试无前后端契约）

---

## 行为承诺映射

> 与 design.md `## 承诺清单 / Commitments` 一一对应；每条承诺指向具体落地 task。漏覆盖处显式说明理由。

| 承诺 | 来源 | 落地 task |
|---|---|---|
| 改 `tests/integration/lifecycle-end-to-end.test.ts` 的 fake runner 拦截 worktree/merge/fetch/status/ls-files/branch -d 命令 | Commitments #1（sub-decision 1=A） | Task 1.1 |
| 改 `tests/integration/project-memory-lifecycle-finish.test.ts` 的 beforeEach/afterEach 临时 override `promoteOnLifecycleFinish` | Commitments #2（sub-decision 2=A） | Task 1.2 |
| 修复后 3 个测试通过 | Commitments #3 | Task 1.1（2 个 case）+ Task 1.2（1 个 case），由各自 Verify 命令验收 |
| 不动生产代码（lifecycle/merge/temp-worktree/cleanup-policy 等） | Commitments #4 | 两个 task File 字段都在 `tests/` 下，scope=lifecycle 仅作 commit prefix |
| 不改 config 默认值 | Commitments #5 | Task 1.2 走 in-test cast override，afterEach 强制恢复 |
| 不引入新 byte-identical 镜像 | Commitments #6 | plan 无新增 prompt 镜像，纯测试 fixture 改动 |
| sub-decision 4（顺序：B 在 A 之后） | sub-decisions #4 | 本 lifecycle 即"修复 B"步骤，无 task 体现，由 issue #77 整体顺序保证 |
| sub-decision 5（不扩展 scope） | sub-decisions #5 | plan 只 2 个 task，不重构 lifecycle E2E 架构 |
| sub-decision 3（加 regression test） | sub-decisions #3 | 已被 design 折叠：Task 1.1 修绿即 regression 保护（未来 lifecycle 新增 git 命令时 fallback runGit + console.warn 提示），不引入额外 task |

**已知按默认决定的事项**：无（5 个 sub-decisions 全部在 brainstormer 阶段获用户确认）。

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2 [两个测试文件互不依赖，可并行]
```

两个 task 改动两个完全独立的测试文件，无 import 关系，无共享 fixture，可由 2 个 implementer 同时执行。

---

## Batch 1: 测试 fixture 修复 (parallel - 2 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2

### Task 1.1: 扩展 lifecycle-end-to-end.test.ts 的 createRunner git handler 为 pure mock
**File:** `tests/integration/lifecycle-end-to-end.test.ts`
**Test:** none（任务本身就是修复既有测试 fixture；验收即跑该文件本身的 2 个失败 case 转绿，无需另写测试）
**Depends:** none
**Domain:** general
**Atlas-impact:** none

**改动位置：** `createRunner` 函数（约 line 98-120）的 `git` handler 内部。

**当前行为（要替换的）：**
```ts
git: async (args, options) => {
  calls.push({ bin: "git", args, cwd: options?.cwd });
  if (isPush(args)) return createRun();
  return runGit(args, options?.cwd ?? repo);  // ← 兜底委托真实 git，导致 worktree add main 失败
},
```

**目标行为：** 改成 pure mock，按下列优先级顺序匹配命令并返回伪造结果，每个分支必须带注释说明对应生产代码调用点。匹配规则（design.md "Approach" 段已定）：

1. `isPush(args)` → `createRun()`（push 成功，保留现有行为）
2. `args[0] === "rev-parse"` 且 `args[1] === "HEAD"` → 返回 fake hash（沿用既有 `${SHA}\n` 或 test 内已有常量；如本文件已有 SHA 常量则复用，否则在文件顶部新增 `const FAKE_HEAD_SHA = "abc123def456";`）
3. `isArgs(args, ["remote", "get-url", "origin"])` → 返回 `${ORIGIN}\n`
4. `args[0] === "worktree"` 且 `args[1] === "add"` → `createRun()`（成功，无 stdout）
5. `args[0] === "worktree"` 且 `args[1] === "remove"` → `createRun()`
6. `args[0] === "worktree"` 且 `args[1] === "list"` → `createRun()`（空 stdout，伪造无额外 worktree）
7. `args[0] === "worktree"` 且 `args[1] === "prune"` → `createRun()`
8. `args[0] === "fetch"` → `createRun()`
9. `args[0] === "merge"` 且 `args.includes("--ff-only")` → `createRun()`
10. `args[0] === "merge"` 且 `args.includes("--no-ff")` → `createRun()`
11. `args[0] === "branch"` 且 `args.includes("-d")` → `createRun()`
12. `isArgs(args, ["status", "--porcelain"])` → `createRun()`（空 stdout = 干净）
13. `args[0] === "ls-files"` → `createRun()`（空 = 无 untracked / 无 match）
14. **fallback**：保留 `return runGit(args, options?.cwd ?? repo);` 但前面加 `console.warn(\`[lifecycle-e2e-fake-runner] unhandled git command: ${args.join(" ")}\`);`（design.md Error Handling 段要求；防漏 case 静默 fail）

**注释要求**（design.md Constraints 段强制）：每个 if 分支上方一行注释，标明该命令在生产代码哪个文件被调用。示例骨架：

```ts
// `lifecycle_commit` 推 fork origin（src/lifecycle/index.ts commit 路径）
if (isPush(args)) return createRun();

// `finishViaLocalMerge` 查 HEAD sha 写 record（src/lifecycle/merge.ts）
if (args[0] === "rev-parse" && args[1] === "HEAD") return createRun(`${FAKE_HEAD_SHA}\n`);

// 仓库 origin URL（ownership pre-flight / lifecycle 记录）
if (isArgs(args, ["remote", "get-url", "origin"])) return createRun(`${ORIGIN}\n`);

// 临时 merge worktree 创建（src/lifecycle/recovery/temp-worktree.ts createTempMergeWorktree）
if (args[0] === "worktree" && args[1] === "add") return createRun();

// ... 余下按上面列表逐条
```

**辅助工具复用：** 已有 `isPush(args)`、`isArgs(args, expected)`、`createRun(stdout?)`、常量 `ORIGIN` 等都在文件内，直接复用；不引入新工具函数。如 `isPush` 内部已 cover push，无需再加 push 兜底。

**Implementer 决策点（在 plan 内已定）：**
- worktree list 返回空 stdout 即可（design 写"空 stdout 或合理伪造"，选空，最简单且 `temp-worktree.ts` 仅判断 exitCode==0）。
- 若 fake hash 常量名冲突已存在，复用既有；保持文件顶部常量风格一致。

**不要做：** 不要把这些分支抽成新的 helper module，原地展开即可（design Constraints "fake runner 扩展后的 git command 拦截逻辑必须有清晰注释"，原地展开 + 注释比 helper 更清晰）；不要改动 `initializeRepo` / `requireGit` / `executeTool` 等其它函数；不要改任何测试 expectation。

**Verify:**
```sh
bun test tests/integration/lifecycle-end-to-end.test.ts
```
预期：先前失败的 2 个 case（"runs the lifecycle tools through local merge and cleanup" / "renders all four artifact pointers into the issue body across the full chain"）全绿；finishOutput 包含 "## Lifecycle finished"；record.state === LIFECYCLE_STATES.CLEANED；runner.edits.at(-1) 包含 "state: cleaned"。

**附加回归验证（implementer 必须跑）：**
```sh
bun test tests/lifecycle/atlas-boundary.test.ts tests/lifecycle/project-memory-boundary.test.ts tests/lifecycle/promote-on-finish.test.ts
```
全部应保持绿色（design.md Testing Strategy "不变" 段）。

**Commit:** `test(lifecycle): mock lifecycle-end-to-end git runner for finishViaLocalMerge path`

---

### Task 1.2: project-memory-lifecycle-finish.test.ts beforeEach/afterEach override promoteOnLifecycleFinish
**File:** `tests/integration/project-memory-lifecycle-finish.test.ts`
**Test:** none（同 Task 1.1，本任务即修复测试 fixture，验收 = 跑该文件转绿）
**Depends:** none
**Domain:** general
**Atlas-impact:** none

**改动位置 1：** 文件顶部 import 段补 `config` import。当前文件不 import `config`（line 1-11），需追加：

```ts
import { config } from "@/utils/config";
```

放在与其它 `@/...` 内部 import 同一组，按字母序插入（参考 `tests/lifecycle/promote-on-finish.test.ts` 既有顺序）。

**改动位置 2：** 文件顶 module-scope let 块（line 105-108 附近 `let root: string;` 等），追加一行：

```ts
let originalPromoteFlag = false;
```

（初始化为 `false` 而非裸 `let originalPromoteFlag: boolean;`，避免 TS strict 下 undefined 风险，且与 config 默认值一致。）

**改动位置 3：** 新增 helper（紧贴 `let originalPromoteFlag` 下方，参考 `tests/lifecycle/promote-on-finish.test.ts:137-139` 的 cast pattern）：

```ts
function setPromoteOnLifecycleFinish(enabled: boolean): void {
  (config.projectMemory as { promoteOnLifecycleFinish: boolean }).promoteOnLifecycleFinish = enabled;
}
```

**改动位置 4：** `beforeEach` 块（line 110-119）内，在所有现有 setup 完成后追加两行：

```ts
beforeEach(async () => {
  root = mkdtempSync(join(tmpdir(), PREFIX));
  cwd = join(root, "repo");
  baseDir = join(root, "records");
  worktreesRoot = join(root, "worktrees");
  mkdirSync(cwd, { recursive: true });
  mkdirSync(worktreesRoot, { recursive: true });
  await $`git init -q`.cwd(cwd);
  await $`git remote add origin ${ORIGIN}`.cwd(cwd);
  // 既有 setup 之后追加：
  originalPromoteFlag = config.projectMemory.promoteOnLifecycleFinish;
  setPromoteOnLifecycleFinish(true);
});
```

**改动位置 5：** `afterEach` 块（line 121-124）内首行恢复（在 `resetProjectMemoryRuntimeForTest` 与 `rmSync` 之前）：

```ts
afterEach(async () => {
  setPromoteOnLifecycleFinish(originalPromoteFlag);
  await resetProjectMemoryRuntimeForTest();
  rmSync(root, { recursive: true, force: true });
});
```

**为何这个顺序：** design.md Error Handling 段要求"afterEach 恢复 config 即使 beforeEach 失败也要恢复"。bun:test 框架保证 afterEach 在 beforeEach 抛错后也会跑；恢复必须放在最前，避免后续 `rmSync` / `resetProjectMemoryRuntimeForTest` 抛错时跳过恢复。

**Implementer 决策点（在 plan 内已定）：**
- 不用 try/finally 包 beforeEach 内部（bun:test 框架本身保证 afterEach 总会跑，pattern 与 `promote-on-finish.test.ts` 一致即可）。
- 不引入 `globalThis` 或环境变量层级的 override，只走 in-place cast，与既有 `promote-on-finish.test.ts:138` 完全一致。

**不要做：**
- 不要修改 `config.projectMemory.promoteOnLifecycleFinish` 的默认值（`src/utils/config.ts`）——design Constraints 明文禁止。
- 不要修改 `createRunner` / `useMemory` / `writeLedger` / 其它 helper。
- 不要修改测试 expectation（line 191 的 `PROMOTED_NOTE` 断言）。
- 不要导出 `setPromoteOnLifecycleFinish` 为共享 util；保持文件内本地化（design "不引入新 byte-identical 镜像"）。

**Verify:**
```sh
bun test tests/integration/project-memory-lifecycle-finish.test.ts
```
预期：先前失败的 case "keeps lifecycle finish successful while promoting active lifecycle memory" 全绿；`record?.notes.some((note) => note.startsWith(PROMOTED_NOTE))` === true。

**附加回归验证（implementer 必须跑）：**
```sh
bun test tests/lifecycle/promote-on-finish.test.ts tests/lifecycle/project-memory-boundary.test.ts
```
两者应保持绿色（design Testing Strategy "不变" 段，特别是 boundary 测试不能因为本次 override 失守）。

**Commit:** `test(lifecycle): override promoteOnLifecycleFinish in project-memory-lifecycle-finish E2E`
