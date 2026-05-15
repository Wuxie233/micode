# Micode Project AGENTS.md

This file holds project-local agent guidance. Global agent policy still lives in `~/.config/opencode/AGENTS.md` and applies on top of this file.

## Design Philosophy

设计哲学约束（低耦合 / 模块化 / 高复用 / 轮子优先）的唯一权威来源是 `.mindmodel/architecture/coupling-reuse.md`。任何 brainstormer / planner / reviewer 阶段的设计或实现决策都应通过 `mindmodel_lookup` 读取该文件，不要在 prompt 或本文件中复制粘贴完整内容，避免三处 drift。

## User-Triggered Specialist Agents

micode 在主工作流（brainstormer / planner / executor）和对抗审查（critic）之外，提供五个用户显式召唤的专家辅助 agent。它们都是 read-only 子 agent，不进入 executor 循环，不参与 output-class 路由，不默认运行。

| Agent id | 中文角色 | 用途 |
|---|---|---|
| `product-manager` | 产品经理 | 需求模糊时用产品经理判断把请求收敛成 PRD：问题框定（Problem/Opportunity）、利益相关者、成功度量、范围边界（In/Out of Scope）、风险与假设、决策建议（build / build with adjustments / do not build 或 defer），保留 user stories 与 Given-When-Then 验收。最多 3 个澄清问题，每个带 A/B/C/D/E 选项与推荐默认；证据不足处显式 Cannot Assess。 |
| `software-architect` | 软件架构师 | 架构 / 数据模型 / 跨模块决策时给出 2-3 个备选方案、显式权衡和推荐选项；强制走 mindmodel_lookup / atlas_lookup 锚定耦合面。 |
| `ux-designer` | UX 设计师 | UI/UX 不满或新 UI 设计时按 WCAG 2.2 / Material Design 3 / Apple HIG / Core Web Vitals / Nielsen 10 / AI 透明性原则评审，按 severity (0-4) × frequency × business impact 排序。 |
| `architecture-quality-inspector` | 架构质检 | 对架构方案做质检：SOLID、循环依赖、抗模式、耦合约束；输出 P0/P1/P2/P3 finding 与三种终态判定（APPROVED / APPROVED with required fixes / CHANGES REQUESTED）。 |
| `rubric-reviewer` | Rubric 评审 | 对方案做多维评分：每维度 Excellent / Good / Acceptable / Poor / Failed，强制证据引用，不输出 1-10 总分。 |

### Dispatch rules

- User-triggered only。用户必须显式说「派产品经理」「派 UX 设计师」「summon software-architect」之类，主 agent 才能调用对应 subagent。任何情况下不允许 auto-spawn（never auto-spawn）。
- 主 agent 在合适阶段最多一次提示一行可派哪个 specialist；用户不响应或说继续就不再提（at most once per phase）。
- Specialists are NOT part of output-class routing. 不要为它们添加 `<output-class agent="...">` 路由块；它们与 location / explanation / diagnosis / mutation 分离。
- Specialists 不进入 executor 的 reviewer 循环。它们的 APPROVED / CHANGES REQUESTED / verdict 文字仅是人类综合材料，不是循环控制信号。
- 多 specialist 并行：用户明确同时召唤时最多 2 个并行；超过会出现 prompt fatigue 与综合困难。
- 主 agent 整合 specialist 输出后停留在讨论阶段；只有用户明确说「go / 进入落地 / proceed」才进入 lifecycle / planner / executor。

### Why these are NOT in output-class routing

`<routing-by-requested-output>` 把请求按"输出类别 + 是否带副作用"分到 location / explanation / diagnosis / mutation / direct-execution。Specialists 是用户的决策辅助，不是某种"输出类别"，也没有 mutation 副作用——把它们塞进 output-class 会污染既有路由语义并诱使主 agent auto-spawn。这是已知的 anti-pattern，明确禁止。

### Drift guard

`brainstormer.ts` 与 `commander.ts` 中的 `<specialist-dispatch>` 块为同一来源，必须 byte-identical（由 `tests/agents/specialist-routing.test.ts` 强制）；本节是 markdown 镜像，命名和语义需保持一致。

## Effect-First User-Facing Reports

主 agent（commander / brainstormer / octto）在用户可见的终态汇报里，必须把表达中心从"我做了什么"切到"你会看到什么效果，以及怎么验证它"。详细 prompt 规则见 `src/agents/commander.ts`、`src/agents/brainstormer.ts`、`src/agents/octto.ts` 的 `<effect-first-reporting>` block；本节是 markdown 镜像，给后续 prompt 编辑一个单源说明。

### 默认五段结构

终态汇报按以下顺序输出，section 标题用以下中文原文：

1. **预期表现**：用户现在会看到什么行为。1 句话或 2-3 个 bullet，说"是什么"不说"改了哪个文件"。
2. **你可以怎么验收**：用户用 2-4 个步骤自己验证（打开某页 / 跑某命令 / 检查某输出），不是 agent 内部 verify 脚本。
3. **已知限制 / 下一步**：没完成的部分、需要用户手动处理的事、已知边界。没有就写"无"。
4. **本次知识上下文**：本任务读取/确认/维护了哪些 Atlas 节点、Project Memory 条目、Mindmodel 主题，传给子 agent 的 context-brief 摘要长度。段尾两行固定状态：`Atlas status: <value>` 和 `Project Memory status: <value>`。
5. **实现记录**：commit / 测试 / issue / batch / 子任务等过程产物压缩为 1-2 行。

### Blocked / failed-stop 例外

- **blocked**：先输出"为什么阻塞"和"用户需要做什么"，再讲已完成的部分。不要让用户翻到末尾才发现下一步要他做什么。
- **failed-stop**：先输出失败结论和恢复建议，再讲过程产物。

### 何时不强行套模板

- 纯查询 / 状态查询 / 单行回答类任务可以一句话完成。
- 中间 checkpoint（不是终态）不需要套五段；只在用户可见的终态汇报触发。
- 用户明确要求"展开 commit / 测试 / 子任务"时，"实现记录"段可以展开到正常长度，但"预期表现"和"你可以怎么验收"仍然在前。

### 与其它规则的关系

- **不替代 completion-notify (QQ)**：QQ 是带外 ≤200 字符短消息；本节作用对象是 OpenCode 对话里的回复内容。
- **不替代 intent-classification**：新请求第一回合"意图: ..."声明仍然写在响应顶端，是 UX 路由信号，不是终态汇报。
- **不改变 executor / reviewer / planner 等 subagent 的内部报告格式**：subagent 仍然返回完整结构化输出，primary agent 在综合给用户时按本节压缩。

### Drift guard

`commander.ts` 与 `brainstormer.ts` 的 `<effect-first-reporting>` block 互为单源，必须 byte-identical（由 `tests/agents/effect-first-reporting.test.ts` 强制）。`octto.ts` 因 workflow 不同使用语义对齐但措辞贴合 octto 角色的版本，drift-guard 不强制 byte-identity，但仍然检查五个 section 标题和 blocked / failed-stop 例外存在。本节是 markdown 镜像，命名和段落顺序需保持一致。"本次知识上下文" subsection 由 `src/agents/knowledge-context-section.ts` 提供，必须在 commander / brainstormer / octto 中保持 byte-identical。

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

## Sub-decision Identification 约定

micode 在需求理解阶段显式识别架构子决策，避免把隐藏选择静默推进到 design / plan / executor。`brainstormer 在 understanding 阶段必须主动 enumerate 所有 architectural sub-decision 并 batched ask user`，但不得把执行阶段变成频繁打断用户的问答流程。

### 识别范围与提问通道

- `启发式扩展清单`：遇到数字参数 / max 上限 / 默认值 / 阈值 / 策略选择 / 命名 contract / 数据模型字段 / 外部依赖 / breaking 与否，以及全局 AGENTS.md `Decision Autonomy` 表右列列出的高影响决策时，都应作为候选 sub-decision 识别。
- channel selection reuses existing `Interactive Question Tools` table（三档表，question-tool-first）：极轻量（单一 yes/no 口头 / 单句澄清 / 告知式）走 plain chat；**默认结构化提问**（≤8 题 batched / pick_one / pick_many ≤4 / 短输入 / 单次破坏性 confirm / 需即时回填）走**内置 `question` 工具**；重型场景（长 diff / 长 plan / 长 markdown review / 多分支 brainstorm / pick-many >8 / ranking / slider / 异步等待 / 9+ 题）走 octto。批量提问首选内置 `question` 工具，不要把结构化决策塞进 plain chat。
- quick-mode / 运维 / executor-direct can skip phase；这些路径只保留必要安全确认，不强制展开 sub-decision 枚举。

### 遗漏后的 fallback

- omission fallback: planner / executor / reviewer / implementer use 最保守 / 最不破坏现有结构 / 最易回滚 default, executor aggregates terminal report。
- hard constraint execution does not interrupt user; leaf agents escalate via `Sub-decision observation: missing`。leaf agent 只报告遗漏与使用的保守默认，不直接追问用户。

### Drift guard

单源在 `src/agents/brainstormer.ts` `<sub-decision-identification>`；本节是 markdown mirror guarded by grep-based `tests/agents/sub-decision-and-checkoff.test.ts`。不新增 byte-identical mirror。

## Requirement Check-off 约定

micode 的终态汇报必须把需求承诺与实际结果对齐，让用户能直接看到哪些需求已满足、哪些存在偏差。brainstormer / commander / octto terminal report `你可以怎么验收` contains `需求核对表`, against design.md `## 承诺清单 / Commitments`, states ✓ / ⚠️ / ✗。

### 承诺来源与核对格式

- design.md 的 `## 承诺清单 / Commitments` is reference source, frontmatter below and before Problem Statement, free format, quick-mode optional。它记录本轮明确承诺的用户可见需求或验收点，不是新的严格 schema。
- `你可以怎么验收` 段中的 `需求核对表` 至少使用以下表头示例：`| 需求 | 状态 | 备注 |`。
- known deviations must be surfaced as ⚠️/✗；不能把未完成、部分完成或设计中放弃的需求藏在实现细节里。
- 当 brainstormer 漏问 sub-decision、后续阶段使用保守默认时，终态 `实现记录` 增加 `本次按默认决定的事项` substructure，列出默认项与理由。

### 不引入

- brainstormer ↔ commander effect-first uses existing byte-identical drift-guard; octto semantic alignment only。
- no new byte-identical mirror, no check-off format validator, no coverage dashboard。

### Drift guard

Drift guard source in effect-first blocks；本节是 markdown mirror，grep-based test guards mirror（`tests/agents/sub-decision-and-checkoff.test.ts`）。

## Lens Swarm Discovery / Adversarial Review

Lens Swarm protocol 是 workflow-sensitive 设计和泛化对抗审查的轻量多视角发现机制：coordinator 可并行派多个窄视角 `brainstorm-scout`，先收集风险、边界、drift guard 与改进建议，再做 synthesis。它是 read-only discovery/review mechanism，不是 execution mechanism。

### `brainstorm-scout`

- `brainstorm-scout` 是 read-only subagent：只读、搜索、lookup；不写文件、不提交、不部署、不重启、不推进 lifecycle。
- 每个 scout 只接收一个 lens（如 `history-archaeology` / `entrypoint-boundary` / `regression-drift-guard` / `safety-recovery` / `minimal-scope-yagni` / `contract-integration`），输出短 findings、Cannot Assess 与 synthesis notes。
- `brainstorm-scout` 不进入 executor output-class routing，不参与 implementer/reviewer cycle，也不输出 `APPROVED` / `CHANGES_REQUESTED` reviewer-loop verdict。

### Discovery Swarm

- brainstormer 对复杂设计、跨模块变更、agent prompt / lifecycle / planner / executor / reviewer contract / runtime / safety 变更，进入 planner 前应先用 Discovery Swarm 发现风险。
- synthesis 后，采纳内容进入 design.md 的 Constraints / Approach / Components / Testing Strategy / Open Questions；未采纳和 Cannot Assess 需要说明原因。

### Adversarial Swarm 与 critic 兼容

- 用户泛化说「对抗性审一下 / 找几个 sub 看看 / 红队过一下」且未显式指定 role 时，默认走 Adversarial Swarm。
- 用户显式指定 `critic` 或 role 名（`archaeologist` / `conservative` / `redteam` / `yagni` / `cross-family`）时，仍走既有 `critic` role 路径，不被 swarm 改写。
- 用户同时要求 swarm + critic role 时可以组合，但 synthesis 必须区分 scout findings 与 critic findings，并停在讨论阶段等待用户明确 go/proceed。

### Planner / Executor / Reviewer review policy

- planner 必须把 swarm / critic / design 中的 risk observation 映射到 task review policy：reviewer mandatory / reviewer-skip eligible / mandatory reason。
- executor 只能按 whitelist 独立验证低风险 reviewer skip；implementer 不能自行决定 skip reviewer。
- 高风险 surface 永远 reviewer mandatory：`src/agents/**` prompt、lifecycle/runtime/deploy/recovery、planner/executor/reviewer contract、Behavior/Commitments、secrets/safety/security/auth、concurrency/retry/cache/error handling、任何 risk observation。
- executor 无法判断时默认 full reviewer，并在 batch summary / 终态实现记录中说明 reviewer coverage 与 skipped low-risk tasks。

### Drift guard

本节是 markdown mirror。Prompt 单源以 `src/agents/lens-swarm-protocol.ts` 和各 agent prompt 为准；`tests/agents/agents-md-lens-swarm.test.ts` 与 `tests/agents/lens-swarm-drift-guard.test.ts` 用 grep-based 关键字符串防漂移，不新增 byte-identical prompt mirror。

## Atlas Shared Mental Model

Project Atlas (`atlas/`) 是人和 AI 共享的项目心智模型。任何想要全局理解 micode 的人或 agent，最该先读 Atlas。Atlas 不是 AI 私有缓存、代码索引或 lifecycle 副作用。

完整 prompt 协议块在 `src/agents/atlas-mental-model.ts` 导出的 `ATLAS_MENTAL_MODEL_PROTOCOL` 字符串中，brainstormer / planner / executor / reviewer / commander / octto 通过模板字面量统一注入。本节是 markdown 镜像，不复制完整协议文本，避免与 prompt 单源 drift（drift-guard 由 `tests/agents/atlas-mental-model.test.ts` 与 `tests/agents/atlas-protocol-injection.test.ts` 强制）。

### 协议四步

1. **Read**：非平凡任务开始时读取 atlas-context（自动注入）和按需 `atlas_lookup`，优先关注 `00-index`、`10-impl`、`20-behavior`、`40-decisions`、`50-risks`。把读到的节点写进终态"本次知识上下文 - 读取"段。
2. **Maintain**：在 batch 完成 / 决策拍板 / lifecycle 阶段切换等 checkpoint 主动写或更新节点。冲突 / 人工编辑走 challenge / delta fallback (`thoughts/shared/atlas-deltas/`)。
3. **Verify**：reviewer 与 executor 在批次完成时检查代码 diff 与对应节点 claim 是否一致；leaf agent 发现冲突通过 "Atlas observation: stale-detected" 单行 escalate，executor 决定本批次内修补还是登记为 stale。
4. **Report**：终态汇报包含一行 `Atlas status: <value>`，并把 Read / Maintain / Verify 关键事实压缩进"本次知识上下文"段。

`atlas-compiler` 与 `/atlas-refresh` 降级为辅助批量整理 / 历史 reconcile 路径，不在日常开发主路径触发。Atlas update 主路径是 agent 在任务中 Maintain。

### 状态取值

终态 "本次知识上下文" 段必须包含一行 `Atlas status: <value>`，取值之一：`consulted` / `read-only` / `maintained` / `verified` / `no-change` / `delta-created` / `stale-detected` / `conflict` / `blocked` / `cannot-assess`。新增 `read-only` / `maintained` / `verified` / `conflict` 与 Read/Maintain/Verify/Report 协议对齐。

### Lifecycle 边界

Lifecycle 是 source provider only。`lifecycle_finish`、`lifecycle_commit` 与任何 hook 都不允许自动 spawn `atlas-compiler` 或写 Atlas vault。`src/atlas/finish-spawn.ts`、`src/atlas/spawn-receipt-marker.ts`、`src/atlas/handoff-marker.ts` 与 `atlas-compiler` / `atlas-worker-*` agent 均为 user-triggered-only，由 `/atlas-refresh` 或人工指令触发；grep-based boundary 测试见 `tests/lifecycle/atlas-boundary.test.ts`。

### 中文优先

节点名 / H1 / H2 / 正文 / summary / behavior / rationale / risk 中文优先。机器语法保留英文：frontmatter keys、IDs、wikilink syntax、file paths、tool names、command names、source pointers、test names、code symbols、fenced code 内容。Chinese-content guard 由 `src/atlas/chinese-content-guard.ts` 提供，是 hint，不阻塞写入。

### Drift guard

`src/agents/atlas-mental-model.ts` 是协议唯一权威来源；本节是 markdown 镜像，命名和段落顺序需保持一致。

## Project Memory Active Maintenance

Project Memory 是项目级的"为什么 / 选了什么"记忆（SQLite 中的 decisions / lessons / risks / open questions）。它与 Atlas（共享心智模型，markdown vault）和 Mindmodel（代码风格约束，.mindmodel/）分工不同：

- **Atlas** 回答"现在的项目是怎样组织的"。
- **Project Memory** 回答"我们之前为什么这么选 / 踩过什么坑 / 留下了什么 open question"。
- **Mindmodel** 回答"代码具体应该怎么写"。

完整 prompt 协议块在 `src/agents/project-memory-protocol.ts` 导出的 `PROJECT_MEMORY_PROTOCOL` 字符串中，brainstormer / planner / executor / reviewer / commander / octto 通过模板字面量统一注入。本节是 markdown 镜像。

### 协议四步（与 Atlas 对称）

1. **Read**：非平凡任务开始时调用 `project_memory_lookup` 查相关主题，把读到的条目写进"本次知识上下文 - 读取"。
2. **Maintain**：在任务过程中主动 `project_memory_promote`：拍板的 decision、可复用 lesson、新增 risk、留下的 open question；带 source pointer (design/plan/ledger/lifecycle/manual)。
3. **Verify**：reviewer 检查代码是否覆盖、违反或 supersede 某条 active decision；触发 active risk 边界时升级为新的 decision/lesson。
4. **Report**：终态"本次知识上下文"段固定一行 `Project Memory status: <value>`，取值 `read-only` / `wrote-decision` / `wrote-lesson` / `wrote-risk` / `wrote-open-question` / `no-change` / `cannot-assess`。

### Lifecycle 边界

Lifecycle 不再自动 promote ledger 或 issue body 进 Project Memory。`config.projectMemory.promoteOnLifecycleFinish` 默认值为 `false`；保留 opt-in 字段是为了支持极少数实验场景，不作为日常路径。grep-based 边界测试见 `tests/lifecycle/project-memory-boundary.test.ts`。

### 父子协同 (Context Brief)

executor 给 implementer / reviewer 派任务时 prompt 中固定含 `<context-brief>` 块，下传已读 Atlas 节点 / Project Memory 条目 / Mindmodel 主题 / 已确认环境 / contract 路径。子 agent 默认信任 brief，不重复 lookup；冲突时 escalate "Brief mismatch" 由 executor 处理。完整规范见 `src/agents/executor.ts` `<context-brief>` 块。

### Drift guard

`src/agents/project-memory-protocol.ts` 是协议唯一权威来源；`tests/agents/project-memory-protocol.test.ts` 强制 6 个主 / 协调 agent 都注入该协议。本节是 markdown 镜像，命名和段落顺序需保持一致。

## Autonomous Lifecycle Recovery

Lifecycle 工具（`lifecycle_finish` / `lifecycle_commit` / `lifecycle_current` / `lifecycle_resume` / `lifecycle_recovery_decision`）在失败时输出结构化 `### Recovery hint` 段。primary agent（brainstormer / commander）按 hint 在最多 3 轮内自主恢复；planner / executor 在自身职责范围内最多 2 轮。

### Failure kinds and recommended actions

| failure_kind | recommended_next_action | 含义 |
|---|---|---|
| `ambiguous_lifecycle` | `clean_stale_records` / `ask_user` | 多个 active lifecycle，按 stale 标记分流 |
| `stale_record` | `clean_stale_records` | record 与 GitHub / 仓库现状脱节 |
| `record_missing` | `resume_issue` | 本地缺记录，从 issue body 重建 |
| `invalid_issue_number` | `ask_user` | 编号非法或无法归一 |
| `dirty_base_worktree` | `use_temp_merge_worktree` | 主 worktree dirty，工具已切临时 worktree |
| `merge_conflict` | `resolve_conflicts` | 临时 worktree 内冲突待人工或 AI 解决 |
| `untracked_cleanup_blocker` | `quarantine_artifacts` / `ask_user` | 未跟踪文件分类归属 |
| `tracked_cleanup_blocker` | `ask_user` | tracked 改动疑似用户作品 |
| `pr_checks_failed` | `ask_user` | CI 失败，需要改代码 |
| `push_failed` | `retry_finish` | 网络/竞争，允许有界重试 |
| `unknown` | `ask_user` | 工具未能归类 |

### Hard safety rules (no exceptions during recovery)

- 不 force push，禁止 `git push --force` / `--force-with-lease`（no force push）。
- 不跳过 git hooks，禁止 `--no-verify`。
- 不对主 worktree 执行 `git reset --hard`。
- 不自动删除用户文件；只能 quarantine 明确归属 lifecycle 的 untracked artifacts 到 `thoughts/lifecycle/backups/issue-<N>/...`。
- 不自动重启 OpenCode（no auto-restart）。
- bounded recovery 最多 3 轮（primary）/ 2 轮（planner、executor）；超过即 halt。

### Drift guard

Drift guard: `src/agents/brainstormer.ts` 与 `src/agents/commander.ts` 的 `<bounded-recovery-loop>` 块是单源；`src/agents/planner.ts` 与 `src/agents/executor.ts` 的相应规则与之语义对齐但裁剪到本职范围。本节是 markdown 镜像，drift 由 `tests/agents/agents-md-lifecycle-recovery.test.ts` 强制。

## Knowledge Bootstrap Commands

micode 提供三条零参数 orchestrator 命令，用单一入口建立 / 大更新 / 体检三层项目知识库 (`/init` → `ARCHITECTURE.md` + `CODE_STYLE.md`；`/mindmodel` → `.mindmodel/`；`/atlas-init` → `atlas/`)。三条命令均路由到 `knowledge-bootstrap-orchestrator` agent，由该 agent 按 mode 串行调度现有 `project-initializer` / `mm-orchestrator` / `atlas-initializer` 子流程。

| 命令 | Mode | 行为 |
|---|---|---|
| `/all-init` | missing-only | 检测三层状态；仅建立缺失部分，已有的层不动 |
| `/all-rebuild` | refresh-all | 列出会被覆盖的文件并 octto confirm；确认后串行重建三层（force-rebuild 语义） |
| `/all-status` | status-only | 只读体检：三层是否存在 + atlas 健康度 + Project Memory 摘要，不写任何文件 |

### Dispatch rules

- 三条命令零参数。不引入 `--flag`，每个 mode 一个独立命令。
- 不替换 `/init`、`/mindmodel`、`/atlas-init`、`/atlas-status`、`/atlas-refresh`。这些原有命令继续可独立使用。
- 串行执行：`project-initializer` → `mm-orchestrator` → `atlas-initializer`，依赖顺序由后两阶段读取前阶段文件决定。禁止并发。
- 中间失败不回滚：任一子 agent 失败时已完成阶段保留，用户复跑 `/all-init` 智能补齐。
- `/all-rebuild` 必须显式 confirm，否则不动文件。
- orchestrator 入口不再收集 intent.* 问卷答案。`/all-rebuild` 的 octto.confirm 覆盖确认保留（破坏性操作的安全闸）。
- atlas-initializer 在 phase 2 自行从 README / package.json description / ARCHITECTURE.md 推断 pitch / 主要用户 / 部署形态；当三者全空白时由 atlas-initializer 自决用 octto 问最多 1 个最关键问题。orchestrator 不再下传 `Pre-seeded answers`。

### Output discipline

每次执行后必须输出"本次知识上下文"板块（参见 `src/agents/knowledge-context-section.ts` 的 `KNOWLEDGE_CONTEXT_SECTION` 单源），列出本次任务读取与维护的知识来源。`/all-status` 之外的模式还需输出 commander effect-first 的四段终态汇报（预期表现 / 你可以怎么验收 / 已知限制 / 实现记录）。

### Drift guard

`src/agents/knowledge-bootstrap-orchestrator.ts`、`src/tools/knowledge-bootstrap/`、`src/index.ts` 中 `PLUGIN_COMMANDS` 的 `all-init` / `all-rebuild` / `all-status` 条目是单源；本节是 markdown 镜像，drift 由 `tests/agents/agents-md-knowledge-bootstrap.test.ts` 强制。
