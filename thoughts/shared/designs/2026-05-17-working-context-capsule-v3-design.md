---
date: 2026-05-17
topic: "Working Context Capsule v3: Expose find/build as Plugin Tools + Contract Gap Drift Guard"
status: draft
---

## 承诺清单 / Commitments

用户原话：

- "搞 mcp 服务应该不是个优雅的做法 先看看 spawn_agent 是怎么做的"
- "这个需求早就该这样写了 为什么到现在才发现有这个问题 是不是其他需求也有类似的问题"
- "同意 推进吧"

investigator 已实查确认：

- 当前仓库**只有** capsule v2 这一个真缺口（prompt 命令式调用了内部 TS 函数名却没注册为工具）
- 其它 prompt 提到的 callable 都已在 `src/index.ts` `tool: { ... }` 注册
- 但 `tests/index-wiring.test.ts` 用 curated allowlist，`tests/agents/context-capsule-drift-guard.test.ts` 只保字符串，没有"prompt callable ⊆ 注册表"的结构性检查

sub-decision 已锁定：

1. 实现方式：**plugin tool（非 MCP）**，照搬 `spawn_agent` 模式
2. 工具名（snake_case）：`find_reusable_context_capsule`、`build_context_capsule`
3. 不暴露的内部行为：`resolveConversationAnchor` 和 `evaluateContextCapsuleFreshness` 改为 find/build 工具内部步骤，prompt 里删除"调用"措辞
4. agent-driven：不做 runtime auto-wrapper；agent 自决何时 find / build / skip
5. drift guard 测试：扫 prompt 中命令式 callable 名 → 必须 ⊆ 注册工具 ∪ 显式 allowlist
6. v1 的 `spawn_agent` `contextCapsule` 参数注入路径完全保留

承诺条目（终态汇报「需求核对表」对照）：

- 两个新工具都按 plugin tool 模式实现（`tool({...})` 工厂、`src/tools/index.ts` 导出、`src/index.ts` `tool: { ... }` 注册）
- 不引入 MCP / JSON-RPC / 独立服务器
- 底层复用 v2 已有 builder/store/freshness/redact/conversation 模块，不重写
- 三个 primary agent prompt（brainstormer / commander / octto）改为命令式调用真实工具名
- `resolveConversationAnchor` / `evaluateContextCapsuleFreshness` 不在 prompt 里以 callable 形式出现
- 新增 drift guard 测试断言"prompt 命令式 callable 名 ⊆ 注册表 ∪ allowlist"
- v1 spawn_agent contextCapsule 参数路径不动
- byte-identical / secret filter / immutable 三大不变量保持
- find 工具不写盘；build 工具只写 `thoughts/shared/context-capsules/`
- 不动 src/agents/context-capsule/* 现有内部 API

## Problem Statement

v2 设计阶段把 `findReusableContextCapsule` / `buildContextCapsule` / `resolveConversationAnchor` / `evaluateContextCapsuleFreshness` 直接写进 prompt 当 callable 用了，但这些只是内部 TS 函数，从未注册成 OpenCode plugin tool。

后果：

- agent 看到 prompt 说"call findReusableContextCapsule"，查自己的工具列表没有这个名字
- 防御性回答"工具没暴露，我不能直接调用"
- v2 的同对话 A→B 复用机制实际**不会被 agent 主动触发**
- 仅 `spawn_agent` 的 `contextCapsule` 参数注入路径生效（但这只在 v1 已写好的 spawn 处生效，对 commander → executor-direct 这种实际链路不起作用）

更深层的问题：测试盲区。没有任何测试检查"prompt 中命令式提到的 callable 名字 ⊆ 实际注册的工具名"。所以 v2 写完测试全绿，但真实链路断了。这次只暴露了 capsule v2 一处，但同型 bug 在未来任何新功能写法不严的时候都会再发生。

## Constraints

- 不能用 MCP / JSON-RPC / 独立 server；必须照 `spawn_agent` / `lifecycle_*` / `project_memory_*` / `atlas_*` 现有 plugin tool 同型实现
- 工具名 snake_case，与现有工具命名一致
- 底层不重写 v2 模块；工具壳薄
- `find_reusable_context_capsule` 是 read-only，不写盘
- `build_context_capsule` 只写 `thoughts/shared/context-capsules/` 目录，不动别的
- agent-driven：不做 runtime auto-wrapper；agent 自决相关性 / freshness / skip
- byte-identical drift guard / secret filter / immutable 不变量保留
- v1 spawn_agent `contextCapsule` 参数注入路径完全保留不动
- drift guard 测试必须分清楚 prompt 上下文里 callable 和 narrative：subagent_type 名、slash command、文档示例不该误报
- 不引入新协议块；既有 `<context-capsule-protocol>` / capsule-v2-hook 块只改 callable 名字
- 不引入新 byte-identical 镜像（drift guard 测试是 grep-based）

## Approach

**核心选择：plugin tool（非 MCP）+ drift guard 结构化堵漏**

放弃方案及理由：

1. **MCP 服务器** —— 拒绝，部署/IPC/类型化都比 plugin tool 重，且与现有工具风格不一致
2. **runtime auto-wrapper（自动 find/build）** —— 拒绝，agent-driven 更灵活、可解释、可审计
3. **只改 prompt 把"call"去掉当 narrative** —— 拒绝，真的要让 agent 用就得给真工具，否则 v2 实际仍不生效

采用方案的关键性质：

- 工具壳薄，底层复用 v2 模块，新增 LOC 少
- agent 在 prompt 协议指导下自决何时调用
- drift guard 测试结构性阻止同型 contract gap 再次发生
- 不破坏 v1 / v2 已有路径

## Architecture

```
src/tools/context-capsule/
├── index.ts                    # createContextCapsuleTools(ctx)
├── find/
│   ├── tool.ts                 # find_reusable_context_capsule（read-only）
│   └── args.ts                 # zod schema
└── build/
    ├── tool.ts                 # build_context_capsule（写盘）
    └── args.ts                 # zod schema

src/tools/index.ts              # 加 export
src/index.ts                    # 在 tool: { ... } 里 ...spread context-capsule tools
```

工具壳形态（对照 `src/tools/spawn-agent/tool.ts:776-792`）：

```
export function createContextCapsuleTools(ctx) {
  return {
    find_reusable_context_capsule: tool({
      description: "...",
      args: { ... },
      execute: async (args, toolCtx) => {
        const anchor = resolveConversationAnchor(toolCtx.sessionID)
        const ref = await findReusableContextCapsule({ ... })
        if (!ref) return "## No reusable capsule"
        const freshness = await evaluateContextCapsuleFreshness({ ref, ... })
        return formatFindResult(ref, freshness)
      }
    }),
    build_context_capsule: tool({
      description: "...",
      args: { ... },
      execute: async (args, toolCtx) => {
        const anchor = resolveConversationAnchor(toolCtx.sessionID)
        const result = await buildContextCapsule({ ... })
        return formatBuildResult(result)
      }
    })
  }
}
```

注意：`resolveConversationAnchor` 和 `evaluateContextCapsuleFreshness` 是工具内部组合的步骤，**不单独暴露**。

## Components

**1. find_reusable_context_capsule 工具**
- 位置：`src/tools/context-capsule/find/`
- 入参：optional `lifecycle_issue` / `topic_hint` / `since` 等过滤；默认从 toolCtx 推 conversation_anchor
- 出参：markdown 结果，列出最匹配 capsule 的 path / sha / token / freshness 档位（fresh | partially-stale | discarded | none）；若选 fresh / partially-stale 则附 capsule 摘要给 agent 决定是否注入

**2. build_context_capsule 工具**
- 位置：`src/tools/context-capsule/build/`
- 入参：`topic`（必填）、`confirmed_facts[]`、`source_files[]`、optional `lifecycle_issue` / `parent_capsule` / `dispatch_kind`
- 出参：markdown 结果，含写入路径、capsule sha、freshness token、warnings（secret 拦截 / soft window 等）

**3. Prompt 改造（brainstormer / commander / octto）**
- 找到现在写为 callable 的 4 个内部函数名：
  - `findReusableContextCapsule` → 改成 `` `find_reusable_context_capsule` ``
  - `buildContextCapsule` → 改成 `` `build_context_capsule` ``
  - `resolveConversationAnchor` → 删掉"调用"，改成描述性："工具内部会推断 conversation_anchor"
  - `evaluateContextCapsuleFreshness` → 删掉"调用"，改成描述性："find 工具返回的 freshness 档位"
- `src/agents/context-capsule-protocol.ts` 同步改

**4. Drift Guard Test**
- 位置：`tests/agents/prompt-tool-contract.test.ts`（新）
- 扫描：所有 `src/agents/**/*.ts` 内 prompt template literal + `src/agents/context-capsule-protocol.ts` + Atlas auto-inject prompt
- 抽取规则：
  - 反引号包裹 + 命令式上下文（"call X" / "调用 X" / "invoke X" / "use X tool" / "via X"）
  - 排除 narrative 引用（"see X for details"、"e.g. X"、subagent_type 列表、slash command 列表、文件路径、test name）
- 断言：抽取得到的名字 ⊆ (注册工具名) ∪ (allowlist)
- allowlist 显式列出非工具但允许在 prompt callable 上下文出现的名字（subagent_type 名等）

**5. Index Wiring 测试扩展**
- `tests/index-wiring.test.ts` 加上两个新工具的 expected 行
- 不替换原 allowlist 机制，只追加

**6. v2 模块**（不动）
- `src/agents/context-capsule/{builder,store,freshness,redact,conversation,format,injector,types}.ts` 保持现状
- 工具壳通过 import 调用它们

## Data Flow

**新 agent-driven 流程：**

```
commander 准备派 executor-direct 处理 B 需求
  ↓
（agent 自决）调 find_reusable_context_capsule
  ↓
工具内部：
  - resolveConversationAnchor(toolCtx.sessionID) → anchor
  - findReusableContextCapsule({ anchor, repo, branch, worktree }) → ref|null
  - evaluateContextCapsuleFreshness(ref) → fresh|partial|discarded
  ↓
返回 markdown 给 agent：
  "## Reusable capsule found
   - path: ...
   - sha: ...
   - freshness: fresh
   - summary: ..."
  ↓
commander 看到 fresh → 把 capsule path 作为 contextCapsule 参数传给 spawn_agent
（这一步走 v1 已有的注入路径，无需新改）
  ↓
executor-direct 收到 prompt 顶部已注入 capsule 前缀
  ↓
B 完成
  ↓
（agent 自决）调 build_context_capsule
  ↓
工具内部：
  - resolveConversationAnchor → anchor
  - buildContextCapsule({ ... }) → 写 thoughts/shared/context-capsules/conv-<anchor>-<topic>-<token>.md
  ↓
返回 markdown 给 agent：写入路径 + sha + warnings
```

**与 v1 / v2 关系：**

- v1 `spawn_agent.contextCapsule` 参数注入：保留，不变
- v2 builder/store/freshness/redact/conversation 内部模块：保留，不变
- v3 新增的只是 agent 可调的工具壳 + prompt 改造 + drift guard

## Error Handling

- **conversation_anchor 拿不到**：find 返回 "no anchor available, v2 path disabled"，agent 跳过；不阻塞
- **capsule 文件不存在**：find 返回 "no reusable capsule"
- **freshness discarded**：find 仍返回 path，但标 discarded，agent 自决是否参考
- **build 检测到 secret**：返回 `blocked: secret`，不写盘
- **build 入参缺 topic**：argschema 拒绝
- **toolCtx.sessionID 缺失**（罕见，比如某些测试场景）：anchor=null，正常返回 `skipped: no-session-context`
- **drift guard 测试 false positive**：通过 allowlist 显式豁免，不要轻易关测试

## Testing Strategy

- **工具单元测试**（参考 `tests/tools/spawn-agent.test.ts`）：
  - find：anchor 解析失败 / 命中 / 不命中 / 三档 freshness
  - build：写盘 / secret 拦截 / 默认值 / parent_capsule 链
- **drift guard 测试**：
  - 当前 prompt：通过（修复后所有 callable ⊆ 注册表 ∪ allowlist）
  - 故意制造一个 prompt 里 `` `not_a_tool` `` callable 引用 → 断言失败
  - 故意写 narrative "见 `spawn_agent`" → 不应误报
- **wiring 测试**：
  - `tests/index-wiring.test.ts` 加 expected entries
- **集成测试**：
  - `tests/integration/context-capsule-find-tool.test.ts`（新）：模拟 anchor + capsule 存在场景
  - `tests/integration/context-capsule-build-tool.test.ts`（新）：模拟写盘
- **回归测试**：
  - v1 spawn-agent allSettled 测试不破坏
  - v2 same-conversation / v1-regression / v2-boundaries / v2-roundtrip 测试不破坏
  - 现有 context-capsule-protocol 测试更新 callable 名

## Open Questions

- **是否给 find/build 加 octto 入口工具版本**：v3 不做，octto 多分支 brainstorm 仍可通过 commander 路径间接受益。
- **drift guard 是否扫 AGENTS.md mirror**：是；mirror 也按"callable ⊆ allowlist"约束，避免 markdown 镜像出现幻名。
- **是否需要 `cleanup_context_capsule` 工具**：v3 不做；现阶段 immutable + 用户自手动清理足够。
- **find 是否接收 `inject_now` 参数自动调 spawn_agent**：v3 不做；保持 agent-driven，find 只返回 ref。

## Behavior

**用户视角的可见行为承诺：**

- 同对话连续提需求时，commander/brainstormer/octto **真的会** 在合适时机调 `find_reusable_context_capsule` 和 `build_context_capsule`
- 调用结果在终态汇报"本次知识上下文"段可见（Capsule status 不再总是 none）
- find 工具不写盘；build 工具只写 `thoughts/shared/context-capsules/`
- 任何 prompt 里以反引号 + 命令式上下文出现的 callable 名字，**必须**对应真实注册工具，否则 CI 立即失败
- agent 仍可自决跳过 find/build（不强制）
- v1 / v2 已有路径行为不变

**验收方式：**

- 触发同对话 A→B 场景，观察 commander 是否真正调用了 `find_reusable_context_capsule` 工具（可在终态实现记录里看到 tool call）
- 故意在某个 agent prompt 写一个不存在的 callable 名 → 跑 `bun test tests/agents/prompt-tool-contract.test.ts` 应立即失败
- v1 / v2 测试套全绿
- find 返回的 fresh capsule 经 commander 注入到下一个 executor-direct 的 prompt 顶部，user prompt 起始字节稳定

Atlas 关联：本次扩展 atlas/20-behavior 下与 subagent dispatch / context 复用相关节点；执行阶段由 atlas-worker-behavior 决定是否新增 v3 子节点或在 v2 节点追加说明。
