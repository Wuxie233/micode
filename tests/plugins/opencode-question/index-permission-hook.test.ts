import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

const INDEX_PATH = "src/index.ts";

describe("src/index.ts: question permission hook wiring", () => {
  it("imports questionPermissionFor from the opencode-question helper", async () => {
    const content = await readFile(INDEX_PATH, "utf-8");
    expect(content).toMatch(/questionPermissionFor/);
    expect(content).toMatch(/from\s+["']\.\/tools\/opencode-question\/permission["']/);
  });

  it("wires question permission into the config hook without removing existing allow rules", async () => {
    const content = await readFile(INDEX_PATH, "utf-8");
    expect(content).toMatch(/questionPermissionFor\(\s*config\.permission\s*\)|\bquestion:\s*["']allow["']/);
    expect(content).toMatch(/edit:\s*["']allow["']/);
    expect(content).toMatch(/bash:\s*["']allow["']/);
    expect(content).toMatch(/webfetch:\s*["']allow["']/);
    expect(content).toMatch(/external_directory:\s*["']allow["']/);
  });

  it("does NOT introduce a custom 'question' tool registration (we use upstream's)", async () => {
    const content = await readFile(INDEX_PATH, "utf-8");
    // Custom question tool would look like a tool factory keyed "question".
    // We forbid that pattern to enforce: use upstream built-in only.
    expect(content).not.toMatch(/createQuestionTool\b/);
    expect(content).not.toMatch(/registerQuestionTool\b/);
    // The plugin tools object spreads octtoTools, lifecycleTools etc. but
    // must not introduce its own "question" key at that top level.
    expect(content).not.toMatch(/\bquestion:\s*tool\.define\b/);
  });
});
