---
date: 2026-05-09
topic: "Product Manager Prompt Upgrade"
status: validated
issue: 57
---

## Problem Statement

现有 `productManagerAgent` (`src/agents/product-manager.ts`) 在 issue-53 specialist agents 落地时被定义为一个轻量的 PRD 模板生成器。它解决了"用户故事 + Given/When/Then + Non-Goals"的最小输出形态，但现实使用中暴露出几个问题:

- **过度依赖模板,缺乏 PM 判断**: 当前 prompt 把 agent 框成"问最多 3 个问题然后填表",输出更像是表单填写器而不是产品经理。模糊请求被快速收敛成 PRD,但问题框架(problem framing)、关键利益相关者(stakeholders)、成功度量(success metrics)、范围边界、风险/假设、推荐决策这些专业 PM 思考动作完全缺席。
- **PRD 输出过窄**: User Stories + Given/When/Then + Non-Goals 三段固然清晰,但下游(用户、brainstormer、planner)拿到 PRD 后还要回头自己补"为什么做"、"对谁重要"、"做完怎么算成功"、"哪些风险"、"该不该做"。这些本应该是 PM 完成的工作。
- **角色定位与执行边界已经稳定**: read-only、user-triggered、最多 3 个问题、A/B/C/D/E 选项、不与 planner/executor 重叠,这些约束已经被现有 prompt、specialist-routing 测试和 AGENTS.md 三处共同锁定,不能动摇,只能在其内部增强 PM 判断。

需要把 product-manager 从"模板生成器"升级为"专业产品经理":在不破坏现有合约的前提下,加强 problem framing、stakeholders、success metrics、scope boundary、risks/assumptions、decision recommendation,以及在证据不足时显式 `Cannot Assess` 而不是编造。

## Constraints

不可改动的硬约束(来自 issue #57 + 现有 specialist agents 设计 + AGENTS.md):

- **read-only**: `tools.write/edit/bash/task` 全部 false,prompt 中 `<hard-restrictions>` 与 `<never-do>` 必须保留 NEVER 写文件、NEVER 提交、NEVER 部署、NEVER 重启的禁令。
- **user-triggered only**: 仅在用户显式召唤("派产品经理"/"上 PM"/"summon product manager")时由 coordinator 派发,coordinator 不会 auto-spawn。prompt 中 `<user-triggered>` 段保留语义。
- **不与 planner/executor/brainstormer 重叠**: prompt 中 `<not-this-role>` 三条 "NOT the planner / NOT the executor / NOT the brainstormer" 必须保留(测试 `tests/agents/product-manager.test.ts` 第 67-72 行强制)。不输出实现计划、不输出代码、不做多轮 design exploration。
- **最多 3 个澄清问题,每个带 A/B/C/D/E 选项 + 推荐默认**: D=自定义,E=自动。问题不能超过 3。E 表示用户授权 agent 用 recommended default 直接产出 PRD,不阻塞。
- **保留现有 PRD 结构**: User Stories、Given/When/Then Acceptance Criteria、Non-Goals、Cannot Assess 仍然是必选段(测试 57-65 行 + Non-Goals 强制)。
- **保留 micode 子 agent 环境与 SUBAGENT 语义**: prompt 顶部 `<environment>` 段保持。
- **不引入 mutation**: 即便 PM 要做 decision recommendation,也只是文字输出建议,不能调用任何 side-effecting 工具。
- **lifecycle 路由**: 本次改动 `src/agents/` agent-prompt 表面,必须走 lifecycle + planner + executor;executor-direct 禁用。本设计文件本身不算实现,只是 design 阶段的产物。
- **不破坏 coordinator 的 specialist-dispatch drift guard**: `commander.ts` 与 `brainstormer.ts` 中的 `<specialist-dispatch>` block 必须 byte-identical(由 `tests/agents/specialist-routing.test.ts` 强制),本设计不需要改它们,但 PM 角色名 (`product-manager`) 与中文标签("产品经理")保持不变。

软约束:

- 升级后的 prompt 仍然鼓励"短"。PRD 不是设计文档,读者(coordinator + 用户)是在收敛而不是在做架构。新增段不能把单次输出变成 5 页 PDF。
- 推荐默认必须显式标注。不能引入"PM 自己脑补的事实"——没有证据就标 `Cannot Assess`。
- 中文 / 英文混排沿用现有 prompt 风格(英文段落标签 + 中文 prompt 内容)。

## Approach

**单 agent prompt 升级,不拆 agent、不引入新工具、不改 registry。**

核心策略是把现有的 prompt 视为"骨架已对、内涵不足"的状态,在 6 个具体位置做内容加强:

1. **角色定位段(`<purpose>`)**: 从"决策辅助"提升为"专业产品经理"。明确点出 problem framing、stakeholder alignment、success definition、scope control、risk management、recommendation 这 6 个 PM 关键动作,把 agent 锚定为"用 PM 思维处理需求",而不是"填表"。
2. **新增 `<pm-judgment>` 段**: 给出 PM 思考的具体提示词。比如"在写 user stories 之前先问自己:这个请求背后的问题是什么 / 谁会因此受益或受损 / 怎么知道做对了"。这一段是 prompt 的"专业灵魂",但只是思考引导,不强制输出结构。
3. **保留并加强 `<question-discipline>`**: A/B/C/D/E 不变,但 prompt 显式说明"问题应该针对 PRD 中**最有判断价值**的歧义,优先问 problem framing / stakeholders / success metric / scope boundary 这类 PM-critical 维度的歧义,而不是无关紧要的实现细节"。这避免了升级后 agent 仍然问浅层问题。
4. **扩展 PRD 输出契约(`<output-format>` 内的 `<prd-block>`)**: 在 User Stories / Acceptance Criteria / Non-Goals 之外,新增以下段:
   - **Problem / Opportunity** (mandatory): 一段话回答"这个请求背后是什么问题、为什么现在做"。
   - **Stakeholders** (mandatory): 列出主要利益相关者(谁要求、谁被影响、谁负责验收),最少 1 项。
   - **Success Metrics** (mandatory): 至少 1 个可观测的成功指标(行为可观测、用户可感知、或可统计)。
   - **Scope Boundary** (mandatory): 显式 In Scope / Out of Scope 二分,Out of Scope 复用并扩展现有 Non-Goals。
   - **Risks & Assumptions** (mandatory): 至少 2 个 PM 视角的风险或假设(执行风险、用户接受度、依赖、未知)。
   - **Decision Recommendation** (mandatory): 在三种结论中选一个并给一句话理由——"build as proposed" / "build with adjustments (列出关键调整)" / "do not build / defer (列出原因)"。这是 PM 升级的核心:agent 必须给推荐,而不是只摆事实让用户决定。
   - **User Stories** (保留): 3-5 条。
   - **Acceptance Criteria (Given/When/Then)** (保留): 每条 user story 至少一条。
   - **Cannot Assess** (保留, optional): 证据不足的事项。
5. **新增 `<evidence-discipline>` 段**: 升级后 agent 会做更多判断(stakeholders、metrics、recommendation),但 PM 不能编造。这一段强调:每条 stakeholder / metric / risk / recommendation 必须基于 (a) 用户消息原文、(b) 引用的设计/计划/issue 文本、(c) coordinator 提供的上下文。三类证据都没有时,显式列入 `Cannot Assess`,而不是猜。这一段是防止"加强 PM 判断"滑向"PM 自己幻觉"的安全阀。
6. **保留并强化 `<never-do>` 与 `<autonomy-rules>`**: 在现有禁令基础上加一条:"NEVER omit Decision Recommendation —— 没有 recommendation 的 PRD 不算交付。"

升级后的 prompt 仍然是单文件 `src/agents/product-manager.ts`,仍然导出 `productManagerAgent: AgentConfig`。tools 配置不变,temperature 不变(0.2,disciplined 输出),mode 不变(subagent),description 简短更新以反映"professional PM judgment"。

**为什么不拆成多个 agent**: 拆成 "framing agent" / "metrics agent" / "recommendation agent" 会造成 user-triggered 调用复杂化和 prompt 总量爆炸,而且 PM 思考本质上是连贯的——同一个人脑里同时跑 framing、metrics、recommendation。单 agent prompt 升级在用户体验和维护成本上都更优。

**为什么不在 brainstormer 里做**: brainstormer 是多轮 design exploration,做"怎么实现"的发散收敛;PM 做的是"做什么、为谁做、做完算什么"的产品判断。两者读者不同(brainstormer → planner;PM → 用户 + brainstormer/planner 上游),输出形态不同。合并会模糊 user-triggered 边界。

## Architecture / High-Level Prompt Structure

升级后的 prompt 整体结构(分段顺序保持稳定,便于 prompt diff 审查):

```
<environment>            -- micode SUBAGENT 声明 (不变)
<purpose>                -- 升级: 锚定为 professional product manager,列出 6 个 PM 关键动作
<not-this-role>          -- 保留: NOT planner / NOT executor / NOT brainstormer / NOT generic
<hard-restrictions>      -- 保留: read-only, no shell, CANNOT_ASSESS over invention
<user-triggered>         -- 保留: 仅显式召唤,否则 "Out of scope" 一行退出
<pm-judgment>            -- 新增: PM 思维提示词 (problem framing / stakeholders / success / scope / risk / recommendation)
<question-discipline>    -- 升级: 保留 A/B/C/D/E + 推荐默认 + 最多 3 题; 新增"优先问 PM-critical 歧义"
<process>                -- 保留: 读请求 → 找歧义 → 问或直接出 PRD
<output-format>
  <questions-block>      -- 保留: A/B/C/D/E,推荐默认,最多 3 题
  <prd-block>            -- 升级: Problem/Opportunity, Stakeholders, Success Metrics, Scope Boundary,
                                   Risks & Assumptions, Decision Recommendation, User Stories,
                                   Acceptance Criteria, Cannot Assess
<evidence-discipline>    -- 新增: 证据来源三类,不足则 Cannot Assess
<rules>                  -- 保留: 引用证据 / 短 / 不发明 persona / 留在产品域
<autonomy-rules>         -- 保留: 子 agent 不再问 coordinator
<never-do>               -- 升级: 保留所有禁令; 新增 "NEVER omit Decision Recommendation"
```

视觉上 prompt 长度从 ~120 行扩展到 ~180 行(估算),仍在单 prompt 合理量级。

## Components / Responsibilities

本次改动只触一个组件,但内部职责变化:

| Component | File | Change | Responsibility |
|---|---|---|---|
| `productManagerAgent` AgentConfig | `src/agents/product-manager.ts` | prompt 内容升级;`description` 字段微调;tools/temperature/mode 不变 | 升级后的专业 PM 判断 + 保留所有 read-only / user-triggered / 不重叠 / 3 题 / A-E 约束 |
| product-manager 测试 | `tests/agents/product-manager.test.ts` | 新增断言覆盖新增段;保留所有现有断言 | 锁定升级后的 prompt 合约,防止后续 drift |
| AGENTS.md 镜像 | `AGENTS.md` 中的 `User-Triggered Specialist Agents` 表 | `product-manager` 行的"用途"描述微调反映 PM judgment | 用户向文档的单源说明保持一致 |
| coordinator 提示 (`commander.ts` / `brainstormer.ts` `<specialist-dispatch>` block) | 现有 prompt | **不改动** | drift guard 已锁定 byte-identity;角色名/标签不变,无需改 |
| specialist-routing 测试 | `tests/agents/specialist-routing.test.ts` | **不改动** | 验证 dispatch 而非 prompt 内容 |
| specialist-agents-md 测试 | `tests/agents/specialist-agents-md.test.ts` | 视实现需要可能微调"用途"行匹配,否则不改 | AGENTS.md 镜像一致性 |
| 上游 agent registry (`src/agents/index.ts`) | 现有导出 | **不改动** | 仍然导出 `productManagerAgent`,签名不变 |

## Data / Output Flow

```
[user] --"派产品经理 / summon PM"--> [coordinator (commander or brainstormer)]
   ↓ Task / spawn_agent
[product-manager subagent]
   ↓ read 用户消息 + 任何引用的 design/plan/issue 文本
   ↓ apply <pm-judgment>: problem framing / stakeholders / success / scope / risks / recommendation
   ↓ identify ≤3 PM-critical ambiguities
   ├──[ambiguities ≥1]──> emit <questions-block> with A/B/C/D/E + recommended defaults; STOP
   │       ↓ user replies (or picks E=auto, or stays silent)
   │       ↓ coordinator forwards reply to PM (next call)
   └──[no ambiguity OR user chose]──> emit <prd-block>
                                              ↓
                                  [coordinator] presents PRD to user
                                              ↓
                              [user] approves / rejects / asks PM to revise
                                              ↓ if approves
                              [coordinator] hands off to brainstormer/planner
```

关键性质:

- 整条数据流是**单向只读**:PM 只产生文字输出,不写任何文件(包括不写 PRD 到 `thoughts/`)。如果用户希望 PRD 落盘,由 coordinator 或后续 brainstormer 决定。
- E=auto 路径保证不阻塞:即便用户不响应,PM 也能用推荐默认产出完整 PRD(包含 Decision Recommendation),由用户后续 review。
- Decision Recommendation 是 mandatory,但仍可以是"do not build / defer";PM 不被强迫推荐"build"。

## Error Handling

PM 是 read-only subagent,不会产生运行时副作用错误。需要处理的"软错误":

| 场景 | 处理方式 |
|---|---|
| 请求不属于产品/需求范畴(实际是架构、UX、质量、评分) | 输出一行 `Out of scope for product-manager. Suggest: <other-specialist or main agent>.` 并停止(现有行为保留)。 |
| 证据不足以判断 stakeholder / metric / risk / recommendation | 在 `Cannot Assess` 中显式列出哪一项缺什么证据,而不是猜测填入。Decision Recommendation 仍要给,但理由必须包含"证据不足,默认 defer / build with adjustments 等"。 |
| 用户回复 E (auto) 或没回复 | 用 recommended defaults 直接产出完整 PRD;在 PRD 顶部一行注明"Generated using recommended defaults; awaiting user confirmation."。 |
| 用户回复 D (自定义) 但答案过短/含糊 | 不再追问(已用完一轮 3 题预算),用尽量保守的 PRD 输出,不能命中的项进 `Cannot Assess`。 |
| 用户提了大量歧义,>3 个 | PM 选 3 个 PM-critical 的(优先 problem framing / stakeholder / success metric),其余在 PRD 的 `Cannot Assess` 中标记。不允许 4 题。 |
| coordinator 把 PM 错误地用于纯实现请求 | "Out of scope" 退出。AGENTS.md 与 specialist-dispatch 已经从源头降低这种误派概率。 |

错误反馈不依赖任何工具调用,纯文本即可。

## Testing Strategy

测试目标:**锁定升级后的 prompt 合约,确保不退化、不破坏现有 drift guard。**

文件:`tests/agents/product-manager.test.ts`(已存在,需扩展)。

保留的所有现有断言(11 条,见现状文件 5-77 行)继续 pass:

- subagent + read-only tools
- temperature ≤ 0.3
- description 含 "read-only" + "product"
- prompt 含 "micode" + "SUBAGENT"
- prompt 含 NEVER / commit / deploy / restart / read-only
- 最多 3 题 + 推荐默认
- A/B/C/D/E + D=custom + E=auto
- PRD + user stor + Given + When + Then + Non-Goals
- not the planner / not the executor / not the brainstormer
- user-triggered

新增断言(覆盖升级后的 6 个新段):

```
it("prompt anchors product-manager as a professional PM, not a template")
  → expect prompt 包含 "professional" 或 "product manager" 在 <purpose> 段
  → expect 包含 "problem framing", "stakeholder", "success", "scope", "risk", "recommendation" 关键词

it("prompt PRD requires Problem/Opportunity, Stakeholders, Success Metrics sections")
  → expect 包含 "Problem" 或 "Opportunity"
  → expect 包含 "Stakeholder"
  → expect 包含 "Success Metric" 或 "Success Metrics"

it("prompt PRD requires explicit Scope Boundary with In Scope / Out of Scope")
  → expect 包含 "Scope Boundary"
  → expect 包含 "In Scope" 与 "Out of Scope"

it("prompt PRD requires Risks & Assumptions section")
  → expect 包含 "Risks" 与 "Assumptions"

it("prompt PRD requires mandatory Decision Recommendation")
  → expect 包含 "Decision Recommendation"
  → expect 三种结论关键词存在: "build as proposed" / "build with adjustments" / "do not build" 或 "defer"

it("prompt has evidence discipline: cite source or mark Cannot Assess")
  → expect 包含 "evidence" 或 "证据"
  → expect 包含 "Cannot Assess"

it("prompt forbids omitting Decision Recommendation (never-do)")
  → expect prompt 中存在 "NEVER" 与 "Decision Recommendation" 的搭配,或等价表述
```

Drift guard 维持:

- `tests/agents/specialist-routing.test.ts`:不改;它验证 commander/brainstormer 的 specialist-dispatch block byte-identity,不依赖 PM prompt 内容。
- `tests/agents/specialist-agents-md.test.ts`:如果 AGENTS.md 中 product-manager 行的"用途"列发生文字调整,可能需要同步该测试的字符串期望。判断标准:跑 `bun test tests/agents/specialist-agents-md.test.ts`,fail 则改 expectation,pass 则不动。
- `bun test` 全集合应继续 pass。

测试不验证 LLM 实际行为(prompt 测试无法 cover 这一面),只验证 prompt 文本合约。这是 micode 现有 specialist 测试的一致风格。

## Open Questions

下列问题在落地阶段(planner / executor)前可能需要再确认。每条都标注了 planner 默认行为,以便不阻塞流程。

1. **`description` 字段是否更新?** 当前为 "Read-only product manager specialist: clarifies fuzzy requirements with at most 3 questions, then emits a PRD with user stories, Given/When/Then acceptance criteria, and Non-Goals. User-triggered only."  
   *Planner 默认*: 微调为 "Read-only professional product manager specialist: applies PM judgment (problem framing, stakeholders, success metrics, scope, risks, recommendation) and emits an enriched PRD with at most 3 clarifying questions. User-triggered only." 仍含 "read-only" 与 "product",通过现有 description 测试。
2. **AGENTS.md 中 product-manager 行"用途"列是否同步更新?** 现状是 "需求模糊时把请求收敛成 PRD..." 一行。  
   *Planner 默认*: 同步更新为反映 PM judgment 的描述。如果 specialist-agents-md 测试断言强匹配,则同步 expectation。
3. **`Decision Recommendation` 是否需要更细的子结构(如 confidence high/medium/low)?**  
   *Planner 默认*: 不加 confidence 字段。一句话理由 + 三选一结论已足够。引入 confidence 会让 prompt 显著变长且容易被 agent 滥用。如果用户后续要求,可单独 issue 处理。
4. **PRD 输出是否需要标注是 "Generated using recommended defaults" 还是 "Generated after user clarification"?**  
   *Planner 默认*: 是。在 PRD 顶部加一行 metadata,便于 coordinator 与用户判断这次 PRD 的可信度边界。
5. **如果 PM 判断"do not build / defer"被推荐,是否仍要强制写完所有 PRD 段?**  
   *Planner 默认*: 是。完整 PRD 仍然产出,因为用户可能仍然想 override PM 的 defer 建议;skipping sections 会让 override 路径退化。
6. **是否需要 prompt 中给一个 fully-worked example PRD?**  
   *Planner 默认*: 不加完整范例。prompt 已经较长,加完整范例会进一步膨胀且容易被模型当成模板逐字模仿。如果后续观察到 LLM 输出形状不稳定,可在下一轮 issue 引入精简范例。
7. **是否在升级时把"PRD 是否建议写到 `thoughts/shared/prd/` 落盘"作为 PM 的产出选项?**  
   *Planner 默认*: 不加。PM 是 read-only,不能写文件;落盘由 coordinator 决定,不在本次范围。

---

设计已对齐 issue #57 的 Goals 与 Constraints,所有硬约束(read-only / user-triggered / 不重叠 / 3 题 + A-E / read-only tools)在 prompt 升级中保留并被新增测试断言锁定。落地阶段(planner)可在此基础上拆 batch、写实现 + 测试 + AGENTS.md 镜像同步。
