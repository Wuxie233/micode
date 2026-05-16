---
date: 2026-05-17
topic: "Working Context Capsule v2: Same-Conversation A→B Coverage"
status: draft
---

## 承诺清单 / Commitments

用户原话节选：
- "我这个场景是一个对话内专注一个项目的多个需求开发 就是开发完了a需求 然后继续提出b的新需求去开发"
- 截图证据：commander → executor-direct（单 subagent）连续派遣三次（Fix hub entry / Continue hub fix / Fix NPC name），每次"10 次读取 4 次搜索"，capsule 没生效
- "开"（同意 v2 推进）

v1 盲区：

| 项 | v1 行为 | v2 必须改 |
|---|---|---|
| 生成 trigger | 仅 ≥2 并行 subagent | 单 subagent 派遣也生成 |
| 复用 anchor | 仅同 lifecycle issue | 同对话 + 同 repo + 同 worktree 也可 |
| executor-direct | 不接收 capsule | 接收 |
| ops/quick-fix 无 lifecycle | 全程没 capsule | 全程有 capsule |

承诺条目（终态汇报「需求核对表」对照）：

- commander/brainstormer/octto 三者同步在同对话内每次 sub-dispatch 完成后生成或追加 capsule
- 同对话内后续 sub-dispatch（包括 executor-direct）自动注入最新 capsule
- 复用 anchor 扩展到「同对话 + 同 repo + 同 worktree」（lifecycle_issue 可为 null）
- 不跨对话复用；OpenCode 重启后同对话 anchor 失效，可接受
- byte-identical drift guard / secret filter / immutable 三大不变量保持
- 不破坏 v1 lifecycle-issue 复用路径
- 不扩展 resume_subagent
- capsule builder 必须轻量，不能明显拖慢下一轮 dispatch
- 终态 Capsule status 行在同对话连续 ops 场景里能稳定出现 fresh / partially-stale / discarded

## Problem Statement

v1 部署后第一次实战暴露盲区：用户在**同一个对话内**对**同一个项目**连续提需求（典型 ops 场景），每次 commander 派 executor-direct 都从零开始读文件、grep、探索。三次连续派遣观察到"10 次读取 4 次搜索"级别的重复探索。原因：

- v1 capsule 生成 trigger 只在并行 fan-out（≥2 subagent）时触发
- v1 复用 anchor 只识别"同 lifecycle issue"
- executor-direct 路径不接收 capsule（设计上认为单 subagent 无需共享）
- ops/quick-fix 路径不开 lifecycle issue，所以没 anchor

结果：最常见的连续开发场景反而没受益。

## Constraints

- v1 的文件格式 / storage 路径 / frontmatter / token / sha 等不变
- 同对话 anchor 仅生效在 primary session 生命周期内；OpenCode 重启后丢失，不补救
- 不引入跨对话复用（防止 stale 污染）
- byte-identical drift guard 仍然强制（不论几个 worker，注入字节稳定）
- secret filter 不放松
- immutable 哲学不破坏：同对话多次 sub-dispatch 生成**多份**新 capsule 文件，不原地改写
- 不修改 executor-direct 自身行为（仍单 session、不分发子 subagent），只让它在 user prompt 顶部多收到一段 capsule
- 性能：capsule 生成必须在毫秒级，不能明显拖慢下一轮 dispatch
- 不破坏 v1：lifecycle 内 fan-out / A→B 复用路径完全保留

## Approach

**核心扩展（两点 + 一个 fallback）：**

1. **生成 trigger 扩展**：commander / brainstormer / octto 在**每次** sub-dispatch（包括单 executor-direct / Task 派遣）完成、得到 subagent 报告后，主动调用 capsule builder：
   - 输入：本轮 sub-dispatch 的 prompt + 子 agent 报告 + primary agent 自己已确认的事实
   - 输出：新 capsule 文件（不覆盖旧的）
   - 不阻塞当前回合的最终回复

2. **复用 anchor 扩展**：新增 `conversation_anchor`（primary session id 或 OpenCode 会话标识）+ 保留 `repo` + `branch` + `worktree`。capsule 查找规则升级为：
   - 优先匹配 `(lifecycle_issue, branch, worktree)` 三元（v1 路径）
   - 否则匹配 `(conversation_anchor, repo, branch, worktree)` 四元（v2 新路径）
   - 都不匹配 → 不复用
   - 取匹配集中最新 `created_at`

3. **executor-direct 注入**：commander 在 spawn executor-direct 时，把当前对话最新 capsule 写到 user prompt 顶部。executor-direct 行为不变，照常单 session 工作；区别只是它的 prompt 一开始就有"已经知道的事实"。

放弃的方案及理由：

- **跨对话复用**：拒绝 — 在 v1 已经预判过 stale 风险大；v2 仍只在同对话内自动复用
- **原地编辑 capsule**：拒绝 — 破坏 immutable / byte-identical 缓存哲学
- **commander 自己一直跟踪一个 in-memory 长 state**：拒绝 — capsule 已经是持久化形态，in-memory 重复造轮

## Architecture

复用 v1 的三层缓存语义，扩展 L2：

| 层 | v1 边界 | v2 边界 |
|---|---|---|
| L1: 本轮 prompt prefix | 一次 spawn 批次 | 不变 |
| L2: 流内复用 | 同 lifecycle issue | + 同对话 + 同 repo + 同 worktree |
| L3: 长期引用 | Atlas 节点 / PM 条目 | 不变 |

新增 frontmatter 字段：

```yaml
conversation_anchor: <opencode-session-id-hash 或 null>
generated_by: brainstormer | commander | octto | executor
dispatch_kind: parallel-fanout | single-subagent | executor-direct
parent_capsule: <prior capsule sha 或 null>   # 同对话上一份 capsule，用于 audit 链
```

注入位置不变（user prompt 顶部 `<context-capsule>` 块），byte-identical 不变。

## Components

**1. Capsule Builder 扩展（`src/agents/context-capsule/builder.ts`）**
- 输入接口新增 `conversationAnchor`、`generatedBy`、`dispatchKind`、`parentCapsuleSha`
- 不变更现有 build 函数签名，新增可选字段；现有调用方默认 null

**2. Capsule Store 扩展（`src/agents/context-capsule/store.ts`）**
- 查找函数新增第二层 fallback：(conversation, repo, branch, worktree) 匹配
- 返回时按 `created_at` desc 取最新

**3. Freshness 扩展（`src/agents/context-capsule/freshness.ts`）**
- 增加 `conversation_anchor` 校验维度
- 三档 fresh / partially-stale / discarded 语义保留

**4. Commander prompt 扩展（`src/agents/commander.ts`）**
- 在 `<spawn-meta>` / sub-dispatch 协议块里增加：
  - 派 sub-agent 前：调用 store.find，找最新可复用 capsule → 注入
  - 派 sub-agent 后：调用 builder.build，写入新 capsule
- drift guard 镜像点：同步扩展 `brainstormer.ts` / `octto.ts`

**5. Brainstormer / Octto prompt 同步扩展**
- 同 commander 逻辑，保持三 primary agent 行为一致

**6. Context Capsule Protocol 单源更新（`src/agents/context-capsule-protocol.ts`）**
- 协议块增加 v2 trigger 描述（"派遣前查找+复用、派遣后生成"）
- byte-identical 镜像 brainstormer/commander/octto

**7. Drift Guard Tests 扩展（`tests/agents/context-capsule-drift-guard.test.ts`）**
- 新增断言：v2 trigger 协议块出现在三 primary agent prompt 中

**8. Conversation Anchor 解析（`src/agents/context-capsule/conversation.ts`，新文件）**
- 输入：OpenCode session 上下文（primary agent 调用时可获得的 session/run 标识）
- 输出：稳定的 conversation_anchor 字符串（hash 后保存，避免 leak 长 id）
- 优雅降级：拿不到 session id 时 anchor = null，v2 路径自动失活，v1 路径不受影响

## Data Flow

**典型 v2 场景（用户截图的连续 ops）：**

```
对话开始，commander 收到 A 需求
  → 派 executor-direct
    → store.find(conversation_anchor=S, repo=R, branch=B, worktree=W)
      → 命中 0（首次）→ 不注入 capsule
    → executor-direct 自行探索完成 A
  → 收到 executor-direct 报告
  → builder.build({ conversation_anchor: S, generatedBy: "commander", dispatchKind: "executor-direct", ... })
    → 写 thoughts/shared/context-capsules/conv-S-fix-hub-entry-{token}.md

用户提 B 需求（同对话）
  → commander 派 executor-direct
    → store.find(conversation_anchor=S, ...) → 命中上面那份
    → freshness preflight(branch+HEAD+hashes+conversation)
      → fresh → 注入到 B 的 executor-direct user prompt 顶部
    → executor-direct 拿到工作集事实，直接基于已知信息工作，不重新探索同一批文件
  → 收到报告
  → 生成 capsule conv-S-fix-npc-name-{token}.md，parent=上一份的 sha

用户提 C 需求...同上
```

**v1 lifecycle 路径同时存在（不受影响）：**

```
brainstormer 走 lifecycle_start_request → 设计 → 计划 → executor → 多 implementer 并行
  → store.find(lifecycle_issue=N, ...) → 命中现有 lifecycle capsule
  → byte-identical 注入到所有并行 implementer
```

## Error Handling

- **conversation_anchor 取不到**：v2 路径静默降级到 v1 only，不影响主流程，终态 `Capsule status: skipped: no-conversation-anchor`
- **同对话多份 capsule 时间戳冲突**：按 created_at desc 排序后取最早 path（字典序破平），保证 deterministic
- **OpenCode 重启**：conversation_anchor 变化 → freshness discarded → 重新从零；不试图恢复
- **builder 失败**：跳过生成，下一轮没复用对象；不影响当前 dispatch
- **找到的 capsule 与当前 repo 不匹配**：discarded（freshness 应早就拦截，作为兜底）
- **capsule 数量在长对话里膨胀**：不主动清理（immutable 哲学），用户可手动清；如未来过大，再考虑保留最近 N 份

## Testing Strategy

- **单元测试**
  - builder：新可选字段不影响 v1 输出
  - store.find：v1 路径不变；v2 路径正确返回最新匹配；不匹配返回 null
  - freshness：conversation_anchor 失配返回 discarded
  - conversation anchor 解析：取得失败时返回 null
- **协议注入测试**
  - drift guard：v2 trigger 协议块出现在 brainstormer / commander / octto prompt
- **集成测试**
  - 同对话三连 dispatch：第二/第三轮 prompt 顶部含上一轮 capsule，且引用最新一份
  - executor-direct 接收注入路径完整
  - v1 lifecycle 并发 fan-out 行为未变（回归保护）
- **手动验收**（用户）
  - 在新对话里跑用户截图同样的 ops 流程：第二个 executor-direct 不再"10 次读取"级别探索
  - 终态汇报 Capsule status 从 v1 的 none 切换到 fresh

## Open Questions

- **多人协作（多对话同 repo）**：当前无影响，因为 anchor 是 primary session id 不是 repo；保持现状。
- **OpenCode session id 是否稳定可用**：v2 直接依赖此能力；conversation.ts 在拿不到时优雅降级。
- **capsule 文件数量长期治理**：暂不引入清理策略，等真实使用数据后决定。
- **是否同步扩展 octto brainstorm 多分支场景**：本轮**做**（保持 commander/brainstormer/octto 一致性）。
- **executor 自己派的并行 batch 算 v1 还是 v2**：算 v1（lifecycle_issue 一定存在），不受影响。

## Behavior

**用户视角的可见行为承诺：**

- 同对话连续提需求时，第二个及之后的 sub-dispatch（含 executor-direct）拿到上一轮 capsule，不再"从头收集"
- `thoughts/shared/context-capsules/` 目录下出现新文件，文件名包含 conversation anchor 片段
- 终态汇报"本次知识上下文"段 `Capsule status: fresh / partially-stale / discarded` 出现在同对话第二轮及之后
- 切对话 / 切 repo / 切 worktree 时 capsule 自动 discarded，不污染新场景
- OpenCode 重启后旧的 conversation anchor 失效，第一轮重新探索；不强求重启后复用
- v1 已有的 lifecycle issue 内 A→B 复用 / 并行 fan-out 缓存命中行为完全保留
- secret / raw logs / 凭据仍不会写入 capsule
- 现有 reviewer / planner / Atlas / PM / context-brief 行为不变

**验收方式：**

- 复现用户截图场景：同对话内连续派 3 次 executor-direct → 第 2/3 次 Capsule status: fresh，subagent 不再大量重复 read/grep
- 跨 OpenCode 重启复现：重启后第一轮 dispatch Capsule status: discarded 或 none（不复用），从第二轮开始 fresh
- 切对话：新对话第一轮 dispatch Capsule status: none，不会拿到旧对话的 capsule

Atlas 关联：本次行为扩展 atlas/20-behavior 中关于 subagent dispatch 与 context 复用的节点（v1 关联点不变；由 executor 在 batch 完成后由 atlas-worker-behavior 评估是否新增 v2 子节点）。
