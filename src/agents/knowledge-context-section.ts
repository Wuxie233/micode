// Single-source prompt fragment for the "本次知识上下文" output block.
//
// Context: issue #63 plans an agent-owned knowledge protocol with a unified
// final-report section listing what an agent READ from atlas / mindmodel /
// project memory and what it MAINTAINED back. Issue #64 (these orchestrator
// commands) lands first, so we own this minimal local definition. When #63
// lands, this file becomes the canonical single source — both issues share it
// byte-for-byte, no drift.
//
// The block is injected into agent prompts via template literal interpolation
// (see knowledge-bootstrap-orchestrator.ts). The block name and Chinese
// section title are stable surface that downstream tests assert on.

export const KNOWLEDGE_CONTEXT_SECTION = `<knowledge-context-section priority="critical" description="终态汇报必须包含本次知识上下文板块">
任务终态用户可见汇报必须包含一段"本次知识上下文"板块，让用户看见 agent 接触过的项目知识基础。最少包含两小节：

1. **读取**：列出本次任务读取的知识来源，可能包括：
   - atlas/ 节点（按 layer + node id，例如 \`10-impl/plugin-composition\`）
   - .mindmodel/ 约束文件（按相对路径）
   - project memory 条目（按 entity_id + entry_id 或简短摘要）
   - ARCHITECTURE.md / CODE_STYLE.md 等项目文档（按相对路径）
   若未读取任何知识来源，明确写"无"。

2. **维护**：列出本次任务对知识层的写入或新建，可能包括：
   - 新建或刷新的 atlas/ 节点 / atlas delta 文件
   - 新建或刷新的 .mindmodel/ 文件
   - 新增 project memory entry（type + summary）
   - 新建 ARCHITECTURE.md / CODE_STYLE.md
   若未维护任何知识来源，明确写"无"。

放在四段终态汇报"实现记录"段之前或之后皆可，但必须出现且使用上述两小节标题。中文优先；机器语法（路径、id、frontmatter key、tool name、code symbol）保留英文。
</knowledge-context-section>`;
