---
date: 2026-05-13
topic: "micode 轻量 BDD 防漂移层"
status: validated
issue: 69
---

## Problem Statement

micode 当前工作流在「用户需求 → 实现」之间缺少显式的行为承诺锚点。用户提的需求会随着 brainstorm 演化、随着 plan 拆解、随着 executor 实现而逐渐漂移，最终用户在终态汇报里读到的可能与最初讨论的预期不完全一致。

具体表现：

- brainstorm 阶段讨论收敛后，「用户可见行为」只存在于对话上下文里，没落到文档
- planner 拆 task 时容易遗漏某条行为承诺
- implementer 实现时不知道行为边界，容易过度扩展或保守裁剪
- reviewer 仅检查代码-design 一致性，不专门检查「行为 vs 实现」
- 终态汇报有时与最初承诺脱节

需要给 micode 加入「行为驱动」机制，但必须满足：

- 高效率：不引入企业级 BDD 仪式（Gherkin / .feature 文件 / 覆盖率仪表盘）
- 适合个人开发：自由格式、可省略、不卡死循环
- 防漂移：5 个阶段（brainstorm / planner / executor / reviewer / 终态汇报）都有机制
- 用户不维护知识库：Atlas / Project Memory 维护全部由 agent 自动完成

## Constraints

- 不破坏 `tests/lifecycle/atlas-boundary.test.ts`：不让 lifecycle 工具自动 spawn atlas-compiler 或写 atlas vault；Atlas 维护由 agent 在 prompt 协议自驱动
- 不破坏 `tests/lifecycle/project-memory-boundary.test.ts`：不改 `promoteOnLifecycleFinish` 默认值；promote 由 agent 显式判断触发
- 不动 Atlas frontmatter schema、不引入 `scenarios[]` 数组、不引入 `atlas_target` 字段、不引入 `atlas-behavior:<slug>` entity 前缀约定
- 不破坏 design.md 现有 9 段顺序（Problem Statement / Constraints / Approach / Architecture / Components / Data Flow / Error Handling / Testing Strategy / Open Questions）—— `## Behavior` 作为可选第 10 段追加
- 不破坏 plan.md task 字段（File / Test / Depends / Domain / Atlas-impact）；`## 行为承诺映射` 作为文件开头新增段，不动 task 模板
- 不破坏 reviewer 输出 final-marker-rule（verdict 仍单独最后一行 APPROVED / CHANGES REQUESTED）；行为一致性作为现有 Findings 段下的软子项
- 不破坏 effect-first-reporting 五段结构（预期表现 / 你可以怎么验收 / 已知限制 / 本次知识上下文 / 实现记录）；只在段内调整内容生成规则
- effect-first-reporting 在 brainstormer.ts 和 commander.ts 之间保持 byte-identical（drift-guard 测试 `tests/agents/effect-first-reporting.test.ts` 强制）
- `## Behavior` 段是可选的；quick-mode / 运维 / executor-direct / 用户显式跳过 时可整段省略
- 个人开发轻量：自由格式（bullet / 段落 / 三段式都行），不强制结构化、不强制 ID、不强制字数限制、不强制每个 task 关联场景
- 用户从不直接编辑 Atlas / Project Memory / thoughts/ 文件；所有维护由 agent 自动完成，用户通过对话指令让 agent 修改

## Approach

**核心命题**：BDD 是 micode 已有协议的「表达升级」和「防漂移锚点」，不是新层。

把 BDD 防漂移要求挂到 micode 已有的协议钩子上：

- `ATLAS_MENTAL_MODEL_PROTOCOL` Maintain 步骤 → 承载行为长期沉淀
- `PROJECT_MEMORY_PROTOCOL` Maintain 步骤 → 承载行为决策和漂移教训
- `effect-first-reporting` 五段 → 自动对齐 design.md `## Behavior`
- reviewer Findings 段 → 加行为一致性子项
- executor context-brief → 加行为承诺指向
- planner plan.md 模板 → 加行为承诺映射段

**全 agent 驱动**：

- 用户只写 design 讨论或对 agent 提需求
- Atlas / Project Memory 维护全部由 agent 在 prompt 协议中主动完成
- 用户在终态汇报「本次知识上下文」段就能看到所有变化

**5 阶段防漂移闭环**：

| 阶段 | 漂移风险 | 防漂移机制 |
|---|---|---|
| brainstorm | 需求只在对话里，未落到文档 | design.md 末尾追加 `## Behavior` 段（brainstormer 主动产出） |
| planner | plan 漏覆盖某条行为 | plan.md 开头加 `## 行为承诺映射` 段 |
| executor | implementer 不知道行为边界 | context-brief 加一行指向 ## Behavior |
| reviewer | 实现偏离承诺没被发现 | Findings 段加「行为一致性」子项 |
| 终态汇报 | 用户看到的与承诺脱节 | 预期表现 / 你可以怎么验收 与 ## Behavior 对齐 |

**为什么不选其它方案**：

- **不选 Gherkin / 结构化场景**（拒绝原因：违反「可以写注释里」的轻量精神；个人开发不需要团队协作工具链）
- **不选双层架构 + atlas_target 字段**（拒绝原因：用户在 brainstorm 时被迫预判 Atlas 节点结构，认知负担过重；红队指出在并发 lifecycle 下有写竞态）
- **不选 sink-to-Atlas 自动化**（拒绝原因：触碰 `tests/lifecycle/atlas-boundary.test.ts` 边界；让 Atlas 维护回归 atlas-mental-model 协议的现有 Maintain checkpoint）
- **不选 reviewer 漂移强制 CHANGES REQUESTED**（拒绝原因：会引发 implementer-reviewer 循环卡死；保留 reviewer 判断空间）
- **不选 plan task 加 Covers 字段 + 覆盖矩阵自检**（拒绝原因：破坏 plan task 模板；planner 用自然语言映射更轻）

## Architecture

```
brainstorm:  design.md ## Behavior 段（用户视角，自由格式）
              │ brainstormer 写完即 atlas_lookup 评估关联
              ▼
planner:     plan.md ## 行为承诺映射 段（每条 Behavior → 对应 task）
              │ planner 主动 atlas_lookup 查现有约束
              ▼
executor:    context-brief 指向 ## Behavior 段
              │ 每个 batch reviewer 通过后 Maintain atlas/20-behavior
              ▼
implementer: 按 ## Behavior 实现，不擅自扩展
              │
              ▼
reviewer:    Findings 段加「行为一致性」子项
              │ 发现明显漂移时自动 promote lesson
              ▼
终态汇报:    预期表现 / 你可以怎么验收 对齐 ## Behavior
              │ 主 agent 最后一次 Atlas 审视
              ▼
Atlas:       atlas/20-behavior 节点已自动更新
Project Memory: 行为决策 / 漂移教训已自动 promote
```

**用户视角**：

- 想看变化 → 读终态汇报「本次知识上下文」段
- 想改 Atlas 节点 → 对 agent 说「atlas/20-behavior/X 改成 Y」→ agent 改
- 想看历史 → 对 agent 说「查 X 行为的历史决策」→ agent 用 project_memory_lookup
- 想清理 PM → 对 agent 说「忘掉 X」→ agent 用 project_memory_forget

## Components

### Component 1: design.md `## Behavior` 段

位置：现有 9 段模板末尾追加（不破坏前 9 段顺序）。

格式：自由形式，无强制结构。建议示例：

```markdown
## Behavior

- 多轮对齐第 3 轮 brainstormer 强制输出「锁定 / 新增 / 未决」三段
- 第 3 轮仍有未决约束时输出 escalate 摘要让用户选 降级 / 加第 4 轮 / 终止
- quick-mode 不受影响
- 验收：开新对话连续提到第 4 轮，看第 3 轮是否收敛

> Atlas 关联：本次行为对应 atlas/20-behavior/multi-round-alignment（如不存在则新建）。具体节点更新由 executor 在 batch 完成后做。
```

brainstormer 在 `<phase name="finalizing">` 必须主动产出（quick-mode / 运维 / executor-direct 可整段省略）。

写完立即 atlas_lookup 评估对应 20-behavior 节点关联，用自然语言（不是结构化字段）注明在 design.md 里。

### Component 2: plan.md `## 行为承诺映射` 段

位置：plan 文件开头（在依赖图之前）。

格式：自然语言列表。

```markdown
## 行为承诺映射

design.md ## Behavior 段列出 N 条行为：

- 行为 1（多轮对齐第 3 轮强制综合）→ 由 Batch 1 Task 1.1, 1.2 实现
- 行为 2（escalate 摘要）→ 由 Batch 1 Task 1.3 实现
- 行为 3（quick-mode 不受影响）→ 由 Batch 2 Task 2.1（测试）验证
- 行为 4（验收方式）→ 不需要 task，是验证手段
```

planner 在拆分 task 时主动 atlas_lookup 查相关 20-behavior 节点，避免遗漏现有约束。

漏覆盖时不阻塞 plan，但 planner 必须显式说「行为 X 没对应 task，因为 Y」。

### Component 3: context-brief 行为指向

executor 派 leaf agent 时，brief 的 `<confirmed>` 段加一行：

```
本次 Task 对应的行为承诺：见 thoughts/shared/designs/.../design.md 的 ## Behavior 段。
其中本 task 实现「<具体行为>」这一条；其它条目由其它 task 负责。
```

不 verbatim 贴整段（避免 brief 膨胀超过 4KB 预算）。implementer 自己 read design.md 全文。

### Component 4: reviewer 行为一致性子项

reviewer 报告现有 Findings 段下加软子项。默认情况：

```markdown
**Findings**
- 行为一致性：✓ 实现与 design.md ## Behavior 一致

**Summary**: ...

APPROVED
```

发现明显漂移时升级：

```markdown
**Findings**
- 行为一致性：⚠️ 实现额外加了「第 5 轮自动归档」行为，design.md ## Behavior 没声明
  → 已 promote lesson: "implementer 倾向过度扩展 escalate 路径，需在 Behavior 段明确边界"

**Summary**: 行为偏离需要回退或补 Behavior 声明

CHANGES REQUESTED: 实现引入了未声明的行为
```

不强制 CR。reviewer 用判断力区分：

- **轻微补全**（不矛盾 Behavior 任何描述，只是补全实现细节）→ 不阻塞，可在 Findings 提示
- **明显漂移**（与 Behavior 某条描述矛盾，或引入未声明的用户可见新行为）→ CHANGES REQUESTED

### Component 5: 终态汇报对齐规则

brainstormer.ts 和 commander.ts 的 `<effect-first-reporting>` 块加规则：

> 如果 design.md 有 ## Behavior 段，「预期表现」段应与之语义一致；「你可以怎么验收」段应包含 Behavior 段提到的验收方式。没有 Behavior 段时按常规生成。

不新增 `Scenario coverage: N/M` 状态行（保留五段结构）。

drift-guard 镜像同步更新（brainstormer / commander byte-identical）。

### Component 6: agent 自动 Maintain Atlas / Project Memory

挂到现有协议（不引入新协议块）。

**Atlas 维护时机**：

- **brainstormer** 写完 ## Behavior 时：`atlas_lookup` 评估对应 20-behavior 节点，在 design.md 注明关联（不直接改 atlas 文件）
- **executor** 在每个 batch reviewer 通过后：判断本批次落地的行为是否需要更新 atlas/20-behavior，是则 read + edit 节点；在 batch 报告里说明 Atlas 维护动作
- **主 agent**（brainstormer / commander）在终态前：最后一次 Atlas 审视，处理累计沉淀

**Project Memory 维护时机**：

- **brainstormer** 拍板架构层级行为决策：`project_memory_promote` decision
- **reviewer** 发现可复用漂移教训：`project_memory_promote` lesson
- 用户明确「先放着」→ `project_memory_promote` open_question

**Agent 自动判断「值得沉淀」的准则**（写在 prompt 协议里）：

沉淀到 atlas/20-behavior 的条件（满足任一即沉淀）：

- 跨 lifecycle 都成立的硬约束（如「不 force push」、「ownership 预检」）
- 影响多个 agent / 跨模块的用户可见行为
- 与现有 atlas/20-behavior 节点描述的某个行为存在修订 / 补充 / 废除关系
- 用户在 brainstorm 中明确表达「这是项目长期规则」

不沉淀的条件：

- 一次性临时配置调整
- 单次实验性行为（用户说「先这样试试」）
- quick-mode 路径下的小补丁
- 仅 UI 文案微调

Project Memory promote 准则：

- `decision`：拍板的长期取舍
- `lesson`：reviewer 发现的可复用漂移教训（不是单次 bug fix）
- `open_question`：用户明确说「先放着等以后再决定」
- 不 promote：未拍板的设想、临时讨论、单次 bug fix

## Data Flow

```
用户提出新需求
  ↓
brainstormer 多轮对齐
  ↓
brainstormer 收敛 → 写 design.md（含 ## Behavior 段 + Atlas 关联自然语言注释）
  ↓
brainstormer 调 lifecycle_record_artifact(design)
  ↓
planner 读 design.md → 拆 plan.md（含 ## 行为承诺映射 段）
  ↓
executor 派 leaf agent（context-brief 含行为指向）
  ↓
implementer 实现 → reviewer 审查（Findings 含行为一致性）
  ↓ reviewer 通过
executor 评估 Atlas Maintain → 自动 read + edit atlas/20-behavior
  ↓
reviewer 发现漂移 → 自动 project_memory_promote lesson
  ↓
循环直到所有 batch 完成
  ↓
主 agent 终态前最后一次 Atlas 审视
  ↓
终态汇报（五段结构，含本次知识上下文：Atlas status / Project Memory status）
  ↓
lifecycle_finish
```

## Error Handling

**brainstormer 在 finalizing 漏写 ## Behavior 段**：

- quick-mode 任务：合规，无问题
- 非 quick-mode 任务：brainstormer prompt 加规则「finalizing 必须主动产出 ## Behavior 段」。如漏写，由 reviewer 在 batch 通过时反向提示用户回 brainstorm 补充

**planner 漏覆盖某条 ## Behavior**：

- 不阻塞 plan
- planner 在 ## 行为承诺映射 段必须显式说「行为 X 没对应 task，因为 Y」
- 用户读 plan 时能立即发现并要求 agent 补 task

**reviewer 行为一致性误判**：

- false positive（合理实现被判漂移）：reviewer 默认 ✓，只在明显偏离时升级；implementer 可在下一轮 reviewer 报告中说明理由
- false negative（漂移未被发现）：lesson 累积后下次 reviewer prompt 强化
- 不强制 CR，避免循环卡死

**executor Maintain Atlas 失败**：

- 不阻塞 lifecycle finish
- 主 agent 在终态前最后一次审视，处理累计沉淀
- 失败原因记录在终态汇报「本次知识上下文」段，由用户决定后续

**Agent 判断「什么值得沉淀」不一致**：

- 准则写在 prompt 协议里足够具体（满足条件之一即沉淀）
- 用户读终态汇报就能看到判断结果
- 不一致时跟 agent 说「这个应该沉淀」，agent 补

**并发 lifecycle 的 Atlas 写竞态**：

- 当前依赖 atlas 协议的现有冲突机制（stale-detected）+ delta fallback（thoughts/shared/atlas-deltas/）
- 不引入新锁
- 落地后 1-2 个月观察实际竞态频率，必要时考虑节点级 last_maintained 时间戳

## Testing Strategy

### Drift-guard 测试更新

**唯一需要更新的现有 drift-guard**：

- `tests/agents/effect-first-reporting.test.ts`：brainstormer / commander 的 effect-first 块 byte-identical fixture 更新

**保持不变**：

- `tests/agents/specialist-routing.test.ts`
- `tests/agents/atlas-mental-model.test.ts`
- `tests/agents/atlas-protocol-injection.test.ts`
- `tests/agents/project-memory-protocol.test.ts`
- `tests/agents/agents-md-lifecycle-recovery.test.ts`
- `tests/lifecycle/atlas-boundary.test.ts`
- `tests/lifecycle/project-memory-boundary.test.ts`

### 新增测试（按需，最小）

- 单元测试：brainstormer prompt 含 `## Behavior` 段约定字符串
- 单元测试：planner prompt 含 `## 行为承诺映射` 约定字符串
- 单元测试：executor context-brief 模板含行为指向字符串
- 单元测试：reviewer prompt 含「行为一致性」子项约定字符串

### 不引入

- 不引入 BDD 测试框架（Cucumber / Jest-cucumber 等）
- 不引入 Gherkin parser
- 不引入覆盖率指标自动校验
- 不引入 `## Behavior` 段格式校验器（自由格式）

### 验收（dogfooding）

本 design 落地后，下一次新任务用本机制走一遍：

- design.md 是否自然产出 `## Behavior` 段
- plan.md 是否自然产出 `## 行为承诺映射` 段
- executor batch 报告里是否能看到 Atlas Maintain 动作
- reviewer 是否在 Findings 写「行为一致性」子项
- 终态汇报「预期表现 / 你可以怎么验收」是否与 `## Behavior` 对齐
- 终态汇报「本次知识上下文」段是否如实反映 Atlas / Project Memory 自动维护

## Open Questions

1. **agent 自动判断「什么值得沉淀」的稳定性**：不同 brainstormer 实例对同一类行为的沉淀判断可能不一致。落地后 1-2 个月观察实际不一致频率，必要时强化 prompt 准则或加入对比示例。

2. **executor batch 内 Atlas Maintain 的并发安全**：micode 支持多 worktree 并发 lifecycle，两个 executor 同时改同一个 atlas/20-behavior 节点的概率虽低但存在。当前依赖 atlas 协议的现有冲突机制（stale-detected）+ delta fallback，不引入新锁。

3. **reviewer 漂移自动 promote lesson 的噪音控制**：reviewer 每次发现漂移都 promote 可能造成 PM 噪音。准则限制「只 promote 可复用 lesson，单次特定情况不 promote」。落地后用 `project_memory_health` 监控 lesson 增长率。

## Behavior

- brainstormer 在 finalizing 阶段必须主动产出 design.md 末尾的 `## Behavior` 段（quick-mode / 运维 / executor-direct / 用户显式跳过 时可省略整段）；写完立即调 `atlas_lookup` 评估对应 atlas/20-behavior 节点，并在 design.md 里用一句自然语言注明 Atlas 关联
- planner 在 plan.md 文件开头自动产出 `## 行为承诺映射` 段，用自然语言列出每条 `## Behavior` 对应的 task；漏覆盖时显式说明理由（不阻塞 plan）
- executor 派 leaf agent 时，context-brief `<confirmed>` 段含一行指向 design.md `## Behavior`；executor 在每个 batch reviewer 通过后主动判断是否需要更新 atlas/20-behavior 节点，并在 batch 报告里说明 Atlas 维护动作
- reviewer 在现有 Findings 段下输出「行为一致性」子项；默认 `✓` 一句话过，发现明显漂移时升级为 `⚠️` 并自动判断是否 `project_memory_promote` 一条 lesson；verdict 仍单独最后一行（不破坏 final-marker-rule）
- 终态汇报的「预期表现」和「你可以怎么验收」段与 design.md `## Behavior` 段语义一致；「本次知识上下文」段如实反映 Atlas / Project Memory 自动维护动作（Atlas status / Project Memory status 两行）
- 用户从不直接打开 atlas/ / Project Memory SQLite / thoughts/ 文件；想改时跟 agent 说，agent 完成实际修改
- 验收方式：本 design 落地后开下一个新任务，看 brainstormer 是否自然产出 `## Behavior` 段、看 planner plan.md 是否含 `## 行为承诺映射`、看 reviewer 输出是否含「行为一致性」子项、看终态汇报是否与 design.md `## Behavior` 段语义一致

> Atlas 关联：本次落地完成后将更新 atlas/20-behavior/brainstorm-plan-implement-workflow 节点（追加 BDD 防漂移机制描述），并可能新建 atlas/40-decisions/bdd-behavior-layer 节点记录「行为驱动用 ## Behavior 自由格式而非 Gherkin」决策。具体由 executor 在 batch 完成后做，由 reviewer 通过 Atlas Verify 阶段确认。
