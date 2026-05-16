---
date: 2026-05-17
topic: "Working Context Capsule for Subagent Prompt Cache Reuse"
status: draft
---

## 承诺清单 / Commitments

用户原话节选：
- "多并发派Subagent的时候 ... 先准备一个Subagent 让他读取需要的文件作为关键上下文 然后直接fork他再二次分配开发任务 ... 利用了缓存机制 不需要重复读取文件了"
- "完成a需求 然后想再做个b需求 做b需求的时候 agent会重新去读文件看上下文 我希望通过这个共享上下文的机制优化这个问题"
- "直接注入了上下文 就类似fork一样"
- "注入应该是按照用户提示词注入吧 不能注入系统提示词啥的"
- "不需要大小限制吧"
- "尽可能的多生效这个机制"

sub-decision-identification 已确认决策（全 A 默认 + 删 size cap）：

1. 存储位置：`thoughts/shared/context-capsules/YYYY-MM-DD-{topic}.md`（可 git diff / 可审计）
2. 生成方：primary agent（brainstormer / commander / executor）在 spawn 前主动判断
3. A→B 复用边界：同 lifecycle issue 内自动复用
4. Freshness 校验：branch + HEAD SHA + 工作集文件 hash + lifecycle issue 都必须匹配
5. 首版覆盖：S 级全做（Lens Swarm / executor batch / critic / 探索 fan-out / mm-orchestrator / atlas-initializer）+ B 级 A→B
6. 大小硬上限：**删除**；只保留软约束「不塞无关内容」，上界由 context window 自然决定

承诺条目（终态汇报「需求核对表」按此核对）：

- 不做 live subagent session fork；改用不可变 user prompt 前缀注入
- 不动 system prompt
- byte-identical capsule 出现在每个并行 worker 的 user prompt 顶部（缓存命中硬要求）
- A→B 复用仅在同 lifecycle issue 内生效
- Freshness 失效不静默丢弃；终态可见复用状态
- worker 仍必须读取自己的目标文件
- 不破坏现有 context-brief / planner contract / reviewer policy / Atlas / PM
- 不扩展 resume_subagent 承担 A→B 复用
- 首版至少覆盖 Lens Swarm + executor batch + A→B 三个最小高频场景
- secrets / raw logs / 凭据不得写入 capsule

## Problem Statement

当 primary agent 在短时间内派出多个 subagent，或用户连续完成需求 A 后做需求 B 时，每个 subagent 会独立调工具重读相同的关键文件、design、plan、contract、Atlas / Project Memory 条目。这造成三类浪费：

- **重复 tool 调用时间**：每个 worker 自己 read / grep / lookup 一遍
- **重复 token 成本**：相同事实被多次塞进模型输入
- **未利用 provider prompt cache**：每个 worker prompt 前缀不同 → 缓存全部失败

目标：把"已读、已确认的事实"做成不可变的 capsule，注入到所有 worker 的 user prompt 顶部，让 provider prompt cache 命中并消除重复读取。

## Constraints

- 仅注入 user prompt，绝不动 system prompt
- byte-identical：同一 capsule 在每个并发 worker 的 user prompt 同一位置（顶部）出现，字节一致
- 不引入 live subagent session fork 或全局 mutable cache
- A→B 复用边界严格限定在同一 lifecycle issue + 同 branch + 同 worktree
- Freshness 失败必须降级（部分复用 + stale 标注 或 discard），不得静默继续
- 不破坏既有协议：context-brief / planner frozen contract / reviewer policy / Atlas / Project Memory / knowledge-context section
- capsule 内容必须经过 secret 过滤
- worker 必须仍然读取自己的目标文件作为最终事实源
- 不扩展 resume_subagent 语义；resume 仍只为失败恢复

## Approach

**核心选择：immutable Context Capsule + user prompt 顶部稳定前缀注入**

放弃方案及理由：

1. **live subagent session fork**：拒绝 — 会污染任务身份 / resume 语义 / scope；现 runtime 不支持
2. **resume_subagent 复用**：拒绝 — 改变安全/恢复原语，scope contamination
3. **全局 semantic cache / daemonized context pool**：拒绝 — 隐式状态 + invalidation 复杂度过高
4. **直接用 ledger 注入**：拒绝 — ledger 是会话纪要，颗粒度不对；capsule 是热路径事实摘要

采用方案的关键性质：

- capsule 一次生成、不可变
- 注入到每个 worker user prompt 顶部、字节稳定 → provider prompt cache 命中
- 同 lifecycle / branch / worktree 内可跨需求复用，附 freshness preflight
- 失效降级而非静默丢弃，终态可见

## Architecture

三层缓存语义：

| 层 | 生命周期 | 用途 |
|---|---|---|
| L1: 本轮 prompt prefix | 一次 spawn 批次 | 多个 worker 共享同一前缀，吃 provider cache |
| L2: lifecycle-scoped capsule | 同 issue 内 | A→B 连续需求复用 |
| L3: 长期知识引用 | 跨 lifecycle | 引用 Atlas 节点 / PM 条目 pointer，不重复内容 |

落盘形态：

- `thoughts/shared/context-capsules/YYYY-MM-DD-{topic}.md`
- frontmatter 含 lifecycle_issue、branch、head_sha、worktree、created_at、source_files[]、source_hashes{}
- body 是稳定文本 capsule（注入用的就是这一段）

注入位置：

```
<context-capsule sha={capsule_sha} fresh-token={token}>
... 不可变事实摘要 ...
</context-capsule>

<spawn-meta>...</spawn-meta>
<context-brief>... task-specific delta ...</context-brief>

任务：...
```

`<context-capsule>` 块出现在 user prompt 最顶部，跨所有并行 worker 字节相同。

## Components

**1. Capsule Builder（生成器）**
- 位置：`src/agents/context-capsule/`（新模块）
- 职责：把 primary agent 当前已读/已确认的事实压缩成 markdown 文本 + frontmatter；过滤 secret；计算 capsule_sha；记录 freshness token
- 调用方：brainstormer / commander / executor 在准备 fan-out 前

**2. Capsule Injector（注入器）**
- 位置：`src/tools/spawn-agent/` 内增强（不另起工具）
- 职责：spawn_agent / Task 在拼装子 agent prompt 时，把 capsule 文本插入 user prompt 顶部；保证字节稳定

**3. Freshness Preflight（新鲜度校验）**
- 位置：`src/agents/context-capsule/freshness.ts`（新模块）
- 职责：复用前对比 branch / HEAD / source_hashes / lifecycle_issue；返回三档 `fresh | partially-stale | discarded`
- 调用方：primary agent 在新需求开始时主动调用

**4. Knowledge Context Section Hook**
- 位置：扩展 `src/agents/knowledge-context-section.ts`（既有单源）
- 职责：终态汇报"本次知识上下文"段加固定一行 `Capsule status: <none|fresh|partially-stale|discarded>` 与 capsule path

**5. Drift Guard**
- 位置：`tests/agents/context-capsule.test.ts`（新测试）
- 职责：grep-based 保证 brainstormer / commander / executor prompt 中都引用同一份 capsule-injection 协议块

**6. Sensitive Content Filter**
- 位置：`src/agents/context-capsule/redact.ts`
- 职责：阻断 `Authorization:` / token / private URL / `.env` 风格内容写入 capsule

## Data Flow

**Lens Swarm 场景（并发 5 scout）：**

```
brainstormer 决定派 5 scout
  → 调 Capsule Builder：摘要提案上下文 + freshness token
  → 写盘 thoughts/shared/context-capsules/...md
  → 5 次 Task spawn，每次 user prompt 顶部注入同一 <context-capsule>
  → provider prompt cache 命中首次写后的 4 次读取
  → scout 各自只追加 lens-specific delta
  → 5 个 scout 完成
  → 终态汇报展示 Capsule status: fresh
```

**A→B 跨需求场景（同 lifecycle issue）：**

```
A 完成 → brainstormer / executor 在 lifecycle 终态时调 Capsule Builder
  → 写盘 + frontmatter 记录 head_sha + source_hashes
  → B 开始 → primary 调 Freshness Preflight
    → fresh:           直接注入复用
    → partially-stale: 注入 + 标注 stale 部分 + 局部重读
    → discarded:       不复用，按新需求处理
  → 终态汇报展示复用状态
```

**Executor batch 场景（多 implementer 并行）：**

```
executor 在 batch fan-out 前合并 plan + frozen contract + 行为承诺 → capsule
  → 与 context-brief 并存：capsule 在前（稳定共享），context-brief 在后（per-task delta）
  → 多 implementer 拿到字节相同的前缀
  → cache 命中
```

## Error Handling

- **capsule 生成失败**：跳过注入，按现有流程 spawn（degrade gracefully），终态汇报 `Capsule status: skipped: <reason>`
- **freshness 校验失败（branch/worktree 变了）**：discarded，重新探索；不静默使用
- **检测到 secret**：拒绝写盘，记录 `Capsule status: blocked: secret`，按现有流程 spawn
- **provider 不支持 prompt cache**：注入仍然有效（减少 worker tool calls），只是省不到 cache 部分
- **capsule 超过 context window 比例阈值（默认 30%）**：警告 + 让 primary agent 自决是否切片或跳过
- **跨 lifecycle 误用**：Freshness Preflight 直接拒绝（lifecycle_issue 不匹配）

## Testing Strategy

- **单元测试**
  - capsule builder：输入既有 atlas / PM / 文件摘要，输出 deterministic markdown
  - redact filter：典型 secret pattern 必须被阻断
  - freshness preflight：branch/HEAD/hash/issue 各失配组合返回正确档位
- **协议注入测试**
  - grep-based：brainstormer / commander / executor prompt 必须含 `<context-capsule>` 注入协议块
  - byte-identical：同一批 spawn 多 worker，capsule 段字节一致
- **集成测试**
  - 模拟 Lens Swarm 5 scout：capsule 文件存在 + 5 个 spawn 调用 prompt 顶部一致
  - 模拟 A→B：A 完成后 capsule 写盘，B 开始时 fresh/partial/discarded 三档分别走通
- **回归保护**
  - 现有 context-brief / planner / reviewer / leaf-no-knowledge-write 测试不破坏
- **手动验收**（用户）
  - 真实跑一次 Lens Swarm，观察终态 "Capsule status: fresh" + 5 scout 显著少调工具
  - 完成需求 A 后再发需求 B（同 issue），观察 B 不重读文件

## Open Questions

- 是否在 octto 也复用 capsule（octto 多分支 brainstorm 场景）？首版**不做**，留 follow-up。
- capsule 是否纳入 Project Memory？首版**不做**；capsule 是热路径短期 artifact，PM 是长期决策。
- Lens Swarm 之外，pattern-finder / codebase-locator 默认要不要也吃 capsule？首版**做**（属 S 级探索 fan-out）。
- atlas-initializer 多 worker 是否首版接入？首版**做**（属 S 级）。
- 跨 worktree 同 issue（罕见）：默认拒绝复用，避免边界混乱；如需要后续单独评估。

## Behavior

**用户视角的可见行为承诺：**

- 当 primary agent 派出 ≥2 个 subagent 时，自动生成并注入 capsule；用户在终态"本次知识上下文"段能看到 `Capsule status: fresh / partially-stale / discarded / skipped: <reason> / none`
- 同一 lifecycle issue 内连续做需求 A、B 时，B 不再从零重读已确认的关键文件；终态可见复用了哪个 capsule
- capsule 文件可在 `thoughts/shared/context-capsules/` 看到、git diff、人工 review
- 切 branch / 切 worktree / 切 lifecycle 后，capsule 自动失效，不会污染新工作流
- 不会把 token、Authorization、私有 URL、`.env` 内容写入 capsule
- 不会改变现有 reviewer / planner / Atlas / PM / context-brief 行为
- 现有 lifecycle 失败恢复 / resume_subagent 路径不受影响

**验收方式：**

- 跑一次 Lens Swarm（如对一个提案派 5 scout），打开 `thoughts/shared/context-capsules/` 看到对应文件；终态汇报含 `Capsule status: fresh`
- 完成需求 A、立刻发需求 B（同 issue），B 的 subagent 不再 read 同一批文件；终态汇报指出复用了 A 的 capsule
- 故意切 branch 后发 B，capsule 被 discarded，B 重新探索
- 故意制造 secret 写入场景，capsule 被 blocked

Atlas 关联：本次行为对应 atlas/20-behavior/ 中关于 subagent dispatch 与 context 复用的节点（若存在则更新，否则由 executor 在 batch 完成后由 atlas-worker-behavior 评估是否新增节点）。
