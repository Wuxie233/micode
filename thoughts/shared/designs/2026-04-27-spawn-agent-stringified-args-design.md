---
date: 2026-04-27
topic: "spawn_agent stringified args tolerance"
status: validated
---

## Problem Statement

Host 平台（部分上游 LLM runtime）会间歇性地把 `spawn_agent` 的 `agents` 数组或对象参数**序列化成 JSON 字符串**再传入工具。micode 的 `normalizeSpawnAgentArgs` 当前只接受原生 array / object / indexed record，遇到字符串直接走拒绝路径，触发：

```
Invalid spawn_agent arguments: each task must provide string agent, prompt, and description fields.
Raw args dumped to /tmp/micode-spawn-agent-<pid>-<ts>.json.
```

实际现象（已在本仓库会话中复现，dump 内容直接证据）：

- LLM 工具调用语义：`spawn_agent({ agents: [{ agent, prompt, description, model }] })`
- host 序列化后实际传入：`{ "agents": "[{...}]" }`（`agents` 字段是 stringified JSON）
- 副作用：同一会话同一 LLM 间歇性失败，导致 LLM-controlled 模型 override 功能在某些 host 路径下不可用

## Constraints

- **不修改 LLM 工具 schema**：仍只暴露 `array | object | indexed record`，不让 LLM 学到 "可以传字符串"
- 不动 `src/utils/model-selection.ts`、不动 `src/tools/sequence.ts`、不动 model 解析
- 保持 `normalizeSpawnAgentArgs` **永不抛异常** 的现有契约
- 保持现有错误信息常量 `INVALID_ARGS_MESSAGE` / `NO_AGENTS_MESSAGE` 不变
- 保持现有 `/tmp` dump 行为不变（拒绝路径上的调试线索）
- 不递归解析；最多兜底两层（顶层 input、`agents` key 的 value）

## Approach

在 `normalizeSpawnAgentArgs` 顶层入口和 `normalizeAgentsKey` 入口分别加一个**轻量级 stringified-JSON 解码器**：

1. 输入是 string 时，trim 并判断首字符是否为 `{` 或 `[`
2. 是则 try-parse 一次，成功则把解析后的值再交给原有路径
3. 失败或不像 JSON 则把字符串原样透传，由原有拒绝路径处理

这样：

- 兼容 host 序列化怪癖
- 不在 LLM schema 上引入 string 输入合法性
- 不引入歧义（纯字符串如 `"implementer"` 仍然被拒）

**为什么两层都做：** 实测 dump 显示 `{ "agents": "..." }`，所以 `normalizeAgentsKey` 兜底是核心场景；顶层兜底成本几乎为零，但防御未来 host 把整个 input 都 stringify 的情况。

**为什么不在 LLM schema 里允许 string：** 会让 LLM 学到一个错误的契约。未来 host 修复后反而劣化模型行为。

## Architecture

改动文件清单：

| 文件 | 类型 | 改动 |
|---|---|---|
| `src/tools/spawn-agent-args.ts` | 源码 | 新增私有 helper `tryParseStringifiedJson`；在 `normalizeSpawnAgentArgs` 顶层和 `normalizeAgentsKey` 入口各调用一次 |
| `tests/tools/spawn-agent-args.test.ts` | 测试 | 新增 stringified accepted / invalid / never-throws 三组用例 |
| `tests/tools/spawn-agent.test.ts` | 测试 | 新增一个集成 case，断言 stringified 输入下 `model` 仍透传到 prompt body |

不需要新文件、不需要改 LLM schema、不需要改 model 解析。

## Components

### `tryParseStringifiedJson(value: unknown): unknown` (新, 私有)

**职责：** 把可能被 host 字符串化的 JSON 输入安全还原为原生值，失败时不抛、不报错、原样返回。

**行为契约：**

- 入参非 string → 原样返回
- 入参 string 但 `trim()` 后不以 `{` 或 `[` 开头 → 原样返回（避免对纯文本如 `"implementer"` 误解析）
- `JSON.parse` 抛错 → catch 后原样返回（按 CODE_STYLE，bare catch 加 comment 解释 intent）
- `JSON.parse` 成功 → 返回 parsed value（可能是 array / object / record / 其它）

**显式不做：** 不递归（解析结果若仍是字符串，不二次 parse）；不打 log；不抛异常。

### `normalizeSpawnAgentArgs` (修改入口)

**新增第一步：** `input = tryParseStringifiedJson(input)`

后续所有判断（`Array.isArray` / `isPlainRecord` / `agents` key / `parseSingleTask` / `isIndexedRecord`）保持不变。

### `normalizeAgentsKey` (修改入口)

**新增第一步：** `value = tryParseStringifiedJson(value)`

后续所有分支（array / single task / indexed record）保持不变。

## Data Flow

```
LLM 工具调用语义: spawn_agent({ agents: [task] })
        │
        ▼
host runtime（可能把 array/object stringify）
        │
        ▼
ctx.tool.execute 收到 args（可能含 stringified 字段）
        │
        ▼
normalizeSpawnAgentArgs(input):
  1) input = tryParseStringifiedJson(input)        ← 顶层兜底
  2) Array.isArray(input)?  → normalizeArrayInput
     isPlainRecord(input)?
       has "agents" key?    → normalizeAgentsKey(value):
                                  a) value = tryParseStringifiedJson(value)  ← 字段兜底
                                  b) Array.isArray(value)? → normalizeArrayInput
                                  c) parseSingleTask(value)? → success
                                  d) isIndexedRecord(value)? → normalizeArrayInput
                                  e) → INVALID_ARGS_MESSAGE
       parseSingleTask(input)? → success
       isIndexedRecord(input)? → normalizeArrayInput
       else → INVALID_ARGS_MESSAGE
  3) 合法 → 进 model 解析 → 创建 subagent
  4) 非法 → INVALID_ARGS_MESSAGE + /tmp dump
```

## Error Handling

- **`JSON.parse` 抛异常：** `tryParseStringifiedJson` 内部 bare catch 直接返回原值。按 CODE_STYLE 是允许的（"intentional flow control / parse fallbacks"），加注释解释 intent
- **解析成功但 schema 不通过：** 和当前一致，走 `INVALID_ARGS_MESSAGE` + `/tmp` dump，行为不变
- **空字符串 / 非 JSON 字符串：** `tryParseStringifiedJson` 原样透传；后续路径以"非 array、非 record、单 task 解析失败、非 indexed record"拒绝；保持现有 `rejects { agents: 'string' }` 与 `rejects string primitive` 测试通过
- **永不抛：** 入口、helper、所有分支都不抛；现有的 "never throws" 测试套继续覆盖

## Testing Strategy

### `tests/tools/spawn-agent-args.test.ts`

在已有 describe 结构中扩展：

**新增 `describe("stringified accepted shapes")`**

- `it("normalizes stringified wrapped array { agents: '[task]' }")` — 等价于 `{ agents: [task] }`
- `it("normalizes stringified wrapped single task { agents: '{...task}' }")` — 等价于 wrapped single
- `it("preserves order across stringified multi-task array")`
- `it("normalizes stringified wrapped indexed record")`
- `it("normalizes top-level stringified array '[task]'")`（顶层兜底）
- `it("normalizes top-level stringified wrapped object '{\\"agents\\":[task]}'")`（防御性双层）

**扩展 `describe("invalid containers")` / `describe("invalid task shapes")`**

- `it("rejects stringified empty array { agents: '[]' }")` → `NO_AGENTS_MESSAGE`
- `it("rejects stringified task with wrong field type { agents: '[{agent:1,...}]' }")` → `INVALID_ARGS_MESSAGE`
- `it("rejects malformed JSON { agents: '[' }")` → `INVALID_ARGS_MESSAGE`
- `it("rejects plain string { agents: 'implementer' }")`（已有，确认未回归）

**扩展 `describe("never throws")` 数组**

- `["stringified bad json", { agents: "[" }]`
- `["stringified plain text", { agents: "implementer" }]`
- `["top-level stringified bad json", "["]`

### `tests/tools/spawn-agent.test.ts`

新增一个集成 case，覆盖端到端路径：

- `it("normalizes stringified spawn-agent payload and still applies model override")` — 输入 `{ agents: '[{...,model:"openai/gpt-5.5"}]' }`，断言 prompt body 里 `model: { providerID: "openai", modelID: "gpt-5.5" }` 透传成功

### 验收

`bun run check` 全绿（biome + eslint + typecheck + test）。

## Open Questions

无。
