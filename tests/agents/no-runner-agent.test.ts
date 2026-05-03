import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as registry from "../../src/agents";

const AGENTS_DIR = join(__dirname, "..", "..", "src", "agents");

describe("agent registry: no runner/operator/light-executor (issue #23)", () => {
  it("does not export a runner agent from src/agents/index.ts", () => {
    const exported = Object.keys(registry);
    for (const name of exported) {
      expect(name.toLowerCase()).not.toContain("runner");
      expect(name.toLowerCase()).not.toContain("operator");
    }
  });

  it("does not contain a runner.ts or operator.ts agent file", () => {
    const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".ts"));
    for (const file of files) {
      expect(file.toLowerCase()).not.toBe("runner.ts");
      expect(file.toLowerCase()).not.toBe("operator.ts");
      expect(file.toLowerCase()).not.toBe("light-executor.ts");
    }
  });

  it("registry index does not import a runner-style agent", () => {
    const indexSource = readFileSync(join(AGENTS_DIR, "index.ts"), "utf-8");
    expect(indexSource).not.toMatch(/from\s+["']\.\/runner["']/);
    expect(indexSource).not.toMatch(/from\s+["']\.\/operator["']/);
    expect(indexSource).not.toMatch(/from\s+["']\.\/light-executor["']/);
  });

  it("commander prompt does not delegate to a runner-style agent", () => {
    const commanderSource = readFileSync(join(AGENTS_DIR, "commander.ts"), "utf-8");
    const withoutNegationBlock = commanderSource.replace(/<not-a-runner>[\s\S]*?<\/not-a-runner>/g, "");
    expect(withoutNegationBlock.toLowerCase()).not.toContain('agent="runner"');
    expect(withoutNegationBlock.toLowerCase()).not.toContain('agent="operator"');
    expect(withoutNegationBlock.toLowerCase()).not.toMatch(/spawn[\s_-]*runner/);
  });
});
