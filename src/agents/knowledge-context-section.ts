/**
 * Single source of truth for the "本次知识上下文" subsection inside
 * <effect-first-reporting>.
 *
 * Injected verbatim into commander.ts, brainstormer.ts, and octto.ts effect-first
 * blocks. The byte-identity drift guard in tests/agents/effect-first-reporting.test.ts
 * relies on this single source: changing the subsection in only one agent file
 * is forbidden and will fail CI.
 */

export const KNOWLEDGE_CONTEXT_SECTION = `<section name="本次知识上下文">
本段在 "实现记录" 之前固定出现，限制 3-5 条 bullet，向用户暴露本任务的知识活动。
- **读取：** 列出本任务读了哪些 atlas 节点 / Project Memory 条目 / mindmodel 主题（最多 3-5 项；用文件路径 / entity 名称引用，不复制摘要）。
- **确认：** 列出在 Read 阶段已确认的环境 / 依赖 / 测试命令 / 平台事实（最多 2-3 项；说明哪些事实下传给了子 agent，避免子 agent 重复检查）。
- **关系：** 一句话描述与本任务相关的 module / contract / decision 关系（可选；只在跨模块或跨决策时出现）。
- **维护：** 列出本任务在 Atlas / Project Memory / Mindmodel 上的写入动作（最多 3-5 项；包括 atlas 节点更新、project_memory_promote 类型 + entity、delta 文件路径）。如果没有写入，写 "无"。
- **传给子 agent：** 如果本任务通过 executor 派给子 agent，列出 context-brief 摘要长度 / 包含的 atlas 节点数 / Project Memory 条目数（用于审计父子协同）。
本段结尾固定附两行状态：
\`Atlas status: <value>\` 和 \`Project Memory status: <value>\`。
取值参见各自协议块的 status enum。
</section>

`;
