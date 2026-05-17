---
date: 2026-05-16
topic: "Bounded Upstream Error Continuation Retry"
status: validated
---

## 承诺清单 / Commitments

用户原话：

- “为什么一出问题就直接停了？ 我预期是一直循环自动重试啊”
- “继续”
- 对结构化决策的确认：自动重试形态 = “有界自动重试”；覆盖范围 = “统一retry框架”；重试预算 = “20次 每次30s”。

已确认决策：

- **失败形态：** `upstream_error: Upstream request failed` 这类 transient upstream/provider 故障不应直接停在 continuation card 等用户手点继续。
- **重试边界：** 不是无限循环，而是有界自动恢复；默认 20 次，每次 30 秒。
- **统一语义：** 各 workflow entrypoint 应共享 retry vocabulary / config / classifier，避免 `spawn_agent` 一套、Task/executor-direct 另一套。
- **安全边界：** 不盲目重放副作用；优先继续同一个 session / continuation，而不是重开任务。
- **排除范围：** lifecycle git/GitHub push/merge/PR-check recovery 和 ordinary chat 不纳入首批 provider/upstream retry。

可核对承诺：

- executor-direct / built-in Task continuation 遇到可恢复 upstream_error 时会自动继续，而不是立即停给用户。
- 自动继续最多 20 次、间隔约 30 秒；耗尽后才结构化报告，需要用户介入。
- `spawn_agent`、Task/executor-direct、Octto auto-resume 等路径的 retry 语义有统一说明，至少不会互相矛盾。
- 不把 `resume_subagent` 扩展成通用 Task retry 入口。
- 不让 lifecycle commit/finish/push/PR-check 被 20×30s provider retry 拖长或重复。

## Problem Statement

用户看到 executor-direct continuation card 在 `upstream_error: Upstream request failed` 后直接停住，需要手动点“继续”。这违背了用户预期：临时 upstream/provider 故障应该自动恢复，而不是把恢复动作转嫁给用户。

现状是 retry 机制分层不一致：micode `spawn_agent` 有 transient retry/budget，而 built-in Task / executor-direct continuation 走 OpenCode Task/session 路径，绕过了 `spawn_agent` 的 retry；`session-recovery` hook 也没有把 `upstream_error` 纳入 recoverable 范围。

## Constraints

- 这是 workflow/runtime-sensitive 改动，必须 lifecycle + planner + executor + mandatory reviewer。
- 自动 retry 必须有界：默认 20 attempts × 30 seconds，不做真正无限循环。
- 对 side-effecting work 不能盲目 respawn；优先 same-session continuation，并要求恢复提示说明“检查当前状态，不要重复已完成副作用”。
- 出现 destructive/remote mutation ambiguity、semantic blocker、pending user question、验证失败、预算耗尽时停止并结构化询问或报告。
- 不自动重启 OpenCode。
- 不修改 lifecycle git/GitHub recovery 语义。
- 不把 ordinary chat 默认纳入长时间自动 retry。
- 不扩大 `resume_subagent` 的职责；它仍只处理 preserved `spawn_agent` `task_error` / `blocked` sessions。

## Approach

采用 **统一词汇 + 分入口 adapter**，而不是“一刀切全局 Promise retry”。

核心判断：

- **共享层：** 一个 upstream transient predicate / retry policy config / delay budget vocabulary。
- **接入层：** 针对每个 prompt-dispatch entrypoint 决定是否接入和如何接入。
- **安全层：** 对可能有副作用的 continuation 只在 same session 里发“继续但先检查当前状态”的恢复 prompt；不能 fresh respawn。

Discovery Swarm synthesis：

- **采纳 entrypoint-boundary：** 必须覆盖 built-in Task/executor-direct continuation；`spawn_agent` 已有 retry，但 classifier / vocabulary 需要对齐；Octto auto-resume 是单独 prompt-dispatch entrypoint；lifecycle git recovery 明确排除。
- **采纳 safety-recovery：** 不能把 20×30s 变成重复 deploy/file edit；same-session continuation 优先，遇到副作用不确定时停问用户。
- **采纳 contract-integration：** prompt/AGENTS/Atlas/tests 必须同步统一 retry contract，避免后续 agent 继续按 45 秒 spawn-only 旧认知设计。
- **采纳 regression-drift-guard：** 需要 coverage/exclusion matrix tests；不能把所有 `session.prompt` 都包进去。
- **部分采纳 minimal-scope-yagni：** 不做 OpenCode core 大改；首批以 `session-recovery` / safe prompt-dispatch adapter 为主，复用小 helper/config，而非重写 `spawn_agent`。

## Architecture

设计由四层组成：

1. **Transient classification vocabulary**
   - 明确哪些 upstream/provider 错误可自动恢复。
   - `upstream_error: Upstream request failed` 属于目标可恢复输入。
   - 配额、认证、配置、用户取消、semantic blocker 不应被当成 transient 重试 10 分钟。

2. **Retry policy config**
   - 默认 attempts = 20。
   - 默认 interval = 30 seconds。
   - 配置集中，prompt / docs / tests 不复制散落 magic numbers。

3. **Continuation adapters**
   - `session-recovery`：处理 continuation card / session-level upstream_error，执行 bounded auto-continue。
   - Octto auto-resume：仅在用户已回答、需要 re-prompt owner session 时对 prompt failure 做同策略 retry；不改变问题等待语义。
   - `spawn_agent`：保留现有 retry helper，但复用或对齐分类词汇与文档；避免破坏刚落地的 45 秒外层 budget，除非 planner 判断需要配置迁移。
   - `resume_subagent`：保持语义，不做通用化。

4. **Safety gates**
   - 对 same-session continuation 注入恢复提示：先检查当前状态、不要重复已完成副作用、只从失败点继续。
   - pending user question / destructive confirmation / semantic ambiguity 不自动 continue。
   - 达到 20 次后停止，使用内置 Question 工具或 structured blocked report，而不是继续隐藏等待。

## Components

**Upstream retry policy module**

- 提供统一的 recoverable upstream error 判断。
- 提供 attempts / interval config 和 attempt key / dedup 语义。
- 供 session-recovery / Octto auto-resume / spawn-agent classifier tests 引用。

**Session recovery integration**

- 将 `upstream_error: Upstream request failed` 纳入 recoverable 但只走 bounded policy。
- 使用 session/error key 去重，避免同一错误同时触发多条 continue。
- 延迟 30 秒后自动 same-session prompt。
- 达到 20 次后停止，并保留用户可见状态。

**Executor-direct continuation prompt**

- 恢复 prompt 需要强调：不要重复已经完成的文件写入、部署、远程操作；先确认当前状态再继续或补报告。
- 不修改 executor-direct “不能 spawn subagents / no plan / bounded envelope” 基本角色。

**Octto auto-resume integration**

- 只包 `answer arrived -> prompt owner session` 这一步。
- 失败后按同策略重试同一 batch，不改变 pending question 的等待逻辑。
- 无 owner / 用户尚未回答时不启动 retry。

**Tests and drift guards**

- session-recovery bounded retry / dedup / max attempts / pending question exclusion。
- Octto auto-resume prompt failure retry / batching preservation。
- lifecycle modules must not import/use upstream retry policy。
- resume_subagent 不被扩展成 fake preserved session。
- AGENTS/Atlas/README/prompt contract 更新一致。

## Data Flow

1. A workflow prompt dispatch hits transient upstream/provider failure.
2. Error is normalized through the shared predicate.
3. Adapter checks whether this entrypoint is eligible for automatic continuation.
4. Adapter looks up attempt state for the session/error key.
5. If under 20 attempts and no safety gate blocks, schedule wait for 30 seconds.
6. After delay, adapter prompts the same owner/session with recovery wording.
7. If recovery succeeds, workflow continues without user click.
8. If the same transient repeats, repeat up to the configured limit.
9. If limit is exhausted or ambiguity is detected, stop and ask/report with compact options.

## Error Handling

- **Recoverable upstream_error：** 自动 same-session continuation，最多 20 次。
- **Repeated same error over budget：** 停止并报告 exhausted retry budget。
- **Pending user question / destructive confirm：** 不自动 retry，让 question flow 保持用户决策优先。
- **Side-effect ambiguity：** 自动 continuation prompt must instruct state inspection; if still ambiguous, stop and ask user via Question tool。
- **Non-transient upstream/provider failure：** 不自动重试 10 分钟，直接分类并报告。
- **Lifecycle failure：** 使用 lifecycle recovery hint 原路径，不用 provider retry policy。

## Testing Strategy

- Unit test shared recoverable predicate: include `upstream_error: Upstream request failed`; exclude auth/quota/config/semantic errors。
- Session recovery tests: bounded 20 attempts, 30s interval fake timer, dedup, max exhaustion, pending-question exclusion, recovery prompt wording。
- Octto auto-resume tests: prompt failure schedules retry, preserves batch ids, no owner/pending unanswered does not retry。
- Spawn-agent classifier tests: align vocabulary without breaking existing 45s retry budget behavior unless plan explicitly migrates it。
- Lifecycle exclusion tests: `src/lifecycle/**` must not use provider retry policy。
- Prompt/docs tests: commander/brainstormer/AGENTS/Atlas references updated and not contradictory。
- End-to-end-ish regression: simulated executor-direct upstream_error should not surface immediate manual continuation before policy exhausts。

## Open Questions

- OpenCode built-in Task continuation card payload 是否能被 `session-recovery` hook 完整捕获？如果不能，planner/executor 需要定位最小可用 hook。
- `20×30s` 是否应同样应用到 existing `spawn_agent` 45s retry budget？默认不直接替换，除非实现证据表明用户期待统一到所有 subagent orchestration；否则保留 `spawn_agent` fast retry，统一文档说明两层边界。
- 如何可靠识别 pending user question / semantic blocker？如无法完全识别，保守策略是不要自动继续该类 session。

## Behavior

用户可见行为承诺：

- 遇到可恢复的 `upstream_error: Upstream request failed` 时，executor-direct / workflow continuation 不再立刻停下让用户点“继续”。
- 系统会自动等待约 30 秒并继续同一个 session，最多 20 次。
- 如果自动恢复成功，用户只看到任务继续推进；不需要手动介入。
- 如果 20 次后仍失败，系统才明确报告 retry exhausted，并用结构化方式要求用户决定下一步。
- 对可能重复副作用或需要用户决策的场景，系统不会盲目无限重试。

验收方式：

- 模拟 executor-direct / Task continuation 的 upstream_error，确认不会立即停在手动 continue card。
- 确认自动 retry 使用 30 秒间隔和 20 次上限。
- 确认 pending question / destructive confirmation 不被自动跳过。
- 确认 lifecycle push/merge/PR-check 不受 20×30s provider retry 影响。

Atlas 关联：本次行为可能修订 atlas/10-impl/spawn-agent-tool.md 并新增/更新 workflow retry 行为节点；executor 在 batch 通过后应维护 Atlas 或登记 delta。
