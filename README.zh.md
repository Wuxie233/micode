# micode

> 把 AI 结对编程变成结构化的多 agent 软件工程——内置分层知识库、Issue 驱动交付生命周期，以及以效果为先的终态汇报。

🇬🇧 **English Documentation →** [README.md](./README.md)

https://github.com/user-attachments/assets/85236ad3-e78a-4ff7-a840-620f6ea2f512

micode 是一个 OpenCode 插件：它把开放式的聊天循环换成 brainstorm → plan → implement 工作流，按 domain 把实现任务路由给专家 implementer，跨域时冻结 API 契约；把项目记忆持久化到跨会话、跨 worktree 的存储；把 issue / branch / worktree / commit / PR / merge 整条交付链路变成确定性的工具调用。它服务的对象是维护非平凡代码库、希望工作产物能活过单次对话的开发者。

## 目录

- [为什么用 micode](#为什么用-micode)
- [快速开始](#快速开始)
- [设计哲学](#设计哲学)
- [功能特性](#功能特性)
- [工作机制](#工作机制)
- [斜杠命令](#斜杠命令)
- [Agents](#agents)
- [Tools](#tools)
- [配置](#配置)
- [Hooks](#hooks)
- [Octto 配置](#octto-配置)
- [本地开发](#本地开发)
- [灵感来源](#灵感来源)
- [致谢](#致谢)
- [许可声明](#许可声明)

## 为什么用 micode

原生 OpenCode 是一个强大的通用聊天 agent，但放到正式的工程协作场景里，会暴露几个结构性缺口。对话是扁平的：在「这个想法是什么」和「开始改代码」之间没有强制的阶段边界。知识随会话死亡：第 12 轮拍板的架构决策，一周后开新对话时谁也看不见。它没有「这个实现任务是前端 UI、那个是后端」的概念——所有任务都跑同一个 model、同一份 prompt。并行 subagent 里某个失败，往往会把同批 peer 的进度一起带走，而不是被隔离。

micode 把这些缺失结构以插件代码的形式补齐，不是靠 prompt 礼仪。brainstorm → plan → implement 流程由 prompt / 输出物 / 退出条件都不同的三类 agent 强制划分。三层知识系统把「代码怎么写」（`.mindmodel/`）、「项目怎么组织」（`atlas/`）和「过去的决策为什么这么定」（Project Memory，SQLite）显式分开。Issue 驱动 lifecycle 把每个非平凡变更变成一次 GitHub issue + branch + worktree + 自动 commit + PR，用工具调用，不靠自由的 shell。planner 给每个任务打上 `Domain` 标签，让 executor 把 UI 任务派给擅长 UI 的 model、把后端任务派给擅长后端的 model，中间用冻结 API 契约把它们粘合。

micode 最适合的人是：维护复杂代码库、希望 AI agent 尊重既有结构而不是重新发明的开发者；需要在失败下保持确定性和可恢复性的 agent 编排者；以及需要让决策 / 教训 / 风险在人员流动、对话压缩、worktree 清理后仍然存活的团队。如果你只想要更快的 chat completion，原生 OpenCode 就够了。

## 快速开始

把下面加进 `~/.config/opencode/opencode.json`：

```json
{ "plugin": ["github:Wuxie233/micode"] }
```

把 [`micode.example.jsonc`](./micode.example.jsonc) 拷到 `~/.config/opencode/micode.jsonc`，把里面的占位符替换成真实的 model 字符串（仓库本身不带任何具体 provider / model 名）。

然后跑 `/init`，生成 `ARCHITECTURE.md` 和 `CODE_STYLE.md`。

`/init` 完成之后跑 `/all-init`，一次性把 `.mindmodel/` 和 `atlas/` 两层知识库也建起来。

`/all-init` 会自动检测三层知识库（项目文档、`.mindmodel/`、`atlas/`）哪几层缺失，只补缺的那部分——可以放心重复跑。

## 设计哲学

下面是项目的 7 条立场。每条都附了权威单源文件的链接。

#### 1. 需求优先（Need-first thinking）

用户的底层需求才是真相来源；用户提的实现方案只是候选项，不一定是最佳路径。Agent 必须先锁定需求再评估方案；当存在明显更优的替代时要主动指出权衡，但不会重新审判用户已经在同一会话里拍板的决策。

→ 完整规则见 [`AGENTS.md` "Need-First Critical Thinking"](https://github.com/Wuxie233/micode/blob/main/AGENTS.md)。

#### 2. 低耦合、轮子优先（Low coupling, wheels-first）

模块之间通过显式接口和纯数据通信，禁止跨模块抓取私有状态或绕过模块边界。业务代码由可复用的小工具、小工厂、共享 hook 组合而成。只有当现有轮子真的无法表达新需求、且新轮子会被多处使用时，才允许新增公共抽象。

→ 完整规则见 [`.mindmodel/architecture/coupling-reuse.md`](./.mindmodel/architecture/coupling-reuse.md)。

#### 3. 分层知识（Layered knowledge）

三层知识库各自回答一个不同的问题。`.mindmodel/` 回答「代码怎么写」（风格、模式、抗模式）。`atlas/` 回答「项目怎么组织」（模块、行为、决策、风险，以 Obsidian vault 的形式组织）。Project Memory 回答「过去为什么这么选」（按仓库 origin 隔离的 SQLite 条目，在 worktree 清理后仍然存在）。

→ 完整规则见 [`AGENTS.md` "Project Memory (v9)"](https://github.com/Wuxie233/micode/blob/main/AGENTS.md) 和 [`AGENTS.md` "Atlas Shared Mental Model"](./AGENTS.md)。

#### 4. 落地前多轮对齐（Multi-round alignment before commitment）

一轮就走是 anti-pattern。非平凡的提案必须走完研究（并行 subagent）→ 带显式备选项的推理 → 批量发问并给出推荐默认值 → 场景演练 → 可选的对抗审查，然后才能调 `lifecycle_start_request`。讨论阶段保持在聊天里；用户没明确说「go / 进入落地」之前不会有任何 `thoughts/shared/designs/` 写入。

→ 完整规则见 [`AGENTS.md` "Multi-Round Requirement Alignment"](https://github.com/Wuxie233/micode/blob/main/AGENTS.md)。

#### 5. 效果优先汇报（Effect-first reporting）

终态汇报以「你会看到什么」和「你怎么验证」开头，而不是「我改了哪些文件」。默认五段结构：预期表现 → 你可以怎么验收 → 已知限制 / 下一步 → 本次知识上下文 → 实现记录。blocked / failed-stop 情况下先讲阻塞原因和下一步，再讲已完成的部分。

→ 完整规则见 [`AGENTS.md` `<effect-first-reporting>`](./AGENTS.md) 与本项目 [`AGENTS.md` "Effect-First User-Facing Reports"](./AGENTS.md)。

#### 6. Agent 维护知识（Agent-maintained knowledge）

用户从不直接编辑 `atlas/` 文件或 Project Memory 的 SQLite 数据库。维护工作由 agent 在每次非平凡任务里按 Read → Maintain → Verify → Report 协议自动完成。所有变化都会在终态汇报的「本次知识上下文」段里显式呈现，含两行固定状态 `Atlas status:` 与 `Project Memory status:`。

→ 完整规则见本项目 [`AGENTS.md` "Atlas Shared Mental Model"](./AGENTS.md) 和 ["Project Memory Active Maintenance"](./AGENTS.md)。

#### 7. 远程写操作的所属预检（Safety pre-flight）

在任何远程写 git 操作（`git push`、`gh issue create`、`gh pr create`、`gh pr merge`、远程分支删除）之前，agent 必须先把仓库归属分到三种情况之一：fork 给个人使用 / 自己的原始仓库 / 向上游贡献。推到 upstream 从不自动发生。`--force` 与 `--no-verify` 硬禁止。

→ 完整规则见 [`AGENTS.md` "Repository Ownership Awareness"](https://github.com/Wuxie233/micode/blob/main/AGENTS.md)。

## 功能特性

### 🎯 Brainstorm → Plan → Implement 工作流

三个阶段背后是三类 prompt / 输出 / 退出条件都不同的 agent。`brainstormer`（文本）或 `octto`（浏览器）驱动设计探索，并行派发研究 subagent，最后写出 `thoughts/shared/designs/YYYY-MM-DD-{topic}-design.md`。`planner` 读 design，写出粒度细（每个 task 2–5 分钟）、文件路径精确、按依赖分批的 plan。`executor` 读 plan，按 `Domain` 把每个 task 派给匹配的 implementer，每个 task 跑 implementer → reviewer 闭环。

例：你说「给用户设置页加密码重置」→ brainstormer 批量问完范围和边界情况、锁定方案 → planner 写出十个分到 `frontend-ui` / `frontend-code` / `backend` 的 task → executor 按 batch 并行派出、reviewer 逐个 sign off。

### 🧠 多轮需求对齐

落地前的对齐循环全程在聊天里跑。研究 → 带显式备选项的推理 → 批量发问并给推荐默认值 → 场景演练（把抽象决策渲染成「下一次开任务时…」「agent 失败时…」这样的具体未来时刻）→ 可选的对抗审查（2-3 个角色冲突的 subagent，比如 `archaeology` / `conservative` / `red team` / `YAGNI`）。只有当你明确说「go」时循环才结束。讨论期间不会写 `thoughts/shared/designs/`。

例：你说「给项目加 audit log」→ 研究 subagent 并行扫已有日志和安全边界 → brainstormer 提出两个方案带权衡 → 你说「派 red team 审一下」→ 3 个对抗 subagent 给出 finding → 形成共识 → 你说「go」→ 此时才触发 `lifecycle_start_request`。

### 🚦 Issue 驱动交付生命周期（v9）

非平凡任务的整条交付链路由确定性工具调用拥有。`lifecycle_start_request` 一步创建 GitHub issue + branch + worktree。`lifecycle_commit` 在每个 checkpoint 跑仓库所属预检、commit，并自动 push 到 fork 的 `origin`。`lifecycle_finish` 完成合并（有远程 CI 时优先走 PR，否则本地 `--no-ff`）、关闭 issue、清理 worktree。失败时输出结构化 `### Recovery hint`；primary agent 在最多 3 轮（planner / executor 最多 2 轮）内自主恢复，不允许 force push，不允许 `--no-verify`。

例：brainstormer 完成 design → `lifecycle_start_request` 开 issue #42 与 worktree `wt-42` → planner 用 `lifecycle_commit` 提交 plan → executor 每完成一批就 commit → 全绿后 `lifecycle_finish` 开 PR、等 CI、合并、删 `wt-42`。

### 🎚️ 按 Domain 路由的 implementer + 冻结契约

`planner` 给每个 task 打上 `Domain` 标签（`frontend-ui` / `frontend-code` / `backend` / `general`）。当 plan 同时覆盖前端（ui 或 code）和后端时，`planner` 额外产出 `thoughts/shared/plans/YYYY-MM-DD-{topic}-contract.md`——一份并发 implementer 必须遵守的冻结 API 契约。`executor` 按每个 task 的 `Domain` 派给对应专家：`implementer-frontend-ui` 负责布局/样式/可访问性，`implementer-frontend-code` 负责状态/表单/类型，`implementer-backend` 负责 API/DB，`implementer-general` 负责共享配置。契约路径会注入每次 implementer / reviewer 的派发 prompt；implementer 发现契约不符时只升级，不修改契约本身。

例：「新 feed 接口 + 新 feed 组件」的 plan → 契约文件冻结 `GET /feed → { items: FeedItem[] }` → `implementer-backend` 与 `implementer-frontend-code` 在同一份契约下并行实现，reviewer 在两侧都验证契约一致性。

### 📚 三层知识系统

micode 把项目知识按职责和存储后端分成三层：

| 层 | 它回答的问题 | 存储 |
|---|---|---|
| `.mindmodel/` | 代码怎么写（风格、模式、抗模式） | Markdown + YAML manifest |
| `atlas/` | 项目怎么组织（模块、行为、决策、风险） | Obsidian vault（Markdown + wikilink） |
| Project Memory | 过去为什么这么选（持久 facts / decisions / lessons / risks） | SQLite，按仓库 origin 隔离 |

Agent 在任务开始时读三层（用 `mindmodel_lookup` / `atlas_lookup` / `project_memory_lookup`），在语义 checkpoint 时维护。Project Memory 按仓库 origin 隔离，不依赖 `thoughts/` 路径，所以在 worktree 清理之后依然存在。

例：你开一个动到 auth 模块的任务 → executor 读 `atlas/10-impl/auth.md` 获得当前组织，`project_memory_lookup("auth")` 返回 3 条历史决策和 1 条 open risk，`.mindmodel/security/auth.md` 给出项目的 auth 编码模式。这些都不必再重新推断。

### 🧑‍🔬 用户显式召唤的专家 agent

6 个 read-only 专家 agent，必须由用户显式召唤。它们从不 auto-spawn，不进入 executor 的 reviewer 循环，也不参与 output-class 路由。它们产出供你综合的评估材料；它们的 verdict 不是循环控制信号。

- `product-manager` — 把模糊请求收敛成 PRD：问题框定、利益相关者、成功度量、范围边界、风险、决策建议。最多 3 个批量澄清问题，每个带 A/B/C/D/E 选项。
- `software-architect` — 产出 2–3 个架构备选方案、显式权衡、推荐选项，锚定到既有模块耦合面。
- `ux-designer` — 按 WCAG 2.2 / Material Design 3 / Apple HIG / Core Web Vitals / Nielsen 10 / AI 透明性审 UI / UX，按 severity × frequency × business impact 排序。
- `architecture-quality-inspector` — 检查 SOLID、循环依赖、抗模式、耦合约束；产出 P0/P1/P2/P3 finding 与三种终态判定。
- `rubric-reviewer` — 多维评分（Excellent / Good / Acceptable / Poor / Failed），每维度强制证据，不出 1-10 总分。
- `critic` — 对抗审查：archaeologist / conservative / red team / YAGNI / cross-family，带 severity 与证据。

→ 完整派发规则见本项目 [`AGENTS.md` "User-Triggered Specialist Agents"](./AGENTS.md)。

例：你说「派 software-architect 审一下」→ architect 返回 3 个带权衡的方案 → 你选一个 → brainstormer 把结论整合进 design。

### 💬 Octto 浏览器问答

自带的浏览器 UI，每个 OpenCode 插件进程跑一个共享 HTTP server。Session 归属创建它的 OpenCode 对话；跨对话调用返回 `## Forbidden`。16 种问题类型覆盖全谱：`confirm` / `pick_one` / `pick_many` / `ask_text` / `ask_code` / `ask_file` / `ask_image` / `show_diff` / `show_plan` / `show_options` / `review_section` / `rank` / `rate` / `slider` / `thumbs` / `emoji_react`，外加多分支的 `brainstorm` session。Auto-resume 派发：agent 在推完问题后结束本回合，portal 在你回答后再唤起 OpenCode 会话。

例：planner 要 5 个批量决策 → push 给 octto → 结束本回合 → 你在浏览器里答完 → planner 自动 resume，把 plan 写出来。

### ⚙️ 弹性与安全

Subagent 失败被分类为 `{success, transient_retried, task_error, blocked, hard_failure}`。瞬时错误在同一个 subagent session 内自动重试。遇到 `task_error` / `blocked` 时，coordinator 优先调 `resume_subagent(session_id, hint)` 而不是重派一个新 agent——被 resume 的 subagent 保留所有上下文。并行 batch 用 `Promise.allSettled`，一个 subagent 失败永远不会把同批 peer 一起带走。任何远程写 git 操作前都跑仓库所属预检。Lifecycle 失败输出结构化 `Recovery hint`；agent 在有界恢复循环里处理，不会 force push、不会 `--no-verify`、也不会自动重启 OpenCode。

例：5 个并行 implementer 跑着，其中一个因为缺 import 返回 `task_error` → executor 用 `resume_subagent` 带 hint 让它补上 import 继续，剩下 4 个不受影响。

## 工作机制

```
Brainstorm → Plan → Implement
     ↓         ↓        ↓
  research  research  executor
```

### Brainstorm

通过协作问答把想法 refine 成 design。两个入口：`brainstormer`（文本）和 `octto`（带 16 种问题类型的浏览器 UI）。会并行派发研究 subagent。

非平凡提案先走完多轮对齐循环：研究 → 带显式备选项的推理 → 批量发问并给推荐默认值 → 场景演练 → 可选对抗审查（`archaeology` / `conservative` / `red team` / `YAGNI`）→ 用户明确说「go」→ 此时才触发 `lifecycle_start_request` 并写 design 文档。

输出：`thoughts/shared/designs/YYYY-MM-DD-{topic}-design.md`（可选的 `## Behavior` 段记录用户可见的行为承诺）。

### Plan

把 design 转成 plan：每个 task 2–5 分钟、文件路径精确、TDD 工作流。每个 task 都带一个 `Domain` 标签（`frontend-ui` / `frontend-code` / `backend` / `general`）。当 plan 同时覆盖前端（ui 或 code）和后端时，planner 额外产出 **冻结 API 契约文档**，并发的 implementer 必须遵守。

plan 还会自动在文件开头产出 `## 行为承诺映射` 段，把 design 里每条 Behavior bullet 显式映射到具体覆盖它的 task，让漏覆盖在实现开始前就暴露出来。

输出：
- `thoughts/shared/plans/YYYY-MM-DD-{topic}.md`
- `thoughts/shared/plans/YYYY-MM-DD-{topic}-contract.md`（仅跨域 plan）

### Implement

在 git worktree 里隔离执行。**Executor** 读每个 task 的 `Domain`，派给匹配的专家 implementer（`implementer-frontend-ui` / `implementer-frontend-code` / `implementer-backend` / `implementer-general`），并把契约路径注入每次 implementer 和 reviewer 的派发 prompt。`Domain: frontend` 这种 split 之前的旧值会被识别为 stale plan，直接停掉执行，并明确提示用户重跑 planner。

Batch 用 `Promise.allSettled` 的 batch-first 并行：独立 task 并发派出，一个失败不影响 peer。遇到 `task_error` / `blocked` 时优先 `resume_subagent(session_id, hint)` 而不是重派，让失败的 subagent 保留上下文。implementer 发现契约不符时只升级，不修改契约本身。

每个 batch 跑完都过 reviewer，并以 `lifecycle_log_progress(kind="status", summary="batch N complete")` 打 checkpoint。

### 知识维护

每次非平凡任务期间，agent 都会在三层知识库上跑 Read → Maintain → Verify → Report 协议：

- **Read** — 在 design / plan 之前调 `mindmodel_lookup`、`atlas_lookup`、`project_memory_lookup`。Atlas 上下文由 `atlas-auto-inject` hook 在会话开始时自动注入。
- **Maintain** — 在 batch 完成 / 决策拍板 / lifecycle 阶段切换等 checkpoint 主动写或更新 `atlas/` 节点，并对非平凡的决策 / 教训 / 风险 / open question 调 `project_memory_promote`。
- **Verify** — reviewer 与 executor 在批次完成时核对代码 diff 与对应节点 claim 是否一致；冲突通过 `Atlas observation: stale-detected` 或 `Project Memory observation: …` 单行 escalate，由 coordinator 路由。
- **Report** — 每次终态汇报都包含「本次知识上下文」段，并以两行固定状态收尾：`Atlas status: <值>` 和 `Project Memory status: <值>`。你能精确看到本次读了哪些来源、维护了哪些。

用户从不直接编辑 `atlas/` 文件或 Project Memory SQLite 数据库。想改一个行为节点就跟 agent 说「`atlas/20-behavior/X` 改成 Y」，由 agent 完成实际写入。

### 会话连续性

通过结构化 compaction 跨会话保留上下文。跑 `/ledger` 创建或更新 `thoughts/ledgers/CONTINUITY_{session}.md`。auto-compact hook 也会在上下文越过阈值时自动产出 ledger summary。Project Memory 在 worktree 清理后仍然存在，并在同一个 fork origin 的所有 worktree 之间共享。

## 斜杠命令

| 命令 | 分类 | 描述 |
|---|---|---|
| `/init` | 核心 | 初始化项目，生成 `ARCHITECTURE.md` 与 `CODE_STYLE.md` |
| `/ledger` | 核心 | 创建或更新会话连续性 ledger |
| `/search` | 核心 | 搜索过去的 handoff / plan / ledger |
| `/mindmodel` | 核心 | 为当前项目生成 `.mindmodel/` 约束 |
| `/memory` | 核心 | 查询持久 Project Memory（无参数 → `project_memory_health`；带参数 → `project_memory_lookup`） |
| `/all-init` | 知识库引导 | 一次性建立三层知识库（仅缺失部分）；可重复跑 |
| `/all-rebuild` | 知识库引导 | 覆盖式重建三层知识库（需要用户在 octto 中显式确认） |
| `/all-status` | 知识库引导 | 只读体检三层知识库与 Project Memory，不写任何文件 |
| `/atlas-init` | Atlas | 冷启动 Atlas vault（支持 `--reconcile` / `--force-rebuild`） |
| `/atlas-status` | Atlas | Atlas 健康报告：open challenge、broken wikilink、orphan staging、上一次运行 |
| `/atlas-refresh` | Atlas | 通过 `atlas-compiler` 做辅助批量 reconcile / 历史清理 |
| `/atlas-translate` | Atlas | 把 Atlas 节点或整个 vault 翻成中文，同时保留结构 |

## Agents

清单已对照 `src/agents/index.ts` 核验。

**Primary（用户可见）**

| Agent | 用途 |
|---|---|
| `commander` | 主工作流调度者 |
| `brainstormer` | 设计探索（文本） |
| `octto` | 设计探索（带 16 种问题类型的浏览器 UI） |

**工作流**

| Agent | 用途 |
|---|---|
| `planner` | 带 `Domain` 标签和可选冻结 API 契约的细粒度 plan |
| `executor` | 按 Domain 派发，配合 `Promise.allSettled` 跑 implementer / reviewer batch |
| `reviewer` | 单 task 的只读 review，校验契约一致性 |
| `executor-direct` | 单 subagent session 内的无 plan 直接执行 |

**Implementer（按 Domain 路由）**

| Agent | 用途 |
|---|---|
| `implementer-frontend-ui` | UI / UX、布局、样式、可访问性、动效、design system |
| `implementer-frontend-code` | 前端代码逻辑、状态、数据流、表单、类型修复、前端测试 |
| `implementer-backend` | API、数据层、服务端工作 |
| `implementer-general` | 配置、脚本、共享类型、测试基础设施 |

**Specialist（用户显式召唤，只读）**

| Agent | 用途 |
|---|---|
| `product-manager` | 把模糊请求收敛成带 framing / metrics / 范围 / 建议的 PRD |
| `software-architect` | 产出 2–3 个带权衡的架构备选方案与推荐选项 |
| `ux-designer` | 按 WCAG 2.2 / Material Design 3 / Apple HIG / CWV / Nielsen 10 审 UI / UX |
| `architecture-quality-inspector` | SOLID、循环依赖、抗模式、耦合约束；P0/P1/P2/P3 finding |
| `rubric-reviewer` | 多维 rubric 评分，强制每维度证据 |
| `critic` | 对抗审查：archaeologist / conservative / red team / YAGNI / cross-family |

**Investigation**

| Agent | 用途 |
|---|---|
| `investigator` | 只读诊断：收集证据，给出根因假设和升级建议 |

**Worker**

| Agent | 用途 |
|---|---|
| `codebase-locator` | 找出文件在仓库中的位置 |
| `codebase-analyzer` | 用精确的 `file:line` 解释代码 |
| `pattern-finder` | 找出可以照搬的既有模式与例子 |
| `artifact-searcher` | 搜索过去的 handoff / plan / ledger |
| `ledger-creator` | 创建与维护连续性 ledger |
| `notification-courier` | 通过 `autoinfo` MCP 推送 QQ 完成通知 |
| `probe` | 评估 octto 分支的 Q&A，决定继续追问还是收尾 |
| `bootstrapper` | 分析请求，为 octto 划分探索分支 |

**Mindmodel**

| Agent | 用途 |
|---|---|
| `mm-orchestrator` | 调度 mindmodel v2 两阶段生成流水线 |
| `mm-stack-detector` | 识别项目技术栈 |
| `mm-pattern-discoverer` | 发现模式类别 |
| `mm-example-extractor` | 为某个 mindmodel 类别提取代码例子 |
| `mm-convention-extractor` | 命名 / 风格 / 代码组织约定 |
| `mm-anti-pattern-detector` | 抗模式与不一致 |
| `mm-dependency-mapper` | 推荐依赖 vs 一次性依赖 |
| `mm-domain-extractor` | 业务域术语与概念 |
| `mm-constraint-writer` | 把分析结果组装进 `.mindmodel/` 并内联抽样 |
| `mm-constraint-reviewer` | 用项目约束审查生成代码 |
| `mm-code-clusterer` | 把相似的代码模式聚类 |

**Atlas**

| Agent | 用途 |
|---|---|
| `atlas-initializer` | 冷启动 Atlas builder：发现项目、规划节点、派发 worker |
| `atlas-compiler` | 辅助批量 reconcile / 历史清理（仅用户触发） |
| `atlas-translator` | 翻译已有 Atlas 节点散文，保留所有机器语法 |
| `atlas-cold-build` | 冷启动 build 层 worker：丰富某个 `10-impl/<module>.md` |
| `atlas-cold-behavior` | 冷启动 behavior 层 worker：起草某个 `20-behavior/<topic>.md` |
| `atlas-worker-build` | 从模块图与代码源出发，提议 build 层节点更新 |
| `atlas-worker-behavior` | 锚定到用户视角，提议 behavior 层节点更新 |

**Bootstrap**

| Agent | 用途 |
|---|---|
| `knowledge-bootstrap-orchestrator` | 串行调度 `/all-init` / `/all-rebuild` / `/all-status` |
| `project-initializer` | 生成 `ARCHITECTURE.md` 与 `CODE_STYLE.md` |

## Tools

清单已对照 `src/tools/index.ts` 与 `src/index.ts` 的 tool 注册核验。

**代码分析**

| Tool | 描述 |
|---|---|
| `ast_grep_search` | 用 `sg` 做 AST 感知的代码模式搜索 |
| `ast_grep_replace` | 用 `sg` 做 AST 感知的代码模式替换 |
| `look_at` | 提取文件结构 / 大纲，节省 context |

**Artifact 搜索**

| Tool | 描述 |
|---|---|
| `artifact_search` | 搜索过去的 plan 与 ledger（SQLite FTS5） |
| `milestone_artifact_search` | 搜索按 milestone 划分的产物（feature / decision / session） |

**Subagent 派发**

| Tool | 描述 |
|---|---|
| `spawn_agent` | 通过 `Promise.allSettled` 并行派发 subagent |
| `resume_subagent` | 在 `task_error` / `blocked` 后恢复保留的 subagent session |
| `batch_read` | 通过 `Promise.all` 并行读多个文件 |

**知识查询**

| Tool | 描述 |
|---|---|
| `mindmodel_lookup` | 查询 `.mindmodel/` 的编码模式与例子 |
| `atlas_lookup` | 在 Atlas vault 中检索节点摘要与源链接 |
| `project_memory_lookup` | 按主题 / 类型 / 状态查 Project Memory |
| `project_memory_promote` | 把 markdown 中的决策 / 教训 / 风险落进 Project Memory |
| `project_memory_forget` | 硬删除 Project Memory 条目（仅用户显式触发） |
| `project_memory_health` | 报告当前项目的 Project Memory 健康度 |

**Lifecycle**

| Tool | 描述 |
|---|---|
| `lifecycle_start_request` | 一次性创建 GitHub issue、branch、worktree |
| `lifecycle_commit` | 为某个 issue 提交 lifecycle 工作（自动 push 到 fork origin） |
| `lifecycle_finish` | 完成合并（PR 优先 / 本地 `--no-ff`）并关闭 issue |
| `lifecycle_current` | 解析当前 branch / worktree 对应的活跃 lifecycle |
| `lifecycle_resume` | 从 GitHub issue body 重建本地 lifecycle 记录 |
| `lifecycle_recovery_decision` | 只读地检视 lifecycle 状态并给出恢复决策 |
| `lifecycle_record_artifact` | 登记 lifecycle 产物指针（design / plan / ledger / commit / pr / worktree） |
| `lifecycle_log_progress` | 追加 progress 条目（decision / blocker / discovery / status / handoff） |

**Octto**

| Tool | 描述 |
|---|---|
| `start_session` | 用初始问题启动 Octto session，自动打开浏览器 |
| `end_session` | 结束 Octto session 并清理 |
| `push_question` | 向已有 session 队列追加问题 |
| `get_answer` | 取某条问题的答复 |
| `get_next_answer` | 等待任一问题被回答 |
| `cancel_question` | 取消一条待回答的问题 |
| `list_questions` | 列出某个 session 的全部问题及状态 |
| `create_brainstorm` | 创建带探索分支的 brainstorm session |
| `await_brainstorm_complete` | 等待 brainstorm session 跑完 |
| `get_brainstorm_summary` | 获取所有分支的总结与 finding |

**PTY**

| Tool | 描述 |
|---|---|
| `pty_spawn` | 启动一个后台 PTY session |
| `pty_write` | 向 PTY session 写入数据 |
| `pty_read` | 读取 PTY session 输出 |
| `pty_list` | 列出所有 PTY session |
| `pty_kill` | 终止 PTY session |

**库文档**

| Tool | 描述 |
|---|---|
| `btca_ask` | 通过 `btca` 询问库 / 框架源码 |

**其它**

| Tool | 描述 |
|---|---|
| `detect_knowledge_state` | 检测磁盘上三层知识库哪几层存在 |

## 配置

完整配置参考（模型解析、`micode.jsonc` 字段、spawn model override、环境变量、运行时部署、发布流程）见 **[docs/configuration.md](./docs/configuration.md)**。

快速示例：

```json
// opencode.json：所有 micode agent 的默认 model
{ "model": "<your-default-model>", "plugin": ["github:Wuxie233/micode"] }
```

```jsonc
// ~/.config/opencode/micode.jsonc：按 agent 覆盖
{
  "agents": {
    "implementer-frontend-ui": { "model": "<your-frontend-ui-model>" },
    "implementer-backend": { "model": "<your-backend-model>" }
  }
}
```

## Hooks

清单已对照 `src/hooks/index.ts` 核验。

- **Think Mode** — `think hard` 等关键词会启用 128k token 的 thinking budget。
- **Ledger Loader** — 把最新的 `thoughts/ledgers/CONTINUITY_*.md` 注入 system prompt。
- **Auto-Compact** — 在 context 越过阈值时压缩会话并写出 ledger summary。
- **File Ops Tracker** — 按 session 跟踪 read / write / edit 操作以便确定性记录。
- **Artifact Auto-Index** — 检测 `thoughts/ledgers/` 与 `thoughts/shared/plans/` 的写入并写进 SQLite FTS5 索引。
- **Context Injector** — 注入 `ARCHITECTURE.md`、`CODE_STYLE.md` 与目录上下文。
- **Token-Aware Truncation** — 截断过大的检索类 tool 输出以适配 context。
- **Fetch Tracker** — 缓存重复的 fetch 类 tool 输出，避免循环。
- **Context Window Monitor** — 跟踪 context 使用率并注入状态。
- **Mindmodel Injector** — 启用 `features.mindmodelInjection` 时按任务注入 `.mindmodel/` 上下文。
- **Constraint Reviewer** — 通过 `mm-constraint-reviewer` 用 `.mindmodel/` 约束审生成代码。
- **Session Recovery** — 对可恢复的 session error 尝试自动恢复。
- **Atlas Auto-Inject** — 在相关 session 开始时自动注入 Atlas 上下文。
- **Comment Checker** — 审查生成代码里的注释卫生。
- **Conversation Title** — 由 lifecycle / tool milestone 决定会话标题（v9 默认关闭聊天消息回退）。
- **Fragment Injector** — 按 agent 注入用户配置的 prompt 片段。

## Octto 配置

Octto 每个 OpenCode 插件进程跑一个共享 HTTP server。Session 通过 session-scoped URL 暴露。

每个 Octto session 归属创建它的 OpenCode 对话。其它对话调用工具会返回 `## Forbidden`，不会修改 session 状态。

| 环境变量 | 默认值 | 作用 |
|---|---|---|
| `OCTTO_PORT` | `0`（Bun 自动选空闲端口） | Octto 共享 server 绑定的端口 |
| `OCTTO_PUBLIC_BASE_URL` | 未设置 | 在反向代理后面时返回给 agent 的 URL 前缀，末尾 `/` 会被去掉。例如 `https://octto.wuxie233.com`。 |

反向代理需要把每个 session 页面路由到 `<base>/s/<sessionId>`、WebSocket 路由到 `<base>/ws/<sessionId>`。HTTPS 下浏览器会自动用 `wss://`。

浏览器 UI 采用 draft-before-send：点 Submit 只是把答案存为本地草稿；要点 `Send N answer(s)` 才会把答复发给 agent，每个草稿都可以用 `Edit` 改动。

## 本地开发

```bash
git clone git@github.com:Wuxie233/micode.git ~/.micode
cd ~/.micode && bun install && bun run build
```

```json
// 用本地路径
{ "plugin": ["~/.micode"] }
```

本地 runtime 路径、`bun run deploy:runtime` 部署助手、发布流程的细节见 [docs/configuration.md](./docs/configuration.md)。

## 灵感来源

- [vtemian/micode](https://github.com/vtemian/micode) - 最初的 MIT 项目基础
- [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) - 插件架构
- [HumanLayer ACE-FCA](https://github.com/humanlayer/12-factor-agents) - 结构化工作流
- [Factory.ai](https://factory.ai/blog/context-compression) - 结构化压缩研究

## 致谢

本项目最初基于 [vtemian/micode](https://github.com/vtemian/micode)（MIT License）并经过实质性重构。
原始版权与 license 文本保留在 `LICENSES/upstream-micode-MIT.txt`。

## 许可声明

上游 license 保留见 `LICENSES/`。
