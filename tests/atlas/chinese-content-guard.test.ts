import { describe, expect, it } from "bun:test";
import { CJK_RATIO_THRESHOLD, inspectAtlasNode, MIN_PROSE_LENGTH } from "@/atlas/chinese-content-guard";

describe("inspectAtlasNode", () => {
  it("passes a Chinese-first node", () => {
    const md = [
      "---",
      "tags: [atlas, impl]",
      "---",
      "# 插件组合",
      "",
      "src/index.ts 是 micode OpenCode plugin 的组合入口，负责装配 agents、hooks、tools。",
      "",
      "## Sources",
      "- code:src/index.ts",
    ].join("\n");
    const result = inspectAtlasNode(md);
    expect(result.ok).toBe(true);
    expect(result.offenders).toEqual([]);
  });

  it("flags an English-only prose line", () => {
    const md = [
      "# Plugin Composition",
      "",
      "This module composes the entire micode plugin from agents and hooks at startup.",
    ].join("\n");
    const result = inspectAtlasNode(md);
    expect(result.ok).toBe(false);
    expect(result.offenders.length).toBe(1);
    expect(result.offenders[0].line).toContain("This module composes");
  });

  it("ignores frontmatter, fenced code, and wikilink-only lines", () => {
    const md = [
      "---",
      "tags: [atlas]",
      "id: plugin-composition",
      "---",
      "# 插件组合",
      "",
      "插件组合负责装配。",
      "",
      "[[10-impl/agent-registry]]",
      "",
      "```ts",
      "export const x = 1;",
      "```",
    ].join("\n");
    const result = inspectAtlasNode(md);
    expect(result.ok).toBe(true);
  });

  it("does not flag short prose below MIN_PROSE_LENGTH", () => {
    const md = ["# 标题", "", "ok"].join("\n");
    const result = inspectAtlasNode(md);
    expect(result.ok).toBe(true);
  });

  it("reports the offending line content and 1-based line number", () => {
    const md = [
      "# 标题",
      "",
      "中文段落。",
      "",
      "This is a long English-only paragraph that clearly fails the Chinese-first rule.",
    ].join("\n");
    const result = inspectAtlasNode(md);
    expect(result.ok).toBe(false);
    expect(result.offenders[0].lineNumber).toBe(5);
  });

  it("exposes the threshold constants for downstream tuning", () => {
    expect(MIN_PROSE_LENGTH).toBeGreaterThanOrEqual(20);
    expect(CJK_RATIO_THRESHOLD).toBeGreaterThanOrEqual(0.3);
    expect(CJK_RATIO_THRESHOLD).toBeLessThanOrEqual(0.5);
  });
});
