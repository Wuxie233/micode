---
date: 2026-05-07
topic: "Critic Agent"
status: validated
---

## Problem Statement

现有对抗审查依赖 AGENTS.md 中的散文角色说明，再由主 agent 临时拼 prompt 派 `general` subagent。这个路径能工作，但输出格式、证据纪律、严重度分级和"允许批准"的边界不稳定。

我们要把对抗审查收敛为一个正式的 read-only `critic` subagent，同时保留现有 user-triggered 工作流：主 agent 可以提示用户可派，但不能擅自派；用户显式说"派红队 / 派极简派"后才调用。

## Constraints

- 只创建一个 `critic` agent，不创建五个独立 critic agent 文件。
- `critic` 必须 read-only：禁用 write、edit、bash、task，不提交、不部署、不重启、不修改文件。
- 触及 `src/agents/` 和 registry，属于 agent-surface forbidden work，必须走 lifecycle、planner、executor。
- 保留 AGENTS.md 中已有的 role pairing 和 max 3 critics per round 规则，避免丢失全局 workflow 合约。
- findings 必须遵守 Codex 风格 bug bar：有影响、离散可行动、证据明确、不靠未声明假设、不把有意变更当 bug。
- `cross-family` role 必须先检查可用 provider/model 多样性；只有单一家族时明确降级，不假装跨家族。

## Approach

采用 **单 agent + role 参数** 的方案。

`src/agents/critic.ts` 作为唯一 prompt 文件，包含一套 shared critic discipline 和五个 role-specific sections：`archaeologist`、`conservative`、`redteam`、`yagni`、`cross-family`。调用方在 prompt 中写明 role，critic 按对应 section 工作。

我选择这个方案，因为它同时满足两个方向：

- 比临时拼 `general` prompt 稳定：输出格式、严重度、证据引用、approval 语义统一。
- 比五个 agent 文件低耦合：所有 shared critic 规则只有一份，不会五处 drift。

## Architecture

新增 agent 作为现有 `src/agents/` registry 的普通 subagent。

结构上跟 `investigator` 更接近，而不是 `reviewer`：

- `reviewer` 可以跑测试，所以不禁 bash。
- `critic` 是证据审查，不执行命令，不改代码，应该禁 bash。
- `critic` 输出人类可读 synthesis，不参与 executor 的 `APPROVED / CHANGES REQUESTED` reviewer 循环。

Coordinator 层只需要知道有 `critic` 这个可用 subagent，并在 adversarial review 说明里把 dispatch target 从 `general role-prompt` 改成 `critic role-prompt`。

## Components

**`src/agents/critic.ts`**

- 定义 `criticAgent`。
- `mode: "subagent"`，低 temperature。
- 禁用 write/edit/bash/task。
- Prompt 包含 shared rules、five role sections、output format 和 never-do。

**`src/agents/index.ts`**

- 导入并注册 `critic`。
- 作为 named export 暴露 `criticAgent`。
- 保持默认 model 注入模式与现有 agents 一致。

**Coordinator prompts**

- `brainstormer` 和 `commander` 的 available agents / available subagents 列表加入 `critic`。
- adversarial review 文案保留 user-triggered 语义，仅说明现在调 `critic` agent 并传 role。

**Spawn-agent role labels**

- 给 `critic` 加中文 role label，便于子会话标题和可读日志。

**Tests**

- Agent unit tests 验证 read-only、temperature、prompt contract、role list、Codex bug bar。
- Registry tests 验证 `critic` 被导出和注册。
- Routing/source tests 验证 coordinator prompt 中列出 `critic`。
- Agent role label tests 验证中文标题映射。

## Data Flow

1. 用户在方案讨论阶段说："派红队审一下" 或 "派 yagni"。
2. 主 agent 根据 AGENTS.md role pairing 选择 `critic`，在 prompt 中写明 `role: redteam` 或 `role: yagni`。
3. `critic` 读取 proposal/context，按 shared bug bar 和 role-specific lens 产出 severity-tiered findings。
4. 主 agent 汇总每个 critic 的 key concern、平衡方案和剩余问题，然后停下来等用户决定。

## Error Handling

**Role 不明确**：critic 先列出支持的五个 role，请调用方重试，不自行猜测。

**证据不足**：finding 标为 `CANNOT_ASSESS` 或降到 P2/P3，不得制造 P0/P1。

**跨家族不可用**：`cross-family` role 明确输出"已降级为单家族 critic"，继续执行普通证据审查。

**输出无 finding**：允许 `APPROVED`，含义是"没发现阻塞问题"，不是"方案完美"。

## Testing Strategy

- 用 Bun tests 直接 import `criticAgent`，检查 `mode`、tool restrictions、temperature 和 prompt 关键语义。
- 扩展 `tests/agents/index.test.ts`，确保 registry/export 正确。
- 扩展 spawn-agent role label tests，确保 `critic` 有中文标签。
- 添加 coordinator routing source test，确保 `brainstormer` 和 `commander` 都知道 `critic`。
- 运行 `bun run check` 作为最终质量门。

## Open Questions

- `critic` 是否应支持机器可解析的 final marker。当前设计不需要，因为 adversarial review 是 human synthesis，不参与 executor reviewer loop。
- `cross-family` 的 provider preflight 初版可先基于 prompt 约束；如果后续发现不可靠，再做 code-level provider resolver。
