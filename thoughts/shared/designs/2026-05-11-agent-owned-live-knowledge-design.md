---
date: 2026-05-11
topic: "Agent-Owned Live Knowledge: Atlas + Project Memory + Context Brief"
status: draft
---

# Agent-Owned Live Knowledge

## Problem Statement

micode 现有的知识系统在"维护方式"上偏离了用户预期：

- **Atlas vault** (`atlas/` markdown 节点) 被设计为"用户显式 `/atlas-refresh` 才合并"，结果在日常开发中长期落后于代码现实。
- **Project Memory** (SQLite 结构化记忆) 主写入路径是 `lifecycle_finish` 自动 promote ledger，相当于工具事后挖矿、agent 不主动沉淀。
- **子 agent**（implementer / reviewer）在 prompt 里被强制要求每次都 `project_memory_lookup` / `mindmodel_lookup`，并行批次中导致重复查询、重复环境检查、重复读已经被父层确认过的事实。
- **用户看不到** agent 到底有没有读知识、读了什么、有没有维护知识；当前终态只有一行 `Atlas status: ...` 太弱。

根因是把"知识维护"当成了工具职责，而不是开发产物职责。这导致两个长期病：

1. **知识陈旧**：项目演进，但 Atlas / Memory 滞后或失真，下次任务读到的是过期心智模型。
2. **协同浪费**：父子 agent 各自从零探索同一份事实，token 与时间被消耗在"再确认一遍"上，而不是真正的工程判断。

## Constraints

硬约束：

- 保留 `/atlas-refresh` `/atlas-status` `/atlas-init` `/atlas-translate` 入口，降级为辅助修复路径，不删除。
- 保留 `atlas-compiler` 与 `atlas-worker-*` 作为辅助批量整理工具，不在日常开发中作为主路径。
- `lifecycle_finish` 与任何 lifecycle hook **不允许** 自动写 `atlas/` 或 Project Memory vault。
- leaf agent (implementer-*、reviewer) **不直接** 写 Atlas，由 executor 统筹维护节点，避免并发冲突。
- byte-identical drift guards (commander + brainstormer effect-first、所有 agent Atlas 协议镜像、AGENTS.md 镜像) 必须同步更新。
- Mindmodel 工作方式不动，权威源仍是 `.mindmodel/architecture/coupling-reuse.md`，implementer / reviewer 仍可查 `mindmodel_lookup`。
- Atlas 仍为 Markdown / Obsidian vault；Project Memory 仍为 SQLite。底层存储不变。
- 保留 `project_memory_forget` 与 `project_memory_health` 用户入口。

软约束：

- 改动需要可分阶段灰度（先 brainstormer/planner，再 executor，再 leaf agent）。
- 不强制每个文件写入级别的实时刷新；以语义 checkpoint 为触发点。

## Approach

**核心范式：Agent 是知识维护者，工具是守门人。**

把 Atlas 与 Project Memory 的协议从"工具事后整理 / 用户显式合并"统一改为同一组动词：

```
Read   → 任务开始读相关节点 / 条目
Maintain → 在 checkpoint 主动写或更新节点 / 条目
Verify → reviewer 检查代码与节点是否一致
Report → 终态报告里说明读了什么、维护了什么
```

并引入两条配套协议：

1. **Context Brief**：父 agent 把已确认事实显式下传给子 agent，子 agent 默认信任、不重复查。
2. **本次知识上下文板块**：终态输出向用户暴露 agent 的知识活动，让维护行为可被审计。

工具的责任收窄到：

- 存储 (markdown 文件 + SQLite 表)
- 检索 (`atlas_lookup` / `project_memory_lookup` / `artifact_search`)
- 写锁与冲突保护 (`atlas/write-lock`, `atlas/staging`, `atlas/_meta/challenges`)
- 敏感数据过滤、去重、source 追踪
- 用户主动入口 (`/atlas-refresh`, `/atlas-status`, `/memory`)

工具不再 **主动决定** 哪些内容值得记住，也不再 **自动从 ledger 推断** decision。

## Architecture

四个改造层，每层有明确边界：

### 层 1：知识维护协议层

把 `ATLAS_MENTAL_MODEL_PROTOCOL` 字符串重写为 Read / Maintain / Verify / Report 四步；新增一份并行的 `PROJECT_MEMORY_PROTOCOL` 同构字符串。两份协议都注入到 brainstormer / planner / executor / reviewer / commander / octto。

### 层 2：父子协同层

在 `executor.ts` 新增 `<context-brief>` 协议块，规定 executor 给 implementer / reviewer spawn 时必须包含的已确认事实清单。implementer / reviewer prompt 改为"优先消费 context-brief，缺失/冲突再补查"。

### 层 3：用户感知层

在 commander / brainstormer / octto 的 `<effect-first-reporting>` 块前面（或"实现记录"段之内）固定新增 **本次知识上下文** 子段。`Atlas status` 行并入这个新段，不再单独占位。

### 层 4：工具收窄层

关闭 `lifecycle_finish` 中对 Project Memory 的自动 promote 触发（如果存在）；保留手动 promote 入口。`atlas-compiler` 与 `/atlas-refresh` 文档明确改为"辅助修复"。所有 lifecycle 边界测试同步更新。

## Components

### 1. 协议单源 (src/agents/atlas-mental-model.ts + 新文件 project-memory-protocol.ts)

- `ATLAS_MENTAL_MODEL_PROTOCOL` 重写为 Read / Maintain / Verify / Report。
- 新增 `PROJECT_MEMORY_PROTOCOL` 字符串，结构对称。
- 两份协议都说明：leaf agent 不主动写、只消费 context-brief。
- Atlas status 枚举扩展：consulted / read-only / maintained / verified / stale-detected / conflict / blocked / cannot-assess。
- 新增 Project Memory status 枚举：read-only / wrote-decision / wrote-lesson / wrote-risk / no-change / cannot-assess。

### 2. Context Brief 协议 (executor.ts)

executor 给 implementer / reviewer 派任务时 prompt 必须含：

```
<context-brief>
  <confirmed>
    - 环境/依赖/测试命令状态
    - 已读 Atlas 节点列表 + 关键摘要 (≤500 字, verbatim)
    - 已读 Project Memory 条目 (decision/lesson/risk) 摘要
    - 已读 Mindmodel 约束摘要
    - 相关 contract 路径
  </confirmed>
  <do-not-repeat>
    - 不要重复检查已确认环境
    - 不要重复 lookup 已传递的 memory/atlas 摘要
  </do-not-repeat>
  <must-still-verify>
    - 读取目标文件
    - 跑本任务验证命令
    - 发现 brief 与代码事实冲突必须 escalate
  </must-still-verify>
</context-brief>
```

### 3. Effect-First 新板块 (commander.ts + brainstormer.ts + octto.ts)

终态输出在"实现记录"段之前增加固定子段 **本次知识上下文**，限制 3-5 条 bullet：

```
## 本次知识上下文

- 读取：atlas/10-impl/executor.md, atlas/40-decisions/atlas-merge-policy.md, Project Memory entity=lifecycle-atlas-boundary
- 确认：依赖已安装、测试命令 bun test 可用、当前任务不涉及前端
- 关系:planner 的 Domain 决定 executor 路由；context-brief 在 spawn prompt 中替代子 agent 自查
- 维护:更新 atlas/10-impl/executor.md (context-brief 协议)，新增 Project Memory decision (agent-owned-knowledge)
- 传给子 agent:context-brief 含已确认环境 + 5 个 Atlas 节点摘要
```

Atlas status 与 Project Memory status 各占一行融入该段。

### 4. Leaf Agent Prompt 调整 (implementer*.ts + reviewer.ts)

- 删除 implementer / reviewer 中"MUST call project_memory_lookup"的强要求。
- 改写为"如果 spawn prompt 含 context-brief，直接使用；缺失或与代码冲突时再补查"。
- mindmodel_lookup 保留为可选项，子 agent 仍可独立查代码风格约束。
- reviewer 新增"检查代码改动后 Atlas / Memory 是否需要同步更新"的职责。

### 5. Lifecycle 边界 (src/lifecycle/* + tests/lifecycle/atlas-boundary.test.ts)

- 确认 `lifecycle_finish` 不调用 Project Memory promote (如已有自动路径要关掉)。
- 更新 `atlas-boundary.test.ts`：lifecycle 不写 vault 但允许 record artifact pointer。
- 新增 lifecycle artifact kind `delta` (如果协议需要) 或显式说明 delta 走 thoughts/ 不进 issue body。

### 6. 辅助入口降级 (src/atlas/commands.ts + atlas-compiler.ts)

- `/atlas-refresh` 文档改为"批量修复 / 历史整理 / 离线 reconcile"。
- `atlas-compiler` agent 描述改为"辅助批量整理"，不再暗示自动 spawn。
- `/atlas-status` 保留为健康检查入口，不变。

## Data Flow

```
用户请求
  ↓
primary agent (brainstormer/commander/octto)
  - Read: atlas_lookup + project_memory_lookup + mindmodel_lookup
  - 输出"本次知识上下文 - 读取"段
  ↓
brainstormer 设计阶段
  - 决策/取舍产生 → Maintain: 写 Project Memory decision
  - 行为规则变化 → Maintain: 更新 atlas/20-behavior 节点
  ↓
lifecycle_start_request → planner
  - Read: 同上
  - 拆任务时识别模块边界变化 → Maintain: 更新 atlas/10-impl
  - 写 contract 文件
  ↓
executor
  - Read: 任务相关 Atlas / Memory 节点
  - 为每个子 agent 准备 context-brief
  - spawn implementer (prompt 含 context-brief)
  ↓
implementer
  - 消费 context-brief
  - 实现代码 (不重复查 memory/atlas)
  - 报告: 是否发现 brief 与代码事实冲突
  ↓
reviewer
  - 消费 context-brief
  - Verify: 检查代码符合 contract + Atlas 节点 + decision
  - 发现 stale → 报告给 executor
  ↓
executor batch 完成
  - Maintain: 根据实现结果更新 atlas/10-impl
  - 如有新风险 → Maintain: 写 Project Memory risk
  ↓
lifecycle_finish (可选)
  - 不自动写 vault
  - 只记录 artifact pointers
  ↓
primary agent 终态输出
  - "本次知识上下文" 板块呈现给用户
  - Atlas status + Project Memory status 各一行
```

## Error Handling

| 异常情况 | 处理策略 |
|---|---|
| Atlas 节点已被人工编辑 (mtime 漂移 / `_meta` 标注) | agent 不覆盖，写 `atlas/_meta/challenges/` 记录建议变更 |
| 多个 agent 同 batch 试图改同节点 | executor 串行化 Atlas 写入；同 batch 内只允许 executor 自己写 |
| context-brief 与代码事实冲突 | 子 agent 必须 escalate (不静默执行)；executor 修 brief 或修代码 |
| context-brief 过大 | 硬限制总长 ≤4KB；超过则父层先压缩，仍超则拆分任务 |
| Project Memory 重复写入同主题 decision | 工具按 (entity, type, title) 去重，新版本标 superseded |
| reviewer 发现 Atlas stale 但本任务不修 | reviewer 在报告中标 `stale-detected`，由 executor 决定是否在本批次维护 |
| agent 跳过维护直接进 finish | drift guard 测试 + reviewer 检查双重防御；CI 失败 |
| lifecycle 误触发 vault 写入 | grep-based boundary 测试拦截，CI 失败 |

## Testing Strategy

- **协议完整性**：`tests/agents/atlas-mental-model.test.ts`、新增 `tests/agents/project-memory-protocol.test.ts`，检查 6 个主 agent 都注入新协议字符串。
- **byte-identity drift**：`tests/agents/effect-first-reporting.test.ts` 更新预期 (commander + brainstormer 仍 byte-identical，含新"本次知识上下文"段)。
- **context-brief 注入**：新增测试，验证 executor prompt 含 `<context-brief>` 块且 implementer/reviewer prompt 含"优先消费"规则。
- **leaf 不主动写 Atlas**：新增 grep 测试，禁止 implementer / reviewer prompt 含"call atlas write"或"修改 atlas/"。
- **leaf 默认不查 Memory**：grep 测试，禁止 implementer / reviewer prompt 含"MUST call project_memory_lookup"。
- **lifecycle 边界**：`tests/lifecycle/atlas-boundary.test.ts` 扩展到 Project Memory：禁止 `src/lifecycle/*` 依赖 Project Memory promote。
- **场景集成**：手动跑 5 个场景：开新任务、设计决策、executor batch、父子协同、终态输出，验证用户可见输出含"本次知识上下文"。

## Open Questions

- **Atlas checkpoint 触发的具体时机**：每个 batch 一次？每个决策一次？每个 reviewer 通过一次？倾向"每个稳定 checkpoint" = batch 完成 + reviewer 通过。
- **context-brief 内容是否需要结构化 schema**：当前用 markdown / XML 标签即可；如果出现解析需求再升级。
- **reviewer 发现 Atlas stale 时应该 fail 还是 warn**：默认 warn 进入 report，让 executor 决定；高风险节点 (40-decisions / 50-risks) 升级为 fail。
- **implementer 是否完全禁查 Project Memory**：倾向"默认不查、特殊例外可查"，例外通过 spawn prompt 显式开放。
- **Mindmodel 是否同步升级为 agent 主动维护**：本设计不动 Mindmodel，但留为下一期开放问题。
- **delta 文件机制是否完全废弃**：保留作为"agent 不能直接修改人工编辑节点时"的 fallback，不再作为主路径。

## Phased Rollout

为降低 regression 风险，分四个阶段实施：

### 阶段 1：协议改写 + 用户感知

- 改写 `ATLAS_MENTAL_MODEL_PROTOCOL` 为 Read/Maintain/Verify/Report
- 新增 `PROJECT_MEMORY_PROTOCOL` 同构字符串
- 在 commander + brainstormer + octto 的 effect-first 增加 **本次知识上下文** 段
- 更新 drift guard 测试 (byte-identity)

### 阶段 2：Context Brief 协议

- 在 executor.ts 新增 `<context-brief>` 块
- implementer / reviewer prompt 改为"优先消费 brief"
- 删除 implementer / reviewer 中强制 `project_memory_lookup` 要求
- 新增 context-brief 注入测试

### 阶段 3:一致性闭环

- reviewer 增加 Atlas/Memory 一致性检查职责
- atlas-compiler 与 `/atlas-refresh` 文档降级
- 关闭 lifecycle 自动 promote (如有)
- 更新 lifecycle 边界测试

### 阶段 4:测试 + 文档同步

- 跑完整 5 个场景集成测试
- 同步 AGENTS.md 镜像 (Atlas Shared Mental Model + 新增 Project Memory 主动维护段)
- 同步 `src/agents/atlas-mental-model.ts` 单源
- 更新 `~/.config/opencode/AGENTS.md` 全局策略中关于 Project Memory 写入规则的描述
