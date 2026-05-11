---
date: 2026-05-12
topic: "Knowledge Bootstrap Orchestrator Commands: /all-init /all-rebuild /all-status"
status: draft
---

# Knowledge Bootstrap Orchestrator Commands

## Problem Statement

micode 已有三个独立命令分别处理三层知识库：

- `/init` → `ARCHITECTURE.md` + `CODE_STYLE.md`
- `/mindmodel` → `.mindmodel/` 编码规范
- `/atlas-init` → `atlas/` 项目心智模型 vault

对于新接入 micode 工作流的项目，用户必须记住三个命令、按正确顺序跑、自己判断哪个有哪个没有。这对接入门槛和日常体检都是摩擦。

我们要新增一组 orchestrator 命令，把"建立 / 大更新 / 体检"三层知识库统一成单一入口：

- `/all-init` 一键智能补齐缺失部分
- `/all-rebuild` 一键大更新（覆盖式）
- `/all-status` 一键体检

这套命令应该尊重以下原则：

1. **零参数**：opencode slash command 没有 tab 补全，参数式 UX 反人类，必须每模式独立命令。
2. **复用而非重写**：内部串联现有的 `project-initializer` / `mm-orchestrator` / `atlas-initializer`，不重写子命令实现。
3. **沿用 agent-owned 知识协议**：输出含"本次知识上下文"板块（issue #63 落地的设计）。
4. **统一问卷**：octto 问题在开头一次性问，三阶段复用。
5. **覆盖式操作显式**：`/all-rebuild` 必须 confirm，列出会被覆盖的文件。

## Constraints

硬约束：

- 保留 `/init` `/mindmodel` `/atlas-init` `/atlas-status` `/atlas-refresh` 独立入口，新命令不替换。
- 不引入命令参数（零参数策略）。
- 不并发执行三个子命令，串行保证 ARCHITECTURE.md → mindmodel → atlas 的依赖顺序。
- 中间步骤失败不回滚已完成步骤，与现有 `/atlas-init` 失败行为一致。
- `/all-rebuild` 必须显式 confirm 才能执行覆盖。
- Project Memory 仍由 agent 主动维护，新命令不批量 promote。
- 命名沿用现有 `/init` `/atlas-init` `/atlas-status` 命名风格，便于记忆。
- 沿用 issue #63 落地的"本次知识上下文"输出板块。

软约束：

- `/all-status` 应该轻量，可以在频繁场景跑，不调 octto。
- octto 问卷应该有 fallback：无 octto 时用默认答案。

## Approach

新增一个 **knowledge-bootstrap-orchestrator** agent，对外暴露三个独立 slash command 入口：

- `/all-init` → orchestrator with mode=`missing-only`
- `/all-rebuild` → orchestrator with mode=`refresh-all`
- `/all-status` → orchestrator with mode=`status-only`

orchestrator 内部按模式选择执行路径：

```
mode=missing-only:
  detect three layers
  for each missing layer:
    spawn child orchestrator (project-initializer / mm-orchestrator / atlas-initializer)
  output "本次知识上下文"

mode=refresh-all:
  detect three layers + list files to overwrite
  confirm via octto
  if confirmed:
    spawn all three child orchestrators with force-rebuild semantics
  output "本次知识上下文"

mode=status-only:
  detect three layers
  call existing /atlas-status logic
  call project_memory_health
  read-only summary output
```

octto 问卷集中在 orchestrator 入口收集，下传给 atlas-initializer。

## Architecture

四层组件：

### 1. 命令注册层

在 `src/index.ts` 的 `PLUGIN_COMMANDS` 注册三个新命令，agent 路由全部指向 `knowledge-bootstrap-orchestrator`。但 orchestrator 需要知道用户用了哪个命令。这通过 prompt template 传入命令名实现，参考现有 PLUGIN_COMMANDS 的 prompt 字段。

### 2. Orchestrator Agent

新增 `src/agents/knowledge-bootstrap-orchestrator.ts`，导出 `definition` 注册到 `src/agents/index.ts`。

orchestrator 接收命令名（`/all-init` / `/all-rebuild` / `/all-status`），决定 mode 并执行对应路径。

### 3. 状态检测器

新增 `src/tools/knowledge-bootstrap/detect.ts`，导出 `detectKnowledgeState(projectRoot)`：

```typescript
type LayerState = "missing" | "present" | "unknown";
interface KnowledgeState {
  init: LayerState;       // ARCHITECTURE.md + CODE_STYLE.md
  mindmodel: LayerState;  // .mindmodel/manifest.yaml
  atlas: LayerState;      // atlas/00-index.md
  projectMemory: { entries: number; healthy: boolean };
}
```

orchestrator 通过这个工具一次性获取三层状态，省得重复探测。

### 4. 子命令复用层

orchestrator 调用以下现有能力：

- `runAtlasInit` from `src/tools/atlas/init.ts`（支持 `fresh` / `force-rebuild` 模式）
- `runAtlasStatus` from `src/tools/atlas/status.ts`
- `project_memory_health` tool（已存在）
- `spawn_agent("project-initializer", ...)` 触发 `/init` 流程
- `spawn_agent("mm-orchestrator", ...)` 触发 `/mindmodel` 流程

## Components

### 1. 命令注册（`src/index.ts`）

在 `PLUGIN_COMMANDS` 中添加：

```
/all-init    → agent: knowledge-bootstrap-orchestrator, prompt: 描述 missing-only 模式
/all-rebuild → agent: knowledge-bootstrap-orchestrator, prompt: 描述 refresh-all 模式
/all-status  → agent: knowledge-bootstrap-orchestrator, prompt: 描述 status-only 模式
```

每个 command 的 prompt 显式告诉 orchestrator 当前是哪个模式。

### 2. Orchestrator Agent（`src/agents/knowledge-bootstrap-orchestrator.ts`）

prompt 结构：

```
<identity>知识库 bootstrap orchestrator，串联 init/mindmodel/atlas-init 三层</identity>

<mode-handling>
  根据用户调用的命令决定模式：
  - /all-init → missing-only
  - /all-rebuild → refresh-all
  - /all-status → status-only
</mode-handling>

<process>
  Step 1: 调 detect_knowledge_state 一次性获取三层状态
  Step 2: 按模式分发：
    missing-only:
      - 全有: 提示用 /all-rebuild
      - 部分缺失: 顺序 spawn 缺失部分对应的 agent
      - 全缺失: 顺序 spawn 三个 agent
    refresh-all:
      - 收集 octto 问卷答案（统一）
      - 列出会被覆盖的文件，confirm
      - 顺序 spawn 三个 agent，每个用 force-rebuild 语义
    status-only:
      - 调 detect 工具
      - 调 atlas-status
      - 调 project_memory_health
      - 不写文件
  Step 3: 输出"本次知识上下文"板块
</process>

<octto-questionnaire>
  refresh-all / missing-only(全缺失) 时，开头一次性问完所有问题
  /atlas-init 阶段的问题（项目命名、领域、用户群）在 orchestrator 入口收集
  下传给 atlas-initializer
</octto-questionnaire>

<atlas-protocol> ATLAS_MENTAL_MODEL_PROTOCOL 注入 </atlas-protocol>
<knowledge-context-section> KNOWLEDGE_CONTEXT_SECTION 注入 </knowledge-context-section>
```

### 3. 状态检测工具（`src/tools/knowledge-bootstrap/detect.ts`）

```typescript
export interface KnowledgeState {
  init: LayerState;
  mindmodel: LayerState;
  atlas: LayerState;
  projectMemory: { entries: number; healthy: boolean };
  files: {
    architectureMd: { exists: boolean; mtime?: Date };
    codeStyleMd: { exists: boolean; mtime?: Date };
    mindmodelManifest: { exists: boolean; mtime?: Date };
    atlasIndex: { exists: boolean; mtime?: Date };
  };
}

export function detectKnowledgeState(projectRoot: string): KnowledgeState;
```

注册为 tool 供 orchestrator 调用。

### 4. 问卷收集器（`src/tools/knowledge-bootstrap/questionnaire.ts`）

把 `src/atlas/cold-init/questions.ts` 的问题收集器抽象一层，让 orchestrator 在入口调一次，结果同时供 `atlas-initializer` 使用。

```typescript
export interface BootstrapAnswers {
  atlas: ColdInitAnswers; // 复用现有
}

export function collectBootstrapAnswers(deps: BootstrapDeps): Promise<BootstrapAnswers>;
```

### 5. Status 报告器（`src/tools/knowledge-bootstrap/status.ts`）

聚合三层状态 + Project Memory 健康度为单一报告：

```typescript
export function renderBootstrapStatus(state: KnowledgeState, atlasStatus: AtlasStatusResult): string;
```

输出 markdown 报告，包含：

- 三层是否存在
- 每个文件的 mtime（陈旧度）
- atlas/_meta/challenges 数量
- Project Memory 条目数 + 健康
- 推荐动作（"全有，可考虑 `/all-rebuild`"等）

## Data Flow

```
用户输入 /all-init
  ↓
PLUGIN_COMMANDS 路由到 knowledge-bootstrap-orchestrator
  ↓
orchestrator prompt 包含 mode=missing-only
  ↓
orchestrator 调 detect_knowledge_state → KnowledgeState
  ↓
分析状态：
  - 全有 → 输出提示，建议用 /all-rebuild → END
  - 部分缺失 → 进入串行 spawn
  - 全缺失 → 收集 octto 答案，进入串行 spawn
  ↓
spawn project-initializer (if init missing)
  ↓ 等待完成
spawn mm-orchestrator (if mindmodel missing)
  ↓ 等待完成
spawn atlas-initializer (if atlas missing) with octto answers prefilled
  ↓ 等待完成
聚合所有阶段结果
  ↓
输出"本次知识上下文"板块：
  - 读取：detect_knowledge_state 结果
  - 维护：本次新建的三层
  - 关系：三层之间的依赖
```

`/all-rebuild` 数据流类似，但：

- 开头额外 confirm 步骤
- 每个 spawn 都传 force-rebuild 语义
- 所有三层都跑（不检测缺失）

`/all-status` 数据流：

```
用户输入 /all-status
  ↓
orchestrator with mode=status-only
  ↓
detect_knowledge_state + runAtlasStatus + project_memory_health
  ↓
renderBootstrapStatus 聚合
  ↓
输出报告（不写任何文件）
```

## Error Handling

| 异常 | 处理 |
|---|---|
| `/all-init` 三层都已存在 | 输出友好提示 + 建议 `/all-rebuild`，不报错 |
| 任一子 agent 失败 | 停在失败步骤，已完成部分保留；用户可复跑 `/all-init` 智能补齐继续 |
| octto 问卷失败 | 用默认值继续，并 warn 用户 |
| `/all-rebuild` confirm 拒绝 | 优雅退出，不动任何文件 |
| 检测器读文件权限错误 | LayerState=`unknown`，orchestrator 提示用户检查权限并退出 |
| `/all-status` 在 Project Memory 工具不可用时 | 输出 N/A，不影响其他三层报告 |

## Testing Strategy

- **状态检测**：`tests/tools/knowledge-bootstrap/detect.test.ts` 覆盖三层各种存在 / 缺失组合
- **命令注册**：`tests/commands/all-init.test.ts` 等三个命令 drift guard，确保 PLUGIN_COMMANDS 含新命令
- **orchestrator prompt**：`tests/agents/knowledge-bootstrap-orchestrator.test.ts` 测试 prompt 含 mode-handling、process、octto-questionnaire 块
- **集成**：在 fixture 项目跑全流程
  - 全空 + `/all-init`：三层都建
  - 部分有 + `/all-init`：只补缺失
  - 全有 + `/all-init`：友好退出
  - 全有 + `/all-rebuild`：confirm 后覆盖
  - 任意 + `/all-status`：只读输出
- **agent-owned 知识协议合规**：orchestrator 输出含"本次知识上下文"板块（沿用 issue #63 测试）
- **AGENTS.md 镜像**：drift test 检查三命令在 AGENTS.md 中描述一致

## Open Questions

- **`/all-status` 是否调 atlas-compiler 的健康度检查**：当前 `/atlas-status` 已经够用，不调 compiler。
- **`/all-rebuild` 是否备份覆盖前的文件到 `thoughts/`**：默认不备份（用户应该靠 git）；后续可加 `--backup` 但本次先不做。
- **是否做 `/all-refresh`**：本次不做，让用户用 `/atlas-refresh` 局部刷新。
- **Project Memory 是否在 `/all-init` 时初始化**：不需要，Project Memory 自动按需创建表。
- **orchestrator 是 primary agent 还是 subagent**：作为 primary agent 直接路由（参考 mm-orchestrator）。

## Phased Rollout

### 阶段 1：状态检测 + 报告器

- 新增 `src/tools/knowledge-bootstrap/detect.ts`
- 新增 `src/tools/knowledge-bootstrap/status.ts`
- 注册 `detect_knowledge_state` 工具
- 单元测试覆盖各种文件存在组合

### 阶段 2：Orchestrator Agent

- 新增 `src/agents/knowledge-bootstrap-orchestrator.ts`
- 注册到 `src/agents/index.ts`
- prompt 含 mode-handling、process、octto-questionnaire、atlas-protocol、knowledge-context-section
- orchestrator drift test

### 阶段 3：三个命令注册

- 在 `src/index.ts` PLUGIN_COMMANDS 添加 `/all-init` `/all-rebuild` `/all-status`
- 每个命令 prompt 显式注入对应模式
- 命令注册 drift test

### 阶段 4：问卷复用 + 集成测试

- 抽象 `src/tools/knowledge-bootstrap/questionnaire.ts`
- atlas-initializer 接受外部传入的 octto 答案
- fixture 集成测试 5 个场景
- AGENTS.md 镜像同步
- 项目级 AGENTS.md 新增三命令描述
