import { describe, expect, it } from "bun:test";

import { atlasTranslatorAgent } from "@/agents/atlas-translator";

describe("atlas-translator chinese-content-guard reference", () => {
  it("documents inspectAtlasNode as a hint-only guard that does not block writes", () => {
    const prompt = atlasTranslatorAgent.prompt;
    expect(prompt).toContain("inspectAtlasNode");
    expect(prompt.toLowerCase()).toContain("hint");
    expect(prompt.toLowerCase()).toContain("not block");
  });
});
