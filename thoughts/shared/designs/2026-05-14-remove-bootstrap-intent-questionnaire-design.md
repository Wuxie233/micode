---
date: 2026-05-14
topic: "Remove intent.* octto questionnaire from /all-init and /all-rebuild"
status: draft
---

# 移除 /all-init 与 /all-rebuild 的 intent.* octto 问卷

## Problem Statement

`/all-rebuild`（及 `/all-init` 全缺失场景）在 `knowledge-bootstrap-orchestrator` 内强制走一段 octto 问卷，要求用户回答三个 atlas cold-init intent 问题：

- `intent.pitch`：一句话项目用途
- `intent.user`：主要用户
- `intent.shape`：部署形态（lib/cli/service/plugin/other）

实际用户体验：

1. 用户在大多数项目里都有 `README.md` / `package.json` / `ARCHITECTURE.md`，这些信息**可由 agent 直接读出**。
2. 用户被迫回答时常常敷衍输入（实例：`"你自己基于对项目的分析研究啊"`、`"你看项目研究"`），这些字符串被按字面塞入 `Pre-seeded answers` 段下传给 `atlas-initializer`，**污染**其判断。
3. `DEFAULT_BOOTSTRAP_ANSWERS` 的兜底值字面就是 `"Project purpose not yet specified; inferred from code."`——代码已经承认"用户不答就让 agent 推断"，那为什么默认不让 agent 推断？
4. `atlas-initializer` phase 1 已经并行调用 `codebase-locator` / `codebase-analyzer` / `pattern-finder` 并 glob `package.json` / `README*` / `ARCHITECTURE*`；它**有能力且应该**自己推断。

## Constraints

- 不改变 `/all-status` 的 read-only 行为。
- 保留 `/all-rebuild` 的 `octto.confirm`（覆盖文件的破坏性确认是必要安全闸）。
- 不改变 `/atlas-init` 独立命令的现有行为（它本来就不走 orchestrator 问卷）。
- Leaf agent（`atlas-cold-build` / `atlas-cold-behavior`）不引入任何新的 octto 调用。
- AGENTS.md 镜像段落 + drift-guard 测试必须同步更新。
- 改动必须 cross-entry 一致：`/all-init` 与 `/all-rebuild` 同时调整，行为对齐。

## Approach

**方案 A（极简删除）**：直接删除 octto 问卷收集步骤，让 `atlas-initializer` 用它已有的 discovery 能力自行推断。`atlas-initializer` 自己保留 "critical info missing → ask ONE focused question" 的自决问询 escape hatch。

考虑过但拒绝的两个备选：

- **方案 B（推断 + confirm）**：先推断再让用户确认。多一道交互在好项目上是噪音，在烂项目上用户也答不出来。
- **方案 C（仅空项目问）**：检测到 README/package.json 都没有时才问。引入条件分支增加复杂度；`atlas-initializer` phase 2 已经能做更精准的判断。

选 A 的核心理由：**真实数据 > 用户敷衍输入 > 兜底字符串**。当前实现把后两者放在前两者前面，方向反了。

## Architecture

涉及四个文件 + 三组测试：

### Source files

1. **`src/agents/knowledge-bootstrap-orchestrator.ts`**
   - 移除 `buildBootstrapQuestionPrompt()` 模板字面量调用。
   - `/all-rebuild` 流程：保留 `octto.confirm` 覆盖确认；删除其后的 octto.start_session intent.* 收集。
   - `/all-init` 全缺失流程：删除 octto.start_session intent.* 收集。
   - spawn `atlas-initializer` 的 prompt 不再含 `"Pre-seeded answers: intent.pitch=..., ..."`；改为指令明确"先自行从 README / package.json / ARCHITECTURE.md / 模块结构推断；推断不到再用 octto 问最多 1 个最关键的问题"。
   - 同步移除 `buildBootstrapQuestionPrompt` 的 import。

2. **`src/tools/knowledge-bootstrap/questionnaire.ts`**
   - 删除整个文件（`BOOTSTRAP_QUESTION_KEYS` / `BootstrapAnswers` / `DEFAULT_BOOTSTRAP_ANSWERS` / `buildBootstrapQuestionPrompt` 无外部消费者）。
   - 或保留空壳文件以减少 import 路径变动——倾向**直接删除**，配套 `src/tools/knowledge-bootstrap/index.ts` 移除相关 re-export。

3. **`src/agents/atlas-initializer.ts`**
   - 在 phase 2 (synthesis) 加入硬约束："若 README / package.json description / ARCHITECTURE.md 中至少有一个可读，**不要**用 octto 问 intent 类问题；从这些数据源直接推断 pitch / user / shape。只有当三者全空白时，才允许用 octto 问最多 1 个最关键的问题。"
   - 保留它的自决问询 escape hatch（不删 phase 2 的"use Octto to ask ONE focused question if critical info missing"语义，只是收紧触发条件）。

4. **`AGENTS.md`**
   - 更新 "Knowledge Bootstrap Commands" 章节的 dispatch rules：移除 "octto 问卷在 orchestrator 入口一次性收集 (intent.pitch / intent.user / intent.shape)" 句子。
   - 增补一句说明：`atlas-initializer` 在 phase 2 自行推断 intent 信息；只在完全推断不到时由其自决用 octto 问 1 个最关键问题。

### Test files

5. **`tests/agents/knowledge-bootstrap-orchestrator.test.ts`**：移除/重写 intent.* 收集相关断言，加入"orchestrator prompt 不应包含 intent.pitch / intent.user / intent.shape 关键字"的反向断言。

6. **`tests/tools/knowledge-bootstrap/questionnaire.test.ts`**：删除（文件本身被删）。

7. **`tests/integration/knowledge-bootstrap-orchestrator.test.ts`**：移除"答案被传到 atlas-initializer prompt"相关 mock 与断言。

8. **`tests/agents/agents-md-knowledge-bootstrap.test.ts`**：同步 AGENTS.md 镜像 drift guard。

9. **`tests/agents/atlas-initializer.test.ts`**：加入对新硬约束语句的存在性断言。

## Components

### Knowledge Bootstrap Orchestrator (primary agent)

**之前**：四阶段：detect → octto.confirm（仅 rebuild） → octto intent.* 问卷 → 串行 spawn 三子 agent。

**之后**：三阶段：detect → octto.confirm（仅 rebuild） → 串行 spawn 三子 agent。

`spawn_agent("atlas-initializer", ...)` 的 prompt 仅含 "mode=missing-only / force-rebuild" 语义，不含 intent 答案。

### Atlas Initializer (subagent)

**职责变化**：增加"自行推断 intent"的明确职责，但**实现方式不变**——它仍然在 phase 1 并行做 discovery，phase 2 综合结果生成节点计划。差别只在 phase 2 的 octto 触发条件被显式收紧（README/package.json/ARCHITECTURE 任一可读时不问）。

### Questionnaire module（即将删除）

`src/tools/knowledge-bootstrap/questionnaire.ts` 整个被删除。`src/tools/knowledge-bootstrap/index.ts` 同步移除 re-export。

## Data Flow

### 删除前

```
user → /all-rebuild
  → orchestrator
      detect_knowledge_state
      octto.confirm "overwrite OK?"
      octto.start_session [intent.pitch, intent.user, intent.shape]  ← 删除目标
      collect answers (or DEFAULT_BOOTSTRAP_ANSWERS fallback)
  → spawn project-initializer
  → spawn mm-orchestrator
  → spawn atlas-initializer
       prompt 含 "Pre-seeded answers: intent.pitch=...,intent.user=...,intent.shape=..."  ← 删除目标
       phase 1: discover (README/package.json/ARCHITECTURE 已可读)
       phase 2: 把 Pre-seeded answers 与 discovery 合并 (污染源)
```

### 删除后

```
user → /all-rebuild
  → orchestrator
      detect_knowledge_state
      octto.confirm "overwrite OK?"      ← 保留（安全闸）
  → spawn project-initializer
  → spawn mm-orchestrator
  → spawn atlas-initializer
       prompt 只含 mode 语义 + 自决推断硬约束
       phase 1: discover (README/package.json/ARCHITECTURE)
       phase 2: 从 discovery 自行推断 pitch/user/shape
                若三者全空白 → 用 octto 问最多 1 个最关键问题（保留 escape hatch）
```

## Error Handling

- **README/package.json/ARCHITECTURE 全空**：`atlas-initializer` phase 2 自决用 octto 问 1 个最关键问题。若 octto 不可用，落到原有 inferred-summary 路径（"this is an inferred draft, refine in the next lifecycle pass"），不阻塞。
- **`atlas-initializer` 推断质量不佳**：用户跑完后可继续用 `/atlas-refresh` 或手动 atlas-compiler 修正。Atlas 节点本身就支持后续 reconcile。
- **测试失败**：drift guard 测试会在 AGENTS.md 镜像与 orchestrator prompt 不一致时触发失败；这是工作流的一部分，按 lifecycle recovery loop 处理。

## Testing Strategy

### 单元测试

- `knowledge-bootstrap-orchestrator.test.ts`：断言 orchestrator prompt **不**含 `intent.pitch` / `intent.user` / `intent.shape` / `buildBootstrapQuestionPrompt` / `Pre-seeded answers`。
- `atlas-initializer.test.ts`：断言 prompt 含新增的"自行推断 intent"硬约束句。
- `agents-md-knowledge-bootstrap.test.ts`：AGENTS.md 镜像与 orchestrator prompt 同步。

### 集成测试

- `integration/knowledge-bootstrap-orchestrator.test.ts`：mock 一个跑 `/all-rebuild`，断言 octto.confirm 被调用但 octto.start_session 不被调用收集 intent；断言 spawn `atlas-initializer` 的 prompt 不含 "Pre-seeded answers"。

### 手动验收

1. 在本仓库（micode）worktree 上跑 `/all-rebuild`，确认只出现 octto.confirm 一道交互，不再出现三个 intent 问题。
2. 跑 `/all-init` 全缺失场景（清空 ARCHITECTURE.md/CODE_STYLE.md/.mindmodel/atlas/ 后），确认不再出现 intent 问卷。
3. 跑 `/atlas-init` 独立命令，确认行为未变（与之前一致：自决问询）。
4. 跑 `/all-status`，确认 read-only 行为未变。

## Open Questions

无。三个开放问题已在讨论阶段全部按默认确认：
1. `/all-rebuild` 覆盖 confirm：保留 ✓
2. `/all-init` 全缺失问卷：同步删除 ✓
3. `atlas-initializer` 硬约束句：写入 ✓
