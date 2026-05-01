import { describe, expect, it } from "bun:test";

import { reviewerAgent } from "@/agents/reviewer";

const reviewer = reviewerAgent;

describe("reviewer agent prompt status emission contract", () => {
  it("instructs the agent to emit APPROVED or CHANGES REQUESTED", () => {
    expect(reviewer.prompt).toContain("APPROVED");
    expect(reviewer.prompt).toContain("CHANGES REQUESTED");
  });

  it("requires the verdict line to be on its own line at the end", () => {
    const prompt = reviewer.prompt.toLowerCase();
    const requiresFinalLine =
      /on its own line/i.test(reviewer.prompt) ||
      /final\s+line/i.test(reviewer.prompt) ||
      /last line/i.test(reviewer.prompt) ||
      /at the end/i.test(reviewer.prompt);

    expect(requiresFinalLine).toBe(true);
    expect(prompt).toContain("changes requested");
  });

  it("does NOT tell the reviewer to emit TEST FAILED or BUILD FAILED on review decisions", () => {
    const prompt = reviewer.prompt;
    const banner = "Status:";
    const idxStatus = prompt.indexOf(banner);

    if (idxStatus >= 0) {
      const block = prompt.slice(idxStatus, idxStatus + 200);
      expect(block).not.toMatch(/TEST FAILED/);
      expect(block).not.toMatch(/BUILD FAILED/);
    }
  });
});
