---
date: 2026-05-07
topic: "Effect First Primary Agent Responses"
status: validated
---

## Problem Statement

主 agent 当前的收尾反馈容易偏向过程：列 issue、commit、测试、batch、子任务。这些信息对自动化留档有价值，但用户最关心的是改动后的实际表现：会看到什么、怎么验收、是否满足原需求、还有哪些限制。

我们要把主 agent 的用户可见汇报中心从"我做了什么"改成"你会看到什么效果，以及怎么验证它"。

## Constraints

- 默认中文、简洁、效果优先。
- 不删除必要的 blocked/failure 信息；阻塞时必须说清用户需要做什么。
- 不改变 executor/reviewer 的内部详细报告格式，只改变 primary agent 对用户的综合表达。
- 不破坏 QQ completion notification 规则。
- 触及 `src/agents/commander.ts`、`src/agents/brainstormer.ts` 和 AGENTS.md，必须走 lifecycle。

## Approach

新增一个 **effect-first reporting** prompt block，要求 primary agent 在完成设计、实现、审查或较大操作后，优先输出：

1. **预期表现**：用户现在会看到什么行为。
2. **你可以怎么验收**：用户用 2-4 个步骤自己验证。
3. **已知限制 / 下一步**：没完成或需要用户处理的事。
4. **实现记录**：commit/tests/issues 等只压缩为 1-2 行，除非用户要求展开。

这个规则补充现有 formatting / notification / intent classification，不替代它们。

## Architecture

**Commander** 是普通落地/运维/quick-mode 的主入口，需要明确 final summary effect-first。

**Brainstormer** 是设计讨论和 lifecycle 编排的主入口，需要在设计方案、对抗审查总结、executor 完成后使用同样结构。

**AGENTS.md** 存项目本地规则，给后续 agent/prompt 编辑一个单源说明。

## Components

**`src/agents/commander.ts`**

- 添加 `<effect-first-reporting>` block。
- 规则：默认不要把子任务表、commit hash、测试命令放在最前面；先讲用户可见效果。
- 例外：blocked/failed-stop 必须先讲阻塞原因和用户动作。

**`src/agents/brainstormer.ts`**

- 添加相同语义 block。
- 和 commander 保持一致，避免 primary 表达风格分裂。

**`AGENTS.md`**

- 添加项目本地一节：`## Effect-First User-Facing Reports`。
- 说明默认结构和压缩原则。

**Tests**

- Commander/brainstormer prompt tests 检查 block 存在、包含"预期表现"、"你可以怎么验收"、"实现记录"、"blocked/failure exception"。
- 可加 drift test：两个 primary 的 block byte-identical 或关键语义一致。

## Data Flow

1. Agent 完成一个用户可见工作单元。
2. 内部工具/子代理仍返回详细报告。
3. Primary agent 综合时先抽取用户可见变化。
4. 用户看到的是效果、验收、限制；过程细节被压缩到末尾。

## Error Handling

**任务 blocked**：先输出"为什么阻塞"和"你要做什么"，再讲已完成部分。

**任务 failed-stop**：先输出失败结论和恢复建议。

**用户要求详细过程**：展开 commit/test/subtask 细节。

**纯查询/小操作**：可以一句话完成，不强行套完整模板。

## Testing Strategy

- Prompt source tests：检查 commander/brainstormer 包含 effect-first block。
- AGENTS.md test：检查项目本地规则存在。
- 不做模型输出集成测试；这是 prompt contract，单元 source test 足够。

## Open Questions

- Octto 是否同步加入。当前主设计先覆盖 commander/brainstormer；如果 octto 作为 primary 也常做用户总结，可在计划阶段评估是否一并加入。
