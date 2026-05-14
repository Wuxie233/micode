---
date: 2026-05-13
topic: "micode 轻量 BDD 防漂移层"
issue: 69
scope: agents
contract: none
---

# micode 轻量 BDD 防漂移层 Implementation Plan

**Goal:** 给 micode 5 阶段工作流（brainstorm / planner / executor / reviewer / 终态汇报）加入轻量 BDD 防漂移层，把"用户可见行为承诺"落到 design.md `## Behavior` 段并贯穿到 plan / context-brief / reviewer findings / effect-first 汇报。

**Architecture:** 全 prompt-only 改动：在已有 6 个 agent prompt（brainstormer / commander / planner / executor / reviewer / octto 不动）和 AGENTS.md 中各插入一段 BDD 协议片段；不引入新工具、不改 Atlas / Project Memory schema、不动 lifecycle 代码。drift-guard 仅更新 brainstormer ↔ commander 的 effect-first-reporting byte-identical 镜像。

**Design:** [thoughts/shared/designs/2026-05-13-micode-bdd-behavior-layer-design.md](../designs/2026-05-13-micode-bdd-behavior-layer-design.md)

**Contract:** none（全部为 prompt / docs 改动，无 frontend ↔ backend 接口面）

---

## 行为承诺映射

design.md `## Behavior` 段列出 7 条行为承诺，本 plan 拆分如下（本 plan 是 BDD 机制自身的 dogfooding 示范）：

- **行为 1**（brainstormer 在 finalizing 主动产出 `## Behavior` 段 + `atlas_lookup` 关联）→ 由 **Task 1.1**（brainstormer.ts 模板加 `## Behavior` 段、finalizing phase 加产出规则、ATLAS Maintain 注入点附近加规则）实现；由 **Task 2.1**（behavior-layer.test.ts）grep 验证。
- **行为 2**（planner 在 plan.md 开头自动产出 `## 行为承诺映射` 段，漏覆盖时显式说明理由）→ 由 **Task 1.3**（planner.ts skeleton-template 加段、output-format 加规则）实现；由 **Task 2.1** grep 验证。
- **行为 3**（executor context-brief 含行为指向 + batch reviewer 通过后主动 Maintain atlas/20-behavior）→ 由 **Task 1.4**（executor.ts mandatory-spawn-block 加行为指向行、atlas-propagation 加 batch checkpoint Maintain 规则）实现；由 **Task 2.1** grep 验证。
- **行为 4**（reviewer Findings 加「行为一致性」子项，发现明显漂移时自动判断 promote lesson；verdict 仍单独最后一行）→ 由 **Task 1.5**（reviewer.ts output-format / checklist 加「行为一致性」子项规则，knowledge-detect-role 加 behavior-drift lesson promote 规则）实现；由 **Task 2.1** grep 验证；final-marker-rule 不动由现有 `effect-first-reporting.test.ts` placement 守护。
- **行为 5**（终态汇报「预期表现」/「你可以怎么验收」与 `## Behavior` 段语义一致；`Atlas status` / `Project Memory status` 两行如实反映自动维护）→ 由 **Task 1.1**（brainstormer.ts `<effect-first-reporting>` 块内加对齐规则）+ **Task 1.2**（commander.ts byte-identical 镜像同步）实现；由 **Task 2.1** grep 验证 + 现有 `tests/agents/effect-first-reporting.test.ts` 的 byte-identical drift-guard 保证镜像不漂移。
- **行为 6**（用户从不直接编辑 atlas / PM / thoughts/，通过对话指令让 agent 修改）→ 由 **Task 1.6**（AGENTS.md 加 `## Behavior 段约定` 一节，明确"全 agent 驱动 + 用户角色"）实现；由 **Task 2.1** grep 验证。
- **行为 7**（验收：开下一个新任务看 brainstormer / planner / reviewer / 终态汇报是否自然产出 BDD 工件）→ 验证手段，不需要 task。本 plan 落地后由用户开新任务 dogfood 验收，对应 design.md `## Testing Strategy` 段「验收（dogfooding）」检查清单。

**未对应任何 task 的行为**：无。所有 6 条「机制类」行为都有对应 task；行为 7 是验证手段。

> Atlas 关联：本 plan 落地后将更新 `atlas/20-behavior/brainstorm-plan-implement-workflow` 节点（追加 BDD 防漂移机制描述），并可能新建 `atlas/40-decisions/bdd-behavior-layer` 节点。Atlas 维护由 executor 在每个 batch reviewer 通过后判断是否需要 Maintain。

---

## Dependency Graph

```
Batch 1 (parallel, 6 tasks): 1.1, 1.2, 1.3, 1.4, 1.5, 1.6 [prompt + docs edits - 各自独立文件，无导入依赖；1.1 与 1.2 必须产出 byte-identical 的 <effect-first-reporting> 块]
Batch 2 (parallel, 2 tasks): 2.1, 2.2 [测试 - 依赖 Batch 1 全部完成]
```

**Batch 1 ↔ Batch 2 依赖说明**：所有 Batch 2 测试 grep / 断言 Batch 1 的 prompt 改动落地，所以 Batch 1 必须先全部完成。Batch 1 内部 6 个 task 互不导入互不依赖（同改一个仓库的不同文件），可完全并行。1.1 / 1.2 的 byte-identical 协调通过本 plan 在两个 task 内嵌入相同的目标字符串完成（不是运行时依赖，是规约对齐），由现有 `tests/agents/effect-first-reporting.test.ts` 持续守护。

---

## Batch 1: Prompt + Docs Edits (parallel - 6 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6

**Cross-task 协调（仅 1.1 ↔ 1.2）**：1.1 与 1.2 都修改 `<effect-first-reporting>` 块；它们必须插入字面上完全相同的对齐规则文本（drift-guard `effect-first-reporting.test.ts` 强制 byte-identical）。本 plan 给两个 task 提供同一份"目标插入文本"，两个 implementer 各自把它落到自己负责的文件。

### Task 1.1: brainstormer.ts — `## Behavior` 段产出 + effect-first 对齐 + Atlas Maintain 注入
**File:** `src/agents/brainstormer.ts`
**Test:** `tests/agents/behavior-layer.test.ts` (新增；同时由 Task 2.1 在 Batch 2 落地完整断言；本 task 仅需让 prompt 字符串落地)
**Depends:** none
**Domain:** general
**Atlas-impact:** none

#### 改动概述（4 个插入点）

1. **`<output-format>` `<sections>` 列表末尾**（当前在文件第 588-598 行，9 个 `<section>` 标签后）：追加第 10 个可选 section 描述 `## Behavior` 段约定。
2. **`<phase name="finalizing">`**（当前在第 404 行）：在 `<action>Write validated design ...</action>` 之前追加一条 `<action>` 描述「produce `## Behavior` 段」+ 紧随其后追加一条 `<action>` 描述「写完后调 `atlas_lookup` 评估对应 atlas/20-behavior 节点关联，并在 design.md 末尾用一行自然语言注明 Atlas 关联」。同时增加 `<rule>` 描述何时可省略整段（quick-mode / 运维 / executor-direct / 用户显式跳过）。
3. **`<effect-first-reporting>` 块**（第 536-576 行）：在 `<structure>` 内部 `<section name="预期表现">` 与 `<section name="你可以怎么验收">` 各自描述末尾追加一句对齐规则；在 `<relationship-to-other-rules>` 之前插入一个新 `<behavior-alignment>` 子块，描述「如果 design.md 有 `## Behavior` 段则两段必须与之语义一致」。**关键**：本块改动必须与 Task 1.2 改动 commander.ts 的对应块产出 byte-identical 文本（`tests/agents/effect-first-reporting.test.ts` 的 drift-guard 强制）。
4. **`${ATLAS_MENTAL_MODEL_PROTOCOL}` 模板字面量注入点附近**（第 578 行）：紧跟在 `${ATLAS_MENTAL_MODEL_PROTOCOL}` 之后、`${PROJECT_MEMORY_PROTOCOL}` 之前（即 578-580 行之间），插入一个新顶级 XML 块 `<behavior-section-maintenance>`，描述「brainstormer 在 finalizing 写完 `## Behavior` 段后立即 `atlas_lookup` 评估关联；属于架构层级行为决策时调 `project_memory_promote` decision」。不替换协议注入字符串本身（保持 ATLAS_MENTAL_MODEL_PROTOCOL / PROJECT_MEMORY_PROTOCOL drift-guard 不破）。

#### 目标插入文本（Task 1.1 ↔ 1.2 共享 effect-first 段）

下面这段 `<behavior-alignment>` 子块必须在 Task 1.1 的 brainstormer.ts 与 Task 1.2 的 commander.ts 中字面完全相同（不含前后空白差异）。插入位置：`<exceptions>` 块之后、`<relationship-to-other-rules>` 块之前。

```xml
<behavior-alignment description="Align user-visible report with design.md ## Behavior section">
<rule>如果当前任务有对应的 design.md 且该 design 含 `## Behavior` 段：「预期表现」段应与 `## Behavior` 列出的用户可见行为语义一致；「你可以怎么验收」段应至少包含 `## Behavior` 段提到的验收方式。</rule>
<rule>没有 design.md 或没有 `## Behavior` 段时按常规生成；不强行编造行为承诺。</rule>
<rule>不在终态汇报里新增 `Scenario coverage: N/M` 状态行或类似仪表盘字段；五段结构不变。</rule>
<rule>本对齐属于内容生成规则，不引入新 section 标题，不破坏 byte-identical drift-guard。</rule>
</behavior-alignment>
```

#### 目标插入文本（Task 1.1 独占：finalizing 与 sections）

`<output-format>` `<sections>` 末尾追加：

```xml
<section name="Behavior" optional="true">用户视角的可见行为承诺与验收方式。自由格式（bullet / 段落均可）。quick-mode / 运维 / executor-direct / 用户显式跳过 时可整段省略。写完立即 `atlas_lookup` 评估对应 atlas/20-behavior 节点关联，在段末用一行自然语言注明（不引入 frontmatter `atlas_target` 字段）。</section>
```

`<phase name="finalizing">` 块内（在现有 `<action>Write validated design ...</action>` 之前）追加：

```xml
<action priority="high">在写 design.md 之前，先产出第 10 个可选段 `## Behavior`：用自由格式列出本次需求的用户可见行为承诺与验收方式。quick-mode / 运维 / executor-direct / 用户显式说"跳过" 时可整段省略。</action>
<action>写完 `## Behavior` 段后立即调 `atlas_lookup` 评估关联的 atlas/20-behavior 节点；在 design.md 末尾用一句自然语言注明关联（例："Atlas 关联：本次行为对应 atlas/20-behavior/<node-slug>，由 executor 在 batch 完成后做实际节点更新"）。</action>
<rule>`## Behavior` 段是可选的：quick-mode / 运维 / executor-direct / 用户显式跳过时可整段省略，brainstormer 不被阻塞。</rule>
<rule>不强制结构化场景 / 不强制 Gherkin / 不强制 ID / 不强制字数；自由格式即可。</rule>
```

`${ATLAS_MENTAL_MODEL_PROTOCOL}` 与 `${PROJECT_MEMORY_PROTOCOL}` 模板字面量之间（不替换两个协议字符串本身）插入：

```xml
<behavior-section-maintenance priority="high" description="BDD 防漂移层：brainstormer 在 finalizing 产出 ## Behavior 段后的 Atlas/PM 维护">
<rule>brainstormer 写完 design.md `## Behavior` 段后，立即 `atlas_lookup` 评估对应 atlas/20-behavior 节点（is-related / is-revision / not-found）；不直接改 atlas 文件，只在 design.md 末尾用一行自然语言注明关联。</rule>
<rule>当本次需求属于"架构层级长期行为决策"（满足 ATLAS_MENTAL_MODEL_PROTOCOL Maintain 准则任一条件）时，调 `project_memory_promote` 写一条 type=decision，entity_name 用 design 主题 slug，source_kind=design，pointer 指向 design.md 路径。</rule>
<rule>用户从不直接编辑 atlas/ / Project Memory SQLite / thoughts/ 文件；想改时跟 brainstormer 说，brainstormer 完成实际修改。</rule>
<rule>本块挂到现有 ATLAS_MENTAL_MODEL_PROTOCOL Maintain 步骤与 PROJECT_MEMORY_PROTOCOL Maintain 步骤上，不引入新协议块。</rule>
</behavior-section-maintenance>
```

#### Verify

- `bun test tests/agents/behavior-layer.test.ts` — 由 Task 2.1 提供完整断言；本 task 内 implementer 至少在 implementation 完成后 grep 一下确认插入字符串落地：
  ```sh
  grep -F '<behavior-alignment description="Align user-visible report with design.md ## Behavior section">' src/agents/brainstormer.ts
  grep -F '<behavior-section-maintenance priority="high"' src/agents/brainstormer.ts
  grep -F '<section name="Behavior" optional="true">' src/agents/brainstormer.ts
  ```
- `bun test tests/agents/effect-first-reporting.test.ts` — 必须仍然通过（Task 1.2 同步后才能通过；本 task 单独跑可能 byte-identical fail，正常）
- `bun test tests/agents/atlas-protocol-injection.test.ts` 与 `tests/agents/project-memory-protocol.test.ts` — 必须通过（确认未破坏协议注入）

**Commit:** `feat(agents): brainstormer 加入 BDD 防漂移层（## Behavior 段、finalizing 产出规则、effect-first 行为对齐、Atlas/PM 维护规则）`

---

### Task 1.2: commander.ts — effect-first 对齐镜像（byte-identical with brainstormer）
**File:** `src/agents/commander.ts`
**Test:** `tests/agents/effect-first-reporting.test.ts`（既有 drift-guard；Task 1.1 与 1.2 都落地后通过）
**Depends:** none
**Domain:** general
**Atlas-impact:** none

#### 改动概述

commander.ts 的 `<effect-first-reporting>` 块必须与 brainstormer.ts 的对应块 byte-identical。本 task 只做一件事：把 Task 1.1 给出的 **完全相同** 的 `<behavior-alignment>` 子块插到 commander.ts `<effect-first-reporting>` 内 `<exceptions>` 块之后、`<relationship-to-other-rules>` 块之前。

不动 commander.ts 其它任何部分。

#### 目标插入文本（与 Task 1.1 字面完全相同）

```xml
<behavior-alignment description="Align user-visible report with design.md ## Behavior section">
<rule>如果当前任务有对应的 design.md 且该 design 含 `## Behavior` 段：「预期表现」段应与 `## Behavior` 列出的用户可见行为语义一致；「你可以怎么验收」段应至少包含 `## Behavior` 段提到的验收方式。</rule>
<rule>没有 design.md 或没有 `## Behavior` 段时按常规生成；不强行编造行为承诺。</rule>
<rule>不在终态汇报里新增 `Scenario coverage: N/M` 状态行或类似仪表盘字段；五段结构不变。</rule>
<rule>本对齐属于内容生成规则，不引入新 section 标题，不破坏 byte-identical drift-guard。</rule>
</behavior-alignment>
```

#### Implementer 注意事项

- 用 Edit 工具，oldString 必须包含 `</exceptions>` 与紧随的换行 + `<relationship-to-other-rules>` 起始行，确保只在 commander.ts 的 `<effect-first-reporting>` 块内匹配一次（commander.ts 整文件只有一处 `<exceptions>` 块在该位置）。
- 落地后 grep 验证：`diff <(grep -A 999 '<effect-first-reporting' src/agents/brainstormer.ts | sed -n '/<\\/effect-first-reporting>/q;p') <(grep -A 999 '<effect-first-reporting' src/agents/commander.ts | sed -n '/<\\/effect-first-reporting>/q;p')` 应当无差异输出。

#### Verify

- `bun test tests/agents/effect-first-reporting.test.ts` — 必须通过（特别是 `drift guard: commander and brainstormer effect-first blocks are byte-identical`）
- `bun test tests/agents/specialist-routing.test.ts` — 必须通过（确认未破坏其它 commander drift-guard）

**Commit:** `feat(agents): commander effect-first 镜像同步 BDD 行为对齐规则（byte-identical with brainstormer）`

---

### Task 1.3: planner.ts — plan.md `## 行为承诺映射` 段 + 主动 atlas_lookup 规则
**File:** `src/agents/planner.ts`
**Test:** `tests/agents/behavior-layer.test.ts` (由 Task 2.1 提供完整断言)
**Depends:** none
**Domain:** general
**Atlas-impact:** none

#### 改动概述（3 个插入点）

1. **`<skeleton-template>` 块**（当前在第 404-433 行附近）：在 `**Contract:** ...` 行之后、`---\n\n## Dependency Graph` 之前，新增一段 markdown 模板片段 `## 行为承诺映射`，作为 plan.md 文件开头新段（plan 文件层面位置：在 Goal/Architecture/Design/Contract 头之后、Dependency Graph 之前）。
2. **`<output-format>` `<frontmatter-rules>` 之后、`<skeleton-template>` 之前**：新增一个 `<behavior-mapping-rules>` XML 块，描述「planner 必须在 plan.md 开头产出 `## 行为承诺映射` 段，每条 design.md ## Behavior 对应到具体 task 或显式说明为什么没对应」。
3. **`<process>` `<phase name="understand-design">`**（已有读取 design 与 mindmodel_lookup 的步骤）：追加一条 `<action>` 描述「读完 design 后立即 `atlas_lookup` 查相关 atlas/20-behavior 节点，作为拆 task 时避免遗漏现有约束的参考」。

#### 目标插入文本

`<skeleton-template>` 内，在 `**Contract:** \`thoughts/shared/plans/YYYY-MM-DD-{topic}-contract.md\` ...` 行之后、第一处 `---` 之前插入：

```markdown
---

## 行为承诺映射

design.md `## Behavior` 段列出 N 条行为承诺：

- 行为 1（<一句话引用 Behavior 段第 1 条>）→ 由 Batch X Task X.Y 实现；由 Batch Z Task Z.W 验证
- 行为 2（<...>）→ 由 Batch X Task X.Y 实现
- 行为 K（<...>）→ 不需要 task，因为 <理由：如"是验证手段"/"已被现有机制覆盖"/"quick-mode 不受影响">

**未对应任何 task 的行为**：<列出或写"无">；如有未对应行为，必须显式给出理由。

> 如果 design.md 没有 `## Behavior` 段（quick-mode / 运维 / executor-direct / 用户显式跳过），本段写 "本任务无 design.md `## Behavior` 段，跳过映射" 即可。
```

`<output-format>` 内、`<frontmatter-rules>` 块之后、`<skeleton-template>` 块之前插入：

```xml
<behavior-mapping-rules priority="critical" description="BDD 防漂移层：plan.md 必须在文件开头含 ## 行为承诺映射 段">
<rule>当 design.md 含 `## Behavior` 段时，plan.md 必须在文件开头（在 Dependency Graph 之前）产出 `## 行为承诺映射` 段。</rule>
<rule>映射用自然语言列表：每条 Behavior → 对应 task；漏覆盖的 Behavior 必须显式说明理由（不阻塞 plan 生成）。</rule>
<rule>映射不强制结构化字段：不引入 `Covers:` task 字段，不引入覆盖矩阵自检；自然语言映射即可，由用户读 plan 时发现遗漏并要求 agent 补 task。</rule>
<rule>当 design.md 没有 `## Behavior` 段时，本段写一句话说明跳过即可（"本任务无 design.md `## Behavior` 段，跳过映射"）。</rule>
<rule>本段是 plan 文件级新增内容，不动 task 节点字段（File / Test / Depends / Domain / Atlas-impact 保持不变）。</rule>
</behavior-mapping-rules>
```

`<phase name="understand-design">`（在现有 action 列表末尾追加）：

```xml
<action>读完 design 后，如果 design 含 `## Behavior` 段，立即 `atlas_lookup` 查相关 atlas/20-behavior 节点（用 Behavior 段提到的概念做 query），作为拆 task 时避免遗漏现有项目约束的参考。无 `## Behavior` 段时按常规进入 minimal-research 阶段。</action>
```

#### Verify

- grep 验证字符串落地：
  ```sh
  grep -F '<behavior-mapping-rules priority="critical"' src/agents/planner.ts
  grep -F '## 行为承诺映射' src/agents/planner.ts
  grep -F 'atlas_lookup 查相关 atlas/20-behavior' src/agents/planner.ts
  ```
- `bun test tests/agents/behavior-layer.test.ts` — 由 Task 2.1 落地完整断言
- `bun test tests/agents/atlas-protocol-injection.test.ts` 与 `tests/agents/project-memory-protocol.test.ts` — 必须通过

**Commit:** `feat(agents): planner 加入 BDD 行为承诺映射段 + 主动 atlas_lookup 规则`

---

### Task 1.4: executor.ts — context-brief 行为指向 + batch checkpoint Atlas Maintain
**File:** `src/agents/executor.ts`
**Test:** `tests/agents/behavior-layer.test.ts` (由 Task 2.1 提供完整断言)
**Depends:** none
**Domain:** general
**Atlas-impact:** none

#### 改动概述（2 个插入点）

1. **`<context-brief>` `<mandatory-spawn-block>` 内 `<confirmed>` 段**（当前在第 193-200 行附近）：在 `- 相关 contract 路径: ...` 行之后追加一行「本次 Task 对应的行为承诺」。
2. **`<atlas-propagation>` 块**（当前在第 178-182 行）：紧接其后插入一个新 `<behavior-checkpoint-maintenance>` 子块，描述「每个 batch reviewer 通过后判断是否需要更新 atlas/20-behavior 节点」与「终态前最后一次 Atlas 审视」。

#### 目标插入文本

`<context-brief>` `<mandatory-spawn-block>` 内 `<confirmed>` 段（在 `- 相关 contract 路径: ...` 行之后追加一行；保持 4KB 限制）：

```
      - 本次 Task 对应的行为承诺: <一句话引用 design.md `## Behavior` 段中本 task 实现的那条；其它条目由其它 task 负责。如 design 无 `## Behavior` 段写 "无"。不 verbatim 整段贴避免突破 4KB>
```

注意：该行必须出现在 `<confirmed>` 块内，与现有 5 行（环境 / Atlas / PM / Mindmodel / contract）并列，作为第 6 行。同时更新本块的 `<size-limit>` 注释 + `<construction-flow>` 中"组装公共 brief"步骤的描述，提到「行为指向」也由 executor 在 parse-plan 阶段从 plan.md `## 行为承诺映射` 段提取。

具体 `<construction-flow>` 改动：在现有 step 1 后追加一句「同时从 plan.md `## 行为承诺映射` 段提取每个 task 对应的行为承诺一句话摘要」；在现有 step 3 描述末尾追加「行为指向按 task 个性化（不同 task 取自映射段中对应的那一条）」。

`<atlas-propagation>` 块之后插入：

```xml
<behavior-checkpoint-maintenance priority="high" description="BDD 防漂移层：每个 batch reviewer 通过后判断是否 Maintain atlas/20-behavior">
<rule>每个 batch 所有 task reviewer APPROVED 后，executor 在 batch 终态报告里执行一次 Atlas 行为节点审视：判断本批次落地的行为是否需要更新或新增 atlas/20-behavior 节点。</rule>
<rule>判断准则（满足任一即 Maintain）：跨 lifecycle 都成立的硬约束 / 影响多个 agent 或跨模块的用户可见行为 / 与现有 atlas/20-behavior 节点存在修订或补充关系 / 用户在 brainstorm 中明确表达"项目长期规则"。</rule>
<rule>不沉淀准则：一次性临时配置调整 / 单次实验性行为（"先试试"）/ quick-mode 路径小补丁 / 仅 UI 文案微调。</rule>
<rule>Maintain 实施：executor 在 batch 报告中用一段 "Atlas 行为节点审视: ..." 描述本次结论（maintained / no-change / stale-detected）；实际节点改写沿用 ATLAS_MENTAL_MODEL_PROTOCOL Maintain 步骤（read + edit），失败时 fallback 到 delta（thoughts/shared/atlas-deltas/）。</rule>
<rule>Maintain 失败不阻塞 lifecycle finish；累计沉淀由主 agent（brainstormer / commander）在终态前最后一次 Atlas 审视处理。</rule>
<rule>本块挂到现有 atlas-propagation / ATLAS_MENTAL_MODEL_PROTOCOL Maintain 步骤上，不引入新协议块、不引入新工具、不动 lifecycle 边界（lifecycle 工具仍不 spawn atlas-compiler）。</rule>
</behavior-checkpoint-maintenance>
```

#### Implementer 注意事项

- `<mandatory-spawn-block>` 模板修改要保留 4KB ≤1000 字符硬限制语义；新增的「行为指向」一行属于 task 级 ≤一句话的内容，不会突破限制。
- 同时确认 `<construction-flow>` 第 426-427 行的示例 brief 字符串是否需要相应更新一行示范"本次 Task 对应的行为承诺: ..."（建议在示例 brief 中追加该字段，保持示例与模板一致）。
- 不动 `atlas-propagation` 内现有规则（不 auto-write delta、observation 上交 primary）。

#### Verify

- grep 验证字符串落地：
  ```sh
  grep -F '本次 Task 对应的行为承诺' src/agents/executor.ts
  grep -F '<behavior-checkpoint-maintenance priority="high"' src/agents/executor.ts
  grep -F 'Atlas 行为节点审视' src/agents/executor.ts
  ```
- `bun test tests/agents/behavior-layer.test.ts` — 由 Task 2.1 提供完整断言
- `bun test tests/lifecycle/atlas-boundary.test.ts` — **必须通过**（确认未让 lifecycle 工具 spawn atlas-compiler；本 task 只在 executor agent prompt 内加 Maintain 规则，不动 lifecycle 工具代码）
- `bun test tests/lifecycle/project-memory-boundary.test.ts` — **必须通过**（确认未动 promoteOnLifecycleFinish 默认值）

**Commit:** `feat(agents): executor context-brief 加行为指向 + batch checkpoint Atlas 行为节点维护规则`

---

### Task 1.5: reviewer.ts — Findings 「行为一致性」子项 + 漂移自动 promote lesson
**File:** `src/agents/reviewer.ts`
**Test:** `tests/agents/behavior-layer.test.ts` (由 Task 2.1 提供完整断言)
**Depends:** none
**Domain:** general
**Atlas-impact:** none

#### 改动概述（2 个插入点）

1. **`<checklist>` 块**（当前在第 100-108 行附近，含 `<section name="knowledge-consistency">`）：在现有 `<section name="knowledge-consistency">` 之后追加一个新 `<section name="behavior-consistency">`，列出行为一致性检查项。
2. **`<output-format>` `<template>`**（当前在第 180-194 行）：在 `**Issues** (if any):` 块前后调整模板，在 `**Test**: PASS / FAIL` 块之后、`**Issues**` 之前插入一个新的 `**Findings**` 段示例，其中含一行「行为一致性」子项（默认 ✓，漂移时 ⚠️）。
3. **`<knowledge-detect-role>` 块**（当前在第 133-153 行）：在 `<project-memory-consistency>` 之后追加一个新 `<behavior-drift-detection>` 子块，描述发现明显行为漂移时升级为 CHANGES REQUESTED + 输出一行 escalate 让 executor / primary agent 判断是否 promote lesson；reviewer 自己不调 project_memory_promote（保持 leaf agent 不写 PM 的协议约定）。

#### 目标插入文本

`<checklist>` 内、`<section name="knowledge-consistency">` 之后插入：

```xml
<section name="behavior-consistency">
<check>Implementation 与 design.md `## Behavior` 段语义一致（没有引入未声明的用户可见行为）?</check>
<check>Implementation 没有遗漏 `## Behavior` 段中由本 task 负责的那条行为承诺?</check>
<check>如 plan.md `## 行为承诺映射` 段指明本 task 对应的行为承诺，diff 实际行为是否与该映射条目一致?</check>
</section>
```

`<output-format>` `<template>` 调整为（在现有 `**Test**: ...` 之后、`**Issues** ...` 之前插入新 `**Findings**` 段）：

```markdown
## Review Task [X.Y]: [file name]

**Test**: PASS / FAIL
- Command: \`bun test path/to/test.ts\`

**Findings**:
- 行为一致性: ✓ 实现与 design.md `## Behavior` 段（本 task 对应条目）一致
  （发现明显漂移时升级为）
  ⚠️ 实现引入了未声明的「<具体行为>」/ 实现遗漏了 `## Behavior` 段第 K 条；建议回退或补 Behavior 声明
- （可选）其它 finding 一行一条

**Issues** (if any):
1. \`file:line\` - [issue]
   **Fix:** [specific fix with code]

**Summary**: [One sentence - what's good or what needs fixing]

[verdict on its own final line per final-marker-rule]
```

`<knowledge-detect-role>` 块内、`<project-memory-consistency>` 之后插入：

```xml
<behavior-drift-detection priority="medium" description="BDD 防漂移层：reviewer 行为一致性升级 + lesson escalate">
<rule>对照 design.md `## Behavior` 段（在 context-brief「本次 Task 对应的行为承诺」字段已下传）判断实现是否存在明显漂移：与某条 `## Behavior` 描述矛盾，或引入未声明的用户可见新行为。</rule>
<rule>区分两类：</rule>
<sub-rule type="minor">轻微补全（不矛盾任何 Behavior 描述，只是补全实现细节）→ 不阻塞，在 `**Findings**` 行为一致性子项标 ✓ 或附一句备注；verdict 仍可 APPROVED。</sub-rule>
<sub-rule type="major">明显漂移（与某条 Behavior 描述矛盾 / 引入未声明用户可见行为 / 遗漏本 task 负责的 Behavior）→ 在 `**Findings**` 行为一致性子项标 ⚠️ 并升级 verdict 为 CHANGES REQUESTED。</sub-rule>
<rule>发现明显漂移且判断属于"可复用漂移教训"（不是单次特定情况）时，在 reviewer 报告 body 中追加一行 "Behavior observation: drift-lesson — <一句话教训> — design pointer: <design.md 路径>"，放在 verdict 之前；executor 收集后由 primary agent 决定是否调 `project_memory_promote` type=lesson。</rule>
<rule>reviewer 是 leaf agent，自身不调 `project_memory_promote` / `project_memory_forget`（保持现有 leaf agent 协议约定）。</rule>
<rule>不强制 CHANGES REQUESTED 阈值过低（避免 implementer-reviewer 循环卡死）：仅"明显漂移"升级；"实现细节补全""更优实现"等不算漂移。</rule>
<rule>verdict 行仍单独最后一行（APPROVED / CHANGES REQUESTED），不破坏 `<final-marker-rule>`。</rule>
</behavior-drift-detection>
```

#### Implementer 注意事项

- 不动 `<final-marker-rule>` 的任何描述（verdict 必须最后一行；CHANGES REQUESTED 锚定行首）；本 task 只是让"行为一致性"作为 Findings 段下的一个子项，verdict 仍独立最后一行。
- 不让 reviewer 调 `project_memory_promote`（违反 leaf-agent 协议）；只让 reviewer 输出 escalate 一行，由 executor / primary agent 决定 promote。
- `<process>` 段不修改（reviewer 现有 7 个 step 不动）；行为一致性检查通过 `<checklist>` 加 section + `<output-format>` 加 Findings 行落地。

#### Verify

- grep 验证字符串落地：
  ```sh
  grep -F '<section name="behavior-consistency">' src/agents/reviewer.ts
  grep -F '<behavior-drift-detection priority="medium"' src/agents/reviewer.ts
  grep -F '行为一致性' src/agents/reviewer.ts
  grep -F 'Behavior observation: drift-lesson' src/agents/reviewer.ts
  ```
- `bun test tests/agents/behavior-layer.test.ts` — 由 Task 2.1 落地
- 确认 `<final-marker-rule>` 内容未变：`grep -c 'verdict MUST appear as the LAST line' src/agents/reviewer.ts` 应当仍为 1

**Commit:** `feat(agents): reviewer Findings 加行为一致性子项 + 漂移升级 / lesson escalate 规则`

---

### Task 1.6: AGENTS.md — `## Behavior 段约定` 一节
**File:** `AGENTS.md`
**Test:** `tests/agents/behavior-layer.test.ts` (由 Task 2.1 提供完整断言)
**Depends:** none
**Domain:** general
**Atlas-impact:** none

#### 改动概述

在 `## Effect-First User-Facing Reports` 一节（当前在第 38-71 行）与 `## Atlas Shared Mental Model` 一节（当前在第 73 行起）之间插入新一节 `## Behavior 段约定`，作为 design.md `## Behavior` 段的项目级 markdown 镜像说明。

不动其它任何小节；不动既有 drift-guard 注释。

#### 目标插入文本

在 AGENTS.md 第 71 行（`## Effect-First User-Facing Reports` 段最后一段「`commander.ts` 与 `brainstormer.ts` ... 必须在 commander / brainstormer / octto 中保持 byte-identical。」）之后、第 73 行（`## Atlas Shared Mental Model`）之前插入：

```markdown
## Behavior 段约定

micode 在 brainstorm / planner / executor / reviewer / 终态汇报 5 个阶段加入轻量 BDD 防漂移层，把"用户可见行为承诺"显式落到 design.md 末尾的 `## Behavior` 段。完整 prompt 协议片段单源在 `src/agents/brainstormer.ts`（`<behavior-section-maintenance>` 与 finalizing 产出规则）、`src/agents/planner.ts`（`<behavior-mapping-rules>` 与 skeleton-template `## 行为承诺映射` 段）、`src/agents/executor.ts`（`<context-brief>` 行为指向 + `<behavior-checkpoint-maintenance>` 块）、`src/agents/reviewer.ts`（`<behavior-drift-detection>` 块 + Findings 行为一致性子项）、`src/agents/brainstormer.ts` 与 `src/agents/commander.ts` 的 `<effect-first-reporting>` 内 `<behavior-alignment>` 子块（byte-identical 镜像）。本节是 markdown 镜像，不复制完整 prompt 文本，避免与 prompt 单源 drift。

### design.md 第 10 个可选段

design.md 既有 9 段（Problem Statement / Constraints / Approach / Architecture / Components / Data Flow / Error Handling / Testing Strategy / Open Questions）顺序不变；`## Behavior` 作为可选第 10 段追加在末尾。

格式：自由（bullet / 段落 / 三段式都可），无强制结构、无强制 ID、无强制字数。建议每条 bullet 描述一条用户可见行为或验收方式。

省略条件：quick-mode / 运维 / executor-direct / 用户显式跳过 时整段可省略。

Atlas 关联用一行自然语言注明，不引入 `atlas_target` frontmatter 字段。

### 5 阶段闭环

| 阶段 | 机制 |
|---|---|
| brainstorm | brainstormer 在 finalizing 主动产出 `## Behavior` 段 + 立即 `atlas_lookup` 评估 atlas/20-behavior 关联；架构层级行为决策时 `project_memory_promote` decision |
| planner | plan.md 文件开头自动产出 `## 行为承诺映射` 段（自然语言列出每条 Behavior 对应的 task；漏覆盖时显式说明理由）；不引入新 task 字段 |
| executor | context-brief `<confirmed>` 段加一行「本次 Task 对应的行为承诺」；每个 batch reviewer 通过后判断是否 Maintain atlas/20-behavior |
| reviewer | `**Findings**` 段加「行为一致性」子项（默认 ✓ 一句话过；明显漂移升级 ⚠️ + CHANGES REQUESTED）；可复用漂移教训以 "Behavior observation: drift-lesson — ..." 一行 escalate 给 executor / primary agent |
| 终态汇报 | brainstormer / commander 的 `<effect-first-reporting>` 五段内「预期表现」与「你可以怎么验收」与 design.md `## Behavior` 段语义一致；不新增 section 标题 |

### 全 agent 驱动 + 用户角色

- 用户从不直接编辑 `atlas/` / Project Memory SQLite / `thoughts/` 文件。
- 用户想改 atlas 节点 → 跟 agent 说「`atlas/20-behavior/X` 改成 Y」→ agent 完成实际修改。
- 用户想查行为历史 → 跟 agent 说「查 X 行为的历史决策」→ agent 调 `project_memory_lookup`。
- 用户想清理 PM 条目 → 跟 agent 说「忘掉 X」→ agent 调 `project_memory_forget`。
- Atlas / Project Memory 维护全部由 agent 在 prompt 协议里自动完成；用户在终态汇报「本次知识上下文」段就能看到所有变化。

### 不引入

- 不引入 Gherkin / `.feature` 文件 / BDD 测试框架。
- 不引入 `scenarios[]` frontmatter 数组。
- 不引入 `atlas_target` 字段。
- 不引入 `atlas-behavior:<slug>` Project Memory entity 前缀约定。
- 不引入 sink-to-Atlas 自动化流程（不触碰 `tests/lifecycle/atlas-boundary.test.ts` 边界）。
- 不引入新 byte-identical 镜像（仅复用 `<effect-first-reporting>` 既有 brainstormer ↔ commander 镜像）。
- 不引入新 task 字段（plan task 仍是 File / Test / Depends / Domain / Atlas-impact）。
- 不引入覆盖率仪表盘 / `Scenario coverage: N/M` 状态行。
- 不引入 `## Behavior` 段格式校验器（自由格式）。

### Drift guard

`src/agents/brainstormer.ts` 与 `src/agents/commander.ts` 的 `<effect-first-reporting>` 块内 `<behavior-alignment>` 子块仍受既有 `tests/agents/effect-first-reporting.test.ts` byte-identical drift-guard 保护。其它 `<behavior-section-maintenance>` / `<behavior-mapping-rules>` / `<behavior-checkpoint-maintenance>` / `<behavior-drift-detection>` 块各自只存在于一个 agent prompt 中，不引入新 byte-identical 镜像；新增小型 grep-based 单元测试 `tests/agents/behavior-layer.test.ts` 守护关键字符串落地。本节是 markdown 镜像，命名和段落顺序需保持一致。
```

#### Implementer 注意事项

- 用 Edit 工具，oldString 取一段足够独特的上下文（包含上一段末尾 + 下一段开头），确保只在 AGENTS.md 中匹配一次。建议 oldString 包含末尾「必须在 commander / brainstormer / octto 中保持 byte-identical。\n\n## Atlas Shared Mental Model」这两个段之间的边界。

#### Verify

- grep 验证字符串落地：
  ```sh
  grep -F '## Behavior 段约定' AGENTS.md
  grep -F '5 阶段闭环' AGENTS.md
  grep -F '全 agent 驱动 + 用户角色' AGENTS.md
  grep -F '不引入 Gherkin' AGENTS.md
  ```
- `bun test tests/agents/effect-first-reporting.test.ts` — 必须通过（特别是 `AGENTS.md mirror` 一组）；本 task 不改既有「Effect-First User-Facing Reports」节内容，只在它之后新增节，既有 mirror 断言不受影响。
- `bun test tests/agents/atlas-mental-model.test.ts` — 必须通过（确认未破坏 Atlas 节）

**Commit:** `docs(agents): AGENTS.md 加 ## Behavior 段约定 一节（design.md 第 10 个可选段 + 5 阶段闭环 + 全 agent 驱动）`

---

## Batch 2: Tests (parallel - 2 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2

### Task 2.1: 新增 `tests/agents/behavior-layer.test.ts` — grep-based 行为层落地守护
**File:** `tests/agents/behavior-layer.test.ts`
**Test:** `tests/agents/behavior-layer.test.ts`（本 task 创建该文件，本身即 test 自身）
**Depends:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.6
**Domain:** general
**Atlas-impact:** none

#### 改动概述

新增小型 grep-based 单元测试文件，断言 Batch 1 各 task 的关键 prompt / docs 字符串都已落地。不引入 BDD 框架、不引入 e2e、不引入格式校验；仅 string contains 断言。

#### 测试文件结构（实现细节）

文件必须使用 `bun:test`（参见项目 `mindmodel` testing pattern），读取 `src/agents/*.ts` 与 `AGENTS.md` 为字符串，按 5 个 describe 块组织：

- `describe("brainstormer.ts behavior-layer additions")`：
  - 含 `<behavior-alignment description="Align user-visible report with design.md ## Behavior section">`（精确字符串）
  - 含 `<behavior-section-maintenance priority="high"`（精确字符串）
  - 含 `<section name="Behavior" optional="true">`（精确字符串）
  - finalizing phase 含 `## Behavior` 与 `atlas_lookup` 字样（separate matches）
- `describe("commander.ts behavior-alignment mirror")`：
  - 含 `<behavior-alignment description="Align user-visible report with design.md ## Behavior section">`（与 brainstormer 完全相同字符串；通过 effect-first-reporting.test.ts 既有 byte-identical drift-guard 持续守护，本测试只断言存在性）
- `describe("planner.ts behavior-mapping additions")`：
  - 含 `<behavior-mapping-rules priority="critical"`
  - skeleton-template 含 `## 行为承诺映射`
  - understand-design phase 含 `atlas_lookup 查相关 atlas/20-behavior`
- `describe("executor.ts context-brief + checkpoint additions")`：
  - context-brief 模板含 `本次 Task 对应的行为承诺`
  - 含 `<behavior-checkpoint-maintenance priority="high"`
  - 含 `Atlas 行为节点审视`
- `describe("reviewer.ts behavior-consistency additions")`：
  - checklist 含 `<section name="behavior-consistency">`
  - 含 `<behavior-drift-detection priority="medium"`
  - output-format template 含 `行为一致性`
  - 含 `Behavior observation: drift-lesson`
  - 守护：reviewer.ts 内 `verdict MUST appear as the LAST line` 仍出现恰好 1 次（确认未破坏 final-marker-rule）
- `describe("AGENTS.md behavior-section mirror")`：
  - 含 `## Behavior 段约定`
  - 含 `5 阶段闭环`
  - 含 `全 agent 驱动 + 用户角色`
  - 含 `不引入 Gherkin`
  - 含 `不引入 atlas_target 字段`
  - 含 `不引入 sink-to-Atlas`

#### 测试代码骨架（implementer 直接落地此结构）

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BRAINSTORMER = readFileSync(join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"), "utf-8");
const COMMANDER = readFileSync(join(__dirname, "..", "..", "src", "agents", "commander.ts"), "utf-8");
const PLANNER = readFileSync(join(__dirname, "..", "..", "src", "agents", "planner.ts"), "utf-8");
const EXECUTOR = readFileSync(join(__dirname, "..", "..", "src", "agents", "executor.ts"), "utf-8");
const REVIEWER = readFileSync(join(__dirname, "..", "..", "src", "agents", "reviewer.ts"), "utf-8");
const AGENTS_MD = readFileSync(join(__dirname, "..", "..", "AGENTS.md"), "utf-8");

describe("brainstormer.ts behavior-layer additions", () => {
  it("includes <behavior-alignment> child block inside effect-first-reporting", () => {
    expect(BRAINSTORMER).toContain('<behavior-alignment description="Align user-visible report with design.md ## Behavior section">');
  });
  it("includes <behavior-section-maintenance> top-level block", () => {
    expect(BRAINSTORMER).toContain('<behavior-section-maintenance priority="high"');
  });
  it("declares ## Behavior as optional 10th design.md section", () => {
    expect(BRAINSTORMER).toContain('<section name="Behavior" optional="true">');
  });
  it("finalizing phase mentions ## Behavior produce + atlas_lookup", () => {
    // Both substrings must appear; we do not assert order, only presence.
    expect(BRAINSTORMER).toContain('## Behavior');
    expect(BRAINSTORMER).toContain('atlas_lookup');
  });
});

describe("commander.ts behavior-alignment mirror", () => {
  it("includes the same <behavior-alignment> child block", () => {
    expect(COMMANDER).toContain('<behavior-alignment description="Align user-visible report with design.md ## Behavior section">');
  });
});

describe("planner.ts behavior-mapping additions", () => {
  it("declares <behavior-mapping-rules> block", () => {
    expect(PLANNER).toContain('<behavior-mapping-rules priority="critical"');
  });
  it("skeleton template contains ## 行为承诺映射 section", () => {
    expect(PLANNER).toContain('## 行为承诺映射');
  });
  it("understand-design phase mentions atlas_lookup for 20-behavior", () => {
    expect(PLANNER).toContain('atlas_lookup 查相关 atlas/20-behavior');
  });
});

describe("executor.ts context-brief + checkpoint additions", () => {
  it("context-brief template carries 行为承诺 pointer", () => {
    expect(EXECUTOR).toContain('本次 Task 对应的行为承诺');
  });
  it("declares <behavior-checkpoint-maintenance> block", () => {
    expect(EXECUTOR).toContain('<behavior-checkpoint-maintenance priority="high"');
  });
  it("mentions 'Atlas 行为节点审视' as the batch checkpoint output marker", () => {
    expect(EXECUTOR).toContain('Atlas 行为节点审视');
  });
});

describe("reviewer.ts behavior-consistency additions", () => {
  it("checklist contains <section name=\"behavior-consistency\">", () => {
    expect(REVIEWER).toContain('<section name="behavior-consistency">');
  });
  it("declares <behavior-drift-detection> block", () => {
    expect(REVIEWER).toContain('<behavior-drift-detection priority="medium"');
  });
  it("output-format template mentions 行为一致性 line", () => {
    expect(REVIEWER).toContain('行为一致性');
  });
  it("escalate marker 'Behavior observation: drift-lesson' exists", () => {
    expect(REVIEWER).toContain('Behavior observation: drift-lesson');
  });
  it("final-marker-rule remains intact (verdict MUST appear as the LAST line)", () => {
    const occurrences = REVIEWER.match(/verdict MUST appear as the LAST line/g) ?? [];
    expect(occurrences.length).toBe(1);
  });
});

describe("AGENTS.md behavior-section mirror", () => {
  it("declares the section heading", () => {
    expect(AGENTS_MD).toMatch(/##\s+Behavior 段约定/);
  });
  it("describes the 5-phase loop", () => {
    expect(AGENTS_MD).toContain('5 阶段闭环');
  });
  it("describes agent-driven + user-role split", () => {
    expect(AGENTS_MD).toContain('全 agent 驱动 + 用户角色');
  });
  it("explicitly forbids Gherkin / .feature files", () => {
    expect(AGENTS_MD).toContain('不引入 Gherkin');
  });
  it("explicitly forbids atlas_target field", () => {
    expect(AGENTS_MD).toContain('不引入 atlas_target 字段');
  });
  it("explicitly forbids sink-to-Atlas auto-flow (preserves atlas-boundary)", () => {
    expect(AGENTS_MD).toContain('不引入 sink-to-Atlas');
  });
});
```

#### Implementer 注意事项

- 严格遵循项目 `mindmodel` testing pattern：用 `bun:test`、tests/agents/ 目录、`readFileSync(join(__dirname, ...))` 读取 prompt 源文件。
- 不引入新 dep；仅 `node:fs`、`node:path`、`bun:test`。
- 不引入 `@/` 路径别名（参考既有 `tests/agents/specialist-routing.test.ts` 用 `join(__dirname, "..", "..", ...)` 即可）。
- **重要**：所有断言字符串必须与 Batch 1 各 task 落地的精确字符串保持一致；如果 Batch 1 实施时被迫调整字符串拼写，Task 2.1 implementer 必须同步更新断言。

#### Verify

- `bun test tests/agents/behavior-layer.test.ts` — 必须全绿（依赖 Batch 1 已完成）
- `bun test tests/agents/effect-first-reporting.test.ts` — 必须仍全绿（确认未破坏既有 drift-guard）
- `bun test tests/agents/specialist-routing.test.ts` — 必须仍全绿
- `bun test tests/agents/atlas-protocol-injection.test.ts` 与 `tests/agents/project-memory-protocol.test.ts` — 必须仍全绿
- `bun test tests/lifecycle/atlas-boundary.test.ts` — 必须仍全绿（确认未引入 lifecycle → atlas 自动 spawn）
- `bun test tests/lifecycle/project-memory-boundary.test.ts` — 必须仍全绿（确认未动 promoteOnLifecycleFinish 默认值）

**Commit:** `test(agents): 新增 behavior-layer.test.ts grep 守护 BDD 行为层关键字符串落地`

---

### Task 2.2: 全量 drift-guard 与 boundary 测试回归
**File:** `(no file change)` — 这是一个 **verification-only** 验证任务，不修改任何文件
**Test:** none（不修改文件即不需要 emit 新 test；这是一个 verification 任务，semantic-risk = none，因为它只是跑既有测试）
**Depends:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 2.1
**Domain:** general
**Atlas-impact:** none

#### 改动概述

本 task 不修改任何文件。它的目的是显式登记一次"全量回归验证"，确保 Batch 1 + Task 2.1 落地后，所有既有 drift-guard / boundary 测试仍然全绿。implementer 跑下面的命令清单，把通过 / 失败结果汇总到 reviewer 报告。

> **为什么单独列一个 task 而不是融入 Task 2.1**：Task 2.1 创建新测试文件，是一个有 diff 的 implementation task。本 task 是 verification-only，没有 diff，但作为 plan 的最后一道闸门，保证整批改动落地后既有 drift-guard 仍稳定。也可由 executor 在 batch 完成后直接跑这些命令（不派 implementer）；本 plan 为了使"验证步骤"对 reviewer 显式可见而单列。

#### 验证命令清单

implementer 按顺序跑下列命令，全部要求退出码 0 / 全绿：

```sh
# A. 既有 drift-guard（必须仍全绿）
bun test tests/agents/effect-first-reporting.test.ts
bun test tests/agents/specialist-routing.test.ts
bun test tests/agents/atlas-mental-model.test.ts
bun test tests/agents/atlas-protocol-injection.test.ts
bun test tests/agents/project-memory-protocol.test.ts
bun test tests/agents/agents-md-lifecycle-recovery.test.ts
bun test tests/agents/agents-md-knowledge-bootstrap.test.ts

# B. lifecycle 边界（design 约束的核心两条）
bun test tests/lifecycle/atlas-boundary.test.ts
bun test tests/lifecycle/project-memory-boundary.test.ts

# C. 本次新增
bun test tests/agents/behavior-layer.test.ts

# D. 全量回归（兜底）
bun test
```

#### 失败处理

- A 类（既有 drift-guard）任何一条失败 → 极可能是 Task 1.1 / 1.2 byte-identical 漂移；implementer 必须把失败诊断回报给 reviewer / executor，由 executor 重派对应 Batch 1 task 修正。
- B 类（lifecycle 边界）任何一条失败 → 极可能是 Task 1.4 越界（不该动 lifecycle 工具）；必须回退该 task 内的越界改动。
- C 类（新增测试）失败 → Task 2.1 断言字符串与 Batch 1 实际落地字符串不一致；implementer 检查并报告差异。
- D 类（全量）有其它失败 → 与本 plan 无关的 pre-existing failure 可在报告中标注 known-flaky；与本 plan 有关的失败必须解决。

#### Implementer 注意事项

- 本 task 不修改任何文件。spawn 时由 executor 派 `implementer-general`，prompt 中明确 "verification-only, no diff expected"。
- Test 字段为 `none` 符合 semantic-risk 准则：本 task 是 glue / 运维 / 无新逻辑，纯跑既有测试；不引入需要被守护的 reusable behavior。
- 完成后报告：列出每条命令的 pass / fail + 通过的 test 数 / 失败的 test 名（如有）。

#### Verify

- 见上文「验证命令清单」全部退出码 0
- reviewer 在审查本 task 时主要确认 implementer 报告中所有命令都标 PASS，且没有越界改动（git diff 应为空）

**Commit:** 本 task 不产生 commit（verification-only，无 diff）。如需要在 lifecycle 记录"全量回归通过"，由 executor 在 batch 终态报告里说明，或在 `lifecycle_commit` 的 summary 中提到"batch 2 all drift-guards 全绿"。
