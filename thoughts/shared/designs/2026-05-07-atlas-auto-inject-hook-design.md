---
date: 2026-05-07
topic: "Atlas Auto Inject Hook"
status: validated
---

## Problem Statement

#46 已经提供 `atlas_lookup` 和 `getAtlasSummary()`，但只提供工具仍然会有 tool drift：brainstormer/planner 可能忘记先看 atlas。用户需要的是开发过程中的稳定参与感：AI 设计和规划时默认先获得项目图谱摘要。

现有 `brainstormer.ts` / `planner.ts` prompt 是静态字符串，无法在 module load 阶段 await `getAtlasSummary(ctx.directory)`。因此不能直接把 atlas 内容拼进 agent config。

## Constraints

- 只给 `brainstormer` 和 `planner` 自动注入 atlas context。
- 不给 `commander` 注入，避免 quick-op / routing 场景无意义吃 token。
- 缺少 atlas vault 或 `00-index.md` 时必须静默跳过，不阻断会话。
- 复用 #46 的 `getAtlasSummary()`，不另写一套读取逻辑。
- 注入内容 bounded，依赖 helper 的 maxBytes 限制。
- 触及 runtime hook 注册，属于 workflow/runtime-sensitive surface，必须走 lifecycle。

## Approach

新增一个 `chat.params` hook：`createAtlasAutoInjectHook(ctx)`。

Hook 在每次构造系统 prompt 时检查 `output.options?.agent`。如果 agent 是 `brainstormer` 或 `planner`，调用 `await getAtlasSummary(ctx.directory)`，并把返回内容包装成：

```xml
<atlas-context>
...
</atlas-context>
```

然后追加或前置到 `output.system`。如果 agent 是 `commander` 或其他 subagent，则不做任何事。

我选择 hook，而不是修改 agent prompt，因为 hook 能拿到 `ctx.directory`，并且现有 codebase 已经用 `ledger-loader` / `fragment-injector` / `context-injector` 走同样路径。

## Architecture

**Hook file**：`src/hooks/atlas-auto-inject.ts`

- 导出 `createAtlasAutoInjectHook(ctx)`。
- 内部维护 allowlist：`brainstormer`, `planner`。
- 调用 `getAtlasSummary(ctx.directory)`。
- 返回 OpenCode hook map `{ "chat.params": async (...) => ... }`。

**Hook barrel**：`src/hooks/index.ts`

- 导出新 hook。

**Plugin registration**：`src/index.ts`

- 实例化 `atlasAutoInjectHook`。
- 在 `chat.params` pipeline 中调用。
- 推荐放在 fragment/context 注入之后，ledger 注入附近，确保系统 prompt 中有清晰 `<atlas-context>` block。

**Tests**：`tests/hooks/atlas-auto-inject.test.ts`

- 用临时目录创建 atlas fixture。
- 测 brainstormer/planner 注入。
- 测 commander 不注入。
- 测缺 atlas 不修改系统 prompt。
- 测已有 system prompt 不被覆盖。

## Components

**`createAtlasAutoInjectHook`**

- 输入：`PluginInput`。
- 输出：hook map。
- 不抛用户可见错误；读取失败时跳过或返回 unchanged system。

**`ATLAS_AUTO_INJECT_AGENTS`**

- 明确 allowlist。
- 代码注释解释 commander 被排除：commander 是 triage/routing agent，按需可调用 `atlas_lookup`，不默认注入。

**`<atlas-context>` 格式**

- 包含 summary 和一行提示：如需更细内容，用 `atlas_lookup` 查询。

## Data Flow

1. OpenCode 准备 chat params。
2. 插件 hook pipeline 开始构建 `output.system`。
3. atlas hook 读取当前 agent name。
4. 如果是 brainstormer/planner，读取 atlas summary。
5. 如果 summary 非空，注入 `<atlas-context>`。
6. Agent 启动时天然拥有 atlas 摘要，减少盲目代码搜索。

## Error Handling

**Atlas 不存在**：`getAtlasSummary` 返回 null，hook 不改 prompt。

**读取失败**：hook 捕获错误，保持 `output.system` 原样，避免 atlas 问题阻塞主工作流。

**非目标 agent**：直接返回。

**系统 prompt 已有内容**：只拼接，不覆盖。

## Testing Strategy

- Hook unit tests 覆盖所有 agent allowlist / exclusion / fallback。
- Existing `tests/atlas/auto-inject.test.ts` 保持通过。
- Typecheck 验证 hook 与 PluginInput/hook pipeline 类型匹配。
- Targeted tests + `bun run typecheck`。

## Open Questions

- 注入顺序（prepend vs append）可由实现选择；要求是 `<atlas-context>` block 清晰可见且不覆盖已有 system。
- 后续如果 token 过大，可以给 `getAtlasSummary` 增加更低 maxBytes 或 feature flag；本轮不加配置复杂度。
