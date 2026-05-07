---
date: 2026-05-07
topic: "Specialist Agents"
status: validated
---

## Problem Statement

当前 micode 已有主工作流 agent（brainstormer/planner/executor）和 critic 对抗审查 agent，但缺少用户显式召唤的决策辅助角色。用户希望在需求模糊、架构方案、UI/UX 体验、架构质量和方案评分这些阶段，能按需派专门 agent 辅助自己判断，而不是让主 agent 自动替自己做完所有决策。

这些 specialist agents 不替代主工作流，不进入 executor 循环，也不默认运行。它们是 user-triggered decision aids。

## Constraints

- 5 个 specialist 独立文件，不参数化：人设、领域知识和输出格式差异大。
- 全部 read-only：禁用 write/edit/bash/task。
- 主 agent 可以在合适阶段提示一次，但不能自动派。
- 用户必须显式说"派产品经理"、"派 UX 设计师"等，才调用对应 subagent。
- 不添加到 output-class routing；这些角色不是 location/explanation/diagnosis/mutation 路径。
- AGENTS.md、brainstormer、commander 三处语义需一致，避免 user-triggered 合约 drift。

## Approach

新增五个 subagent 文件：

- `product-manager`
- `software-architect`
- `ux-designer`
- `architecture-quality-inspector`
- `rubric-reviewer`

每个 agent 采用 `investigator` / `critic` 的 read-only AgentConfig 模式，但 prompt output contract 按各自领域独立定义。

Coordinator 层新增 `<specialist-dispatch>` 说明：只提示，不自动派；每阶段最多提示一次；用户不响应或说继续就不再提。

## Architecture

**Agent layer** 承载角色专业性。

**Registry layer** 把 5 个 agent 暴露给 Task/spawn_agent。

**Coordinator prompt layer** 告诉主 agent 何时建议派遣、如何避免提示疲劳、如何保持 user-triggered。

**Global AGENTS.md layer** 作为跨主 agent 的工作流合约说明。

## Components

**`product-manager`**

- 用于需求模糊阶段。
- 一次最多问 3 个问题，每个有推荐默认。
- A/B/C/D/E 选项：D 自定义，E 自动生成。
- 输出 PRD：用户故事、Given/When/Then 验收标准、Non-Goals。

**`software-architect`**

- 用于架构方案阶段。
- 强制 2-3 个备选方案和显式 trade-off。
- 标注与现有模块的耦合面，优先使用 atlas_lookup / mindmodel_lookup。
- 输出推荐方案和理由。

**`ux-designer`**

- 用于 UI/UX 不满或新 UI 设计。
- 锚定 WCAG 2.2、Material Design 3、Apple HIG、Core Web Vitals。
- Nielsen 10 + AI Transparency / Explainability。
- 严重度 0-4，按 severity × frequency × business impact 排序。

**`architecture-quality-inspector`**

- 用于架构方案质检。
- 检查 SOLID、循环依赖、抗模式、耦合约束。
- 输出 P0/P1/P2/P3 findings，终止状态是 APPROVED / APPROVED with required fixes / CHANGES REQUESTED。

**`rubric-reviewer`**

- 用于多维度评分。
- 类别评级：Excellent / Good / Acceptable / Poor / Failed。
- 每维度单独评分，强制证据引用，不输出 1-10 总分。

## Data Flow

1. 用户在设计讨论中表达需求或请求辅助。
2. 主 agent 根据阶段最多提示一次可派 specialist。
3. 用户显式说"派 X"。
4. 主 agent 调对应 subagent，传入当前需求/方案/上下文。
5. Specialist 输出结构化辅助结果。
6. 主 agent 帮用户整合结果，但停留在讨论阶段；只有用户说 go 才进 lifecycle。

## Error Handling

**用户没指定要派谁**：主 agent 继续自己讨论，不自动派。

**请求超出 specialist 领域**：specialist 明确边界并给出建议转派对象。

**证据不足**：评分或质检必须说明 `CANNOT_ASSESS` / `需要补充材料`，不能编造。

**提示疲劳**：同阶段最多提示一次；用户说继续后不重复。

## Testing Strategy

- 每个 specialist 一个 prompt unit test，验证 read-only、关键领域锚点、输出 contract。
- Registry tests：5 个 agent 注册到 `agents` map 且 re-export。
- Role label tests：中文 session label。
- Routing tests：brainstormer/commander 都列出 specialist agents，包含 `<specialist-dispatch>`，不包含 output-class routing。
- Typecheck + targeted tests。

## Open Questions

- Specialist dispatch 的"每阶段最多一次"当前是 prompt-level 约束，无 runtime state 记录。若后续重复提示明显，再考虑代码层 state。
- UX 设计师如果需要截图/浏览器证据，后续可接入 `mobile-ux-audit-expert` skill 或 Playwright；本轮先做 prompt-level subagent。
