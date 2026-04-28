# Lifecycle Pre-flight Fix + Conversation-Title v2 Implementation Plan

**Goal:** 1) 修复 lifecycle pre-flight 把 fork 误判为 unknown 导致 `lifecycle_start_request` 全面失败；2) 把会话标题策略从 status-first 改为稳定的 topic-first，避免 `重启了` / `继续` 这类低信息量消息覆盖既有 topic。

**Architecture:** 两段独立工作。Part A 是单文件 schema 放宽 + 一个 sentinel 常量调整，最小侵入；Part B 是 `src/utils/conversation-title/` 内部重构，引入 source-confidence 与 topic 持久化，hooks 层只调用方式微调。两段都不改 hook 注册接口、不改 lifecycle 公开 API。

**Design:** 无独立 design 文档（任务已直接在用户消息中规约）。本计划即作为 design+plan 合并稿。

**Contract:** none（纯单进程内部修复，无前后端跨域接口）。

---

## 背景与约束

### A. 当前 pre-flight 失败现象

- `lifecycle_start_request` 调用时，pre-flight 走到 `gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission,hasIssuesEnabled`。
- 实际 `gh` 返回的 `parent` 形状是 `{ name, owner: { login } }`，没有 `nameWithOwner` 字段；`RepoParentSchema` 期待 `nameWithOwner: v.string()` ⇒ valibot `safeParse` 失败 ⇒ `parseRepoView` 返回 `null` ⇒ `classifyRepo` 直接给 `kind: UNKNOWN` ⇒ 上层把它当成 `pre_flight_failed` 中止整条 lifecycle 启动。
- 决策：放宽 schema 接受两种 parent 形状（旧 `nameWithOwner` 字段保留兼容；新增 `name + owner.login` 路径），并 normalize 成一份内部 `RepoParent`，让 `getParentUrl` 仍能给出 upstream URL。
- runner.gh 当前没有 `cwd` 参数。pre-flight 里 `git remote get-url origin` 用了 `cwd`，但 `gh repo view` 没传 cwd ⇒ gh 隐式按进程 cwd 解析仓库。这在 worktree 里通常能工作（gh 走 git config），本次先**不**给 `runner.gh` 加 cwd，避免扩面，留作后续。计划里只在测试中固化"不传 cwd"行为，避免回归引入。

### B. ABORTED_ISSUE_NUMBER = 1 污染问题

- `abortStart` 在 issue 创建前失败时写入 `record.issueNumber = 1` 作为 sentinel；store 用 issueNumber 作主键文件名 ⇒ 真实 issue #1 的记录会被本地 aborted record 覆盖，反之亦然。
- 决策：**本次做最小修复**。把 sentinel 改成 `0`（store 校验现在要求 `>= MIN_ISSUE_NUMBER`，说明 0 当前会被拒绝；放宽 `validateIssueNumber` 仅对 0 开特例，仅 `abortStart` 路径用），文件名用 `aborted-<timestamp>.json` 而非数字键，避免与真实 issue 冲突。如果实施时发现 store/load 改动溢出，降级为最小变更：在 abortStart 里直接使用 `Number.MAX_SAFE_INTEGER - <自增>` 这种不可能与真实 issue 碰撞的高位数字，并文档化。
- 这个修复列为 Part A 内的独立小任务；如果实施时间紧张可以推迟到下一轮，但本计划保留任务卡。

### C. 标题 v2 的稳定 topic 设计

- 现状：每次 `tool.execute.after` 或 `chat.message` 都重算 `<status>: <summary>`，summary 来源单一（先到先得），低信息消息也参与，导致 topic 跳变。
- 目标：维护一个 per-session 的 canonical topic（带 `confidence` 和 `source`），新事件只有当置信度更高时才覆盖；标题默认是 `<topic>`，仅在结论态（done / failed / blocked）后置阶段标签。
- 来源置信度（高 → 低）：
  1. `lifecycle_start_request` 的 `summary`（**最高**，固定为 issue topic）
  2. `lifecycle_commit` / `lifecycle_finish` 的 `summary`（不可覆盖 1，但可补全空 topic）
  3. plan/design 文件路径的 slug（来自 `write` 工具）
  4. PR title / commit title（来自 `lifecycle_commit` 的 `scope+summary` 拼接）
  5. 用户首条非低信息 chat message（最弱，仅在 topic 仍空时使用）
- 低信息消息黑名单（精确匹配，去 trim、去标点、小写后比较）：`重启了 继续 ok 好了 收到 嗯 行 好的 这是符合预期吗 what did we do so far 怎么样 ?` 等；以及长度 < 4 字符的纯短语。
- 用户手动改名 opt-out / throttle / done-freeze / update error swallow 全部保留现有行为。
- **不**引入 LLM 摘要，只用规则 + 字符串处理。

### D. 状态弱化输出格式

- 默认标题：`<topic>` 单段，最多 `maxLength`（沿用 50）。
- 结论态后置：仅当 status ∈ {DONE, FAILED}（FAILED 是新增）时输出 `<topic> · <status-label>`，使用 ` · ` 分隔（U+00B7 加空格）。
- INITIALIZING / PLANNING / EXECUTING 一律不出现在标题里（弱化）。
- 不引入 issue-number 前缀（`#3 · ...`）。本次明确放弃，理由：拿到 issue 号需要 lifecycle store 反查，跨 hook 与 lifecycle 模块依赖代价大；topic 稳定后用户已能区分不同 conversation。

---

## Dependency Graph

```
Batch 1 (parallel):  A1.1, A1.2, B1.1                    [foundation – schema/纯函数/常量]
Batch 2 (parallel):  A2.1, B2.1, B2.2                    [纯函数实现 – 依赖 batch 1]
Batch 3 (sequential within hook): B3.1, B3.2             [hook wiring – 依赖 batch 2]
Batch 4 (parallel):  A4.1, B4.1                          [集成测试 / 端到端验证]
```

---

## Part A: Pre-flight schema 放宽与 ABORTED sentinel

### Task A1.1: 放宽 RepoParent schema 与 normalize parent
**File:** `src/lifecycle/pre-flight.ts`
**Test:** `tests/lifecycle/pre-flight.test.ts`（扩展现有文件）
**Depends:** none
**Domain:** backend

**行为：**
1. `RepoParentSchema` 改为 `v.union([...])`，接受两种形状：
   - 旧形状：`{ nameWithOwner: string, url?: string }`
   - 新形状：`{ name: string, owner: { login: string }, url?: string }`
2. 新增 `normalizeParent(parent: unknown): RepoParent | null`，把任一形状收敛成内部 `{ nameWithOwner, url? }`：新形状用 `${owner.login}/${name}` 拼成 nameWithOwner。
3. `parseRepoView` 在 `safeParse` 成功后跑 normalize，把 view.parent 替换为统一形状再返回。`getParentUrl` / `createResult` 不需要改。
4. 兜底：如果 `isFork: true` 但 parent 仍为 null 或解析失败，**仍把 kind 判为 FORK**（用 owner.login 作为 viewerLogin），`upstreamUrl` 给 null。理由：用户语境里"fork 但拿不到 parent 元数据"远比"误判为 upstream"安全。
5. 不改 `runner.gh` 接口，不加 cwd 参数。

**测试新增 case：**
- `it("classifies forks when parent uses {name, owner.login} shape")` — 喂入实际 gh 返回的 shape，期望 `kind === FORK`，`upstreamUrl` 拼成 `https://github.com/<login>/<name>`。
- `it("classifies forks even when parent is null")` — `isFork:true, parent:null`，期望 `kind === FORK`，`upstreamUrl === null`。
- `it("still classifies legacy nameWithOwner parent shape")` — 保证旧 schema 形状不回归。

**Verify:** `bun test tests/lifecycle/pre-flight.test.ts`
**Commit:** `fix(lifecycle): accept gh parent {name, owner.login} shape in pre-flight`

---

### Task A1.2: ABORTED sentinel 不再撞 issue #1
**File:** `src/lifecycle/index.ts`
**Test:** `tests/lifecycle/store.test.ts`（如已存在则扩展，否则新增最小用例 in `tests/lifecycle/aborted-sentinel.test.ts`）
**Depends:** none（与 A1.1 解耦）
**Domain:** backend

**行为决策：**
- 不动 store 主键策略（改 store 文件名格式风险大）。改用一个**绝对不会与真实 issue 撞号**的 sentinel：`const ABORTED_ISSUE_NUMBER = Number.MAX_SAFE_INTEGER`（即 9007199254740991），并在 `validateIssueNumber` 之外不调整任何校验（store 现有 `>= MIN_ISSUE_NUMBER` 已经允许）。
- 如果将来有真实 issue 号到 9e15，再迁移；当前 GitHub 单仓 issue 号离这个数 13 个数量级，安全。
- 顺手：在 `abortStart` 写 record 时，`note` 里附上 `aborted-sentinel` 字样，方便人类辨认；并在 `notes` 里 push 一条 ``pre_flight_failed: <reason>` 已携带的原 note 之外加 `aborted-sentinel:1` ⇒ 改为 `aborted-sentinel:max`。

**实现细节：**
- `src/lifecycle/index.ts` 第 72 行：`const ABORTED_ISSUE_NUMBER = 1;` → `const ABORTED_ISSUE_NUMBER = Number.MAX_SAFE_INTEGER;`
- `issueUrlFor(input, ABORTED_ISSUE_NUMBER)` 会拼出 `https://github.com/<owner>/<repo>/issues/9007199254740991` 这种荒诞 URL；为了不把这个荒诞 URL 写进 issue body 等下游，新增 helper：
  ```
  const isAbortedSentinel = (n: number): boolean => n === ABORTED_ISSUE_NUMBER;
  ```
  并在 `abortStart` 内把 `issueUrl` 设为空字符串（已有的 `createRecord` 接口若不允许空串，则保留荒诞 URL；判断标准：先跑现有测试看 record 是否被序列化校验）。
- 如果改 `issueUrl` 会触发其他校验失败，则**只改常量**，不改 URL，并在计划注释里标注"留作后续 cleanup"。

**测试：**
- `it("aborted records use a sentinel issue number that cannot collide with real issues")`：调用 `abortStart` 走 mock context，断言 `record.issueNumber === Number.MAX_SAFE_INTEGER`。
- `it("aborting twice does not overwrite a pre-existing real issue #1 record")`：先 save 一个真实 issue#1 的 record，再触发 abortStart，再 load(1) 应仍是真实记录。

**Verify:** `bun test tests/lifecycle/`
**Commit:** `fix(lifecycle): move aborted sentinel off issue #1 to MAX_SAFE_INTEGER`

---

### Task A2.1: pre-flight 集成 smoke 测试（mock gh 真实 JSON）
**File:** `tests/lifecycle/pre-flight.test.ts`（同 A1.1 文件，独立 case）
**Test:** 同上
**Depends:** A1.1
**Domain:** backend

**行为：**
- 拷贝当前 `/root/CODE/micode` 实际 `gh repo view ...` 的真实 JSON 输出（实施者运行 `gh repo view --json nameWithOwner,isFork,parent,owner,viewerPermission,hasIssuesEnabled` 取一份 fixture），存为字符串常量喂入 fake runner。
- 断言 `classifyRepo` 给出 `kind === FORK` 且 `upstreamUrl` 非空。
- 这是一个**回归门票**：保证以后 gh 字段再变形不会无声破坏 lifecycle 启动。

**Verify:** `bun test tests/lifecycle/pre-flight.test.ts -t "real gh fixture"`
**Commit:** `test(lifecycle): pin real gh repo view fixture against pre-flight regression`

---

## Part B: Conversation-title v2 (topic-first)

### Task B1.1: 来源置信度常量与黑名单
**File:** `src/utils/conversation-title/source.ts`（新增）
**Test:** `tests/utils/conversation-title/source.test.ts`（新增）
**Depends:** none
**Domain:** general

**行为：**
- 导出 `TITLE_SOURCE` as-const 常量映射：
  ```
  LIFECYCLE_ISSUE = "lifecycle-issue"     // 置信度 100，最高
  LIFECYCLE_FINISH = "lifecycle-finish"   // 95，等价于 issue
  PLAN_PATH = "plan-path"                 // 70
  DESIGN_PATH = "design-path"             // 65
  COMMIT_TITLE = "commit-title"           // 50
  USER_MESSAGE = "user-message"           // 30，最弱
  ```
  对应 `TITLE_SOURCE_CONFIDENCE` 映射 source → number。
- 导出 `LOW_INFO_PATTERNS`：
  - 精确匹配集合（小写、去首尾标点空白后比较）：
    `重启了 / 继续 / 接着 / ok / okay / 好了 / 好的 / 收到 / 嗯 / 行 / done / 这是符合预期吗 / 这是符合预期吗? / 这符合预期吗 / what did we do so far / what did we do so far? / 怎么样 / 然后呢 / next / 继续做 / 继续吧`
  - 长度规则：normalize 后 `<= 3` 个 unicode 字符 ⇒ 低信息。
- 导出 `isLowInformationMessage(text: string): boolean`，纯函数。
- 导出 `compareConfidence(a: TitleSource, b: TitleSource): number` 返回负/零/正。

**测试：**
- 各黑名单字符串、混合大小写、带尾标点 `?` `。` 都应识别为低信息。
- `"想给 octto 加一个新功能"` 不算低信息。
- `"什么"` 算低信息（长度 2）。
- `compareConfidence(LIFECYCLE_ISSUE, USER_MESSAGE) > 0`。

**Verify:** `bun test tests/utils/conversation-title/source.test.ts`
**Commit:** `feat(conversation-title): add source confidence and low-info filter`

---

### Task B2.1: format.ts 改为 topic-first 输出
**File:** `src/utils/conversation-title/format.ts`
**Test:** `tests/utils/conversation-title/format.test.ts`（如不存在则新增）
**Depends:** B1.1
**Domain:** general

**行为：**
- 新增 `TITLE_STATUS.FAILED = "失败"` 已存在；新增 `TITLE_STATUS.BLOCKED = "阻塞"` 也作为结论态。
- 新增 `CONCLUSIVE_STATUSES: readonly TitleStatus[] = [TITLE_STATUS.DONE, TITLE_STATUS.FAILED, TITLE_STATUS.BLOCKED]`。
- 重写 `buildTitle(parts, maxLength)`：
  - 输入改为 `{ topic: string; status: TitleStatus }`（保持 `summary` 字段名向后兼容：内部映射 `summary -> topic`，旧测试不破）。具体：保留旧签名 `buildTitle({status, summary}, max)` 工作；新增 `buildTopicTitle({topic, status}, max)` 作为 v2 主路径。
  - v2 行为：
    - `topic === ""` ⇒ 返回 `status` 单段（保留旧兜底）。
    - `CONCLUSIVE_STATUSES.includes(status)` ⇒ 输出 `${topic} · ${status}`，按 maxLength 截断 topic 部分（保留 ` · ${status}` 后缀完整）。
    - 否则 ⇒ 输出 `topic` 单段（去掉 `<status>: ` 前缀）。
  - 分隔符常量 `STATUS_SUFFIX_SEPARATOR = " · "`。
- `summaryFromUserMessage` 保留，但调用方在 v2 hook 里要先用 `isLowInformationMessage` 过滤。

**测试新增/调整：**
- `it("buildTopicTitle returns plain topic for non-conclusive status")`
- `it("buildTopicTitle appends ' · 已完成' for DONE status")`
- `it("buildTopicTitle appends ' · 失败' for FAILED status")`
- `it("buildTopicTitle truncates topic but keeps suffix intact")`
- 旧 `buildTitle` 现有测试如果存在，保持通过（可能需要 case-by-case 调；如果项目没旧测试就跳过）。

**Verify:** `bun test tests/utils/conversation-title/format.test.ts`
**Commit:** `feat(conversation-title): topic-first buildTopicTitle with weakened status`

---

### Task B2.2: state.ts 引入 topic + confidence 持久化
**File:** `src/utils/conversation-title/state.ts`
**Test:** `tests/utils/conversation-title/state.test.ts`（如不存在则新增）
**Depends:** B1.1, B2.1
**Domain:** general

**行为：**
- `SessionRecord` 扩展字段：
  ```
  topic: string | null;           // 当前 canonical topic
  topicSource: TitleSource | null;// 来源
  ```
- `DecisionInput` 扩展字段：`source: TitleSource`（必填）。
- `decide(input)` 新逻辑（伪代码）：
  ```
  if optedOut → skip
  if doneFrozen → skip
  // 1) 决定新 topic
  const incomingTopic = input.summary;  // hook 已经过滤好的高质量 topic 候选
  let nextTopic = record.topic;
  let nextSource = record.topicSource;
  if (incomingTopic && nextTopic === null) {
    nextTopic = incomingTopic; nextSource = input.source;
  } else if (incomingTopic && compareConfidence(input.source, nextSource!) > 0) {
    nextTopic = incomingTopic; nextSource = input.source;
  } // 否则保留旧 topic
  // 2) 构造标题
  const title = buildTopicTitle({ topic: nextTopic ?? "", status: input.status }, input.maxLength);
  if (throttled(title)) → skip
  updateRecord(...)
  return WRITE
  ```
- 移除"低置信来源覆盖高置信 topic"的可能性。
- 保留：opt-out 检测、done-freeze、throttle、forget。
- 新增方法 `getTopic(sessionID): { topic: string | null; source: TitleSource | null }`，便于调试与测试。

**测试新增：**
- `it("first lifecycle issue summary becomes the topic")`
- `it("subsequent lower-confidence sources do not override the topic")`
- `it("higher-confidence source upgrades the topic")`
- `it("low-info chat that the hook filtered out never reaches decide")`（实际上 hook 过滤；这里只测 decide 不会自己解释 summary 含义）
- `it("conclusive status appends suffix without changing topic")`
- 旧 throttle / done-freeze / opt-out 测试保留并适配新 schema（只是 `source` 多传一个参数）。

**Verify:** `bun test tests/utils/conversation-title/state.test.ts`
**Commit:** `feat(conversation-title): persist canonical topic with source confidence`

---

### Task B3.1: classifier.ts 同步携带 source
**File:** `src/utils/conversation-title/classifier.ts`
**Test:** `tests/utils/conversation-title/classifier.test.ts`（如不存在则新增）
**Depends:** B1.1
**Domain:** general

**行为：**
- `MilestoneSignal` 扩展字段：`source: TitleSource`。
- 各 detector 返回时附 source：
  - `detectLifecycleStart` → `LIFECYCLE_ISSUE`
  - `detectLifecycleCommit` → `COMMIT_TITLE`（注意：commit 的 summary 不应能覆盖 issue topic；source 在 B2.2 决策里负责）
  - `detectLifecycleFinish` → `LIFECYCLE_FINISH`
  - `detectPlanWrite`：路径含 `-design.md` ⇒ `DESIGN_PATH`，否则 `PLAN_PATH`
  - `detectImplementerSpawn` → 不需要附 topic（保留 `summary: null`），source 给 `COMMIT_TITLE` 占位即可，因为它本来就不会更新 topic（summary 为 null 的分支在 B2.2 里被跳过）。
- `detectLifecycleFinish` 当 output 含 `closed` ⇒ 给 `status: DONE`，`summary: null`，`source: LIFECYCLE_FINISH`。

**测试：**
- 每个 detector 返回的 source 都正确。
- plan vs design 路径区分。

**Verify:** `bun test tests/utils/conversation-title/classifier.test.ts`
**Commit:** `feat(conversation-title): tag milestone signals with source label`

---

### Task B3.2: hooks/conversation-title.ts 接入 v2
**File:** `src/hooks/conversation-title.ts`
**Test:** `tests/hooks/conversation-title.test.ts`（扩展现有文件）
**Depends:** B2.1, B2.2, B3.1
**Domain:** general

**行为：**
- `dispatch` 增加 `source` 参数透传给 `registry.decide`。
- `handleToolAfter`：从 `classifyToolMilestone` 拿 signal 后，把 `signal.source` 一并传入。
- `handleChatMessage`：
  - 仍用 `summaryFromUserMessage` 提取 cleaned text。
  - **新增**：调用 `isLowInformationMessage(cleaned)`，若 true ⇒ 直接 return，不进入 dispatch。
  - 否则用 `source: TITLE_SOURCE.USER_MESSAGE`、`status: 当前不再用 INITIALIZING 触发标题展示`。决策里 status 仅影响是否加后缀；用户消息本身不是结论态 ⇒ 用一个新 status `TITLE_STATUS.ACTIVE`（如果引入新值代价大，复用 `INITIALIZING` 但语义上"非结论态"行为已由 buildTopicTitle 决定，标题不会出现 `初始化:` 字样，所以**无需新增 status**）。决策：**复用 `INITIALIZING`**，buildTopicTitle 见 B2.1 会忽略它。
- 不动：`isInternalSession` 过滤、parent ID 过滤主 session、update error swallow、session.deleted forget。

**测试新增/调整：**
- `it("ignores '重启了' chat message")`：发送 `重启了` ⇒ updates 空。
- `it("ignores '继续' / 'ok' / '这是符合预期吗' chat messages")`：参数化几条。
- `it("first lifecycle_start_request becomes the topic")`：发 lifecycle_start_request summary `修复 fork 检测` ⇒ title 应为 `修复 fork 检测`（不再有 `规划中: ` 前缀）。
- `it("later user message cannot override a lifecycle topic")`：先 lifecycle_start，再发用户消息 `加个按钮` ⇒ title 仍是 lifecycle 的 topic。
- `it("lifecycle_finish closed outcome appends ' · 已完成'")`。
- `it("manual user title still triggers opt-out and freezes further updates")`（保持现有行为）。
- 现有 `"renames the main session when a plan file is written"` 测试断言要更新：从 `规划中: foo` 改为 `foo`。
- 现有 `"renames on the first user message of a session"` 测试要更新：从 `初始化: 设计 对话名 自动更新` 改为 `设计 对话名 自动更新`。

**Verify:** `bun test tests/hooks/conversation-title.test.ts`
**Commit:** `feat(conversation-title): switch hook to topic-first with low-info filter`

---

### Task B4.1: 端到端场景回归
**File:** `tests/hooks/conversation-title.scenario.test.ts`（新增）
**Test:** 同上
**Depends:** B3.2
**Domain:** general

**行为：**
脚本化复现真实场景：
1. 用户首条消息 `修复 lifecycle pre-flight` → title = `修复 lifecycle pre-flight`
2. lifecycle_start_request summary `修复 fork pre-flight 与会话标题 v2` → title 升级为后者（更高 confidence）
3. write `thoughts/shared/plans/2026-04-28-lifecycle-preflight-and-title-v2.md` → title 不变（PLAN_PATH 置信度低于 LIFECYCLE_ISSUE）
4. 用户消息 `重启了` → title 不变
5. 用户消息 `继续` → title 不变
6. lifecycle_commit scope=`lifecycle` summary=`relax parent schema` → title 不变（COMMIT 置信度低）
7. lifecycle_finish output 含 `closed` → title = `修复 fork pre-flight 与会话标题 v2 · 已完成`

**Verify:** `bun test tests/hooks/conversation-title.scenario.test.ts`
**Commit:** `test(conversation-title): end-to-end topic stability scenario`

---

### Task A4.1: 全量门槛
**File:** none（运行已有 quality gate）
**Test:** `bun run check`
**Depends:** A1.1, A1.2, A2.1, B3.2, B4.1
**Domain:** general

**行为：**
- 跑 `bun run check`（biome + eslint + typecheck + bun test）。
- 修复任何因 schema/类型变更冒出来的 typecheck/lint 报错。
- 不要为了过 lint 添加无关重构；只修与本计划相关的红线。

**Verify:** `bun run check`
**Commit:** （此 batch 通常无独立 commit；若 lint 自动修了零碎格式，可 squash 到上一相关 commit；新增 commit 用 `chore(lifecycle,conversation-title): satisfy quality gate`）

---

## 实施顺序与小步原则

- **强烈建议每个 Task 单独一个 commit**，方便 reviewer 按文件审。
- Part A 可以独立先合（A1.1 + A1.2 + A2.1），立刻解锁 lifecycle_start_request；Part B 再分两批合。
- 任何 Task 出错回滚都只影响一个文件 + 一个测试文件，blast radius 最小。
- A1.2（aborted sentinel）若实施时发现存在隐性依赖 issue#1 路径的代码（grep `1` 在 lifecycle/index.ts 全文里要小心），先只改常量值，把"sentinel 不写 issueUrl"留作单独 follow-up。

## 不做（明确范围外）

- 不给 `runner.gh` 加 `cwd` 参数（避免改运行入口签名 + 改造 4 个调用点；只在 worktree 隐式生效就够用）。
- 不引入 issue 号前缀（`#3 · ...`），原因见上。
- 不引入 LLM 摘要做标题。
- 不重构 `LifecycleStore` 主键策略（aborted record 改用大 sentinel 已经隔离冲突）。
- 不动 `octto` 子 session 的标题逻辑（已通过 parentID 过滤）。
