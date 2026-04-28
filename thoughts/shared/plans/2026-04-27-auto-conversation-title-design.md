# Auto Conversation Title — Design

> Status: design (post-brainstorm)
> Origin: chat-mode brainstorm session 2026-04-27 (Octto blocked by `create_brainstorm` stringify bug — see Open Issues §1)
> Author decisions: 1a + 2c(条件式) + 3a + 4a

## Problem

OpenCode 的对话名当前对工作效率没有帮助:在对话列表里看不出每个会话当前在干嘛、走到哪一步。用户希望主 AGENT 的对话名能根据"当前任务状态"自动更新,这样在多会话切换时能快速识别每个对话的角色和进展。

实现 scope 严格限定为"用户直接交互的主 AGENT 会话",不动 subagent / octto session / lifecycle worktree 之外的会话。

## Findings by branch

### Branch 1 — 触发时机:里程碑触发 (1a)

**决策**:在关键里程碑事件触发更名,不做 per-tool-call 改名,不做 AI 自决,不做定时轮询。

**里程碑信号源** (按优先级,首个命中即更新):

| 信号 | 来源 | 状态文案 |
|---|---|---|
| Lifecycle issue 创建 | `lifecycle_start_request` 工具结束 | `规划中` |
| Plan 文件落盘 | `tool.execute.after` + tool=`write` + path 匹配 `thoughts/shared/plans/*.md` | `规划中` |
| 进入执行批次 | `spawn_agent` 触发 + agent 名以 `implementer-` 开头或为 `executor` | `执行中` |
| Lifecycle commit | `lifecycle_commit` 工具结束 | `执行中` (沿用) |
| Lifecycle finish | `lifecycle_finish` 工具结束且 `outcome.state===closed` | `已完成` |
| 用户首条消息 (新会话冷启动) | `chat.message` 且会话之前无标题或为默认占位 | `初始化` 或派生标题 |

**为什么不选其他**:
- 工具事件触发 (1c): 每次工具结束都更名会让 OpenCode 列表抖动严重,而且大部分工具调用语义噪声大 (read/grep 不该改标题)
- AI 自决 (1b): LLM 自己判断"语义变化"一致性差,而且要每次额外调用一次写入 API,代价高、抖动概率高
- 定时防抖 (1d): 滞后,而且没有自然的"任务完成"事件可对齐

**节流**: 同一 sessionID 1 秒内多次同标题更新合并为一次 (避免连续触发同状态时打 N 次 API)。

### Branch 2 — 命名规范:状态 + 任务,可选 issue 前缀 (2a + 2c 条件式)

**决策**: 标题模板为 `[#<issue>] <状态>: <任务摘要>` 中括号部分仅在能查到 lifecycle issue 时才出现。

**完整文法**:

```
title       := issue-prefix? status ": " summary
issue-prefix:= "#" issueNumber " "      (仅在该会话归属一个 active lifecycle 时)
status      := "初始化" | "规划中" | "执行中" | "已完成" | "失败"
summary     := <= 28 chars,从用户首条 user message + plan 文件名派生
```

**实例**:
- 无 issue: `执行中: 自动重命名对话`
- 有 issue: `#42 执行中: 自动重命名对话`
- 冷启动: `初始化: 设计对话名自动更新` (从首条 message 截取)

**Summary 派生规则**:
1. 优先级 1: 最近一次落盘的 `thoughts/shared/plans/YYYY-MM-DD-<slug>.md`,取 `<slug>` 转中文/原样保留
2. 优先级 2: lifecycle record 的 issue title (如有)
3. 优先级 3: 该会话第一条 user message 的前 28 个字符 (规范化:去换行、去多余空格)
4. 兜底: 保留 OpenCode 原默认标题,不动

**长度上限**: 整体 ≤ 50 字符 (中文按 1 字符算,emoji 不用)。超长在 summary 处截断并加 `…`。

**Issue 前缀的查询路径**:
- 通过 `lifecycle.store.list()` + `lifecycle.store.load(num)` 拉所有记录
- 用当前会话所在 cwd 与 `record.worktree` 比对,或用当前 git branch 与 `record.branch` 比对
- 只接受 `state ∈ {planning, executing, committing}` 的活跃记录
- 命中 0 条 → 省略前缀;命中多条 → 取 state 最靠后那条 (近似"最活跃")
- 该查询命中后 cache 60 秒,避免每次更新都遍历

### Branch 3 — 实现路径:Hook + API 能力探测 (3a) — evidence 已确认

**Evidence 收集结果**: SDK 能力齐全,3a 是唯一合理的实现路径,实施风险已基本消除。

| 关键点 | Evidence |
|---|---|
| 改标题 API | `client.session.update({ path: { id }, body: { title } })` 在 `node_modules/@opencode-ai/sdk/dist/gen/sdk.gen.d.ts:130` |
| 数据契约 | `SessionUpdateData.body.title?: string`,200 即成功 (`types.gen.d.ts:1913-1923`) |
| Hook 时机 | `Hooks["tool.execute.after"]` 提供 `tool` `sessionID` `args` `output` (`@opencode-ai/plugin/dist/index.d.ts:233-242`) |
| Hook 时机 (冷启动) | `Hooks["chat.message"]` 提供 `sessionID` `agent` (`index.d.ts:183-195`) |
| 父子会话区分 | 子会话有 `parentID`,主会话没有 (`types.gen.d.ts:107-109,469`),通过 `client.session.get` 校验 |
| 现有 hook 模式 | `src/hooks/file-ops-tracker.ts` 是干净参考:`createXHook(ctx) => Hooks` + 内存 Map per-session state |
| Lifecycle 数据 | `LifecycleStore.{list,load}` 暴露所有 record,`record.{branch,worktree,state}` 可用于反查 issue (`src/lifecycle/store.ts:16-20`) |

**模块布局**:

```
src/hooks/conversation-title.ts        # 主 hook:tool.execute.after + chat.message
src/utils/conversation-title/
  index.ts                             # 公开 API:applyTitle(ctx, sessionID, signal)
  classifier.ts                        # signal -> {status, summary} 推导
  lifecycle-lookup.ts                  # cwd/branch -> issueNumber 反查 + cache
  format.ts                            # title 拼装 + 长度约束
src/index.ts                           # 注册 hook
tests/hooks/conversation-title.test.ts # 单元 + 集成
tests/utils/conversation-title/        # classifier / lookup / format 单测
```

**Per-session 状态结构** (内存,与 file-ops-tracker 同模式):

```ts
interface ConversationTitleState {
  sessionID: string;
  isMainAgent: boolean | "unknown";    // lazy probe via client.session.get
  lastTitle: string | null;            // 防止重复写
  lastUpdateAt: number;                // 节流:1s 内同标题不重写
  lastSummary: string | null;          // summary 派生缓存
  lifecycleIssue: number | null;       // 60s cache
  lifecycleCachedAt: number;
}
```

**核心流程** (handler `tool.execute.after`):

1. 从 `input.tool` + `input.args` + `input.output` 推断是否是里程碑信号 (Branch 1 表)
2. 若不是 → return
3. lazy 探测主 vs 子会话:首次时调 `client.session.get({path:{id:sessionID}})`,缓存结果。子会话直接 return
4. 派生 summary (Branch 2 §"Summary 派生规则")
5. 反查 issue (有 cache,Branch 2 §"Issue 前缀")
6. 拼装 title 并 enforce 长度上限
7. 节流: 若 title 与 lastTitle 相同且距 lastUpdateAt < 1s → 跳过
8. 调 `client.session.update({path:{id:sessionID},body:{title}})`,失败 catch + log,绝不抛
9. 更新 lastTitle / lastUpdateAt

**为什么不选其他**:
- 3b (强绑 lifecycle): 用户大量会话不走 lifecycle (像本对话本身),覆盖率太低,违反"主 AGENT 会话都生效"的目标
- 3c (从 ledger 派生): ledger 是事后产物,更新滞后 5-10 分钟,失去标识价值
- 3d (独立工具,显式调用): 自动化为零,等同于"AI 记得改名才改",违背"自动"目标

### Branch 4 — 作用范围:仅主 AGENT 当前会话 (4a)

**决策**: 仅当 `client.session.get(sessionID).parentID` 为 falsy/不存在时才更名;子会话、octto session、subagent session 全部跳过。

**判定细节**:
- 用 `Session.parentID` 字段作主/子判定的唯一权威源 (SDK type 已确认有该字段)
- Octto session 由 `sessions.startSession` 在 `src/octto/session/store.ts` 自己管,不会跑 OpenCode 的 chat hook,自然不会被命中
- `spawn_agent` / `resume_subagent` 创建的子 session 在 OpenCode 侧有 `parentID`,会被排除
- Lifecycle worktree: worktree 不影响 sessionID 关系,worktree 内开的主会话仍然是 `parentID===undefined`,会被命中。这是 expected — worktree 内的对话也需要 issue 前缀提示
- Tool 调用是 `tool.execute.after` 上报的:子会话的工具调用走子会话自己的 sessionID,主会话保持不动

**保护项**:
- 用户手动改过的标题不被回写: 在第一次自动写入前先 `client.session.get()` 读取当前 title,如果当前 title 不等于"我们上次写过的 lastTitle" 且也不是 OpenCode 默认占位标题 (空串 / `Untitled` 等),视为用户手改 → 该会话进入"opt-out 状态",后续不再自动更名,直到下一次冷启动
- 这个 opt-out 状态 per-session,内存里维护即可,session 删除时随 `event=session.deleted` 清掉

## Recommendation

按 4 个 branch 决策合并实施。**单一推荐方案**:

**MVP 拆分** (建议拆成 2 个 issue,各自一天工作量):

**Phase 1 — 核心 hook + 状态机**
1. 新建 `src/hooks/conversation-title.ts`,实现 `tool.execute.after` + `chat.message` + `event` (清理) 三个 handler
2. 新建 `src/utils/conversation-title/{classifier,format}.ts`,纯函数,优先单元测试覆盖
3. 在 `src/index.ts` 注册 hook (照 `createFileOpsTrackerHook` 注册位置抄)
4. **暂不做 issue 反查**: phase 1 标题无 `#<issue>` 前缀,只做 `状态: 摘要`
5. opt-out 检测 + per-session 状态机
6. 测试: classifier 决策表、format 长度约束、opt-out 触发、子会话排除

**Phase 2 — Lifecycle issue 反查**
1. 新建 `src/utils/conversation-title/lifecycle-lookup.ts`,实现 cwd/branch → issueNumber + 60s cache
2. 接入 phase 1 的 format 链路
3. 测试: 多 record 时取最活跃、cache TTL、查询失败时 fallback 到无前缀

**Risks 与 mitigations**:
- **R1: SDK 改 title API 在某些 OpenCode 版本可能返回 4xx 但实际未生效** → mitigation: 写完后 `getTitle` 比对一次,不同则 log warn,但不重试 (避免无限循环)
- **R2: lifecycle store 反查在 record 多时性能下降** → mitigation: 60s cache + 上限只读最近 50 条 record (按 mtime)
- **R3: 在很多对话激活时,首次 probe 主/子会话会有一次 SDK round-trip** → mitigation: 结果常驻内存,session 生命周期内只查一次
- **R4: 用户在改标题瞬间 hook 写覆盖** → mitigation: opt-out 机制 (见 Branch 4 "保护项")
- **R5: tool name 里程碑识别误判** → mitigation: 单元测试覆盖每条信号,classifier 是纯函数 + 决策表

**Acceptance**:
- 在 micode 仓库新开一个不走 lifecycle 的对话,问"帮我看看 README" → 标题更新为 `初始化: 看 README` 之类
- 在 micode 仓库走 `lifecycle_start_request` + `planner` → 标题在 plan 落盘后变成 `#<num> 规划中: <plan-slug>`
- 用户手改标题为 `我自己取的名字` → 此后即便有里程碑信号也不再回写
- 子会话 / octto session / subagent session 标题不被动

**配置开关** (放 `micode.json`):
```jsonc
{
  "features": {
    "conversationTitle": {
      "enabled": true,             // default true
      "includeIssuePrefix": true,  // default true,phase 2 起生效
      "maxLength": 50              // default 50
    }
  }
}
```

## Open Issues / Follow-ups

1. **`create_brainstorm` 工具的 stringify bug** (这次 brainstorm 没能用 octto 的根因): host 把数组类参数序列化成 JSON 字符串再传入,而 `src/tools/octto/brainstorm.ts` 的 `normalizeBranches` 没像 `src/tools/spawn-agent-args.ts` 的 `tryParseStringifiedJson` 那样兜底,直接报 schema 错。修复方案就是抄 spawn-agent-args 那一套 `tryParseStringifiedJson` 加在 `normalizeSequence` 之前。**这是独立 bug,建议另起 issue 修复。**
2. 是否要给"已完成"状态加一个不会被新触发覆盖的"终态"语义? 当前定义里 lifecycle finish 后一旦再有工具调用就可能被改回 `执行中`。Phase 1 简化处理:已完成态保留 60 秒不被回写,之后再有信号则按新信号走。
3. v9 lifecycle 之外的 git branch 也可以考虑做一次 fallback 反查 (从 branch 名找 `#<num>`),但优先级低,先观察 phase 1+2 表现。
