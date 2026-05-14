---
date: 2026-05-14
topic: "brainstormer sub-decision identification + 终态需求核对"
issue: 73
scope: agents
contract: none
---

# Sub-decision Identification + Requirement Check-off Implementation Plan

**Goal:** 在 micode prompt 层落地「事前问全 architectural sub-decision」+「事后核对用户原始要求」两条规则，与 BDD 防漂移层 issue #69 互补，全部用 grep-based drift-guard 守护（不新增 byte-identical 镜像）。

**Architecture:** 在 6 个 agent prompt（brainstormer / commander / octto / planner / executor / reviewer）与 AGENTS.md 各自加规则段；同步更新唯一现有 byte-identical 测试 fixture（effect-first-reporting.test.ts），新增一份 grep-based 单元测试守护其余字符串。所有 prompt 改动遵守 design 5 大「不引入」边界（不新 agent / 不动 lifecycle 工具 / 不动 Atlas / PM schema / 不动 .mindmodel/ / 不引入新 byte-identical 镜像）。

**Design:** `thoughts/shared/designs/2026-05-14-sub-decision-and-requirement-checkoff-design.md`

**Contract:** `none`（本次任务全部落在 prompt + markdown + 测试层，无跨 frontend/backend 域调用，故不产出 contract 文件）

---

## 行为承诺映射

> 本段对照 design.md `## 承诺清单 / Commitments` 段 8 条承诺与 `## Behavior` 段，将每条承诺映射到具体落地 task。漏覆盖处显式说明理由。本段是 issue #69 BDD 防漂移层 planner 规则的产物，本次任务自身也作为该规则的第一次 dogfooding。

| # | 承诺 / Behavior | 落地 Task | 说明 |
|---|---|---|---|
| 1 | brainstormer understanding 阶段必须 enumerate 全部 architectural sub-decision 并 batched ask user | 1.1（新增 `<sub-decision-identification>` phase block） | 复用 AGENTS.md channel selection（≤3 plain chat / ≥4 octto） |
| 2 | 执行阶段绝不向用户 surface 新的 architectural sub-decision；保守默认 + 终态汇报 surface | 1.4 / 1.5 / 1.6（planner / executor / reviewer 各加「执行中不打断用户」硬约束）+ 1.2 / 1.3（brainstormer / commander effect-first 加「本次按默认决定」子规则）+ 1.3 octto 语义对齐版本 | 三个执行 agent 各自独立加规则，不引入新镜像 |
| 3 | architectural decision 启发式扩展清单（数字参数 / max 上限 / 默认值 / 阈值 / 策略选择 / 命名 contract / 数据模型字段 / 外部依赖 / breaking 与否 + AGENTS.md Decision Autonomy 表右列） | 1.1（写在 `<sub-decision-identification>` 内）+ 1.7（AGENTS.md `## Sub-decision Identification 约定` 段镜像） | brainstormer prompt + AGENTS.md 双源（grep 守护，非 byte-identical） |
| 4 | batched ask 复用 AGENTS.md 现有 channel selection（≤3 chat / ≥4 octto） | 1.1（在 `<sub-decision-identification>` 内显式引用 AGENTS.md channel selection）+ 1.7（AGENTS.md 镜像段） | 不引入独立通道判断逻辑 |
| 5 | 终态汇报「你可以怎么验收」段内含「需求核对表」（✓/⚠️/✗ 三态） | 1.2（brainstormer effect-first）+ 1.2（commander effect-first，与 brainstormer byte-identical 共生）+ 1.3（octto 语义对齐）+ 1.7（AGENTS.md `## Requirement Check-off 约定` 镜像） | 复用现有 effect-first byte-identical drift-guard 覆盖 brainstormer ↔ commander；不新增镜像 |
| 6 | 需求核对表参照源为 design.md 顶部 `## 承诺清单` 段 | 1.1（brainstormer finalizing 加「承诺清单」产出动作 + design.md template 新增段） | 本次 design.md 自身即作为范本 |
| 7 | brainstormer / commander / octto 三 primary agent 一致；octto 语义对齐不强 byte-identical | 1.2（brainstormer / commander 同步改）+ 1.3（octto 语义对齐改） | 1.2 与 1.3 在同一 batch 并行，效果首测试 fixture 在 batch 2 一次性覆盖三者关键字符串 |
| 8 | drift-guard 全部 grep-based；不新增 byte-identical 镜像；唯一更新现有 byte-identical 是 effect-first-reporting.test.ts | 2.1（更新现有 byte-identical fixture）+ 2.2（新增 grep-based 单元测试） | 不破坏 atlas-boundary / project-memory-boundary / atlas-protocol-injection / behavior-layer 等已存在测试 |

`## Behavior` 段（design 第 10 段）每条 bullet 都已并入上表，无漏覆盖。

---

## Dependency Graph

```
Batch 1 (parallel - 7 implementers): 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
  └─ 全是 prompt / markdown 文件独立编辑；不互相 import。1.2(brainstormer) 与 1.2-mirror(commander) 通过现有 byte-identical 测试间接耦合，但编辑动作本身独立；为防止 batch 中途半合规状态，1.2 与 commander mirror 同 batch 并行落地。
Batch 2 (parallel - 2 implementers): 2.1, 2.2 [依赖 Batch 1 全部完成]
  └─ 测试更新；必须等所有 prompt 改动落地后才能跑通。
```

依赖关系说明：
- Batch 1 内 7 个 task 都修改不同文件，且不相互 import，可严格并行。
- Batch 2 的 2 个 test task 都依赖 Batch 1 全部完成（任一 prompt task 漏改都会让相关 grep 断言失败）。

---

## Batch 1: Prompt + AGENTS.md edits (parallel - 7 implementers)

所有 task 修改不同文件，相互独立，无 import 依赖。
Tasks: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7

### Task 1.1: brainstormer.ts — `<sub-decision-identification>` phase + design.md 模板「## 承诺清单」段 + finalizing 产出动作
**File:** `src/agents/brainstormer.ts`
**Test:** none （prompt-only 改动；落地由 Batch 2 的 grep-based 测试 `tests/agents/sub-decision-and-checkoff.test.ts` 守护）
**Depends:** none
**Domain:** general
**Atlas-impact:** none

改动要点（在同一文件中四处编辑，必须全部落地）：

1. 在 `<process>` 块内、`<phase name="understanding">` 之后、`<phase name="exploring">` 之前，新增一个独立 phase 块：
   ```
   <phase name="sub-decision-identification" trigger="after understanding gathered codebase context, before exploring">
     <action priority="high">扫描用户原始需求，对照启发式扩展清单 enumerate 全部 architectural sub-decision 点。</action>
     <heuristic-checklist description="必须扫描的决策类型">
       <item>数字参数：max / min / default / timeout / 上限 / 阈值</item>
       <item>策略选择：队列调度 / retry 模式 / 错误处理路径</item>
       <item>命名 contract：API 路径 / 数据库字段名 / 配置键</item>
       <item>数据模型字段：新表结构 / schema 字段</item>
       <item>外部依赖：库选择 / 服务接入</item>
       <item>breaking 与否：API 兼容、迁移策略</item>
       <item>AGENTS.md `Decision Autonomy` 表右列（ASK 类）全部</item>
     </heuristic-checklist>
     <rule>每个识别出的决策点列出：编号 + 选项 A/B/C/D + 推荐默认 + 一句话理由。</rule>
     <rule>按 AGENTS.md `Interactive Question Tools` 现有 channel selection 表选通道：≤3 题用 plain chat numbered；≥4 题或需 review diff/code/plan 用 octto。不引入独立通道判断逻辑。</rule>
     <rule>用户回复 `1: A, 2: B, ...` / "全默认 OK" / "全默认但 X 改 Y" / 逐条作答 四种格式都接受。</rule>
     <rule>用户确认后进入 lifecycle_start_request。本 phase 之后 brainstormer 不再就 architectural decision 问用户。</rule>
     <rule>quick-mode / 运维 / executor-direct / 用户显式跳过 时本 phase 整段省略，brainstormer 不被阻塞。</rule>
     <rule>遗漏兜底：若执行阶段（planner / executor / reviewer / implementer）发现漏识别的 sub-decision，按保守默认决定后由 executor 聚合到终态汇报「实现记录」段「本次按默认决定的事项」子结构 surface。本 phase 不重新打开。</rule>
   </phase>
   ```

2. 在 `<phase name="finalizing" trigger="after presenting design">` 内、`<action>Write validated design ...</action>` 之前，新增一条 `<action priority="high">`：
   - 内容：在写 design.md 之前，先产出 frontmatter 之下、`## Problem Statement` 之前的新顶层段 `## 承诺清单 / Commitments`。该段含：用户原话引用（最初 message + 中途澄清的具体要求）+ 本次 sub-decision-identification batched ask 已确认的全部决策点 + 提炼为可核对的承诺条目。quick-mode / 运维 / executor-direct 可省略本段，与 `## Behavior` 段遵循同一可省略规则。

3. 在 `<output-format path="thoughts/shared/designs/...">` 内 `<sections>` 块顶部（`<section name="Problem Statement">` 之前）新增：
   ```
   <section name="Commitments" optional="true">用户原话 + sub-decision-identification batched ask 已确认决策点 + 提炼承诺条目。frontmatter 之下、Problem Statement 之前。自由格式。quick-mode / 运维 / executor-direct / 用户显式跳过 时可整段省略。终态汇报「需求核对表」以本段为对照源。</section>
   ```

4. 在现有 `<effect-first-reporting>` 块内做两处插入（不破坏五段结构、不破坏 byte-identical drift-guard，只是在 section 内部加子规则；commander 镜像在 1.2 同步改，两者 byte-identical）：
   - 在 `<section name="你可以怎么验收">` 段末追加一句子规则：「如果当前 design.md 含 `## 承诺清单 / Commitments` 段，本段必含「需求核对表」子结构（一个 markdown 表格 `| 需求 | 状态 | 备注 |`，状态用 ✓ / ⚠️ / ✗ 三态），对照承诺清单逐条标注。已知偏差必须主动列为 ⚠️ 或 ✗，不能省略让用户去发现。无 ## 承诺清单 段时省略本子结构。」
   - 在 `<section name="实现记录">` 段末追加一句子规则：「如果执行阶段（planner / executor / reviewer / implementer）发现 brainstorm 阶段漏识别的 architectural sub-decision、按保守默认决定，本段必含「本次按默认决定的事项」子结构（编号列表：决策点 → 默认值 → 简短理由）。如无此类情况则省略本子结构。」

修改后必须满足（Batch 2 测试会验证）：
- 文件含字符串 `<phase name="sub-decision-identification"`
- 文件含字符串 `启发式扩展清单`
- 文件含字符串 `## 承诺清单`（同时出现在 finalizing action 和 output-format section 注释里）
- 文件含字符串 `<section name="Commitments" optional="true">`
- effect-first-reporting 块内含 `需求核对表` 与 `本次按默认决定的事项`

不允许：
- 不要新增独立的 `<requirement-checkoff>` 或 `<sub-decision-default>` 顶层 XML 块（只在现有 effect-first-reporting 内 section 末追加子规则）
- 不要修改 byte-identical 的 effect-first 整体五段结构
- 不要修改 KNOWLEDGE_CONTEXT_SECTION 引用方式
- 不要修改 ATLAS_MENTAL_MODEL_PROTOCOL / PROJECT_MEMORY_PROTOCOL 注入位置

**Verify:** `bun build src/agents/brainstormer.ts --target=node --outfile=/tmp/brainstormer-check.js`（编译通过即结构完整）；最终验证由 Batch 2 跑全套测试确认。
**Commit:** `feat(agents): brainstormer adds <sub-decision-identification> phase + 承诺清单 段 + 需求核对表 / 本次按默认决定 effect-first 子规则`

### Task 1.2: commander.ts — effect-first-reporting 同步加「需求核对表」+「本次按默认决定的事项」子规则（与 brainstormer byte-identical 镜像）
**File:** `src/agents/commander.ts`
**Test:** none （prompt-only；由 Batch 2.1 现有 byte-identical drift-guard `effect-first-reporting.test.ts` + Batch 2.2 grep 守护）
**Depends:** none
**Domain:** general
**Atlas-impact:** none

改动要点（与 1.1 第 4 步内容必须 byte-identical 相等，因为现有 `tests/agents/effect-first-reporting.test.ts` 强制 commander ↔ brainstormer 整个 `<effect-first-reporting>` 块 byte-identical）：

- 找到 commander.ts 内的 `<effect-first-reporting>` 块。
- 在 `<section name="你可以怎么验收">` 段末追加与 1.1 第 4 步完全相同的「需求核对表」子规则文本（一字不差）。
- 在 `<section name="实现记录">` 段末追加与 1.1 第 4 步完全相同的「本次按默认决定的事项」子规则文本（一字不差）。

实现注意：
- 实施时建议先在 brainstormer.ts 完成 1.1 第 4 步的精确文本，再用同一段 newString 在 commander.ts 上做 Edit，避免人工抄写引入 1-2 字差异。
- 若两者文本最终不 byte-identical，Batch 2.1 测试会立即报错（这是预期保护机制，非缺陷）。

修改后必须满足：
- commander.ts 与 brainstormer.ts 的 `<effect-first-reporting>...</effect-first-reporting>` 块完全相同（现有 drift-guard 已覆盖）
- commander.ts effect-first 块内含 `需求核对表` 与 `本次按默认决定的事项`

不允许：
- 不要在 commander.ts 加 `<sub-decision-identification>` phase（commander 没有 brainstormer 那种 phase 化 understanding 流程；sub-decision identification 仅 brainstormer 行为）
- 不要在 commander.ts 改 design.md template（commander 不写 design.md）

**Verify:** Batch 2.1 测试通过即证明 commander ↔ brainstormer byte-identical。
**Commit:** `feat(agents): commander effect-first 镜像新增 需求核对表 与 本次按默认决定 子规则（与 brainstormer byte-identical）`

### Task 1.3: octto.ts — effect-first-reporting 加语义对齐版本（不强制 byte-identical）
**File:** `src/agents/octto.ts`
**Test:** none （prompt-only；由 Batch 2.2 grep 守护）
**Depends:** none
**Domain:** general
**Atlas-impact:** none

改动要点：

- 找到 octto.ts 内的 `<effect-first-reporting>` 块。
- 在 `<section name="你可以怎么验收">` 段末追加语义对齐的「需求核对表」子规则。文字可适配 octto 角色（提到 octto session / 用户在 portal 完成的 brainstorm decisions），但语义一致：必含 `| 需求 | 状态 | 备注 |` 三态 ✓/⚠️/✗ 表格、参照 design.md `## 承诺清单`、已知偏差主动 surface。
- 在 `<section name="实现记录">` 段末追加语义对齐的「本次按默认决定的事项」子规则。文字可适配 octto 角色，但语义一致：当执行阶段按保守默认决定遗漏 sub-decision 时必含编号列表「决策点 → 默认值 → 简短理由」。

修改后必须满足：
- octto.ts effect-first 块内含字符串 `需求核对表` 与 `本次按默认决定的事项`（grep 守护）
- octto.ts effect-first 块仍 NOT byte-identical 与 commander.ts（现有 drift-guard test 强制保留 octto 个性化）
- octto.ts effect-first 块仍含 `brainstorm` / `end_brainstorm` / `design 文档` / `session` 任一关键词（现有 drift-guard test 已强制）

不允许：
- 不要把 octto effect-first 块抄成与 commander byte-identical（会触发现有 drift-guard 失败）
- 不要在 octto.ts 加 `<sub-decision-identification>` phase（octto 不是 brainstormer，不走 understanding 流程）

**Verify:** Batch 2 测试通过即证明语义对齐到位。
**Commit:** `feat(agents): octto effect-first 加语义对齐的 需求核对表 与 本次按默认决定 子规则`

### Task 1.4: planner.ts — 加「执行中不打断用户」硬约束规则（独立块，非镜像）
**File:** `src/agents/planner.ts`
**Test:** none （prompt-only；由 Batch 2.2 grep 守护）
**Depends:** none
**Domain:** general
**Atlas-impact:** none

改动要点：

在 planner.ts 内、`<critical-rules>` 块之后、`<process>` 块之前（或紧挨现有 `<behavior-mapping-rules>` 块），新增独立 XML 块：

```
<no-mid-execution-interrupt priority="critical" description="Sub-decision identification 配套：planner 阶段绝不向用户 surface 新的 architectural sub-decision">
<rule>planner 阶段不允许调用 octto_ask / autoinfo_remote_ask 等任何会中断用户的工具就 architectural sub-decision 提问。</rule>
<rule>发现 brainstorm 阶段漏识别的 architectural sub-decision（满足启发式扩展清单：数字参数 / max 上限 / 默认值 / 阈值 / 策略选择 / 命名 contract / 数据模型字段 / 外部依赖 / breaking 与否）时：
  1. 用最保守 / 最不破坏现有结构 / 最易回滚的默认值
  2. 在 plan 文件相应 task 描述里显式记录「按默认决定: 决策点 → 默认值 → 理由」
  3. 由 executor 在执行阶段聚合后回传给主 agent，最终在终态汇报「实现记录」段「本次按默认决定的事项」子结构 surface
</rule>
<rule>这条规则不引入 byte-identical 镜像；planner / executor / reviewer 三处各自独立加，drift-guard 用 grep-based 关键字符串守护。</rule>
<rule>本规则与现有 `<lifecycle-recovery>` 「ask user」 hint 不冲突：lifecycle 工具失败时仍可向用户 surface 阻塞；本规则仅约束 architectural sub-decision 这一类「本可在 brainstorm 阶段问完」的事项。</rule>
</no-mid-execution-interrupt>
```

修改后必须满足：
- planner.ts 含字符串 `<no-mid-execution-interrupt priority="critical"`
- planner.ts 含字符串 `按默认决定`
- planner.ts 含字符串 `不允许调用 octto_ask`

不允许：
- 不要在 planner.ts 加 `<sub-decision-identification>` phase（planner 不是 brainstormer）
- 不要在 planner.ts 加「需求核对表」（planner 不写终态汇报）
- 不要把 1.4 / 1.5 / 1.6 三处文本写成 byte-identical（design 明确：grep-based 各自独立加）

**Verify:** Batch 2.2 测试通过即证明字符串落地。
**Commit:** `feat(agents): planner 加「执行中不打断用户」硬约束规则`

### Task 1.5: executor.ts — 加「执行中不打断用户」硬约束 + 聚合遗漏 sub-decision 到终态报告
**File:** `src/agents/executor.ts`
**Test:** none （prompt-only；由 Batch 2.2 grep 守护）
**Depends:** none
**Domain:** general
**Atlas-impact:** none

改动要点：

在 executor.ts 内、`<rules>` 块之后或紧邻现有 `<behavior-checkpoint-maintenance>` 块，新增独立 XML 块：

```
<no-mid-execution-interrupt priority="critical" description="Sub-decision identification 配套：executor 阶段绝不向用户 surface 新的 architectural sub-decision；遗漏聚合到终态报告">
<rule>executor 阶段不允许调用 octto_ask / autoinfo_remote_ask 等任何会中断用户的工具就 architectural sub-decision 提问。</rule>
<rule>implementer / reviewer 子 agent 通过 escalate（标准报告字段或 "Sub-decision observation: missing — <决策点> — <建议默认>" 单行）上报漏识别的 architectural sub-decision；executor 自决保守默认（最保守 / 最不破坏现有结构 / 最易回滚），不重新打开 brainstorm，不向用户 surface 中断。</rule>
<rule>executor 在终态汇报回传给 primary agent（brainstormer / commander）时，必须聚合本次执行中所有「按默认决定的事项」清单（来自自身决策 + implementer escalate + reviewer escalate），格式为编号列表：决策点 → 默认值 → 简短理由。primary agent 据此填入终态汇报「实现记录」段「本次按默认决定的事项」子结构。</rule>
<rule>若本次执行未触发任何 sub-decision 默认决定，回传时显式标注「无按默认决定的事项」，让 primary agent 知道可省略该子结构。</rule>
<rule>本规则与现有 `<lifecycle-recovery>` 「ask user」 hint 不冲突：lifecycle 工具失败、PR check 失败、conflict 等运维类阻塞仍可向用户 surface；本规则仅约束 architectural sub-decision 这一类「本可在 brainstorm 阶段问完」的事项。</rule>
<rule>这条规则不引入 byte-identical 镜像；executor / planner / reviewer 三处各自独立加，drift-guard 用 grep-based 关键字符串守护。</rule>
</no-mid-execution-interrupt>
```

修改后必须满足：
- executor.ts 含字符串 `<no-mid-execution-interrupt priority="critical"`
- executor.ts 含字符串 `Sub-decision observation: missing`
- executor.ts 含字符串 `按默认决定的事项`
- executor.ts 含字符串 `不允许调用 octto_ask`

不允许：
- 不要修改现有 `<context-brief>` 块结构（不引入新字段）
- 不要把 1.4 / 1.5 / 1.6 三处文本写成 byte-identical

**Verify:** Batch 2.2 测试通过即证明字符串落地。
**Commit:** `feat(agents): executor 加「执行中不打断用户」+ 聚合遗漏 sub-decision 到终态报告`

### Task 1.6: reviewer.ts — 加「执行中不打断用户」硬约束（leaf agent escalate 路径）
**File:** `src/agents/reviewer.ts`
**Test:** none （prompt-only；由 Batch 2.2 grep 守护）
**Depends:** none
**Domain:** general
**Atlas-impact:** none

改动要点：

在 reviewer.ts 内、`<rules>` 块附近或紧邻现有 `<behavior-drift-detection>` 块，新增独立 XML 块：

```
<no-mid-execution-interrupt priority="critical" description="Sub-decision identification 配套：reviewer 作为 leaf agent，不直接打断用户，发现漏识别 sub-decision 通过 escalate 上报">
<rule>reviewer 阶段不允许调用 octto_ask / autoinfo_remote_ask 等任何会中断用户的工具就 architectural sub-decision 提问。</rule>
<rule>reviewer 是 leaf agent，发现实现里有 brainstorm 阶段漏识别的 architectural sub-decision（满足启发式扩展清单：数字参数 / max 上限 / 默认值 / 阈值 / 策略选择 / 命名 contract / 数据模型字段 / 外部依赖 / breaking 与否）时：
  1. 在 `**Findings**` 段加一行 escalate 标记 `Sub-decision observation: missing — <决策点> — <建议默认或当前实现选择>`
  2. 不直接修改实现，不打断用户，不阻塞 batch
  3. 由 executor 接收 escalate，自决是否本批次内修补 / 登记到终态「按默认决定的事项」清单
</rule>
<rule>若 reviewer 同时发现实现已用了不合理的非保守默认（如直接选了破坏性最大的方案），可在 escalate 行后加一句「建议改为 <更保守值>」；最终决定权在 executor。</rule>
<rule>本规则与现有 `<behavior-drift-detection>` 的 "Behavior observation: drift-lesson" escalate 路径并列，互不替代：行为漂移走 behavior-drift-detection；架构 sub-decision 漏识别走本块。</rule>
<rule>这条规则不引入 byte-identical 镜像；reviewer / planner / executor 三处各自独立加，drift-guard 用 grep-based 关键字符串守护。</rule>
<rule>不修改 reviewer 现有 `final-marker-rule`（verdict 仍是最后一行）。</rule>
</no-mid-execution-interrupt>
```

修改后必须满足：
- reviewer.ts 含字符串 `<no-mid-execution-interrupt priority="critical"`
- reviewer.ts 含字符串 `Sub-decision observation: missing`
- reviewer.ts 含字符串 `不允许调用 octto_ask`
- reviewer.ts 现有 `verdict MUST appear as the LAST line` 字符串仍只出现 1 次（不破坏 behavior-layer test）

不允许：
- 不要修改现有 `<behavior-drift-detection>` 块（与本块并列，不替代）
- 不要修改 reviewer 输出的 `**Findings**` / verdict 段格式
- 不要把 1.4 / 1.5 / 1.6 三处文本写成 byte-identical

**Verify:** Batch 2.2 测试通过即证明字符串落地。
**Commit:** `feat(agents): reviewer 加「执行中不打断用户」escalate 上报路径`

### Task 1.7: AGENTS.md — 新增「## Sub-decision Identification 约定」+「## Requirement Check-off 约定」两节
**File:** `AGENTS.md`
**Test:** none （markdown-only；由 Batch 2.2 grep 守护）
**Depends:** none
**Domain:** general
**Atlas-impact:** none

改动要点：

在 AGENTS.md 内、紧邻现有「## Behavior 段约定」之后（或与之相邻位置，确保 mirror 段集中），新增两节顶层 markdown section。每节遵守现有 AGENTS.md 镜像段约定（drift-guard 来源 + 单源声明）。

**新增 1：`## Sub-decision Identification 约定`**

内容要点（自由排版，但必含以下关键字符串以通过 grep 守护）：
- 节首一句话目的：「brainstormer 在 understanding 阶段必须主动 enumerate 所有 architectural sub-decision 并 batched ask user」
- 启发式扩展清单（数字参数 / max 上限 / 默认值 / 阈值 / 策略选择 / 命名 contract / 数据模型字段 / 外部依赖 / breaking 与否 + AGENTS.md `Decision Autonomy` 表右列）
- channel 选择：复用现有 `Interactive Question Tools` 表（≤3 题 plain chat numbered；≥4 题 octto）
- 遗漏兜底：执行阶段（planner / executor / reviewer / implementer）发现漏识别的 sub-decision，用最保守 / 最不破坏现有结构 / 最易回滚的默认值，由 executor 聚合到终态报告
- 硬约束「执行中不打断用户」：planner / executor / reviewer / leaf agent 全程不能向用户 surface 新的 architectural sub-decision；leaf agent 通过 escalate 上报
- quick-mode / 运维 / executor-direct 可跳过整个 sub-decision identification phase
- Drift guard：单源在 `src/agents/brainstormer.ts` 的 `<sub-decision-identification>` block；本节是 markdown 镜像，drift 由 grep-based test `tests/agents/sub-decision-and-checkoff.test.ts` 守护

**新增 2：`## Requirement Check-off 约定`**

内容要点（自由排版，但必含以下关键字符串以通过 grep 守护）：
- 节首一句话目的：「brainstormer / commander / octto 终态汇报「你可以怎么验收」段必含『需求核对表』，对照 design.md `## 承诺清单 / Commitments` 段每条要求标注 ✓ / ⚠️ / ✗ 三态」
- 表格示例（`| 需求 | 状态 | 备注 |` 表头）
- 已知偏差必须主动列为 ⚠️ 或 ✗，不能省略让用户去发现
- design.md `## 承诺清单 / Commitments` 段是参照源；该段是 frontmatter 之下、Problem Statement 之前的新顶层段；自由格式；quick-mode 可省略
- 「本次按默认决定的事项」子结构：终态「实现记录」段在执行阶段触发保守默认时必含
- brainstormer ↔ commander 整段 effect-first-reporting 通过现有 byte-identical drift-guard 自动守护；octto 语义对齐不强制 byte-identical
- 不引入新 byte-identical 镜像；不引入需求核对表格式校验器（自由格式）；不引入需求核对覆盖率仪表盘
- Drift guard：本节是 markdown 镜像，单源在 `src/agents/brainstormer.ts` / `src/agents/commander.ts` 的 `<effect-first-reporting>` 块内的「需求核对表」+「本次按默认决定的事项」子规则；drift 由 grep-based test 守护

修改后必须满足：
- AGENTS.md 含字符串 `## Sub-decision Identification 约定`
- AGENTS.md 含字符串 `## Requirement Check-off 约定`
- AGENTS.md 含字符串 `需求核对表` 与 `承诺清单`
- AGENTS.md 含字符串 `启发式扩展清单`
- AGENTS.md 含字符串 `Sub-decision observation: missing`（描述 leaf agent escalate 路径）
- AGENTS.md 现有「## Behavior 段约定」标题仍存在（不破坏 behavior-layer test）

不允许：
- 不要替换 / 删除现有任何 AGENTS.md 段
- 不要在两节内嵌入大段 prompt 复制（保留 single-source 在 src/agents/*.ts，本文是镜像描述）

**Verify:** Batch 2.2 测试通过即证明字符串落地。
**Commit:** `docs(agents-md): 新增 Sub-decision Identification 与 Requirement Check-off 两节镜像`

---

## Batch 2: Drift-guard test updates (parallel - 2 implementers)

依赖 Batch 1 全部完成。两个 test 文件独立。
Tasks: 2.1, 2.2

### Task 2.1: 更新现有 byte-identical fixture `tests/agents/effect-first-reporting.test.ts`
**File:** `tests/agents/effect-first-reporting.test.ts`
**Test:** `bun test tests/agents/effect-first-reporting.test.ts`
**Depends:** 1.1, 1.2, 1.3
**Domain:** general
**Atlas-impact:** none

改动要点：

当前 `effect-first-reporting.test.ts` 已经做到了以下事情，本次 issue #73 落地后必须仍然全部 pass，不要破坏：

1. `<effect-first-reporting>` 块在三个 primary（commander / brainstormer / octto）各只出现 1 次（opens=1, closes=1）。
2. 五段标签 `预期表现 / 你可以怎么验收 / 已知限制 / 本次知识上下文 / 实现记录` verbatim。
3. `blocked` / `failed-stop` 异常规则关键字。
4. commander ↔ brainstormer `<effect-first-reporting>` 块 byte-identical。
5. octto NOT byte-identical 与 commander，但含 brainstorm / end_brainstorm / design 文档 / session 任一关键词。
6. 知识上下文 subsection 在三处 byte-identical。
7. AGENTS.md mirror 段 `## Effect-First User-Facing Reports` 含五段标签等。

本次 Task 1.1 / 1.2 / 1.3 改动后，#4 与 #6 会同时增加新文本（「需求核对表」+「本次按默认决定的事项」子规则）；#5 octto 也会加语义对齐版本但仍不同于 commander。本测试文件**无须新增断言**，只需确认以下：

- 跑 `bun test tests/agents/effect-first-reporting.test.ts` 全部 pass。
- 若 commander ↔ brainstormer byte-identical 失败：说明 1.1 / 1.2 抄写出现字符差异，回到 1.1 / 1.2 修正。
- 若 octto byte-identical 与 commander 测试反向触发（octto 与 commander 撞成相同）：说明 1.3 抄太死，回到 1.3 加入 octto 个性化措辞。

判断是否需要加新断言：
- 「需求核对表」+「本次按默认决定的事项」字符串守护由 Batch 2.2 新文件 `sub-decision-and-checkoff.test.ts` 负责，不在本文件加。
- 本文件保持「effect-first 块结构 + byte-identical 关系」语义，不扩展到子规则关键字。这是 design 「不引入新 byte-identical 镜像」边界要求的最小化。

可选小调整（不强制，仅当现有断言因 prompt 改动产生 false positive 时才做）：
- `it("contains all four section labels verbatim", ...)`：当前用 `for (const label of SECTION_LABELS)` 检查；SECTION_LABELS 已含五段，不变。
- 现有 `expect(octtoBody).toMatch(/brainstorm|end_brainstorm|design.{0,20}文档|session/i)` 仍有效；1.3 octto 改动只在已存在的 effect-first 块内追加子规则文本，不会去掉关键字。

最终交付物：
- 文件代码无需新增任何 `expect` 断言（如确实需要，仅追加 1-2 个「需求核对表」+「本次按默认决定」字符串守护断言，但更推荐放在 Batch 2.2 新文件以保持本文件「byte-identical 关系守护」单一职责）。
- 跑测试全 pass。

如出现以下情况需 escalate：
- commander ↔ brainstormer byte-identical 持续失败且 1.1 / 1.2 文本已多次比对一致 → 检查是否模板字符串内含不可见 unicode 字符差异
- octto byte-identical 测试反向触发 → 检查 1.3 是否漏写 octto 角色措辞

**Verify:** `bun test tests/agents/effect-first-reporting.test.ts`
**Commit:** `test(agents): effect-first-reporting fixture 在 1.1/1.2/1.3 落地后仍全 pass（如需微调 sanity 断言一并提交）`

### Task 2.2: 新增 grep-based 单元测试 `tests/agents/sub-decision-and-checkoff.test.ts`
**File:** `tests/agents/sub-decision-and-checkoff.test.ts`
**Test:** `bun test tests/agents/sub-decision-and-checkoff.test.ts`
**Depends:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
**Domain:** general
**Atlas-impact:** none

改动要点：

新建 grep-based 单元测试文件，参照现有 `tests/agents/behavior-layer.test.ts` 模式（见仓库中该文件作为完整模板）。文件结构：

1. 顶部用 `readFileSync` 加载所有相关 prompt 源 + AGENTS.md：
   ```typescript
   const BRAINSTORMER = readFileSync(join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"), "utf-8");
   const COMMANDER = readFileSync(join(__dirname, "..", "..", "src", "agents", "commander.ts"), "utf-8");
   const OCTTO = readFileSync(join(__dirname, "..", "..", "src", "agents", "octto.ts"), "utf-8");
   const PLANNER = readFileSync(join(__dirname, "..", "..", "src", "agents", "planner.ts"), "utf-8");
   const EXECUTOR = readFileSync(join(__dirname, "..", "..", "src", "agents", "executor.ts"), "utf-8");
   const REVIEWER = readFileSync(join(__dirname, "..", "..", "src", "agents", "reviewer.ts"), "utf-8");
   const AGENTS_MD = readFileSync(join(__dirname, "..", "..", "AGENTS.md"), "utf-8");
   ```

2. 用 `describe / it / expect` 覆盖以下断言（每条对应 design / commitments 中一条约束）：

   **`describe("brainstormer.ts sub-decision-identification additions", ...)`：**
   - 含独立 phase block：`expect(BRAINSTORMER).toContain('<phase name="sub-decision-identification"')`
   - 含启发式扩展清单关键词：`expect(BRAINSTORMER).toContain('启发式扩展清单')`
   - 含 channel selection 复用提示：`expect(BRAINSTORMER).toMatch(/AGENTS\.md.*channel|Interactive Question Tools/i)`
   - 含遗漏兜底规则：`expect(BRAINSTORMER).toContain('保守默认')`
   - design.md template 含 Commitments 段：`expect(BRAINSTORMER).toContain('<section name="Commitments" optional="true">')`
   - finalizing 阶段含「承诺清单」产出动作：`expect(BRAINSTORMER).toContain('## 承诺清单')`

   **`describe("brainstormer.ts + commander.ts requirement-checkoff additions", ...)`：**
   - 两者 effect-first 块内含「需求核对表」：`expect(BRAINSTORMER).toContain('需求核对表')` + `expect(COMMANDER).toContain('需求核对表')`
   - 两者 effect-first 块内含「本次按默认决定的事项」：`expect(BRAINSTORMER).toContain('本次按默认决定的事项')` + `expect(COMMANDER).toContain('本次按默认决定的事项')`
   - 三态 ✓/⚠️/✗ 字符串：`expect(BRAINSTORMER).toMatch(/[✓⚠✗]/)`

   **`describe("octto.ts requirement-checkoff semantic alignment", ...)`：**
   - 含「需求核对表」：`expect(OCTTO).toContain('需求核对表')`
   - 含「本次按默认决定的事项」：`expect(OCTTO).toContain('本次按默认决定的事项')`
   - NOT byte-identical 与 commander 的 effect-first（用现有 effect-first-reporting.test.ts 同款抽取逻辑或简单字串差异断言）

   **`describe("planner.ts / executor.ts / reviewer.ts no-mid-execution-interrupt additions", ...)`：**
   - 三处各含独立块：`expect(PLANNER).toContain('<no-mid-execution-interrupt priority="critical"')`、同理 EXECUTOR / REVIEWER
   - 三处各含「不允许调用 octto_ask」：`expect(PLANNER).toContain('不允许调用 octto_ask')`、同理 EXECUTOR / REVIEWER
   - executor 含聚合规则：`expect(EXECUTOR).toContain('按默认决定的事项')`
   - executor 含 leaf escalate 标记：`expect(EXECUTOR).toContain('Sub-decision observation: missing')`
   - reviewer 含 leaf escalate 标记：`expect(REVIEWER).toContain('Sub-decision observation: missing')`
   - reviewer 现有 verdict 规则仍只出现 1 次（不破坏 behavior-layer 测试）：`expect((REVIEWER.match(/verdict MUST appear as the LAST line/g) ?? []).length).toBe(1)`
   - 三处不 byte-identical 任两组合：用简单字串差异断言（如 `expect(PLANNER.match(/<no-mid-execution-interrupt[\s\S]*?<\/no-mid-execution-interrupt>/)?.[0]).not.toBe(EXECUTOR.match(/<no-mid-execution-interrupt[\s\S]*?<\/no-mid-execution-interrupt>/)?.[0])`），覆盖「不引入新 byte-identical 镜像」边界

   **`describe("AGENTS.md mirror sections", ...)`：**
   - 含两节标题：`expect(AGENTS_MD).toMatch(/##\s+Sub-decision Identification 约定/)` + `expect(AGENTS_MD).toMatch(/##\s+Requirement Check-off 约定/)`
   - 含关键字：`需求核对表` / `承诺清单` / `启发式扩展清单` / `保守默认`
   - 不破坏现有 `## Behavior 段约定`：`expect(AGENTS_MD).toMatch(/##\s+Behavior 段约定/)`
   - 含 drift-guard 来源说明（单源声明）：`expect(AGENTS_MD).toMatch(/单源.*brainstormer\.ts|grep-based/i)`

3. 不要写覆盖率类指标 / 不要写承诺清单格式校验器；只做 grep-based 关键字符串守护。

参考已有模式：直接读 `tests/agents/behavior-layer.test.ts` 作模板复用，把 describe 块结构对齐过来。

修改后必须满足：
- 新文件路径：`tests/agents/sub-decision-and-checkoff.test.ts`
- 跑 `bun test tests/agents/sub-decision-and-checkoff.test.ts` 全部 pass
- 跑 `bun test tests/agents/effect-first-reporting.test.ts` 全部 pass（与 2.1 协同）
- 跑 `bun test tests/agents/behavior-layer.test.ts` 全部 pass（不能因 reviewer / brainstormer prompt 改动破坏现有 behavior-layer 测试）
- 跑 `bun test tests/agents/atlas-protocol-injection.test.ts` 全部 pass（不能因 prompt 改动破坏 atlas 协议注入测试）

不允许：
- 不要在新测试里硬编码具体 markdown 表格行（已知偏差行的具体文本由实现时填充，本测试只检查 `| 需求 | 状态 | 备注 |` 表头或 `需求核对表` 字串即可）
- 不要添加任何 byte-identical 断言（design 明确禁止新增 byte-identical 镜像；唯一现有 byte-identical 由 2.1 覆盖）
- 不要 mock 任何模块；只用 `readFileSync` 读源文件 + `toContain` / `toMatch`

**Verify:** `bun test tests/agents/sub-decision-and-checkoff.test.ts && bun test tests/agents/effect-first-reporting.test.ts && bun test tests/agents/behavior-layer.test.ts && bun test tests/agents/atlas-protocol-injection.test.ts`
**Commit:** `test(agents): 新增 sub-decision-and-checkoff grep-based drift-guard 测试`
