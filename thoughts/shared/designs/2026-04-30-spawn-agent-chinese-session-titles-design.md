---
date: 2026-04-30
topic: "Spawn-agent 内部会话中文语义化命名"
status: validated
---

## Problem Statement

Octto 会话列表现在会暴露 `spawn-agent.implementer-backend` 这类内部技术标题。它符合当前实现，但不符合用户体验预期。

用户看到的是会话入口，不是调试日志。标题应该直接回答“这个会话在做什么”，并且在中文环境下优先使用中文表达。

## Constraints

- 不能把 `spawn-agent.*` 这种内部实现前缀继续暴露为用户主标题。
- 不改变主会话标题的稳定策略，避免执行阶段频繁覆盖原始任务主题。
- 复用现有 conversation-title 的中文状态词、标题格式和截断习惯。
- 不引入完整 i18n 框架，本次只做 scoped naming fix。
- 子会话标题必须在创建时就有意义，因为列表页会直接读取 session title。

## Approach

采用“子会话创建时语义化命名”的方案。

内部 spawn 会话不再以 agent 技术名作为标题，而是由状态、任务描述、agent 中文角色共同生成一个短中文标题。主会话标题仍由现有 conversation-title hook 管理，不让子任务执行噪声覆盖主主题。

我选择这个方案，因为它改动面最小、效果最直接，而且正好对应用户截图里的问题：Octto 列表展示的是内部 session title。

我考虑过让 conversation-title hook 接管内部会话，但这个方案会碰到 parent session、状态机置信度、并发 spawn 的复杂问题，收益不如直接修正内部会话命名。

## Architecture

新增一个 spawn session naming 层，位于 spawn-agent tool 附近，负责把内部 task metadata 转为用户可读标题。

整体结构保持简单：spawn-agent tool 只负责创建会话，naming helper 负责标题生成，conversation-title hook 继续负责主会话标题。

## Components

**Spawn session namer:** 根据 agent、description、outcome 生成中文标题。

- 输入 agent role、task description、可选 outcome。
- 输出短标题，例如 `执行中: 修复后端权限校验`。
- 对缺失 description 的任务使用 agent 中文角色兜底。

**Agent role labels:** 提供常见 agent 的中文角色名。

- `implementer-backend` 显示为 `后端实现`。
- `implementer-frontend` 显示为 `前端实现`。
- `reviewer` 显示为 `代码审查`。
- 未知 agent 保留原名，但不带 `spawn-agent.` 前缀。

**Spawn-agent tool integration:** 在创建内部 session 时调用 namer。

- 当前硬编码标题替换为语义化标题。
- 保留内部 session 的技术关联信息在结果输出或日志中，而不是会话主标题中。

**Completion title update:** spawn 结束后可选更新为终态标题。

- success 显示 `已完成: ...`。
- blocked 显示 `阻塞: ...`。
- failure 显示 `失败: ...`。

## Data Flow

执行器或其他调用方发起 spawn-agent 后，tool 收到 agent、description 和 prompt。

命名流程如下：

- 优先从 description 提取人类可读任务摘要。
- 如果 description 不可用，使用 prompt 的高层意图或 agent 中文角色作为兜底。
- 使用现有中文状态词生成标题。
- 创建内部 session 时写入这个标题。
- 子会话完成后，根据 outcome 更新为终态标题。
- Octto portal 继续读取 session.title，不需要额外 UI 改动。

## Error Handling

命名失败不能影响 spawn-agent 执行。

- description 缺失时降级为 agent 中文角色。
- agent 未知时降级为原 agent 名称，但移除 `spawn-agent.` 技术前缀。
- 标题为空时降级为 `执行中: 子任务`。
- 截断逻辑必须保留状态词，优先截断摘要。

## Testing Strategy

测试重点放在用户可见行为，而不是内部实现细节。

- spawn-agent 创建内部 session 时使用中文语义化标题。
- implementer、reviewer、planner 等 agent 有稳定中文角色映射。
- description 优先级高于 agent fallback。
- 长标题按现有格式截断。
- success、blocked、failed outcome 更新为正确中文终态。
- 现有主会话自动改名测试保持不变，确保主会话标题没有被子任务噪声覆盖。

## Open Questions

暂无阻塞问题。

后续如果要做完整多语言支持，可以把中文角色映射升级为配置化显示语言。但这不是本次修复的必要条件。
