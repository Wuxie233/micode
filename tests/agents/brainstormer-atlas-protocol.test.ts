import { describe, expect, it } from "bun:test";

import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";
import { brainstormerAgent } from "@/agents/brainstormer";

describe("brainstormer Atlas mental model protocol", () => {
  const prompt = brainstormerAgent.prompt ?? "";

  it("contains the canonical Atlas mental model protocol", () => {
    expect(prompt).toContain(ATLAS_MENTAL_MODEL_PROTOCOL);
  });

  it("places the Atlas protocol after effect-first reporting and before output-format", () => {
    const effectFirstClose = prompt.indexOf("</effect-first-reporting>");
    const atlasOpen = prompt.indexOf("<atlas-mental-model");
    const outputFormatOpen = prompt.indexOf("<output-format");

    expect(effectFirstClose).toBeGreaterThan(-1);
    expect(atlasOpen).toBeGreaterThan(-1);
    expect(outputFormatOpen).toBeGreaterThan(-1);
    expect(atlasOpen).toBeGreaterThan(effectFirstClose);
    expect(atlasOpen).toBeLessThan(outputFormatOpen);
  });

  it("injects exactly one Atlas protocol block", () => {
    const matches = prompt.match(/<atlas-mental-model/g) ?? [];

    expect(matches).toHaveLength(1);
  });

  it("preserves the Chinese-first Atlas core requirement", () => {
    expect(prompt).toContain("Project Atlas (atlas/) 是人和 AI 共享的项目心智模型");
    expect(prompt).toContain(
      "传递项目信息（节点名 / 标题 / 正文 / summary / behavior 描述 / decision rationale / risk 描述）必须中文优先",
    );
  });
});
