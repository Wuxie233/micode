---
date: 2026-05-15
topic: "upstream stream error retry"
contract: none
---

# Upstream Stream Error Retry — Implementation Plan

**Goal:** 把形如 `{"type":"error","error":{"type":"upstream_error","code":"internal_server_error","message":"stream error: stream ID 1261; INTERNAL_ERROR; received from peer"}}` 的 HTTP/2 上游 stream INTERNAL_ERROR 加入 `spawn_agent` 既有 transient 自动重试通道。

**Architecture:** 仅扩展 `src/tools/spawn-agent/classify-tokens.ts` 的 `TRANSIENT_NETWORK_PATTERNS` 数组：新增一条 **窄化** 正则 `/stream\s+ID\s+\d+;\s*INTERNAL_ERROR/i`，要求 `stream ID <number>` 与 `INTERNAL_ERROR` 必须共现（HTTP/2 peer-reset 签名），从而被既有 `classifySpawnError → INTERNAL_CLASSES.TRANSIENT → retryOnTransient` 路径自动识别。不新增重试通道，不改 retries/backoff 配置，不动 `TRANSIENT_HTTP_STATUSES`，不改任何调用点。

**Design source:** 用户消息（无 design.md）；约束：复用 `TRANSIENT_NETWORK_PATTERNS` / `classifySpawnError` / `retryOnTransient`，避免把普通 HTTP 500 或 `internal_server_error` code、`upstream_error` type 误判为 transient。

**Contract:** none（单域、单插件 runtime 行为；无 frontend↔backend 边界）。

---

## 目标 / Goals

- 让 `spawn_agent` 在子 agent 触发 HTTP/2 上游 stream INTERNAL_ERROR（"stream error: stream ID N; INTERNAL_ERROR; received from peer"）时，与现有 `ECONNRESET` / `ETIMEDOUT` / `stream aborted|reset|closed` 一样落入 `INTERNAL_CLASSES.TRANSIENT`，由 `retryOnTransient` 在同一 subagent session 内自动重试。
- 保持其它分类语义不变：成功仍然成功，task_error / blocked / hard_failure / review_changes_requested 不被波及。
- 用 token-level 单元测试守护新增模式不漂移（既匹配该错误的代表性 message，也明确不匹配普通 500 / `internal_server_error` / `upstream_error` 三类近邻字符串）。

## 非目标 / Non-Goals

- 不把 HTTP 500 加入 `TRANSIENT_HTTP_STATUSES`（保留"普通 500 不自动重试"的现有决策）。
- 不匹配裸 `INTERNAL_ERROR` / `internal_server_error` / `upstream_error` token（避免捕获非 h2 peer-reset 的真失败）。
- 不新增重试通道、不改 retries/backoff 配置、不动 `classifySpawnError` 调用方（`tool.ts`、`retitle-stale-reviews.ts`）。
- 不引入新的分类（`INTERNAL_CLASSES` 不变）、不引入新 `reason` 字符串、不引入新 frontmatter / agent field。
- 不需要 atlas / project memory 写入（runtime fix，非长期决策；本计划本身的判定理由仍会被 planner 归档到 plan 文件，作为下次类似改动的参考即可）。

## 依赖图 / Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2 [TDD red: 给 classify-tokens / classify 加失败用例 — 无依赖]
Batch 2 (sequential after Batch 1): 2.1 [实现: 在 TRANSIENT_NETWORK_PATTERNS 加正则 — 依赖 1.1, 1.2 看到红]
Batch 3 (parallel after Batch 2): 3.1 [验证全量测试绿]
```

注：Batch 1 两个测试任务相互独立可并行；Batch 2 只有一个文件改动；Batch 3 是 verify-only。

---

## Batch 1: TDD red — 新增匹配 / 反匹配用例 (parallel - 2 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2

### Task 1.1: 给 TRANSIENT_NETWORK_PATTERNS 加 h2 上游 stream INTERNAL_ERROR 正反匹配用例（TDD red）
**File:** `tests/tools/spawn-agent/classify-tokens.test.ts`
**Test:** `tests/tools/spawn-agent/classify-tokens.test.ts`（自包含；新增 `it(...)` 块）
**Depends:** none
**Domain:** general
**Atlas-impact:** none

**意图**

在既有 `describe("spawn-agent classifier tokens", ...)` 块内，追加两个 `it(...)`：

1. 正向：用 `matchesAnyPattern(message, TRANSIENT_NETWORK_PATTERNS)` 断言下列代表性 message 字符串返回 `true`：
   - `"stream error: stream ID 1261; INTERNAL_ERROR; received from peer"`
   - JSON-stringified 形式：`'{"type":"error","sequence_number":0,"error":{"type":"upstream_error","code":"internal_server_error","message":"stream error: stream ID 1261; INTERNAL_ERROR; received from peer"}}'`（验证 `String(e)` 兜底路径下也会命中）
   - 不同 stream ID 数字（例如 `7`、`99999`）—— 守护正则不写死 ID 长度。

2. 反向：用 `matchesAnyPattern(message, TRANSIENT_NETWORK_PATTERNS)` 断言下列字符串 **仍然** 返回 `false`（守护窄化）：
   - `"upstream returned internal_server_error"`（裸 code）
   - `"upstream_error: provider blew up"`（裸 type）
   - `"HTTP 500 Internal Server Error"`（普通 500）
   - `"stream error happened"`（无 `stream ID N; INTERNAL_ERROR` 共现）
   - `"INTERNAL_ERROR"`（孤立 token）

**编码约束**

- 文件已使用 `bun:test` 的 `describe / it / expect`，沿用即可，不引入新 import。
- 把代表性字符串提到文件顶部常量区（如 `STREAM_INTERNAL_ERROR_MESSAGE` / `STREAM_INTERNAL_ERROR_JSON_MESSAGE` / `STREAM_INTERNAL_ERROR_OTHER_ID_MESSAGE` / `NON_TRANSIENT_INTERNAL_ERROR_MESSAGE` 等），与现有 `ECONNRESET_MESSAGE` / `STREAM_RESET_MESSAGE` 命名风格一致。
- 不修改既有 `it(...)` 块的断言；保留 `STREAM_RESET_MESSAGE` 的现有正向匹配测试（属于既有 `stream (aborted|reset|closed)` 模式，不在本变更范围）。

**Verify (red 阶段，Batch 1 单独跑应失败):**
```sh
bun test tests/tools/spawn-agent/classify-tokens.test.ts
```

**Verify (Batch 2 完成后再跑应全绿):**
```sh
bun test tests/tools/spawn-agent/classify-tokens.test.ts
```

**Commit:** `test(spawn-agent): add h2 upstream stream INTERNAL_ERROR transient pattern cases`

### Task 1.2: 给 classifySpawnError 加端到端 transient 分类用例（TDD red）
**File:** `tests/tools/spawn-agent/classify.test.ts`
**Test:** `tests/tools/spawn-agent/classify.test.ts`（自包含；新增 `it(...)` 块）
**Depends:** none
**Domain:** general
**Atlas-impact:** none

**意图**

在既有 `describe("classifySpawnError", ...)` 块内，追加 `it(...)`：

1. 正向（核心）：
   ```ts
   const result = classifySpawnError({
     thrown: new Error("stream error: stream ID 1261; INTERNAL_ERROR; received from peer"),
   });
   expect(result.class).toBe(INTERNAL_CLASSES.TRANSIENT);
   expect(result.reason).toContain("INTERNAL_ERROR");
   ```

2. 正向（带 httpStatus=500，验证 thrown-pattern 路径优先于 status 检查；现有 `classify.ts:108-114` 顺序保证 `thrown && pattern` 在 `isTransientStatus` 之前命中）：
   ```ts
   const result = classifySpawnError({
     thrown: new Error("stream error: stream ID 42; INTERNAL_ERROR; received from peer"),
     httpStatus: 500,
   });
   expect(result.class).toBe(INTERNAL_CLASSES.TRANSIENT);
   ```

3. 反向（守护：thrown=`Error("internal_server_error")` 且 httpStatus=500 仍然 **不是** TRANSIENT）：
   ```ts
   const result = classifySpawnError({
     thrown: new Error("internal_server_error"),
     httpStatus: 500,
   });
   expect(result.class).not.toBe(INTERNAL_CLASSES.TRANSIENT);
   ```

4. 反向（守护：纯 `upstream_error` 字符串 thrown 不是 TRANSIENT）：
   ```ts
   const result = classifySpawnError({
     thrown: new Error("upstream_error: something went wrong"),
   });
   expect(result.class).not.toBe(INTERNAL_CLASSES.TRANSIENT);
   ```

**编码约束**

- 沿用文件现有 `bun:test` import 与 `@/tools/spawn-agent/classify` 路径别名。
- 不引入 mock；`classifySpawnError` 是纯函数。
- 不修改既有 `it(...)`；新增用例追加到 `describe("classifySpawnError", ...)` 块末尾。

**Verify (red 阶段，Batch 1 单独跑应失败):**
```sh
bun test tests/tools/spawn-agent/classify.test.ts
```

**Verify (Batch 2 完成后再跑应全绿):**
```sh
bun test tests/tools/spawn-agent/classify.test.ts
```

**Commit:** `test(spawn-agent): classify h2 upstream stream INTERNAL_ERROR as transient`

---

## Batch 2: 实现 — 在 TRANSIENT_NETWORK_PATTERNS 增补窄化正则 (sequential after Batch 1)

Depends on Batch 1 (failing tests landed).
Tasks: 2.1

### Task 2.1: 在 TRANSIENT_NETWORK_PATTERNS 增补窄化 h2 上游 INTERNAL_ERROR 正则
**File:** `src/tools/spawn-agent/classify-tokens.ts`
**Test:** Batch 1 的两个测试文件（`tests/tools/spawn-agent/classify-tokens.test.ts` + `tests/tools/spawn-agent/classify.test.ts`），均应在本任务完成后转绿。
**Depends:** 1.1, 1.2
**Domain:** general
**Atlas-impact:** none

**意图**

在 `TRANSIENT_NETWORK_PATTERNS` 数组里追加一条 **窄化** 正则：

```ts
/stream\s+ID\s+\d+;\s*INTERNAL_ERROR/i
```

放在 `/stream\s+(aborted|reset|closed)/i` 之后即可（顺序不影响语义，因为 `matchesAnyPattern` 用 `.some()`）。

**为什么这样写**

- 强制 `stream ID <number>` 与 `INTERNAL_ERROR` 在同一字符串中按顺序共现。这是 HTTP/2 peer reset 的特征短语（参见 Go 标准库 `http2.StreamError.String()`），也是用户报告的 `upstream_error.message` 的固定形式。
- `\d+` 不写死 ID 长度，覆盖任意 stream 编号。
- 不匹配孤立的 `INTERNAL_ERROR` token，也不匹配 `internal_server_error` / `upstream_error`；这是 1.1 反匹配用例守护的范围。
- `i` flag 与既有模式一致（既有模式都带 `i`）。

**编码约束**

- 仅修改 `classify-tokens.ts`；不动 `classify.ts`、`tool.ts`、`retry.ts`。
- 不动 `TRANSIENT_HTTP_STATUSES`（500 仍然不在 transient HTTP 列表里）。
- 不引入新 import / 新常量 / 新导出。
- 数组其它条目保持完全不变（包括既有 `/stream\s+(aborted|reset|closed)/i`）。

**与既有路径的衔接（实现者无需改动这些文件，只需理解）**

- `src/tools/spawn-agent/classify.ts:108-114` 的 `transientFailure` 已经先做 `thrown && matchesAnyPattern(message, TRANSIENT_NETWORK_PATTERNS)` 再看 httpStatus；新增正则自动落入此优先级。
- `src/tools/spawn-agent/tool.ts:317-333` 的 `classifyThrown` 在拿到 TRANSIENT 时调用 `deleteInternalSession({ ctx, sessionId, agent: "spawn-agent.transient" })` 清理失败 session，并将 `sessionId` 透传给 `onTransientSession` 回调；行为不变。
- `src/tools/spawn-agent/retry.ts:33` 的 `retryOnTransient` 按既有 `config.subagent.retries / backoff` 策略重试；不需要任何参数调整。

**Verify:**
```sh
bun test tests/tools/spawn-agent/classify-tokens.test.ts
bun test tests/tools/spawn-agent/classify.test.ts
```

**Commit:** `feat(spawn-agent): treat h2 upstream stream INTERNAL_ERROR as transient and retry`

---

## Batch 3: 验证 — 全套 spawn-agent 测试绿 (parallel after Batch 2)

Depends on Batch 2 (implementation landed).
Tasks: 3.1

### Task 3.1: 跑全套 spawn-agent 测试，守护无回归
**File:** （无文件改动；纯验证任务）
**Test:** none（任务本身就是运行测试套件，semantic risk 已被 1.1 / 1.2 / 2.1 覆盖）
**Depends:** 2.1
**Domain:** general
**Atlas-impact:** none

**意图**

在 `/root/CODE/micode` 工作目录跑完整 `tests/tools/spawn-agent/` 套件，确认：

- Batch 1 新增的两条测试文件（`classify-tokens.test.ts` / `classify.test.ts`）全部通过。
- 既有测试零回归：`agent-roles` / `classify-verifier-integration` / `cleanup` / `diagnostics` / `format` / `generation-fence` / `generation-fence-e2e` / `integration` / `marker-confidence` / `naming` / `naming-integration` / `preserve-on-failure` / `read-guard` / `registry` / `resume-prompt` / `retitle-stale-reviews` / `retry` / `spawn-session-registry` / `task-identity` / `tool` / `types` / `verifier` / `verifier-types` 全绿。

**编码约束**

- 不修改任何源代码；如果出现回归，以"实现失败"上报，由上层决定 resume / 修复路径。
- 不引入新测试文件。

**Verify:**
```sh
bun test tests/tools/spawn-agent
```

**Commit:** （本任务无代码改动，无独立 commit；如需要可作为 Batch 2 commit 的同 batch verify 步骤记录在 lifecycle 进度）

---

## 风险控制 / Risk Controls

| 风险 | 控制 |
|---|---|
| 把普通 HTTP 500 误判为 transient | 不动 `TRANSIENT_HTTP_STATUSES`；新增正则只看 message 字符串，且要求 `stream ID N; INTERNAL_ERROR` 共现 |
| 把所有上游 `internal_server_error` 误判为 transient | 不匹配 `internal_server_error` token；用 1.1 反匹配用例守护 |
| 把所有上游 `upstream_error` 误判为 transient | 不匹配 `upstream_error` token；用 1.1 反匹配用例守护 |
| 与既有 `stream (aborted|reset|closed)` 模式冲突 / 重复匹配 | 新增正则使用不同关键字 `stream ID <number>; INTERNAL_ERROR`，不与现有模式产生 superset 关系；现有 `STREAM_RESET_MESSAGE` 测试用例继续通过 |
| Retry 风暴：单次失败被重试到耗尽预算 | 复用 `retryOnTransient` 既有 maxAttempts/backoff；不引入新通道；transient session 仍按 `deleteInternalSession` 清理（见 `tool.ts:325`） |
| 错误对象不是 `Error` 实例时 `extractErrorMessage` 行为 | `extractErrorMessage` 已用 `String(e)` 兜底（`src/utils/errors.ts`），正则在结果字符串上 `i` flag 匹配，对裸字符串 / Error / JSON-stringified 错误三种来源都适用 |
| 单元测试覆盖与真实 runtime 路径脱节 | Batch 3 跑全套 `tests/tools/spawn-agent/` 套件（不只新增文件），守护 `classify.test.ts` / `classify-tokens.test.ts` / `retry.test.ts` 等既有断言不破 |

## 知识上下文 / Knowledge Context

- 读取的代码事实：`src/tools/spawn-agent/classify-tokens.ts`（TRANSIENT_NETWORK_PATTERNS / TRANSIENT_HTTP_STATUSES 定义）、`src/tools/spawn-agent/classify.ts`（`classifySpawnError` 优先 `thrown + transient pattern` → 再 `httpStatus + TRANSIENT_HTTP_STATUSES`）、`src/tools/spawn-agent/tool.ts:317-333`（`classifyThrown` 把 thrown 错误送入 classify 并在 TRANSIENT 时清理 session）、`src/tools/spawn-agent/retry.ts:33`（`retryOnTransient` 入口）、`src/utils/errors.ts`（`extractErrorMessage` 兜底）。
- 既有测试约定：`tests/tools/spawn-agent/classify-tokens.test.ts` 用代表性 message 串做正反断言；`tests/tools/spawn-agent/classify.test.ts` 用 `classifySpawnError({ thrown: new Error(...) })` 端到端断言分类。新增测试沿用同一风格，不引入新框架 / 新 helper。
- Project Memory：lookup 无相关条目（用户已告知）；本变更属于 runtime 修复 + 经验级判断，决策理由（"为什么不直接放宽 HTTP 500"）写在本计划"非目标"与"风险控制"段；executor 完成 batch 后由 primary agent 决定是否 `project_memory_promote` 为 `lesson`（条件：未来出现第二种 h2 上游模式需要相似处理时再固化为 decision）。
- Atlas：未初始化（用户已告知）；不触发 atlas Maintain；任务终态写 `Atlas status: cannot-assess`。
- Project Memory status（计划阶段）：`read-only`。
- Atlas status（计划阶段）：`cannot-assess`。

## 行为承诺映射 / Behavior Mapping

design.md 不存在（runtime fix 直接来自用户消息）。本计划对应的用户可见行为承诺：

- "spawn_agent 在收到形如 `stream error: stream ID N; INTERNAL_ERROR; received from peer` 的上游错误时，会自动在同一 subagent session 内重试，而不是直接把 outcome 上报为 hard_failure。" → 由 Batch 1 / Batch 2 联合覆盖（Batch 1 用 token-level + 行为级测试断言；Batch 2 落实改动；Batch 3 守护既有套件不破）。
- "普通 HTTP 500、裸 `internal_server_error`、裸 `upstream_error` 不会被错误升级为 transient。" → 由 Batch 1 的反匹配用例覆盖。

## 总验收 / Acceptance

按下面顺序在 `/root/CODE/micode` 工作目录执行，每一步都应通过：

```sh
# 1) Batch 1 红：新增的两个测试用例应失败（patterns 数组尚未含新正则）
bun test tests/tools/spawn-agent/classify-tokens.test.ts
bun test tests/tools/spawn-agent/classify.test.ts

# 2) Batch 2 绿：实现后两个文件的新用例 + 既有用例全部通过
bun test tests/tools/spawn-agent/classify-tokens.test.ts
bun test tests/tools/spawn-agent/classify.test.ts

# 3) Batch 3：spawn-agent 全套测试绿，无回归
bun test tests/tools/spawn-agent
```

Stretch（可选）：

```sh
# 验证项目整体未被破坏（按本地资源裁剪；如果耗时大可只跑 spawn-agent 套件）
bun test
```

