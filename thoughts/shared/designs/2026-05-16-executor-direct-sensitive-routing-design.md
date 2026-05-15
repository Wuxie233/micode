---
date: 2026-05-16
topic: "Executor-direct 敏感路由小步放宽"
status: validated
---

## 承诺清单 / Commitments

- 当用户明确要求直接处理、目标文件明确、scope 小、verification 明确时，非语义敏感面小修可以路由到 `executor-direct`。
- 涉及 agent routing、tool permissions、lifecycle rules、slash command contract、runtime boot registration、deploy/restart policy 的行为变化仍必须走 lifecycle + planner + executor。
- runtime 源码小修若未执行 `bun run deploy:runtime`，终态报告必须明确说明 live OpenCode runtime 尚未生效。
- 不新增 agent 类型、不新增 runner lane、不改 lifecycle 工具、不改 `executor-direct` 本体。

## Problem Statement

当前 workflow 对敏感面采用“一触即 plan”的规则。这个规则保护了 agent prompt、runtime、slash command、deploy、lifecycle 等高影响入口，但也会把明确、局部、可验证的小修复升级成完整 design / plan / executor 流程。

用户截图里的 MCP 启动修复就是典型误伤：问题已定位、目标配置明确、验证路径明确，但因为触及 OpenCode MCP config / runtime 加载面，被强制进入 planner。这会让 `executor-direct` 的 no-plan scoped execution 能力在实际使用中变得过窄。

## Constraints

**必须保留的安全边界：**

- 不允许 `executor-direct` 绕过 agent routing、tool permissions、lifecycle、deploy、restart、remote mutation、slash command contract 等高风险行为变化。
- 不新增新的 agent 类型、runner lane、配置开关或复杂 taxonomy。
- 不改 lifecycle 工具的 issue / worktree / commit / merge / recovery 状态机。
- 不改 `executor-direct` 本体，优先通过 primary agent 路由提示和测试收敛行为。
- 不允许把“改动行数少”当作降级理由；核心判断是语义影响、目标明确度、验证明确度和副作用边界。

**允许优化的部分：**

- 将“敏感面一律禁止 direct”的绝对规则改成“默认保守，但存在窄例外”。
- 让用户明确要求 direct 且给出 bounded scope 时，primary agent 可以选择 `executor-direct`。
- 让终态报告显式说明本次是否跳过 lifecycle、是否部署 runtime、是否仍需用户后续动作。

## Approach

选择 **小步放宽**，而不是保留现状或引入 hard-forbidden / soft-sensitive 新分类。

**核心规则：**敏感面默认仍进入 lifecycle + planner，但当请求同时满足以下条件时，可以走 `executor-direct`：

- 用户明确要求直接处理或明确反对 plan ceremony。
- 目标文件 / 配置 / host 明确，且 scope 可由单个 subagent 在一次 session 内完成。
- 修改不改变行为 contract、routing、权限、lifecycle、deploy/restart policy 或 slash command 参数语义。
- verification 明确，或存在最便宜且相关的 sanity check。
- 不需要默认 commit / push / deploy / restart / GitHub mutation。
- runtime 相关源码修改必须在报告中说明 live runtime 是否已部署生效。

**仍然强制 plan 的场景：**

- 改 agent routing、agent role、tool permissions、model 策略或 lifecycle 触发规则。
- 改 slash command name、argument contract、agent mapping、template side effect。
- 改 MCP server 注册逻辑、runtime boot / registration、deploy helper、build/release flow。
- 改 `src/lifecycle/`、`src/hooks/lifecycle/`、commit / push / merge / recovery 逻辑。
- 任何跨模块行为变化，或需要 reviewer/lifecycle 审计链的任务。

## Architecture

本设计只改变 **primary agent 的路由判断文本与测试契约**，不改变执行架构。

**保持不变：**

- `executor-direct` 仍是 single-session、no-plan、no-reviewer、no-subagent 的 bounded executor。
- `planner` / `executor` 仍是非平凡任务的主交付路径。
- lifecycle 仍负责 issue、worktree、checkpoint commit、finish、recovery。
- deploy/runtime/restart 仍需要显式授权与独立安全提示。

**需要对齐的入口：**

- `brainstormer`：放宽 `<non-trivial-detector>` 对 typo / 文案小修的绝对禁用措辞，改为默认保守 + explicit bounded exception。
- `commander`：与 brainstormer 的 direct-execution 边界保持一致，避免同一请求在不同 primary agent 下路由不同。
- tests：更新 routing guard，验证 narrow exception 存在，同时验证高风险行为变化仍不能 direct。

## Components

**Primary routing policy：**负责识别是否为 bounded direct request。它不执行修改，只决定是否派 `executor-direct`、`investigator`、`planner` 或进入 lifecycle。

**Executor-direct：**继续执行明确 scope 的小修复。它不拥有 lifecycle，不默认 commit/push，不重启 OpenCode，不扩展 scope。

**Planner / executor chain：**继续处理需要设计拆分、reviewer cycle、跨模块协调或 lifecycle 审计的任务。

**Routing tests：**作为 prompt contract 守卫，覆盖正例与反例，避免“窄例外”漂移成通用逃生通道。

## Data Flow

用户请求进入 primary agent 后，先做风险分类：

- 若是未知原因或故障症状，先派 `investigator`。
- 若是非敏感、明确、局部小修，直接派 `executor-direct`。
- 若触及敏感面，默认进入 lifecycle + planner。
- 若触及敏感面但满足 explicit bounded exception，派 `executor-direct`，并要求其报告 execution envelope、verification、side effects、deploy/restart status。
- 若执行过程中发现 scope 扩大或触及 hard boundary，`executor-direct` 必须停止并报告 blocked，primary agent 再升级到 planner / lifecycle。

## Error Handling

**误判为 direct：**`executor-direct` 一旦发现修改会改变 routing、权限、lifecycle、deploy/restart、command contract 或跨模块行为，立即停止，不继续扩大 scope。

**runtime 未生效：**终态报告必须明确区分“源码已修改”和“live OpenCode runtime 已生效”。未执行 `bun run deploy:runtime` 时，不得暗示当前会话已修复。

**入口漂移：**测试同时覆盖 brainstormer 与 commander 的 routing 文案，防止一个入口允许 direct、另一个入口强制 plan。

**用户要求强行 direct：**如果请求触及 hard boundary，primary agent 应明确拒绝降级，并解释必须 plan 的具体原因。

## Testing Strategy

测试重点放在 prompt contract，而不是新增运行时机制。

- 更新 `tests/agents/brainstormer.test.ts`：不再断言 agent prompt typo 必须 lifecycle；改为断言敏感面默认保守，但 explicit bounded exception 可路由到 `executor-direct`。
- 更新 `tests/agents/commander.test.ts` 或相关 routing 测试：确保 commander 与 brainstormer 对 direct exception 的语义一致。
- 更新 `tests/agents/executor-direct-routing.test.ts`：保留 direct-execution 是 no-plan、bounded/scoped、single subagent session 的契约。
- 新增或调整反例断言：routing / permissions / lifecycle / deploy / restart / slash command contract / runtime boot registration 仍不得 direct。
- 运行最小测试集后再由 lifecycle commit，避免 prompt 文案和测试守卫漂移。

## Open Questions

- 是否需要在 README / README.zh.md 中补一句“sensitive but bounded direct exception”的用户可见说明？本轮默认不做，除非测试或文档 drift 已要求同步。
- 是否需要让 `executor-direct` 报告中固定出现“跳过 lifecycle 的理由”？本轮先通过 primary prompt 要求，暂不改 `executor-direct` 本体。

## Behavior

- 当用户说“这个很小，直接派 direct”且目标/验证/副作用边界都清楚时，系统可以跳过 planner，直接派 `executor-direct`。
- 当请求看似小但会改变 routing、权限、lifecycle、deploy/restart 或 command contract 时，系统仍会明确拒绝 direct 并升级到正式流程。
- 对 runtime 源码小修，系统会在结果里明确告诉用户：源码是否已改、runtime 是否已 deploy、生效是否需要后续动作。
- 行为层面与 Atlas 的 workflow / executor-direct 节点相关；若实现后发现已有 `atlas/20-behavior` 节点覆盖该流程，应同步维护。
