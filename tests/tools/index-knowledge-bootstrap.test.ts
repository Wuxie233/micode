import { describe, expect, it } from "bun:test";

import { createDetectKnowledgeStateTool } from "@/tools";

describe("top-level tools barrel: knowledge bootstrap", () => {
  it("re-exports createDetectKnowledgeStateTool", () => {
    expect(typeof createDetectKnowledgeStateTool).toBe("function");
  });
});
