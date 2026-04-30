---
date: 2026-04-30
topic: "resume_subagent 成功后清理失败子会话标题"
status: validated
---

## Problem Statement

用户截图里出现了一个更细的状态同步问题：子会话第一次失败后标题显示 `失败: Review ...`，后续通过 retry 或 `resume_subagent` 实际恢复成功，但会话列表里仍然残留失败标题。

这不是主 agent issue 标题问题，也不是刚才 spawn-agent 初次执行标题问题。它属于 preserved session 被恢复后的 cleanup 路径缺口。

## Constraints

- 不改变 issue #13 的主会话标题格式。
- 不给子会话加 issue 前缀。
- 不让标题更新失败影响真实的 resume 结果。
- 保留成功和 hard-failure 后清理 preserved registry 的语义。
- blocked 和 task_error 仍应保留 session，并显示准确终态标题。

## Approach

采用“resume_subagent 结果路径补齐标题同步”的方案。

spawn-agent 初次执行已经会根据 outcome 更新或删除内部 session。resume_subagent 应该复用同一套命名规则，在恢复成功时不再让旧的 `失败:` 标题停留在用户可见列表里。

我选择这个方案，因为问题发生在 resume 成功后的 cleanup 分支，不需要改 Octto UI，也不需要改主标题状态机。

## Architecture

resume_subagent 的结果处理分为两类：

**恢复成功或不可恢复结束：**

- 将旧失败标题更新为 `已完成: ...` 或准确终态。
- 随后执行现有 cleanup，移除 preserved registry 并删除内部 session。
- 如果底层 session 删除有延迟，用户看到的也不再是 `失败:`。

**恢复后仍阻塞或仍失败：**

- 保留 session。
- 使用 `阻塞:` 或 `失败:` 标题反映当前状态。
- registry 保留或更新，让后续还能继续 resume。

## Components

**Resume outcome title sync:** 在 `resume_subagent` 的 outcome 分支中调用 spawn-agent 的 completion title builder。

**Internal session update:** 复用已有 `updateInternalSession`，保持 best-effort，不抛出影响主流程。

**Preserved registry cleanup:** 保持成功后 remove + delete 的行为，但在 delete 前先写入正确终态标题。

## Data Flow

第一次 reviewer 失败：

- spawn-agent 将 session 标题更新为 `失败: Review ...`。
- session 被 preserved registry 记录。

用户或 executor 调用 resume_subagent 后成功：

- resume_subagent 生成成功 outcome。
- 先把标题更新为 `已完成: Review ...`。
- 再删除 preserved session 并移除 registry。

如果删除未能立刻反映到 Octto 列表，标题也已经从失败变成完成。

## Error Handling

标题更新和删除都是 cleanup 辅助动作，不能覆盖 resume_subagent 的主要结果。

- update 失败：记录 warning，继续返回真实 resume 结果。
- delete 失败：沿用现有 best-effort cleanup 策略。
- 缺失 description：用 agent 中文角色 fallback。

## Testing Strategy

- preserved session resume 成功时，先更新为 `已完成:`，再 cleanup。
- preserved session resume 后仍 task_error 时，标题保持或更新为 `失败:`。
- preserved session resume 后 blocked 时，标题更新为 `阻塞:`。
- update 失败不导致 resume_subagent 失败。
- 现有 spawn-agent 初次执行标题测试继续通过。

## Open Questions

暂无阻塞问题。
