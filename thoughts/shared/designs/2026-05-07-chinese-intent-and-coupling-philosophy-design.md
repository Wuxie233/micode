---
date: 2026-05-07
topic: "Chinese Intent Classification and Coupling Philosophy"
status: validated
---

## Problem Statement

主 agent 现在会做 quick-mode、non-trivial detector、routing-by-output 等内部判断，但用户看不到它把请求理解成什么类型。这会让用户难以及时纠正 agent 路线，尤其是小改动误触 agent prompt / lifecycle / deploy 等敏感面时。

同时，用户希望把自己的工程哲学写进工作流：从架构设计开始强调低耦合、模块化分层、高复用，业务逻辑由可复用"轮子"拼装，而不是每个需求都临时堆业务代码。

## Constraints

- 用户可见语义必须尽量中文，避免 `lane`、缩写、半英文标签带来的认知负担。
- 意图声明是 UX 层，不替代已有 quick-mode、non-trivial-detector 和 routing-by-output。
- Forbidden surface 优先级最高：触及 `src/agents/` 等敏感面时，即使是 typo，也必须识别为"设计"。
- 设计哲学只存一份：`.mindmodel/architecture/coupling-reuse.md`。
- AGENTS.md 和 agent prompts 只引用该约束，不重复粘贴完整哲学，避免三处 drift。
- `.mindmodel/architecture/coupling-reuse.md` 和 AGENTS.md reference 必须同批落地。

## Approach

采用 **中文意图声明 + mindmodel 单源约束**。

每个新请求第一回合，primary agent 第一行输出：

`意图: <快速修复|设计|调试|运维>。理由: <一句话>。`

四个意图足够覆盖现有工作流：

- **快速修复**：小而局部、无 forbidden surface 的低风险修补。
- **设计**：新功能、架构变更、跨模块改造、任何 forbidden surface。
- **调试**：未知原因、故障诊断、需要 investigator 证据包。
- **运维**：状态查询、部署、配置、GitHub/仓库操作。

设计哲学进入 `.mindmodel/architecture/coupling-reuse.md`，让 planner/reviewer/implementer 通过现有 `mindmodel_lookup` 获取。AGENTS.md 只补一条全局提示：设计哲学约束见 mindmodel 文件。

## Architecture

**Primary prompt layer** 负责用户可见的第一句话分类。

**Existing detector layer** 继续负责真实路由安全，优先级写清楚：

1. forbidden-surface
2. non-trivial-detector
3. 意图声明

这意味着意图声明不能成为绕过 lifecycle 的理由。它必须服从已有 detectors。

**Mindmodel layer** 存储长期工程哲学。这样后续 planner 和 reviewer 只要沿用现有 `mindmodel_lookup` 机制，就能读取同一份约束。

## Components

**`src/agents/brainstormer.ts`**

- 增加 `<intent-classification>` block。
- 明确四个中文意图、输出格式、first-turn-only、forbidden surface worked example。

**`src/agents/commander.ts`**

- 增加同样的 `<intent-classification>` block。
- 与 brainstormer 保持完全一致，避免 primary agents 表现分裂。

**`.mindmodel/architecture/coupling-reuse.md`**

- 新增模块解耦与高复用约束。
- 覆盖 brainstormer/architect、planner、reviewer 三个使用阶段。
- 明确反模式：shotgun business logic、utility duplication、future-proof abstraction、private-state coupling。

**`AGENTS.md`**

- 添加一条中文设计哲学引用，不复制完整内容。

**Tests**

- 检查 primary prompt 包含意图声明、中文枚举、forbidden-surface worked example。
- 检查 mindmodel 文件存在并包含核心关键词。
- 检查 AGENTS.md 引用 mindmodel 文件。

## Data Flow

1. 用户发新请求。
2. 主 agent 先根据 forbidden surface 和现有 detectors 判断安全边界。
3. 主 agent 输出中文意图行。
4. 如果进入设计或规划阶段，现有 `mindmodel_lookup` 读取 coupling/reuse 约束。
5. Planner 拆 task 时标注耦合面、复用点、新轮子是否必要。
6. Reviewer 审查实现是否违背低耦合/高复用原则。

## Error Handling

**请求混合多个意图**：选择最高风险意图。例如"顺手改一下 agent prompt typo 并部署"应为"设计"，不是"快速修复"或"运维"。

**意图和 detector 冲突**：detector 胜出。Prompt 必须明确不能用"快速修复"覆盖 forbidden surface。

**mindmodel 缺失**：AGENTS.md reference 和 mindmodel 文件同批提交；测试防止 reference dangling。

**重复输出意图造成噪音**：仅在新请求第一回合输出；连续对话不重复。

## Testing Strategy

- Agent prompt tests：brainstormer/commander 包含意图格式、四个中文意图、优先级、worked example。
- Mindmodel test：文件存在，包含低耦合、模块化、复用、轮子、反模式。
- AGENTS/source test：全局配置引用 `.mindmodel/architecture/coupling-reuse.md`。
- 运行 targeted tests + `bun run check`。

## Open Questions

- 是否需要 code-level intent router。当前先用 prompt-level 约束，因为这只是用户可见 UX 层，真实安全仍由 non-trivial-detector 兜底。
- commander 是否应对所有 ops 输出意图。当前设计为新请求第一回合输出即可，避免每条状态查询重复。
