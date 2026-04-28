---
date: 2026-04-27
topic: "primary agent model override escape hatch (brainstormer only)"
status: validated
---

## Problem Statement

`spawn_agent` 工具支持 per-call `model` 参数（LLM-controlled override），可以让 LLM 在用户提出"用 Opus 评审"这类指令时，把单次 subagent 派遣路由到指定模型。

但在 primary agent 路径（brainstormer / commander / octto）上**功能完全不可达**：

- 这些 agent 通过 `tools: { spawn_agent: false }` **物理禁用**了 spawn_agent
- prompt 反复要求 "ALWAYS use Task tool, NEVER use spawn_agent"
- OpenCode 内置的 Task 工具**没有 model 参数**

实测在 brainstormer 会话中用户说"用 Opus 评审"时，brainstormer 处于约束冲突状态（截图证据），无法派 Opus reviewer。

考古发现：

- `spawn_agent: false` 是上游 vtemian 在 2026-01-05 commit `520a065` 故意设置的"primary 用 Task / subagent 用 spawn_agent"分层架构边界
- spawn_agent 加 model 参数是 113 天后（2026-04-27 commit `00e4c33`），加的时候没有触及这条边界，也没有相关测试或文档讨论交互

## Constraints

**架构边界（来自上游意图 + 红队评估）：**

- commander 必须保持 `spawn_agent: false`。它是 v9 lifecycle 入口（lifecycle_start_request → lifecycle_commit → lifecycle_finish），spawn_agent 的 Promise.allSettled 异步语义会破坏 lifecycle 状态机的同步假设，造成 worktree / issue / PR / git 四方不一致，且会自动 push 到 fork（不可逆事故面）
- octto **本期不动**，单独建 issue 评估。理由：octto 走 background_task / portal auto-resume / WebSocket lifecycle 三套异步链路，叠加 spawn_agent 的 task_error resume 机制后存在 double-resume 风险，需要单独设计

> **实施期校准（2026-04-27）：** 实施时发现 `src/agents/octto.ts` **从未** 设置 `spawn_agent: false`，而是上游缺省状态（即默认开启）。本设计原文说"保持禁用"是基于错误前提。实际处理为：octto 完全不修改源文件，保持上游缺省状态；测试断言使用 `Object.hasOwn` 区分"未设置"与"设置为 false"，commander 仍是显式 `false`，octto 是"未设置"。这一现状本身可能是上游疏漏或刻意，不在本期讨论范围。

**技术约束：**

- 不修改 OpenCode 平台内置 Task 工具
- 不修改 spawn_agent 工具的 LLM-facing schema（`agents` 仍只接受 array | object | indexed record，不让 LLM 学到可以传字符串）
- 不修改 model 解析逻辑（`src/utils/model-selection.ts` 不动）
- 保持 `bun run check` 全绿
- escape hatch 触发条件必须**可机器判定**，不依赖 LLM 做模糊意图分类

**长期约束：**

- 当 OpenCode 平台给 Task 加 model 参数后，本 escape hatch 必须**立即废除**，写入文档作为强约束

## Approach

**「精准切口 + 守护带」。**

只对 brainstormer 一个 agent 打开 spawn_agent，配套四层守护：prompt 规则、tool description 下沉、可观测日志、prompt-lint 测试。

| 决策点 | 选择 | 理由 |
|---|---|---|
| commander spawn_agent | 保持 `false` | 红队 #4 风险 8/10，lifecycle 不可逆事故面 |
| brainstormer spawn_agent | 改为 `true` | 用户实际场景在这里，红队 #1/#2 可通过守护带缓解 |
| octto spawn_agent | 保持 `false`（本期） | 红队 #9 double-resume 风险待单独评估 |
| escape hatch 触发条件 | **用户最近消息含具体 model 字面 token** | 可机器判定，避开"明确要求"这种 LLM 难判定语义 |
| 规则放置位置 | prompt + spawn_agent tool description | tool description 是 LLM tool selection 时一定会读的，比单纯放 system prompt 更稳 |
| 默认行为 | 不变（仍用 Task） | 守护"escape hatch 不漂移成常态" |

**为什么不选其他方案：**

- 直接打开三个 primary（粗暴方案）：红队风险 8/10，commander 那条不接受
- modelOverrides 声明 + hook 注入（保守派 A）：依赖 OpenCode hook 能改写内置 Task 参数（未验证），且体验是声明式，跟"用 Opus 评审"这句中文期望的"立即生效"不符
- dispatch 新工具（保守派 B）：本质是换名字的 spawn_agent，绕过禁用边界
- escalation 转交（保守派 C）：用户体验断层（要切 agent / 走 handoff 文件）
- 后台重派 hook（保守派 D）：token 翻倍 + 自然语言意图匹配不可靠

## Architecture

改动以 **brainstormer 为唯一切入点**，其他 primary agent 保持现状。

### 模块影响

| 模块 | 改动 |
|---|---|
| `src/agents/brainstormer.ts` | 去掉 `spawn_agent: false`；prompt 加 escape hatch 段落（含触发条件 + 反例 + 废除条款引用） |
| `src/agents/commander.ts` | **不动** |
| `src/agents/octto.ts` | **不动** |
| `src/tools/spawn-agent/tool.ts` | tool description 加一段：primary-agent caller 仅在最近用户消息含具体 model 字面名时使用本工具 |
| `src/utils/logger.ts` | 不动（用现有 log.info） |
| `src/tools/spawn-agent/tool.ts` 的 handler | 在 task model override 路径加一条结构化 info log（caller agent + target agent + model + override 类型），可被后续审计 |
| `tests/agents/` | 新增 brainstormer.test.ts（验证 spawn_agent 已开 + prompt 含 escape hatch 段落 + commander 仍关 + octto 仍关）|
| `README.md` | 加一段 "primary agent model override" 说明 + 废除条款 |

### 不影响的边界

- spawn_agent 的 LLM-facing schema 不变
- model 解析逻辑不变
- v9 lifecycle 链路不变
- octto / commander 任何行为不变

## Components

### 1. brainstormer prompt escape hatch 段落（新增）

**位置：** `src/agents/brainstormer.ts` prompt 字符串里，紧跟现有 "Use Task tool / NEVER use spawn_agent" 段落之后。

**内容契约：**

- 强调默认规则不变：派 subagent 用 Task
- 单一例外触发条件：**用户最近一条消息包含具体 model 字面 token**（如 claude / opus / sonnet / gpt / gemini / haiku 等）
- 触发后用 spawn_agent 单次调用，并在 model 字段填入 `provider/model` 字符串
- 显式反例清单：
  - "这个用更好的模型" — 不触发
  - "感觉太慢了" — 不触发
  - "换一个" — 不触发
  - "试试别的" — 不触发
- 不确定时**问用户**，不要自己猜
- 一次 escape hatch 不构成默认行为，下次仍走 Task
- 结尾注明：当 OpenCode Task 支持 model 参数后此规则立即作废

### 2. spawn_agent tool description 守护补充（新增段落）

**位置：** `src/tools/spawn-agent/tool.ts` 中 tool description 字符串。

**内容契约：**

- 现有描述完全保留
- 追加一段："primary agent caller policy"
  - 默认 primary agent（brainstormer/commander/octto）应使用 Task 工具
  - brainstormer 是当前唯一允许的 primary caller
  - 调用条件：用户最近消息中含具体 model 字面 token
  - 不满足条件时 abort 并改用 Task
  - 这是过渡性 escape hatch，未来 Task 支持 model 参数后废除

**为什么放 tool description**：LLM 在 tool selection 阶段一定会扫 tool description；放 system prompt 里被淡化的概率比放 tool description 大。

### 3. caller observability log（新增）

**位置：** `src/tools/spawn-agent/tool.ts` handler 中 model override 解析成功的分支。

**内容契约：**

- 当 task 含 model override 时，调用 `log.info("spawn_agent.model_override", { caller, target_agent, provider, model_id })`
- caller 标识尽量从 ctx 上下文取（如能拿到 sessionInfo / agent name），取不到则记 `unknown`
- 不影响主逻辑（fail-safe wrap）
- 为后续"primary 是否在违规调用"审计提供数据基础

**为什么必要**：红队 #1（规则漂移）和 #2（语义歧义）的最大问题是**不可观测**。先建立日志基础，等数据积累后再决定是否要更严格的 runtime guard。

### 4. agent config lint 测试（新增）

**位置：** `tests/agents/brainstormer.test.ts`（或类似路径，按现有测试组织）。

**测试 case：**

- `it("brainstormer enables spawn_agent for model override escape hatch")` — 断言 `brainstormerAgent.tools.spawn_agent === true`
- `it("brainstormer prompt documents the escape hatch with a sunset clause")` — 断言 prompt 字符串里同时包含：
  - 触发条件关键词（"model literal" 或类似）
  - "废除" / "sunset" 或等价说明
  - 反例段落标记
- `it("commander keeps spawn_agent disabled (lifecycle integrity)")` — 断言 `commanderAgent.tools.spawn_agent === false`
- `it("octto keeps spawn_agent disabled (pending separate evaluation)")` — 断言 octto 配置同样保持禁用
- `it("only brainstormer is allowed to call spawn_agent among primary agents")` — 遍历所有 primary agent 配置，断言除 brainstormer 外都禁用

**这是配置漂移检测**：未来若有人误删 commander 的 `spawn_agent: false`，CI 立即拦截。

### 5. spawn_agent tool description 测试（新增）

**位置：** `tests/tools/spawn-agent.test.ts` 现有结构内。

**测试 case：**

- `it("tool description carries the primary-agent caller policy")` — 断言 tool description 字符串包含：
  - "primary agent" 或等价表述
  - "brainstormer" 显式列出
  - "Task" 字样（指向默认通道）
  - "model literal" 触发条件描述

### 6. README escape hatch 说明（更新）

**位置：** `README.md` 现有 "LLM-Controlled Spawn Model Overrides" 段落附近。

**新增内容：**

- 说明 brainstormer 是唯一允许 primary 调用 spawn_agent 的 agent
- 说明触发条件（用户消息含具体 model 字面 token）
- 显式废除条款：当 OpenCode 平台给 Task 加 model 参数后，escape hatch 立即移除
- 引用本设计文档路径

## Data Flow

```
用户在 brainstormer 会话: "用 Opus 评审刚才的设计"
        │
        ▼
brainstormer 收到消息
        │
        ▼
brainstormer 检查 prompt escape hatch 规则:
  - 消息中是否含具体 model 字面 token? "Opus" → 是
  - 是否是单次明确请求? 是
        │
        ▼
brainstormer 选择工具:
  - 默认: Task(subagent_type="reviewer", ...)
  - 当前命中 escape hatch: spawn_agent({ agents: [{
      agent: "reviewer",
      prompt: "...",
      description: "Review per user request",
      model: "wuxie-claude/claude-opus-4-7"  // brainstormer 从配置中可知 provider
    }]})
        │
        ▼
spawn_agent handler:
  1) normalizeSpawnAgentArgs (含 stringified 兜底)
  2) resolveModelReference(model, availableModels)
  3) 解析成功 → log.info("spawn_agent.model_override", {...})
  4) 解析失败 → hard_failure (与现有路径一致)
        │
        ▼
session.create + session.prompt(body 含 model)
        │
        ▼
返回结果给 brainstormer
        │
        ▼
下一轮用户消息不含 model 字面 token:
brainstormer 回归默认: 使用 Task tool
```

## Error Handling

- **escape hatch 误触发**（LLM 把"我觉得 sonnet 更好"当成请求）：靠反例段落 + tool description 守护抑制；事后通过 caller log 审计
- **model 解析失败**：保持现有 hard_failure 行为，错误信息 `Model override is not available: <model>`
- **brainstormer 在不该用时用了 spawn_agent**：log 留痕，靠人工审计 + 后续可加 runtime guard。本期不加 hard guard（避免误伤合法触发）
- **测试假阳性**（prompt lint 误报）：测试断言用 substring/keyword 而非完整字符串，允许 prompt 措辞演化
- **commander spawn_agent 配置被误改**：CI 拦截

## Testing Strategy

### 自动化测试（必须）

`tests/agents/brainstormer.test.ts` 新增（或扩展现有）：

- 5 条 agent config lint case（见 Components #4）
- 1 条 prompt 内容 lint case：验证 escape hatch 段落存在 + 反例段落存在 + 废除条款存在

`tests/tools/spawn-agent.test.ts` 扩展：

- 1 条 tool description case：验证 primary-agent caller policy 段落存在

### 手工验证（实施后做一次）

实施 + commit + push + 用户重启 OpenCode 后：

- 在 brainstormer 会话说"用 Opus 评审 X"，观察 brainstormer 是否走 spawn_agent + model 参数
- 在 brainstormer 会话说"觉得这个慢"，观察 brainstormer **不应**走 spawn_agent
- 检查日志能搜到 `spawn_agent.model_override` 事件

### 不测试的（明确不在范围）

- LLM 行为完整性（"在所有边界 prompt 下都正确选工具"）：LLM 行为不可单测，靠 prompt 设计 + 守护带 + 长期日志审计
- octto 路径：本期不动
- 跨 session 行为：escape hatch 是单次 per-call，不跨 session

## Open Questions

1. **caller log 中 caller agent name 的获取路径**：spawn_agent handler 是否能从 ctx 拿到 calling agent 的 name？如不能，本期 caller 字段记 `unknown`，作为 follow-up 改进
2. **octto 是否要走类似机制**：等本期落地稳定后单独建 issue 评估
3. **OpenCode 上游 Task model 参数 PR 是否值得提**：长期最优解，但跟本期解耦
4. **brainstormer 是否需要在 prompt 里也禁用 commander 的某些行为**：本期不动；commander 自己的 prompt 仍然 NEVER spawn_agent 是足够的
