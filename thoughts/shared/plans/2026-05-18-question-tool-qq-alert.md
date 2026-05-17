---
date: 2026-05-18
topic: question-tool-qq-alert
issue: 97
scope: agents-md
contract: none
---

# Pre-Question QQ Alert Policy Implementation Plan

**Goal:** 在全局 `/root/.config/opencode/AGENTS.md` 中加入窄例外规则，要求 primary agent 在调用 built-in `question` tool 前 best-effort 发送一条短 QQ 提醒；同时在 Completion Notification 段加 cross-reference 保护既有 terminal 通知语义。

**Architecture:** 纯 policy 文本变更。两处编辑（Built-in `question` tool rules 末尾加规则；Completion Notification 段加 cross-reference 段）。无 prompt 单源镜像、无 src 代码改动、无 runtime/tool 行为改动。全局 AGENTS.md 在本仓库之外，无法靠 repo Bun test 守护，所以本计划用人工 grep verification 作为验收手段。

**Design:** [`thoughts/shared/designs/2026-05-18-question-tool-qq-alert-design.md`](../designs/2026-05-18-question-tool-qq-alert-design.md)

**Contract:** none（不跨 frontend/backend domain，且不涉及 API/数据契约）

---

## 行为承诺映射

design.md `## Behavior` 段共 6 条行为承诺：

- 行为 1（"当 primary agent 准备通过 built-in `question` tool 问用户结构化问题时，用户应先收到一条短 QQ 提醒，随后在 OpenCode 内看到问题。"）→ 由 Batch 1 Task 1.1 在全局 AGENTS.md 的 Built-in `question` tool rules 段新增 pre-question alert 规则实现；由 Batch 2 Task 2.1 的 grep verification + 人工新会话试触发验证
- 行为 2（"提醒不会泄露问题正文、文件路径、日志、凭据、私有 URL 或其它秘密。"）→ 由 Batch 1 Task 1.1 在规则文本中明确规定"固定短中文、no payload、无秘密"实现；Batch 2 Task 2.1 grep 检查关键约束 token
- 行为 3（"如果 QQ 提醒失败，用户仍会在 OpenCode 内看到问题；agent 不会卡在 QQ 发送失败上。"）→ 由 Batch 1 Task 1.1 在规则文本中明确"best-effort, silent continue, no retry, no block"实现
- 行为 4（"plain chat、Octto、`autoinfo_remote_ask` 与 subagent 提问不会因为本变更新增 QQ 提醒。"）→ 由 Batch 1 Task 1.1 在规则文本中明确 exclude 列表实现；Batch 2 Task 2.1 grep 检查 exclude 关键 token
- 行为 5（"任务完成时的 QQ completion notification 行为保持原样：仍 exactly-once，仍是 final answer 前最后一次 tool call。"）→ 由 Batch 1 Task 1.2 在 Completion Notification 段新增 cross-reference 实现，明确 pre-question alert 是非终态例外、不计入 exactly-once、不破坏 last-tool-call 约束
- 行为 6（"修改全局 `AGENTS.md` 后，用户需要 quit / restart OpenCode 才能让新 global policy 在新会话中生效；自动化不会重启当前 OpenCode。"）→ 由 Batch 2 Task 2.1 在终态报告中显式提示用户 restart；本规则不需要 task 实现（属于交付通知约束，由 primary agent 在终态汇报"已知限制 / 下一步"段告知）

**未对应任何 task 的行为**：无。

---

## Review Policy

- **Reviewer mandatory:** 1.1, 1.2, 2.1。全部 task 均改动全局 agent policy / notification policy，按 mandatory-reviewer-surfaces 规则（"agent prompts ... safety/security ... user-visible acceptance"）全部 mandatory。
- **Reviewer-skip eligible:** 无。
- **Risk observations:**
  - Discovery Swarm `safety-recovery`：固定短空提醒，避免 QQ spam 与秘密外泄 → 映射到 Task 1.1（规则文本必须固定示例为短中文 no-payload）。
  - Discovery Swarm `entrypoint-boundary`：primary agents only / built-in `question` only / 排除 plain chat / Octto / `autoinfo_remote_ask` / subagents → 映射到 Task 1.1（规则文本必须显式列出 4 个 exclude）。
  - Discovery Swarm `regression-drift-guard`：保留 terminal completion notification 语义并加 cross-reference → 映射到 Task 1.2（Completion Notification 段必须显式声明 pre-question alert 是非终态例外、不计入 exactly-once、不破坏 last-tool-call）。
  - Discovery Swarm `minimal-scope-yagni`：不加 config knob / retry / 节流 → 映射到 Task 1.1（规则文本不得引入新 config 字段、不得引入 retry 计数器）。

---

## Dependency Graph

```
Batch 1 (parallel - 2 implementers): 1.1, 1.2 [policy text edits, two distinct sections of the same file]
Batch 2 (sequential after 1): 2.1 [verification - depends on both edits landed]
```

注：1.1 与 1.2 改的是同一文件的不同段落。它们语义独立，但物理写同一文件需要执行器顺序应用（先后两次 edit 同一文件）。Plan 把它们列在同一 Batch 表示"语义上互不依赖"；执行器在 implementation 阶段按文件锁串行落盘即可，依然算单 Batch parallel-eligible。

---

## Batch 1: Policy Text Edits (parallel-eligible - 2 micro-edits)

All tasks in this batch have NO inter-task dependencies. Both edit `/root/.config/opencode/AGENTS.md`, different sections.
Tasks: 1.1, 1.2

### Task 1.1: Pre-Question QQ Alert Rule in Built-in `question` tool rules
**File:** `/root/.config/opencode/AGENTS.md`
**Test:** none（policy 文本变更；全局 AGENTS.md 在本仓库之外，无 repo Bun test 可守护；语义验收由 Batch 2 Task 2.1 grep + 人工触发完成。Semantic risk 评估：本任务只改全局 agent prompt policy，无 exported reusable logic / parsing / state transitions / 并发 / error branches，按 semantic-risk 规则归入"prompt-only 改动"且无 repo-internal mirror 可测）
**Depends:** none
**Domain:** general
**Atlas-impact:** none（不修改 atlas/ 节点；本变更属于 agent prompt policy 行为契约调整，但因 Atlas vault 默认未初始化 / 与本任务无直接节点关联，遵循设计 doc 末尾"Atlas 关联：未找到现有关联的 atlas/20-behavior 节点；本次由 executor 在 batch 完成后按实际影响判断是否维护"）
**Review policy:** mandatory — 改动全局 agent policy + QQ notification 行为，按 mandatory-reviewer-surfaces 全覆盖（agent prompts / user-visible acceptance / safety boundary）

**编辑位置：** `/root/.config/opencode/AGENTS.md` 中 `### Built-in \`question\` tool rules` 段（约 line 264-272）的现有 bullet 列表末尾，**在 `### Octto rules (when chosen)` 段之前**追加一条新规则 bullet。

**精确编辑（Edit 工具的 oldString / newString）：**

`oldString`（保持现有规则末两条以做 anchor，确保唯一匹配）：

```
- 答案回填：从 `question` tool 返回的 answers 数组中按 `header` 索引解析；不要假设答案顺序。
- 不可用时降级：极少数情况下 OpenCode 当前会话内置 `question` 工具不可用（某些执行模式 / 测试 stub），降级到 plain chat numbered（与 Octto fallback 对称）。
```

`newString`（在原两条后追加 1 条 pre-question alert 规则）：

```
- 答案回填：从 `question` tool 返回的 answers 数组中按 `header` 索引解析；不要假设答案顺序。
- 不可用时降级：极少数情况下 OpenCode 当前会话内置 `question` 工具不可用（某些执行模式 / 测试 stub），降级到 plain chat numbered（与 Octto fallback 对称）。
- **Pre-question QQ alert（非终态例外）：** primary agents（`brainstormer` / `commander` / `octto` / 未来 primary）在调用 built-in `question` tool 之前，MUST best-effort 尝试一次 `autoinfo_send_qq_notification`，发送一条固定短中文提醒，例如「有问题需要你在 OpenCode 回答。」，不得包含问题正文、选项文本、文件路径、日志、凭据、私有 URL 或任何秘密。失败 / 不可用 / 超时一律静默继续到 `question` 调用，不重试、不阻塞、不进入恢复循环。本规则仅覆盖 built-in `question` tool；plain chat 轻量确认、Octto session tools（`show_diff` / `show_plan` / `review_section` / `ask_code` / `create_brainstorm` 等）、`autoinfo_remote_ask` 与 subagents / non-primary agents 不发送此预提醒。此提醒是非终态例外，不计入下文 `Completion Notification (QQ)` 的 exactly-once 与 last-tool-call 约束。
```

**Verify:**
- `grep -F "Pre-question QQ alert" /root/.config/opencode/AGENTS.md` 应返回 1 行匹配。
- `grep -F "built-in \`question\` tool 之前" /root/.config/opencode/AGENTS.md` 应返回 1 行匹配。
- `grep -F "subagents / non-primary agents 不发送此预提醒" /root/.config/opencode/AGENTS.md` 应返回 1 行匹配。
- `grep -F "不重试、不阻塞" /root/.config/opencode/AGENTS.md` 应至少返回 1 行匹配。

**Commit:** `feat(agents-md): add pre-question QQ alert rule for built-in question tool`

---

### Task 1.2: Cross-Reference in Completion Notification (QQ) Section
**File:** `/root/.config/opencode/AGENTS.md`
**Test:** none（policy 文本变更；同 Task 1.1 理由；语义验收由 Batch 2 Task 2.1 完成）
**Depends:** none（语义独立于 1.1；物理上同一文件需顺序应用，executor 在落盘阶段串行）
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — 改动 QQ notification policy 与 terminal completion 契约边界

**编辑位置：** `/root/.config/opencode/AGENTS.md` 中 `## Completion Notification (QQ)` 段（约 line 410-419）现有 6 条编号规则末尾追加 1 条 cross-reference。

**精确编辑：**

`oldString`：

```
6. **Message shape:** keep the QQ body Chinese, under 200 chars, and free of secrets/raw logs. Recommended: `[completed|blocked|failed-stop] <中文摘要>。回到 OpenCode 查看。`
```

`newString`：

```
6. **Message shape:** keep the QQ body Chinese, under 200 chars, and free of secrets/raw logs. Recommended: `[completed|blocked|failed-stop] <中文摘要>。回到 OpenCode 查看。`
7. **Pre-question alert cross-reference:** primary agents 在调用 built-in `question` tool 前发送的短 QQ 预提醒（见 `Interactive Question Tools` 段的 `Built-in \`question\` tool rules`）是**非终态例外**：它不计入本算法的 exactly-once 约束，不破坏 terminal notification 的 last-tool-call 约束（pre-question alert 发生在 mid-conversation，紧邻 `question` tool 之前，而非 final answer 之前）。终态 completion notification 仍然是 final answer 前最后一次 tool call，并仍受 rule 5（best-effort, no retry）约束。
```

**Verify:**
- `grep -F "Pre-question alert cross-reference" /root/.config/opencode/AGENTS.md` 应返回 1 行匹配。
- `grep -F "不计入本算法的 exactly-once 约束" /root/.config/opencode/AGENTS.md` 应返回 1 行匹配。
- `grep -F "终态 completion notification 仍然是 final answer 前最后一次 tool call" /root/.config/opencode/AGENTS.md` 应返回 1 行匹配。

**Commit:** `docs(agents-md): cross-reference pre-question QQ alert in completion notification policy`

---

## Batch 2: Verification (sequential - 1 verifier)

Depends on Batch 1 completing. Read-back verification + manual restart guidance.
Tasks: 2.1

### Task 2.1: Verify Policy Text + User-Visible Restart Guidance
**File:** `/root/.config/opencode/AGENTS.md`（read-only 验收）
**Test:** none（验收任务本身就是测试；不产出新代码或新文件）
**Depends:** 1.1, 1.2
**Domain:** general
**Atlas-impact:** none
**Review policy:** mandatory — 验收覆盖度直接影响全局 agent policy 改动是否安全发布

**目的：** 在两条 policy 文本编辑落盘后，跑一组 grep 检查确认关键 token 全部存在且未误伤现有规则；同时在执行器终态报告中提示用户 quit / restart OpenCode 才能让新 global policy 在新会话中生效。

**Steps（顺序执行，所有命令均**只读**、**不重启 OpenCode**、**不动其他文件**）：**

1. 跑 Task 1.1 的全部 grep verify 命令，每条应返回非空。
2. 跑 Task 1.2 的全部 grep verify 命令，每条应返回非空。
3. 跑联合检查，确认 4 个 exclude entry 在新规则中各出现至少一次：
   - `grep -F "plain chat 轻量确认" /root/.config/opencode/AGENTS.md`
   - `grep -F "Octto session tools" /root/.config/opencode/AGENTS.md`
   - `grep -F '`autoinfo_remote_ask`' /root/.config/opencode/AGENTS.md`（已存在多处，必须仍存在且新规则中明确出现）
   - `grep -F "subagents / non-primary agents 不发送此预提醒" /root/.config/opencode/AGENTS.md`
4. 跑回归检查，确认既有 Completion Notification 6 条原规则未被破坏：
   - `grep -F "Single authoritative algorithm" /root/.config/opencode/AGENTS.md` 应返回 1 行（段头未被改名）。
   - `grep -F "exactly one \`autoinfo_send_qq_notification\` before the final answer" /root/.config/opencode/AGENTS.md` 应返回 1 行。
   - `grep -F "last tool call before the final answer" /root/.config/opencode/AGENTS.md` 应返回 1 行。
5. 跑回归检查，确认 Interactive Question Tools 三档表未被破坏：
   - `grep -F "默认主路径" /root/.config/opencode/AGENTS.md` 应至少返回 1 行。
   - `grep -F "极轻量端点" /root/.config/opencode/AGENTS.md` 应至少返回 1 行。
   - `grep -F "重型档" /root/.config/opencode/AGENTS.md` 应至少返回 1 行。
6. 不动 OpenCode 进程：**禁止** `systemctl restart opencode-web.service` / `/usr/local/bin/restart-opencode-detached` / 任何 `opencode web` 或 `opencode serve` 重启命令。
7. 在终态汇报"已知限制 / 下一步"段显式提示用户："本次修改全局 `/root/.config/opencode/AGENTS.md`；OpenCode 当前会话已加载的旧 policy 不会自动刷新，需要你手动 quit OpenCode 再启动新会话才能生效。新会话中 primary agent 第一次准备调用 built-in `question` tool 时，应能看到短 QQ 预提醒。"
8. 在终态汇报"你可以怎么验收"段给出 2 步手动验收：
   - 新会话中触发 primary agent 走 built-in `question` tool 的场景（任意需要结构化回答的请求），观察是否先到 1 条短 QQ 提醒，再看到 OpenCode 内的问题面板。
   - 临时禁用 `autoinfo_send_qq_notification`（或网络下线），重新触发同一场景，观察问题面板仍正常出现，agent 不卡顿、无重试噪音。

**Verify（合并）：**

```sh
# 一次跑完所有 grep 检查（每条都应非空退出 0）
set -e
F=/root/.config/opencode/AGENTS.md
grep -F "Pre-question QQ alert" "$F"
grep -F "built-in \`question\` tool 之前" "$F"
grep -F "subagents / non-primary agents 不发送此预提醒" "$F"
grep -F "不重试、不阻塞" "$F"
grep -F "Pre-question alert cross-reference" "$F"
grep -F "不计入本算法的 exactly-once 约束" "$F"
grep -F "终态 completion notification 仍然是 final answer 前最后一次 tool call" "$F"
grep -F "plain chat 轻量确认" "$F"
grep -F "Octto session tools" "$F"
grep -F "subagents / non-primary agents 不发送此预提醒" "$F"
grep -F "Single authoritative algorithm" "$F"
grep -F "exactly one \`autoinfo_send_qq_notification\` before the final answer" "$F"
grep -F "last tool call before the final answer" "$F"
echo "OK: global AGENTS.md pre-question QQ alert policy landed."
```

**Commit:** none（无新代码产出；本任务只做 read-only 验收 + 终态汇报内容约束。Task 1.1 / 1.2 的 commit 已覆盖文件改动。）
