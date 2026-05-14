---
date: 2026-05-14
topic: "brainstormer sub-decision identification + 终态需求核对"
status: validated
issue: 73
---

## 承诺清单 / Commitments

> 这是 brainstormer 在 understanding 阶段提炼的「用户原始要求」稳定快照，供终态核对参照。
> 后续 plan / executor / reviewer / 终态汇报 均以本段为对照源。

用户原话：
- "头脑风暴阶段就把全部决策点问好"
- "执行过程中不能打断用户"
- "BDD 防漂移层覆盖不到 architectural sub-decision 被默默决定的情况"
- "终态没核对用户原始需求"

提炼为 8 条具体承诺：

1. **brainstormer 在 understanding 阶段必须 enumerate 全部 architectural sub-decision 并 batched ask user**，遗漏则后续不再补问用户。
2. **执行阶段（planner / executor / reviewer / leaf agent）绝不向用户 surface 新的 architectural sub-decision**，遇遗漏用保守默认 + 终态汇报 surface「本次按默认决定的事项」。
3. **architectural decision 的边界用启发式扩展**：AGENTS.md Decision Autonomy 表 + 数字参数 / max 上限 / 默认值 / 阈值 / 策略选择 / 命名 contract / 数据模型字段 / 外部依赖 / breaking 与否。
4. **batched ask 复用 AGENTS.md 现有 channel selection 表**：≤3 题 plain chat numbered，≥4 题或需 review diff/code/plan 用 octto。
5. **终态汇报新增「需求核对表」**：作为「你可以怎么验收」段的内部子结构，需求条目 → ✓ / ⚠️ 偏差 / ✗ 未实现 三态。
6. **核对参照源是 design.md 顶部「承诺清单」段**（本段自身就是范本）。
7. **brainstormer / commander / octto 三个 primary agent 一致**：sub-decision identification 规则 + requirement check-off 规则三者都加；octto 语义对齐但不强制 byte-identical。
8. **drift-guard 全部 grep-based**：不引入新 byte-identical 镜像（保守派担忧）；复用现有 effect-first-reporting byte-identical 覆盖 brainstormer/commander 内嵌部分。

8 条已在 brainstorm 讨论阶段获用户确认「全默认 OK」。

## Problem Statement

micode 现有工作流（含刚落地的 BDD 防漂移层 issue #69）在两个具体场景仍会出现「开发方向偏离用户需求」：

**案例 1（终态偏差未 surface）**：MCServer FZG-BossSystem 任务里，AI 实现 7 条需求中的 7 条都有偏差（旋转速度 8°/tick 改成 12°/tick、血量 200 颗心 改成 500 HP、装备钻石剑+下界合金套未实现等），但终态汇报「预期表现」段全是仓库操作结果，没核对原始需求。用户追问"有没有偏离需求"才被迫 enumerate 出 7 条偏差。

**案例 2（架构决策被默默决定）**：Studio 并发批量任务里，用户只要求"加并发批量"，AI 在 brainstorm 阶段自己决定了「max=2」这个 architectural 默认值，未问用户。用户在终态质问"我没让你搞额外并发限制，你为什么擅自决策？"

两个案例的根因是同一个：**AI 决定 vs 用户决定的边界识别错误**——一个在终态没主动核对，一个在 brainstorm 没主动 ask。

刚落地的 BDD 防漂移层 issue #69 解决的是「行为承诺通过 5 阶段闭环传递」，但：
- design.md `## Behavior` 段是「系统最终表现」，**不是**「用户原始要求」（案例 1 中 ## Behavior 即使有也只会写"插件能召唤 Boss"，不会写"旋转 8°/tick"这种细节）
- BDD 防漂移层在 quick-mode / executor-direct 是 opt-out（案例 2 的 Studio 任务大概率走 executor-direct 跳过整层）
- BDD 防漂移层只 enforce reviewer 在实现后检查行为一致性，**不 enforce brainstormer 在事前 enumerate sub-decision**

需要补两个新机制，与 BDD 防漂移层互补。

## Constraints

- 不破坏 `tests/agents/effect-first-reporting.test.ts` 现有 byte-identical drift-guard（brainstormer ↔ commander）；只在现有 effect-first 块内调整内容生成规则
- 不破坏 effect-first-reporting 五段结构；「需求核对表」作为「你可以怎么验收」段内部子结构，不引入第六段
- 不破坏 design.md 9 段 + `## Behavior`（第 10 段）顺序；「承诺清单」作为 frontmatter 之下、Problem Statement 之前的顶层段
- 不引入新 byte-identical 镜像（保守派担忧 drift-guard 矩阵爆炸）；新增规则用 grep-based 单元测试守护关键字符串
- 不修改 lifecycle 工具代码、Atlas schema、Project Memory schema、.mindmodel/
- 硬约束「执行过程中不打断用户」：planner / executor / reviewer / leaf agent 全程不能向用户 surface 新的 architectural sub-decision；遇遗漏用保守默认 + 终态汇报列出
- sub-decision identification 复用 AGENTS.md channel-selection 表（≤3 题 plain chat，≥4 题 octto）；不引入独立通道判断逻辑
- small decision 仍由 agent 自决（AGENTS.md Decision Autonomy 表左列）；新规则只强制 architectural 类启发式扩展后的决策点必问

## Approach

**核心命题**：「sub-decision identification（事前问全）」+「requirement check-off（事后核对）」是同一根因「AI 决定 vs 用户决定边界识别」的双面解。两条规则一起加，与 BDD 防漂移层 issue #69 互补。

**与 BDD 防漂移层的分工**：

| 层 | 覆盖什么 | 触发时机 |
|---|---|---|
| BDD 防漂移层（issue #69） | 系统最终表现 vs 实现是否漂移 | reviewer + 终态 |
| sub-decision identification（本次） | architectural sub-decision 是否问全 | brainstormer understanding |
| requirement check-off（本次） | 用户原始要求 vs 最终实现 | brainstormer / commander / octto 终态 |

三层叠加形成完整防漂移：事前问全 → 中间不打断 → 事后核对。

**Sub-decision identification 工作流**：

1. brainstormer 在 understanding 阶段（gathered codebase context 后）做一次显式 enumeration
2. 对照启发式扩展清单（数字参数 / max 上限 / 默认值 / 阈值 / 策略选择 / 命名 contract / 数据模型字段 / 外部依赖 / breaking 与否）扫描用户原始需求
3. 列出所有符合启发式的决策点 + 选项 + 推荐默认 + 一句话理由
4. 按 AGENTS.md channel-selection 表选通道（≤3 plain chat numbered；≥4 octto）
5. 用户回复 `1: A, 2: B, ...` 或 "全默认 OK"
6. 用户确认后进 lifecycle_start_request

**遗漏兜底规则**：

执行阶段（planner / executor / reviewer / implementer）发现 brainstorm 漏识别的 architectural sub-decision：
- **必须**用「最保守 / 最不破坏现有结构 / 最易回滚」的默认值
- **必须**在终态汇报「实现记录」段下列出「本次按默认决定的事项」清单
- **不允许**向用户 surface 中断流程

**Requirement check-off 工作流**：

终态汇报「你可以怎么验收」段必含一个表格，列出 design.md 「承诺清单」段每条要求的实现状态：

| 需求 | 状态 | 备注 |
|---|---|---|
| 用户原话 1 | ✓ | 实现路径 |
| 用户原话 2 | ⚠️ | 实现了 80%，未覆盖 X 子项 |
| 用户原话 3 | ✗ | 未实现，原因 Y |

**已知偏差必须 ⚠️ 或 ✗ 主动列出，不能省略让用户去发现**。

## Architecture

```
brainstorm 阶段
  ↓
brainstormer understanding phase（gather codebase context）
  ↓
brainstormer <sub-decision-identification> checkpoint
  ├─ 扫描用户原始需求 对照启发式扩展清单
  ├─ enumerate sub-decisions + 推荐默认
  └─ batched ask user（≤3 chat / ≥4 octto）
  ↓
用户确认 / 改默认
  ↓
brainstormer 写 design.md
  ├─ frontmatter
  ├─ ## 承诺清单（用户原话 + 本轮 batched ask 决定的 sub-decision 全列出）  ← 新增
  ├─ ## Problem Statement → ## Open Questions（9 段不变）
  └─ ## Behavior（第 10 段，issue #69 已有）
  ↓
planner / executor / reviewer / implementer 全程引用承诺清单
  ↓
执行中发现遗漏 sub-decision
  ├─ 用保守默认（不打断用户）
  └─ 记录到「本次按默认决定的事项」清单
  ↓
终态汇报（brainstormer / commander / octto）
  ├─ 预期表现
  ├─ 你可以怎么验收
  │  └─ 需求核对表（对照 ## 承诺清单 每条 ✓/⚠️/✗）  ← 新增子结构
  ├─ 已知限制
  ├─ 本次知识上下文
  └─ 实现记录
     └─ 本次按默认决定的事项（如有）  ← 新增子结构
```

## Components

### Component 1: brainstormer `<sub-decision-identification>` block

位置：brainstormer.ts 在 `<process>` 块的 `<phase name="understanding">` 之后、`<phase name="exploring">` 之前新增独立 phase `<phase name="sub-decision-identification">`。

prompt 内容要点：

- 显式 enumeration checklist 触发：用户描述非平凡需求 + intent-classification 非 quick-mode
- 启发式扩展清单（必扫描的决策类型）：
  - 数字参数（max / min / default / timeout / 上限 / 阈值）
  - 策略选择（队列调度 / retry 模式 / 错误处理路径）
  - 命名 contract（API 路径 / 数据库字段名 / 配置键）
  - 数据模型字段（新表结构 / schema 字段）
  - 外部依赖（库选择 / 服务接入）
  - breaking 与否（API 兼容、迁移策略）
  - AGENTS.md Decision Autonomy 表右列全部
- batched ask 格式：编号 + 选项 A/B/C/D + 推荐默认 + 一句话理由
- channel 选择：复用 AGENTS.md 现有 channel-selection 表
- 用户「全默认 OK」/「全 OK 但 X 改 Y」/逐条作答 三种格式都接受
- 用户确认后进入 lifecycle_start_request，本 phase 之后不再问用户 architectural decision
- quick-mode / 运维 / executor-direct 可跳过本 phase

### Component 2: brainstormer `<phase name="finalizing">` 加「承诺清单」产出

brainstormer 在写 design.md 时，frontmatter 下、`## Problem Statement` 之前新增 `## 承诺清单 / Commitments` 段：

- 用户原话引用（最初 message + 中途澄清的具体要求）
- 本次 sub-decision identification batched ask 的全部决策点 + 用户确认的选项
- 提炼为可核对的承诺条目

非 quick-mode 任务必须产出。quick-mode 可省略。

### Component 3: brainstormer + commander + octto `<effect-first-reporting>` 加 `<requirement-checkoff>` 子规则

在三个 primary agent 的 `<effect-first-reporting>` 块内、「你可以怎么验收」section 的子规则下新增：

> 如果 design.md 有 `## 承诺清单` 段，「你可以怎么验收」段必含一个核对表（| 需求 | 状态 | 备注 |），状态用 ✓ / ⚠️ / ✗ 三态；已知偏差必须主动列为 ⚠️ 或 ✗，不能省略让用户去发现。

brainstormer ↔ commander 之间通过现有 effect-first-reporting byte-identical drift-guard 自动守护。octto 用语义对齐版本（不强制 byte-identical），文字适配 octto 角色。

### Component 4: brainstormer + commander + octto `<effect-first-reporting>` 加「本次按默认决定的事项」子规则

在三个 primary agent 的 `<effect-first-reporting>` 块内、「实现记录」section 的子规则下新增：

> 如果执行阶段（planner / executor / reviewer / implementer）发现 brainstorm 阶段漏识别的 architectural sub-decision，按保守默认决定后必须在「实现记录」段列出「本次按默认决定的事项」清单：决策点 → 默认值 → 简短理由。如无此类情况则省略本子结构。

### Component 5: planner / executor / reviewer prompt 加「执行中不打断用户」硬约束

在 planner.ts / executor.ts / reviewer.ts 各加一条规则（非镜像，各自独立）：

> 执行阶段绝不向用户 surface 新的 architectural sub-decision 中断流程。发现 brainstorm 阶段漏识别的决策点时：
> 1. 用最保守 / 最不破坏现有结构 / 最易回滚的默认值
> 2. 记录到本 batch / 本 task 报告里的「按默认决定」字段
> 3. 由 executor 聚合后回传给主 agent，最终在终态汇报「实现记录」段 surface

这条规则不镜像（不属于 byte-identical 约束）；只在三个 agent 各自 prompt 加 grep 守护字符串。

### Component 6: AGENTS.md 加镜像段

新增两节：
- `## Sub-decision Identification 约定`：说明 brainstormer 行为 + 启发式扩展清单 + 遗漏兜底规则
- `## Requirement Check-off 约定`：说明终态需求核对表 + 已知偏差 surface 规则

drift-guard：grep-based 测试守护关键字符串存在，不强制 byte-identical。

## Data Flow

```
用户提需求
  ↓
brainstormer understanding（gather context）
  ↓
brainstormer sub-decision-identification:
  scan 启发式扩展清单 → enumerate decision points → batched ask
  ↓
用户确认 ("全默认 OK" / "改 X" / 逐条)
  ↓
brainstormer finalizing:
  写 design.md，## 承诺清单 段含用户原话 + 已确认 sub-decision
  ↓
lifecycle_start_request → planner
  ↓
planner 读 design.md（含承诺清单），plan.md 行为承诺映射 + 任何遗漏 sub-decision 用保守默认（不打断用户）
  ↓
executor 派 implementer / reviewer（context-brief 含承诺清单引用）
  ↓
任何执行阶段发现遗漏 sub-decision → 保守默认 + 记录到「按默认决定」字段（不打断用户）
  ↓
executor 聚合所有遗漏决定
  ↓
brainstormer / commander 终态汇报:
  ├─ 你可以怎么验收 → 需求核对表（对照承诺清单 ✓/⚠️/✗）
  └─ 实现记录 → 本次按默认决定的事项（如有）
  ↓
lifecycle_finish
```

## Error Handling

**brainstormer 在 understanding 阶段漏识别 sub-decision**：
- 后续执行阶段用保守默认兜底
- 终态汇报「实现记录」surface
- 用户读终态可纠正

**用户对 batched ask 回答含糊（如"看着办"）**：
- brainstormer 用推荐默认 + 在 ## 承诺清单 段标注「未明确决定，本次按默认 X」
- 后续可补 lifecycle 调整

**执行阶段 implementer / reviewer 想中断问用户**：
- 协议层禁止
- implementer / reviewer 用 escalate 上报给 executor
- executor 自决（用保守默认）+ 记录
- 绝不调用 octto_ask / autoinfo_remote_ask 等中断用户的工具

**终态需求核对表写不出来（因为承诺清单 vs 实现对应不清楚）**：
- 主 agent 必须诚实标 ⚠️ + 理由
- 不允许跳过整个核对表

**承诺清单本身有歧义（用户原话措辞模糊）**：
- brainstormer 在 understanding 阶段就在 batched ask 中澄清
- 进入 lifecycle 后承诺清单是 frozen，不再改

## Testing Strategy

### Drift-guard 测试更新

**唯一需要更新的现有 drift-guard**：
- `tests/agents/effect-first-reporting.test.ts`：brainstormer / commander 的 effect-first 块 byte-identical fixture 更新（新增「需求核对表」+「本次按默认决定」子规则）

**保持不变**：所有其它 drift-guard / boundary 测试。

### 新增测试

新增 1 个 grep-based 单元测试文件 `tests/agents/sub-decision-and-checkoff.test.ts`，覆盖：
- brainstormer.ts 含 `<sub-decision-identification>` block 关键字符串
- brainstormer.ts 的 design.md template 含「承诺清单 / Commitments」段说明
- brainstormer.ts / commander.ts 含「需求核对表」子规则关键字符串
- brainstormer.ts / commander.ts 含「本次按默认决定」子规则关键字符串
- octto.ts 含语义对齐版本关键字符串
- planner.ts / executor.ts / reviewer.ts 各含「执行中不打断用户」硬约束关键字符串
- AGENTS.md 含「## Sub-decision Identification 约定」+「## Requirement Check-off 约定」段

### 不引入

- 不引入新 BDD / 行为测试框架
- 不引入承诺清单格式校验器（自由格式）
- 不引入需求核对表覆盖率指标

### Dogfooding 验收

本 design 落地后，下一个非平凡新任务时观察：
- brainstormer understanding 阶段是否主动 enumerate sub-decisions 并 batched ask
- design.md 是否含 ## 承诺清单 段
- 终态汇报「你可以怎么验收」段是否含需求核对表
- 如果执行阶段有遗漏 sub-decision，「实现记录」段是否 surface

## Open Questions

1. **启发式扩展清单的完整性**：当前列了 9 类（数字 / 策略 / 命名 / 数据 / 依赖 / breaking + AGENTS.md 表）。落地后 1-2 个月观察实际遗漏情况，可能需扩展（如「错误处理路径选择」「日志级别策略」「测试覆盖范围决定」）。

2. **执行阶段「按默认决定」的可逆性**：用保守默认后用户在终态发现不对，是开新 lifecycle 修正还是原 lifecycle 补救？当前选 A（开新 lifecycle）更干净；落地后看用户实际使用习惯。

3. **承诺清单与 issue body 的同步**：design.md 顶部承诺清单 vs lifecycle issue body 是否要做双向同步？当前选「不同步」（issue body 沿用现有模板，承诺清单只活在 design.md），减少 drift 风险；落地后看是否需要让 issue body 也 surface 承诺清单。

## Behavior

- brainstormer 在 understanding 阶段（gather codebase context 后）自动扫描启发式扩展清单（数字参数 / max 上限 / 默认值 / 阈值 / 策略选择 / 命名 contract / 数据模型字段 / 外部依赖 / breaking 与否 + AGENTS.md Decision Autonomy ASK 类），enumerate 所有 architectural sub-decision，按 ≤3/≥4 题选通道 batched ask user with recommended defaults。quick-mode / 运维 / executor-direct 可跳过。
- brainstormer 在 finalizing 阶段写 design.md 时，frontmatter 之下、Problem Statement 之前必含 `## 承诺清单 / Commitments` 段（用户原话 + batched ask 已确认 sub-decision）。
- planner / executor / reviewer / implementer 全程绝不向用户 surface 新的 architectural sub-decision；遇遗漏用保守默认 + 在终态汇报「实现记录」段列出。
- brainstormer / commander 的终态汇报「你可以怎么验收」段必含需求核对表（对照 design.md `## 承诺清单`，三态 ✓/⚠️/✗），已知偏差主动 surface。octto 语义对齐但不强制 byte-identical。
- brainstormer / commander 的终态汇报「实现记录」段如有遗漏 sub-decision 按默认决定，必须列出「本次按默认决定的事项」清单。
- 验收方式：本 design 落地后开下一个非平凡新任务，看 brainstormer 是否在 understanding 阶段主动 batched ask sub-decision、看 design.md 是否含 ## 承诺清单、看终态汇报「你可以怎么验收」段是否含需求核对表。

> Atlas 关联：本次落地完成后将更新 atlas/20-behavior/brainstorm-plan-implement-workflow 节点（在 BDD 防漂移层 mechanics 段追加 sub-decision identification + requirement check-off 描述），并新建 atlas/40-decisions/sub-decision-identification-and-checkoff 节点记录「事前问全 + 事后核对」决策。具体由 executor 在 batch 完成后做。
