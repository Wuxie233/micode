---
date: 2026-05-16
topic: "Lifecycle Conflict Resolver and Decision-Minimal Agent Responses"
status: validated
---

## 承诺清单 / Commitments

- 并行需求中，后完成的 lifecycle 在 merge 最新 main 时遇到可安全处理的 Git conflict，应自动进入 AI resolver，而不是默认阻塞给用户。
- resolver 可修改 Git conflict files，并允许少量直接相关的测试、类型、调用点文件；扩大范围必须解释理由并接受 reviewer 校验。
- resolver 无法安全判断业务语义时，必须用 question 工具向用户发起结构化决策，而不是输出长篇阻塞说明。
- 全局 agent 用户可见回复应采用 decision-minimal contract：只保留影响用户决策、验收、下一步的信息；内部诊断留在 artifact、lifecycle progress、plan、ledger 或子 agent 报告中。
- 所有真实用户决策提问默认走内置 question 工具；plain chat 只用于无选择需求的超轻量告知或 question 工具不可用时的降级。
- 保持安全边界：不 force push、不 force-with-lease、不 reset hard、不跳过 hooks、不删除用户文件、不自动重启 OpenCode。
- 提供轻量只读审计路径，帮助区分历史“丢更新”是 force-push、squash 历史错觉、语义覆盖，还是 lifecycle 外部手工操作导致。

## Problem Statement

当前 issue-driven lifecycle 能处理“分支落后 main 但没有文本冲突”的并行合并场景，但遇到真实 merge conflict 时会保留临时 worktree 并阻塞。这个行为在多需求并行开发时会中断自动化链路。

同时，现有 agent 回复容易把 recovery hint、reviewer 报告、子 agent 过程信息直接暴露给用户。用户需要的是影响决策的关键信息和结构化选择，而不是从长日志里找下一步。

## Constraints

本设计触及 workflow/lifecycle、agent prompt 和跨模块行为，必须走完整 lifecycle、planner、executor、reviewer 流程。

**不可突破的安全边界：**

- 不使用 force push 或 force-with-lease。
- 不使用 reset hard、跳过 hooks、自动删除用户文件或重启 OpenCode。
- 冲突解决发生在 lifecycle 保留的临时 merge worktree 中，不污染主 worktree。
- resolver 不能静默做业务取舍；语义不确定时必须转成用户决策。
- 用户可见回复不能直接 dump raw recovery hint、完整 Git 输出、reviewer checklist 或子 agent 原始报告。

**交互边界：**

- 真实决策提问默认使用内置 question 工具。
- question 内容只展示决策必要信息：阻塞原因、影响范围、推荐选项、备选动作。
- plain chat 只保留给无选择需求的状态告知，或 question 工具不可用时的极简降级。

## Approach

我选择在现有 lifecycle merge 流程后追加 **conflict recovery phase**，而不是改成 rebase 或扩大普通 merge 行为。这样能保留当前安全模型：先在临时 worktree 快进到最新 main，再尝试 no-ff merge issue branch，只有 Git 明确冲突时才进入 resolver。

resolver 采用受限执行：默认只处理 conflict files，可小范围扩展到直接相关的测试、类型、调用点文件。任何扩展都必须进入报告和 reviewer 判断；若 resolver 无法判断业务语义，则不继续猜测，而是生成结构化 question 让用户选择。

全局回复 UX 采用 **decision-minimal response contract**。primary/coordinator 只把“结论、影响、用户需要做的选择、验收方式”放到聊天里；内部诊断继续留在 lifecycle progress、design、plan、ledger、子 agent 报告和测试输出中。

我拒绝的方案：

- **强制 rebase B 到最新 main：** 会污染 issue branch，且真实语义冲突仍会卡住。
- **保持人工处理冲突：** 安全但不符合并行自动化目标。
- **全项目无边界自动修：** 自动化最强，但误伤 workflow/lifecycle 的风险过高。
- **继续输出长报告让用户读：** 对 agent 有用，对用户决策低效。

## Architecture

整体结构分三层：

**Lifecycle conflict recovery layer：**

- 继续由 lifecycle finish 负责创建临时 merge worktree、同步最新 base、执行 no-ff merge。
- 当 merge 失败并识别到 conflict files 时，返回结构化 conflict context，而不是直接变成最终人工阻塞。
- conflict context 包含 issue、branch、temp worktree、conflict files、base branch 和安全边界。

**AI resolver execution layer：**

- primary/coordinator 在 bounded recovery loop 中识别 merge_conflict，并派发受限 conflict resolver flow。
- resolver 在 temp worktree 中完成冲突文件修复、小范围相关文件调整、验证和 reviewer 校验。
- 成功后完成 in-progress merge，并让 lifecycle finish 继续 push、cleanup、close issue。
- 失败或不安全时返回 compact blocker，而不是原始日志。

**Decision-minimal interaction layer：**

- 新增共享回复契约，注入 primary/coordinator prompts，并约束 leaf agent escalate 格式。
- 需要用户决策时统一生成 question 工具问题，选项带推荐默认。
- 用户可见消息不再承载内部审计日志；内部细节留给 artifacts。

## Components

**Conflict context builder：**

- 从 merge_conflict recovery hint 中提取最小 resolver 输入。
- 明确 allowed files、allowed expansion、forbidden operations 和验证要求。

**Conflict resolver flow：**

- 在 temp merge worktree 内处理冲突。
- 允许修改 conflict files 及少量直接相关测试、类型、调用点文件。
- 必须说明扩展理由。
- 必须通过 reviewer；高风险 surface 不允许跳过 reviewer。

**Question decision bridge：**

- 把 resolver blocked outcome 转成 question 工具问题。
- 默认选项包括：按某侧优先继续、保留两边语义继续、用户补充业务取舍、暂停并保留 temp worktree。
- 只展示决策必要信息，不展示 raw recovery hint。

**Decision-minimal response contract：**

- 约束 commander、brainstormer、octto、planner、executor 的用户可见回复。
- 约束 reviewer/implementer 只向上层 escalate compact facts，不直接面向用户输出过程噪声。
- 与现有 effect-first reporting 兼容，不替换其五段终态结构。

**Lightweight lost-update audit：**

- 提供只读审计步骤或轻量报告入口。
- 区分 force-push、squash merge 历史错觉、语义覆盖、push rejection、lifecycle 外手工操作。
- 不执行历史重写、不自动修复旧内容。

**Drift guards and tests：**

- 覆盖 no force push / no reset hard / no no-verify。
- 覆盖 merge_conflict 自动进入 resolver flow。
- 覆盖 resolver blocked 时必须 question-tool-first。
- 覆盖用户可见回复不得 dump raw recovery hint 或子 agent 原始报告。

## Data Flow

**成功路径：**

1. B 调用 lifecycle finish。
2. local merge path 创建 temp merge worktree，并快进到最新 origin/main。
3. Git 尝试把 B issue branch no-ff merge 到 temp main。
4. 如果发生 conflict，生成 conflict context。
5. primary/coordinator 派发 conflict resolver flow。
6. resolver 在 temp worktree 内解决冲突并验证。
7. reviewer 通过后完成 merge commit。
8. lifecycle finish 继续 plain push origin main、cleanup、close issue。

**阻塞路径：**

1. resolver 判断语义不安全、范围过大或验证无法通过。
2. resolver 返回 compact blocker 给 primary/coordinator。
3. primary/coordinator 使用 question 工具向用户询问下一步。
4. 用户选择后，流程按选择继续、暂停或保留 temp worktree。

**全局回复路径：**

1. leaf agent 只返回面向上层的 compact facts 和必要证据。
2. coordinator 汇总为 decision-minimal 用户消息。
3. 如需用户选择，直接发 question 工具问题。
4. 聊天回复只保留结论、影响、选择、验收和下一步。

## Error Handling

**Semantic ambiguity：**

resolver 无法判断 A/B 哪个业务语义优先时，必须 blocked 并触发 question 工具。默认推荐“用户补充业务取舍”，而不是 AI 硬猜。

**Scope expansion risk：**

resolver 需要改 conflict files 之外的文件时，必须说明与冲突的直接关系。若扩展范围超过少量测试、类型、调用点文件，则 blocked。

**Validation failure：**

resolver 改完但验证失败时，允许在同一 temp worktree 内做有界修复。超过恢复上限后 blocked，并用 question 工具提供继续策略。

**Push race：**

merge 成功但 plain push 被远端更新拒绝时，沿用现有 push_failed bounded retry。仍禁止 force push。

**Question tool unavailable：**

如果内置 question 工具不可用，降级为极简 numbered prompt。降级只暴露决策必要信息，不输出内部日志。

**Historical audit uncertainty：**

本轮只提供只读证据路径。没有 GitHub audit log 或远端事件历史时，只能给出概率判断，不能断言历史从未发生过外部 force push。

## Testing Strategy

**Lifecycle merge tests：**

- 构造 A 已合并、B 落后 main、无冲突时仍沿用当前成功路径。
- 构造 A/B 同文件 conflict，验证 lifecycle 不直接最终 halt，而是生成 resolver context。
- resolver 成功后，验证 temp worktree 中 merge 完成、plain push 被调用、cleanup 继续执行。

**Blocked/question tests：**

- resolver 返回 semantic ambiguity 时，primary prompt 必须要求使用 question 工具。
- 用户可见 blocked 摘要不得包含 raw recovery hint、完整 Git 输出、reviewer checklist 或子 agent 原始报告。
- question 选项必须包含推荐默认和安全暂停路径。

**Safety tests：**

- 保持 no force push、no force-with-lease、no reset hard、no no-verify、no auto restart 的现有 guard。
- resolver temp worktree 不得污染主 worktree。
- 超范围修改必须被 reviewer 或 coordinator 标记 blocked。

**Response UX tests：**

- commander / brainstormer effect-first blocks 保持 byte-identical guard。
- 全局 decision-minimal contract 注入 primary/coordinator prompts。
- leaf agent escalation 不要求用户阅读内部诊断。

**Audit tests：**

- lost-update audit 路径只读。
- 审计输出区分 force-push evidence、squash history confusion、semantic overwrite 和 manual remote mutation。

## Open Questions

无阻塞性 open question。resolver 的具体实现形态由 planner 在不破坏现有 lifecycle 安全边界的前提下细化。

## Behavior

- 当并行 issue B 在 finish 时遇到 A 已合入 main 造成的可解决冲突，用户通常不会被打断；系统会自动进入受限 AI resolver 并继续完成合并。
- 当冲突涉及业务语义取舍，用户会收到 question 工具中的短问题和推荐选项，而不是一大段日志式说明。
- 全局 agent 回复会优先展示结论、影响、验收和下一步；内部诊断默认不出现在用户聊天主路径中。
- 历史“丢更新”排查会优先通过只读审计区分 force-push、squash、语义覆盖和手工远端操作。

Atlas 关联：本设计应更新 lifecycle 行为、agent 回复 UX、workflow recovery 风险相关的 Atlas 节点。
