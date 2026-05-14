---
date: 2026-05-14
topic: ".opencode/skills/.state.json trailing newline 修复"
issue: 75
scope: skill-autopilot
contract: none
---

# `.state.json` Trailing Newline 修复 Implementation Plan

**Goal:** 让 `src/skill-autopilot/runner.ts` 的 `saveState()` 写出的 `.opencode/skills/.state.json` 末尾始终含 `\n`,使 `biome check .` 在 CI 通过。

**Architecture:** 单点 1 行修改 + 1 个 regression 单元测试。修改点是 `saveState()` 中唯一一处 `writeFileSync`(line 103)；regression 测试通过 `runAutopilot` 公开 API 触发 saveState 后读取磁盘文件断言末尾字节为 `\n`。

**Design:** `thoughts/shared/designs/2026-05-14-state-json-trailing-newline-design.md`

**Contract:** none(单 domain — backend/runtime,不跨 frontend/backend,无需 frozen API contract)

---

## 行为承诺映射

design.md `## Behavior` 段(第 163-173 行)承诺的用户可见行为与本 plan task 的对应关系:

| Behavior 承诺(design.md) | 对应 Task | 说明 |
|---|---|---|
| `saveState()` 写出的 `.state.json` 文件末尾始终包含 `\n`(POSIX 规范) | Task 1.1 | 单行修改 `writeFileSync` 输出末尾拼 `\n` |
| 用户运行 `lifecycle_commit` → preStageHook → saveState,文件被写入后 `biome check .` 接受 | Task 1.1 | 同上;dogfood 验收靠本 lifecycle 自己 PR CI |
| CI(`bun run check` 含 `biome check .`)不再因 `.state.json` 缺 trailing newline fail | Task 1.1 | 同上 |
| regression 测试守护:未来重构 saveState 时若不慎删除 `\n`,单元测试立即报错 | Task 2.1 | 新增 regression 单元测试 |

未漏覆盖。design.md `## 承诺清单 / Commitments` 段(第 8-30 行)的 5 条承诺与上表一一对应:
- "改 `src/skill-autopilot/runner.ts:103` 的 `saveState()` 加 trailing `\n`" → Task 1.1
- "检查 `renderIndexMd`:调研已确认无需修改" → 无 task(已在 design 阶段确认,本 plan 不动)
- "加 regression 单元测试覆盖 saveState 输出以 `\n` 结尾" → Task 2.1
- "不改 `.gitignore` / biome 配置 / lefthook 配置" → 全 task 不涉及(约束)
- "不破坏 saveState 现有行为契约" → Task 1.1 保留签名 `(cwd, state): void` 与 mkdirSync 逻辑
- "不引入新 byte-identical 镜像" → 全 task 不涉及

---

## Dependency Graph

```
Batch 1 (1 implementer): 1.1 [foundation - 1 行修改,无 deps]
Batch 2 (1 implementer): 2.1 [regression test - 依赖 1.1 完成才能验证通过]
```

理由:Task 2.1 的 Verify 命令 `bun test tests/skill-autopilot/runner.test.ts` 需要 Task 1.1 的 impl 已经落盘才能通过。两个 task 同 batch 并行时,Task 2.1 的 verify 可能先于 Task 1.1 完成,导致误报失败。拆 2 batches 保证 verify 顺序正确。

---

## Batch 1: 修源(1 implementer)

Task in this batch has no dependencies.
Tasks: 1.1

### Task 1.1: `saveState()` 添加 trailing newline
**File:** `src/skill-autopilot/runner.ts`
**Test:** none(本任务由 Task 2.1 的 regression 测试守护;Task 1.1 自身是 1 行字面量改动,无独立测试)
**Depends:** none
**Domain:** backend
**Atlas-impact:** none(设计层面已声明 `Atlas status: no-change`;runtime bug 修复,无长期心智模型变化)

**修改位置:** 第 103 行(函数 `saveState()` 内部,`writeFileSync` 调用)

**修改前(line 100-104):**

```typescript
function saveState(cwd: string, state: State): void {
  const file = join(cwd, STATE_FILE);
  mkdirSync(join(cwd, SKILLS_DIR), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, JSON_INDENT));
}
```

**修改后:**

```typescript
function saveState(cwd: string, state: State): void {
  const file = join(cwd, STATE_FILE);
  mkdirSync(join(cwd, SKILLS_DIR), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, JSON_INDENT)}\n`);
}
```

**精确字节级 diff:**

```diff
-  writeFileSync(file, JSON.stringify(state, null, JSON_INDENT));
+  writeFileSync(file, `${JSON.stringify(state, null, JSON_INDENT)}\n`);
```

**不动的部分(契约保护):**
- 函数签名 `(cwd: string, state: State): void` 保持不变
- `STATE_FILE` / `SKILLS_DIR` / `JSON_INDENT` 常量保持不变
- `mkdirSync` 逻辑(line 102)保持不变
- `loadState` / `emptyState` / `bumpState` / `distinctSets` 等相邻函数完全不动
- 调用者(`runInsideMutex` 在 line 334 处的调用)完全无感知

**实现备注(Senior engineer 决策):**
- 选模板字面量 `` `${...}\n` `` 而非字符串拼接 `JSON.stringify(...) + "\n"`:与 micode 代码库其他地方风格一致(grep 显示模板字面量是主流),且 biome 偏好。如果项目实际偏好 `+` 拼接,implementer 可自行切换,语义等价。
- 不抽 helper `writeJsonFile()`:design.md Open Question 2 明确说明本次只 1 处修复,不抽象。
- 不联动改其它 writeFileSync 调用(`lifecycle/lease/store.ts:58`、`atlas/challenge-dedup.ts:54`、`atlas/write-lock.ts:48`):design.md Open Question 1 明确说明这些文件未被 git tracked,不触发 CI fail,本 lifecycle 不扩展 scope。

**Verify:**
```bash
bun run check
```

预期:`biome check .` 通过(本任务自身不直接产出测试,但本 lifecycle 自身 commit 会触发 preStageHook 跑 saveState,写入新格式后整体 check 通过 — dogfood)。
另外手动验收:`od -c /tmp/test-state.json | tail -3` 看末尾字节(可选,留给 reviewer 信心)。

**Commit:** `fix(skill-autopilot): append trailing newline to .state.json writes (#75)`

---

## Batch 2: Regression Test(1 implementer)

Depends on Batch 1 completing.
Tasks: 2.1

### Task 2.1: Regression 单元测试 — saveState 输出末尾 `\n`
**File:** `tests/skill-autopilot/runner.test.ts`(在现有文件追加 1 个 `it` 块)
**Test:** 本任务本身就是测试,不再额外测试
**Depends:** 1.1(测试 expectation 依赖 1.1 的 impl 已落盘才能通过)
**Domain:** general(test infrastructure;tests/ 路径属于 cross-cutting test)
**Atlas-impact:** none

**修改方式:** 在现有 `tests/skill-autopilot/runner.test.ts` 文件末尾的 `describe("runAutopilot", ...)` 块内部追加 1 个新 `it` 测试。不新建文件,不改既有测试。

**追加位置:** 文件第 222 行(最后一个 `});` 之前,即 `describe` 块的最后一个 `it` 之后)。

**追加的测试代码:**

```typescript
  it("writes .state.json with a trailing newline", async () => {
    const dir = tempRoot("sa-runner-newline-");

    await runAutopilot({
      cwd: dir,
      projectId: PROJECT_ID,
      issueNumber: ISSUE,
      now: NOW,
      resolveProjectId: async () => ({ projectId: PROJECT_ID, kind: "origin", source: "git_remote" }),
      seedCandidates: [candidate({ trigger: WRITE_TRIGGER })],
    });

    const stateContent = readFileSync(join(dir, STATE_PATH), "utf8");
    expect(stateContent.endsWith("\n")).toBe(true);
  });
```

**测试设计说明(Senior engineer 决策):**

1. **使用 `runAutopilot` 公开 API 触发 saveState,而非直接调用 saveState:**
   - `saveState` 是 module-internal function,未导出。Mindmodel `patterns/testing.md` 规则 "Tests enforce contracts, not implementation" — 应测试可观察行为,不测内部 helper。
   - `runAutopilot` 是公开导出 API,且现有测试(line 130-149)已证明它会触发 saveState 写入 `.state.json`(`seedCandidates` 走完 pipeline 后 saveState 在 line ~334 被调用)。

2. **复用现有 test helpers (`tempRoot` / `candidate` / 常量):**
   - 现有 `tempRoot()` (line 24-28) 已通过 `mkdtempSync` 创建临时目录并自动清理(line 99-101 的 `afterEach` 已注册)。
   - 现有 `candidate()` (line 38-48) 和顶层常量 `PROJECT_ID` / `ISSUE` / `NOW` / `WRITE_TRIGGER` 直接复用,不引入新常量。
   - 已 import 的符号 `readFileSync` / `join` / `STATE_PATH` 全部可用,无需新 import。

3. **断言形态 `endsWith("\n")`:**
   - 比 `od -c` 字节检查更可读、更跨平台稳定。
   - 不断言精确字节长度(JSON 内容会随 seed 数据变,会脆)。
   - 不断言文件大小(同上)。

4. **测试名字 "writes .state.json with a trailing newline":**
   - 紧贴现有 `describe("runAutopilot", ...)` 块的命名风格(BDD 行为描述)。

5. **不 seedState():**
   - 现有 line 130 的 write 测试用 `seedState(dir)` 是因为它依赖 distinctIssues 计数;本测试只需观察 saveState 写入末尾字节,不需要预置 state 文件(saveState 会从空 state 起步,end-to-end 走完后写入新 .state.json)。
   - 即使 seedState 也无害(seedState 自己写入的 JSON 也不带 `\n`,会被 saveState 覆盖),不 seed 更简洁。

**不动的部分:**
- 文件顶部 imports 不动(`readFileSync` / `join` / `mkdtempSync` 已存在)
- 顶层常量 `STATE_PATH` / `PROJECT_ID` / `ISSUE` / `NOW` / `WRITE_TRIGGER` 不动
- helper 函数 `tempRoot` / `seedState` / `candidate` / `runDefault` 不动
- 其它 6 个既有 `it` 测试完全不动
- `afterEach` 自动清理 `roots` 不动 — 新测试通过 `tempRoot()` 自动加入 `roots` 数组,会被复用清理

**Verify:**
```bash
bun test tests/skill-autopilot/runner.test.ts
```

预期:所有现有测试继续通过 + 新增 "writes .state.json with a trailing newline" 通过。

进一步可选验收:
```bash
bun run check
```
确保整体 quality gate(typecheck + biome + 全量 test)不退化。

**Commit:** `test(skill-autopilot): regression test for .state.json trailing newline (#75)`
