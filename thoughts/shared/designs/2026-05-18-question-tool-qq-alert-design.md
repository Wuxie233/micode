---
date: 2026-05-18
topic: question-tool-qq-alert
status: validated
---

## 承诺清单 / Commitments

- Primary agents 在调用 built-in `question` tool 前，先 best-effort 发送一次短 QQ 提醒。
- 提醒只覆盖 built-in `question` tool，不覆盖 plain chat、Octto、`autoinfo_remote_ask` 或任何 subagent / non-primary agent。
- QQ 提醒内容固定短中文，低信息量，不包含问题正文、日志、路径、凭据、私有 URL 或任何秘密。
- QQ 发送失败、不可用或超时时，不阻塞提问、不重试，继续调用 `question`。
- 既有 terminal completion notification 语义保持不变：终态通知仍 exactly-once，且仍是 final answer 前最后一次 tool call。
- 全局 `AGENTS.md` 修改生效依赖新会话；自动化不重启 OpenCode，终态报告提示用户自行 quit / restart。

## Problem Statement

用户希望以后 primary agent 在通过 built-in `question` tool 发起结构化提问前，先通过 QQ 提醒用户“有问题需要回答”，避免问题卡在 OpenCode 会话内无人注意。

设计目标是在全局 agent policy 中增加一个窄例外，而不是改变所有提问渠道或完成通知协议。

## Constraints

- 只设计后续要修改的全局 policy 行为；本 artifact 不直接修改 `/root/.config/opencode/AGENTS.md`。
- 仅适用于 primary agents 调用 built-in `question` tool 的路径。
- 不影响 plain chat 轻量确认，不影响 Octto 默认异步 / 重型 review 流程。
- 不允许 subagents / non-primary agents 发送该预提问 QQ 提醒。
- 不使用 `autoinfo_remote_ask` 作为替代问题渠道。
- 不新增 config knob、retry 机制、计数器、节流协议或新工作流层。
- 不自动重启 OpenCode。
- QQ 内容必须少于 200 字，中文、无秘密、无原始问题内容。

## Approach

采用 narrow pre-question alert exception：在全局 `AGENTS.md` 的 Built-in `question` tool rules 下增加一条小规则，要求 primary agent 在调用 built-in `question` tool 前立即尝试一次 `autoinfo_send_qq_notification`。

同时在 Completion Notification 规则中补一条 cross-reference，说明该预提问提醒是非终态例外，不计入终态 completion notification，不改变终态通知的 exactly-once 和 last-tool-call 约束。

Discovery Swarm 结论已采纳：

- safety-recovery：固定短空提醒，避免 QQ spam 与秘密外泄；best-effort、no retry、no block。
- entrypoint-boundary：primary agents only；built-in `question` only；排除 plain chat、Octto、`autoinfo_remote_ask` 与 subagents。
- minimal-scope-yagni：只补小规则与窄 clarification，不加配置、不加新协议。
- regression-drift-guard：保留 terminal completion notification 语义并加 cross-reference。

## Architecture

该设计只改变 agent policy 层的行为契约，不改变 tool 实现、runtime、Octto、lifecycle 或 subagent 调度系统。

Policy placement：

- Built-in `question` tool rules：新增“pre-question QQ alert”规则，绑定调用 built-in `question` tool 的直接前置动作。
- Completion Notification (QQ)：新增说明，区分非终态预提问提醒与终态完成通知。

这保持现有提问通道三档模型不变：plain chat 仍是极轻量端点，built-in `question` 仍是默认结构化路径，Octto 仍用于重型 / 异步场景。

## Components

- Primary agents：`brainstormer`、`commander`、`octto` 及未来 primary agents，只有在它们直接调用 built-in `question` tool 时触发预提醒。
- Built-in `question` tool：唯一触发点；不扩展到 `confirm`/`pick_one` 等 Octto session tools，也不扩展到 `autoinfo_remote_ask`。
- `autoinfo_send_qq_notification`：预提醒发送工具，作为 best-effort 非阻塞动作。
- Completion notification policy：保留终态通知的所有 hard rules，并声明预提醒不与终态通知互相计数。

## Data Flow

Primary agent 需要 structured in-session answer 时：

1. 判断本次是否调用 built-in `question` tool。
2. 若调用方是 primary agent，立即尝试一次 `autoinfo_send_qq_notification`。
3. QQ message 使用固定短中文，例如“有问题需要你在 OpenCode 回答。”，不得包含具体问题内容或敏感上下文。
4. 无论 QQ 发送成功、失败或工具不可用，都继续调用 built-in `question` tool。
5. 后续按现有 `question` tool answer 回填流程继续。

Excluded flows：

- plain chat：不发送预提醒。
- Octto：默认不发送预提醒，继续依赖 Octto 自身 portal / auto-resume 流程。
- `autoinfo_remote_ask`：不作为普通 in-session question channel，也不触发该规则。
- subagents / non-primary agents：不得发送预提醒。

## Error Handling

- `autoinfo_send_qq_notification` 失败：静默继续到 built-in `question` tool。
- 工具不可用：静默继续到 built-in `question` tool。
- QQ 发送慢或异常：不重试，不进入恢复循环，不阻塞用户问题创建。
- 终态 completion notification 失败处理不变：final answer 前最多一次尝试，失败后继续 final answer。

## Testing Strategy

- 文档 / prompt drift test：检查 Built-in `question` tool rules 中存在 pre-question QQ alert 规则。
- 文档 / prompt drift test：检查 Completion Notification 段明确保留 terminal exactly-once + last-tool-call 语义，并区分 pre-question alert。
- 静态文本校验：确认规则包含 built-in `question` only、primary agents only、exclude plain chat、exclude Octto、exclude `autoinfo_remote_ask`、exclude subagents。
- 静态文本校验：确认 failure behavior 为 best-effort、silent continue、no retry。
- 人工验收：新会话中 primary agent 调用 built-in `question` tool 前，应先收到一条短 QQ 提醒；若 QQ 不可用，问题仍正常出现。

## Open Questions

- 无。当前 issue #97 采用 narrow pre-question alert exception，不引入额外配置或跨渠道扩展。

## Behavior

- 当 primary agent 准备通过 built-in `question` tool 问用户结构化问题时，用户应先收到一条短 QQ 提醒，随后在 OpenCode 内看到问题。
- 提醒不会泄露问题正文、文件路径、日志、凭据、私有 URL 或其它秘密。
- 如果 QQ 提醒失败，用户仍会在 OpenCode 内看到问题；agent 不会卡在 QQ 发送失败上。
- plain chat、Octto、`autoinfo_remote_ask` 与 subagent 提问不会因为本变更新增 QQ 提醒。
- 任务完成时的 QQ completion notification 行为保持原样：仍 exactly-once，仍是 final answer 前最后一次 tool call。
- 修改全局 `AGENTS.md` 后，用户需要 quit / restart OpenCode 才能让新 global policy 在新会话中生效；自动化不会重启当前 OpenCode。

Acceptance checks：

- 触发一次 primary agent built-in `question` tool：应观察到一条短 QQ 预提醒，然后问题出现。
- 断开或禁用 QQ notification：问题仍应正常出现，无重试噪音。
- 触发 Octto 或 plain chat 问题：不应出现该预提醒。
- 任务终态：只应看到既有 terminal completion notification，且该通知仍是 final answer 前最后一次 tool call。

Atlas 关联：未找到现有关联的 atlas/20-behavior 节点；本次由 executor 在 batch 完成后按实际影响判断是否维护。
