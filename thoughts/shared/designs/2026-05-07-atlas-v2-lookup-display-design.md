---
date: 2026-05-07
topic: "Atlas v2 Lookup and Display"
status: validated
---

## Problem Statement

Atlas 当前已经能作为 Obsidian vault 展示项目结构，但它在开发流程中的参与感不足：brainstormer/planner 不会稳定地先看 atlas，AI 仍然倾向直接爬代码或向量搜索。

同时，用户在 Obsidian 中看到的节点仍是英文文件名，Sources 区块也是 `code:src/...` 纯文本，不可点击源码。正文翻译已经完成，但展示层和源码跳转还没完整闭环。

## Constraints

- 不做全量删库重建；用增量迁移保留 atlas 历史。
- 不重命名 atlas 文件和 wikilink targets；英文路径继续作为稳定机器 ID。
- 不把 `sources: string[]` 改成结构化对象；当前 parser/serializer/workers/reconciler 全链路依赖 flat string schema。
- 中文 graph view 依赖 Obsidian community plugin `obsidian-front-matter-title`，但 vault 在未安装插件时仍可用。
- GitHub permalink 是主源码跳转方式，保证跨设备稳定。
- 本 issue 只提供 auto-inject 基础 `getAtlasSummary()`；真正注入 brainstormer/planner 在 B-final issue 落地。

## Approach

采用 **兼容扩展**：保留现有 atlas schema 的 `sources: string[]`，通过 frontmatter `extras` 和正文渲染增强展示能力。

核心设计：

- `atlas_lookup` 扫描 atlas vault markdown，按 query 匹配 id/title/summary/sources/connections，返回小摘要。
- Frontmatter extras 写入 `title`、`aliases`、`source_path`，不影响现有 parser。
- Sources 正文把 `code:src/...` 渲染成 `[查看源码 src/...](https://github.com/Wuxie233/micode/blob/main/src/...)`。
- atlas-translator 增加职责：现有节点补齐 display title metadata 和 source links。
- `getAtlasSummary()` 读取 `atlas/00-index.md` 和少量关键节点，为后续 prompt auto-inject 提供稳定接口。

这个方案比 schema-breaking structured source 更安全：既满足用户体验，又避免改动 atlas claim/reconciler/worker JSON 格式。

## Architecture

**Tool layer** 新增 `atlas_lookup`，模式参考 `mindmodel_lookup`：本地目录扫描、无数据库、soft error markdown 输出。

**Atlas rendering layer** 增强 cold-init renderer/template：未来新增节点直接拥有 display metadata 和 GitHub source links。

**Migration layer** 扩展 atlas-translator prompt，让现有 vault 节点通过一次增量翻译/迁移获得同样格式。

**Auto-inject foundation** 新增 `src/atlas/auto-inject.ts`，只负责生成摘要，不直接修改 agent prompt。

## Components

**`src/tools/atlas/lookup.ts`**

- 新增 tool factory `createAtlasLookupTool(ctx)`。
- 参数：`query`, optional `layer`, optional `limit`。
- 扫描 `atlas/**/*.md`，排除 `_meta/` 和 archive。
- 用现有 `readPage` 读取 frontmatter/body。
- 输出包含 path、title/id、layer、summary excerpt、source links。

**Tool registration**

- `src/tools/atlas/index.ts` 导出 lookup。
- `src/tools/index.ts` 导出 factory。
- `src/index.ts` 注册工具。

**Renderer / templates**

- 增加 source pointer → markdown link formatter。
- 保留 frontmatter `sources:` 原始 strings。
- 正文 `## Sources` 输出可点击 GitHub link。
- Frontmatter `extras` 中写 `title` / `aliases` / `source_path`。

**Synthesize / types**

- 避免 schema-breaking structured source。
- 如需新增字段，放到 `PlannedNode` optional metadata 或在 renderer 中由 `sources` 推导。

**`src/agents/atlas-translator.ts`**

- Prompt 扩展：保留机器字段，但补齐 `title`/`aliases`/`source_path`，并把 Sources 正文从 raw pointer 改为 GitHub permalink。
- H1 保持英文 wikilink target 或现状，不用 translator 重命名文件。

**`src/atlas/auto-inject.ts`**

- 导出 `getAtlasSummary(projectRoot, options?)` 或同项目风格的 ctx-based helper。
- 返回 < 2000 token 的中文 atlas 摘要。
- B-final 使用该接口注入 brainstormer/planner。

**`atlas/README.md`**

- 文档化 `obsidian-front-matter-title` 插件。
- 说明没装插件时 graph view 显示英文文件名，装后显示 frontmatter title。

## Data Flow

**AI 查询**：主 agent 或 subagent 调 `atlas_lookup("lifecycle 状态机")` → tool 扫描 vault → 返回相关节点、连接、源码链接。

**未来节点生成**：cold-init 或 refresh 生成 node → renderer 保留 machine sources → body Sources 渲染 permalink → Obsidian 中可点击。

**现有 vault 迁移**：atlas-translator 读取现有节点 → 保留 filename/wikilink → 补 frontmatter display metadata → 改写 Sources 正文 → atlas commit。

**后续 auto-inject**：B-final 调 `getAtlasSummary()` → prompt 获得 atlas index 摘要 → AI 先看关系再看代码。

## Error Handling

**atlas vault 不存在**：`atlas_lookup` 返回清晰 `## Atlas not initialized`，不抛异常中断。

**query 无命中**：返回建议：读取 `atlas/00-index.md` 或扩大 layer filter。

**无法识别 source pointer**：保留原始 bullet，不生成坏链接。

**repo URL 不可解析**：fallback 到 `https://github.com/Wuxie233/micode`，并在测试覆盖。

**插件未安装**：atlas/README 说明 graph fallback，vault 不报错。

## Testing Strategy

- Tool tests：缺 vault、命中、layer filter、limit、formatted markdown。
- Renderer tests：`code:src/...` 正文 Sources 变 GitHub link，frontmatter sources 保持原始字符串。
- Frontmatter/template tests：extras 支持 `title` / `aliases` / `source_path`。
- Translator prompt tests：包含新职责与保护规则。
- Auto-inject tests：摘要长度、缺 vault fallback、读取 00-index。
- `bun run typecheck` + targeted atlas tests；如 full check 仍被无关 `.opencode/skills/.state.json` newline 卡住，记录但不扩大 scope。

## Open Questions

- 中文 title 的生成算法初版可简单映射或让 translator 补齐；后续不满意可以单独优化。
- 是否需要本地相对源码链接作为 fallback。当前主链路选择 GitHub permalink，跨设备更稳定。
