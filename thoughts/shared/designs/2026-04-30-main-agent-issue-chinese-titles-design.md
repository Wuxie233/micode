---
date: 2026-04-30
topic: "主 agent 会话标题 issue 前缀与中文语义化"
status: validated
---

## Problem Statement

主 agent 会话标题现在仍可能显示英文 prompt 片段、工具阶段描述，或者过于机械的截断文本。用户期望主对话标题是中文、语义化、能看出需求本身，并且在有 lifecycle issue 时带上 issue 编号。

这次需求明确覆盖之前 v2 标题设计里“不加 issue 前缀”的选择。现在我们把 issue 编号视为主会话可见身份的一部分。

## Constraints

- 只给主 agent 会话加 issue 前缀，内部 spawn-agent 子会话不加。
- 主标题不能被 executor、implementer、reviewer、spawn-agent 等内部工具名污染。
- 有 issue 时使用用户指定的形态：`#32 状态：需求`。
- 无 issue 时仍保持中文语义标题，例如 `优化主会话标题生成` 或 `执行中：优化主会话标题生成`。
- 保留现有 opt-out、throttle、done-freeze 语义，避免用户手动改名后被频繁覆盖。
- 不引入完整 LLM 标题生成链路，本轮优先用确定性提取和格式化修正。

## Approach

采用“主会话标题状态机扩展”的方案：把 issue number 和中文语义 topic 变成标题状态的一部分，由 conversation-title 的 classifier、state、format 三层共同处理。

我选择这个方案，因为主会话标题已经由 conversation-title hook 统一管理。继续在这里扩展 issue 前缀和过滤规则，能避免 Octto portal 或 lifecycle 模块重复拼标题。

我考虑过在 Octto 列表端临时拼接 issue 编号，但那只修 UI，不修 OpenCode 原始 session title，也会让不同入口看到不同标题，所以不采用。

## Architecture

整体仍然维持三层结构：classifier 识别信号，state 保存会话标题上下文，format 负责最终字符串形态。

新增的核心是 `issueNumber` 字段和主会话标题格式变体。

**主会话标题格式：**

- 有 issue、执行中：`#13 执行中：优化主会话标题生成`
- 有 issue、已完成：`#13 已完成：优化主会话标题生成`
- 有 issue、失败：`#13 失败：优化主会话标题生成`
- 无 issue：`执行中：优化主会话标题生成`
- 子会话：继续使用 spawn-agent 子会话自己的标题策略，不带 issue 前缀。

## Components

**Milestone classifier:** 提取 issue number 和候选 topic。

- 从 `lifecycle_start_request` 输出解析 issue number。
- 从 `lifecycle_commit` 和 `lifecycle_finish` args 读取 `issue_number`。
- 从 lifecycle summary、design/plan topic、用户中文消息提取需求摘要。
- 拒绝 tool/agent 名称作为 topic。

**Title state registry:** 持久保存主会话的 issue number、topic、source confidence 和最后标题。

- issue number 一旦识别，后续低置信信号不能清空。
- 高置信 topic 仍优先，例如 lifecycle issue summary 高于用户闲聊消息。
- spawn/internal child session 继续被主标题逻辑排除。

**Title formatter:** 负责 issue-aware 中文标题格式。

- 有 issue 时使用 `#N 状态：需求`。
- 使用中文冒号 `：`，匹配用户给出的目标形态。
- 截断时保护 `#N 状态：` 前缀，只截断需求摘要。
- 不再把 issue-backed 主标题格式化成英文冒号或 raw prompt 片段。

**Low-info filter:** 扩展过滤规则。

- 过滤 `spawn-agent`、`implementer-*`、`executor`、`reviewer` 等纯技术名。
- 过滤 `Create implementation plan`、`Execute implementation plan` 等流程性英文短语。
- 保留真正的需求关键词，例如 `自动改名`、`中文对话名字`、`主 agent 标题`。

## Data Flow

当 lifecycle 创建 issue 时，hook 从工具输出或后续 lifecycle args 中拿到 issue number。

随后标题状态机记录：

- issue number：例如 `13`
- topic：例如 `优化主会话标题生成`
- status：例如 `执行中`
- source：例如 `lifecycle-issue`

formatter 输出：`#13 执行中：优化主会话标题生成`。

当任务完成后，finish 信号更新 status，topic 和 issue number 保持不变，标题变为：`#13 已完成：优化主会话标题生成`。

## Error Handling

如果 issue number 解析失败，主标题仍生成中文语义标题，只是不带 `#N`。

如果候选 topic 是工具名、agent 名、低信息英文流程词，状态机拒绝覆盖已有 topic。

如果没有可靠 topic，降级为中文状态标题，但不使用 `spawn-agent.*` 或英文工具名。

如果用户手动修改标题触发 opt-out，自动标题系统继续尊重手动标题。

## Testing Strategy

新增和更新测试围绕用户可见标题。

- lifecycle start 后主会话标题包含 issue 编号和中文需求。
- lifecycle commit/finish args 中的 issue number 能补全或保持 issue 前缀。
- 完成、失败、阻塞状态使用 `#N 状态：需求`。
- 无 issue 时不显示 `#N`。
- internal child session 不获得主会话 issue 前缀。
- 工具名、agent 名、英文流程短语不会覆盖中文需求 topic。
- 长中文需求截断时保留 `#N 状态：` 前缀。
- 已有 opt-out、throttle、done-freeze 测试继续通过。

## Open Questions

暂无阻塞问题。

后续如果要进一步“智能”，可以接入轻量摘要器把长中文用户问题归纳成 8 到 14 字标题。但这会引入非确定性，本轮先把 issue、状态、中文过滤链路做稳。
