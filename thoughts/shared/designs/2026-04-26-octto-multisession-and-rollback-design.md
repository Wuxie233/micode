---
date: 2026-04-26
topic: "Octto 多会话隔离与回答回退"
status: validated
---

## Problem Statement

用户在公网反代 (`https://octto.wuxie233.com/`) 测试 Octto 后提出两个真实问题：

1. **多会话冲突**：多个 OpenCode 对话并发调用 Octto 工具会不会互相串题、抢答案、抢分支状态。
2. **选错回退**：浏览器一旦点 Submit，就只能干等下一题，没法回到上一题改答案。

我们要解决这两个问题，同时为 Octto 公网反代场景（HTTPS + 共享端口）打基础。

## Constraints

- **不能破坏现有工作流**：`brainstormer` / `octto` agent 的 `create_brainstorm` → `await_brainstorm_complete` 主链路必须保持兼容。
- **不能假设单进程内只有一个 Octto session**：micode 在一个 OpenCode 进程里被多对话共享。
- **Bun 原生 server**：继续用 `Bun.serve`，不引入新依赖。
- **公网反代友好**：必须支持 HTTPS、WSS、Host 转发，不能硬编码 `ws://`。
- **YAGNI**：深度回滚（撤销已被 probe agent 消费的答案）暂不做，先做 UI 草稿层 + ownership guard。
- **重启风险**：本次改动会动 plugin 代码，需要重启 OpenCode 服务才生效，必须在交付时由用户决定何时重启。

## Approach

分两期。一期解决 90% 痛点。

**一期（本设计的实现范围）：**

1. **共享 server + 路径化会话**：所有 Octto session 共用一个 `Bun.serve` 端口，URL 改为 `/s/:sessionId`，WebSocket 改为 `/ws/:sessionId`。一个反代域名打开任意会话。
2. **Ownership guard**：每个 Octto session 记录创建它的父 OpenCode `parentSessionId`，工具层在 `push_question` / `get_next_answer` / `cancel_question` / `end_session` 等入口校验调用方是不是同一个父会话。跨父会话访问直接拒绝。
3. **UI 草稿层**：`Submit` 不再立即 `ws.send`，先把答案标记为 draft 缓存。所有 pending 题目答完后出现"Send N answers"按钮，发送前每条 draft 上有 Edit 按钮可以回到题面重选。
4. **公网反代支持**：`config.octto` 增加 `port` / `publicBaseUrl` / `bindAddress` 可配置项，从环境变量读取。

**二期（不在本设计范围）：**

- 服务端 `revise_answer` 工具
- brainstorm state 回滚 + 取消已生成 probe 追问
- WebSocket error 类型在 UI 上的可见提示

## Architecture

```
OpenCode 进程
├── octtoSessionStore (单例)
│   ├── sharedServer        ← 一个 Bun.serve, 共享端口
│   ├── sessions: Map<sid, Session>
│   │   └── Session.ownerSessionID    ← 新增, 父 OpenCode 会话 ID
│   ├── questionToSession: Map<qid, sid>
│   └── waiters
│
├── tracker (parentSessionId → Set<octtoSessionId>)
│   └── 旧机制保留, 新增 ownership 校验
│
└── 工具层
    ├── start_session       ← 写入 ownerSessionID
    ├── push_question       ← 校验 ownerSessionID == ctx.sessionID
    ├── get_next_answer     ← 同上
    ├── cancel_question     ← 同上
    ├── end_session         ← 同上
    └── create_brainstorm/await_brainstorm_complete  ← 同上
```

```
浏览器
├── GET /s/:sessionId       ← 同一份 HTML bundle
├── WS  /ws/:sessionId      ← 路径里带 sessionId
└── UI 状态
    ├── pending[]
    ├── drafts[] (answered=true, sent=false)   ← 新增
    └── sent[]   (answered=true, sent=true)
```

## Components

### `src/utils/config.ts` - octto 配置扩展

- 新增 `octto.port`：从 `OCTTO_PORT` 环境变量读，默认 `0`（随机端口）。
- 新增 `octto.publicBaseUrl`：从 `OCTTO_PUBLIC_BASE_URL` 环境变量读，默认空字符串。配置后 `start_session` 返回的 URL 用它，否则用 `http://host:port`。
- 修改 `octto.bindAddress` 行为：`allowRemoteBind=true` 时 bind 真实地址（保持原行为）。
- 不破坏类型：`as const` 仍然适用。

### `src/octto/session/server.ts` - 共享 server + 路径路由

- `createServer(store)` 不再要求外部传 `sessionId`，改为路径解析。
- 路由：
  - `GET /` → 引导页（提示需要 `/s/:sessionId`）
  - `GET /s/:sessionId` → HTML bundle
  - `GET /ws/:sessionId` → WebSocket upgrade，把 `sessionId` 写入 `ws.data`
  - 其它 → 404
- 校验 `sessionId` 必须存在于 store，不存在返回 404。
- HTML bundle 路径不变，只是 mount 在 `/s/:sessionId`。

### `src/octto/session/sessions.ts` - 共享 server + ownership

- `createSessionStore(options)` 在第一次 `startSession` 时 lazy 创建共享 server，cleanup 时关闭。
- `Session` 新增字段 `ownerSessionID: string | null`。
- `startSession({ ownerSessionID, title, questions })` 把 ownerSessionID 写入 session。
- 新增内部 helper `assertOwner(sessionId, ownerSessionID)`：不匹配抛 `OcttoOwnershipError`。
- `endSession` / `pushQuestion` / `getAnswer` / `getNextAnswer` / `cancelQuestion` 全部接受可选 `ownerSessionID` 参数，传了就校验。
- `teardownSession` 不再停 server（server 是共享的），只清 session。

### `src/tools/octto/*` - 工具层接 ownerSessionID

- `start_session` / `create_brainstorm`：execute 里取 `context.sessionID`，传给 `sessions.startSession`。
- `end_session` / `push_question` / `get_next_answer` / `cancel_question` / `await_brainstorm_complete`：execute 里把 `context.sessionID` 当 ownerSessionID 传给 store。
- ownership 失败返回结构化错误字符串，不抛异常给 LLM。

### `src/octto/ui/bundle.ts` - UI 草稿层

- WebSocket URL 推导：解析 `window.location.pathname`，取 `/s/:sessionId`，构造 `/ws/:sessionId`。protocol 按 `window.location.protocol === "https:"` 切 `wss://`。
- 状态模型扩展：每个 question 增加 `sent: boolean`。
  - `Submit` 只设 `answered=true; sent=false; answer=...`，不发 WS。
  - 当所有 pending 处理完且存在 drafts 时，渲染"Review Answers"面板和"Send N answer(s)"按钮。
  - 点 "Send" 才统一 `ws.send` 所有 drafts，并把 `sent=true`。
  - 每条 draft 卡片右上角有 Edit 按钮：点了把该 question 重置回 pending（清 answer/sent，重新渲染题面）。
- 服务端推 `cancel` 时，本地直接移除（drafts 也丢）。
- 重连后服务端会重发 pending question，UI `upsertQuestion` 保留本地 `answered/answer/sent` 状态。

### 配置文档

- `micode.example.jsonc` 增补 `OCTTO_PORT` / `OCTTO_PUBLIC_BASE_URL` 用法说明。
- README 在 Octto 章节加一段"Public reverse proxy"说明。

## Data Flow

**新建会话**

```
LLM → start_session(ctx)
  → sessions.startSession({ ownerSessionID: ctx.sessionID, ... })
    → 第一次：lazy 创建共享 server, bind=127.0.0.1, port=config.octto.port
    → 注册 session, ownerSessionID 写入
    → URL = config.octto.publicBaseUrl + "/s/" + sid (回退到 http://host:port/s/:sid)
  → 返回 URL 给 LLM
```

**用户答题（草稿）**

```
浏览器 GET /s/:sid → HTML bundle
浏览器 WS  /ws/:sid → 服务端按 path 写 ws.data.sessionId
服务端: store.handleWsConnect(sid, ws)  → 推送所有 pending 问题
浏览器: Submit
  → 本地 q.answered=true, q.sent=false (不发 WS)
  → 当 pending=0 且 drafts>0 → 出现 Send 按钮
浏览器: Edit
  → q.answered=false, q.answer=undefined (回到题面)
浏览器: Send All
  → 对每条 draft ws.send({type:"response", id, answer})
  → q.sent=true
服务端: handleWsMessage 收到 response → 标 answered → notify waiters
```

**工具调用 ownership 校验**

```
LLM(对话A) → push_question(sid_of_B, ...)
  → ctx.sessionID = "A"
  → sessions.pushQuestion(sid_of_B, ..., ownerSessionID="A")
    → assertOwner: stored owner="B", incoming="A" → throw OcttoOwnershipError
  → 工具返回 "Failed: session does not belong to current chat"
```

## Error Handling

- **Ownership 不匹配**：返回结构化错误字符串，包含 session_id 前缀和当前 ctx 前缀，方便排查。不向浏览器发任何东西。
- **共享 server bind 失败**：`startSession` 直接抛错给 LLM，自动清理已注册的 session 记录。
- **未知 sessionId 的 HTTP/WS 请求**：404，避免泄露其它会话信息。
- **用户重复点 Send**：`sent=true` 后跳过，避免重发。
- **WebSocket 断线重连**：服务端按 sessionId 重新发送所有 `pending` 问题；UI 用 `upsertQuestion` 保留本地 draft 状态。
- **Server cleanup**：只在 `store.cleanup()` 关闭共享 server，单个 session end 不影响其它会话。

## Testing Strategy

新增 `tests/tools/octto/`（已有目录）：

1. **多会话隔离测试**
   - 创建两个 store-internal sessions，分配不同 ownerSessionID。
   - A 调 push_question 用 B 的 sid，断言返回 ownership error。
   - A 调 push_question 用自己的 sid，断言成功。

2. **共享 server 路径路由测试**
   - 启动 `createServer(store)`，注册一个 session sid=`abc`。
   - `GET /s/abc` 返回 HTML 200。
   - `GET /s/notexist` 返回 404。
   - `GET /ws/abc` upgrade 成功；`GET /ws/notexist` 拒绝。

3. **end_session 不停 shared server**
   - 启动 store，创建两个 session，end 其中一个，断言另一个仍能接 WS。
   - cleanup 后断言 server 关闭。

4. **配置覆盖**
   - 设置 `process.env.OCTTO_PUBLIC_BASE_URL=https://octto.wuxie233.com`，断言 `startSession.url` 以该前缀开头。

5. **UI 草稿层测试**
   - 用 happy-dom 或纯 DOM 字符串断言：渲染单题 → 模拟 Submit → 不调用 ws.send → 渲染 Send 按钮 → 点 Send → 调用 ws.send。
   - 模拟 Edit → 题目回到 pending 渲染。

整体跑 `bun run check`：Biome + ESLint + tsc + bun test。

## Open Questions

- **公网反代下 Send 按钮文案**：要不要中文？现在 brainstormer / octto agent 是英文 prompt，UI 也是英文。先保留英文，后续看用户反馈。
- **Owner 关联强度**：跨 OpenCode 进程不存在，因为 store 是进程内单例。同一个进程内的 octto session 共享 store 已经够。
- **二期回滚是否要做**：要等用户实际撞到"已发送但想撤"的场景再决定。一期 UI 草稿层覆盖 90% 误点。
