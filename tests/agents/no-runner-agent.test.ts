import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as registry from "../../src/agents";

const AGENTS_DIR = join(__dirname, "..", "..", "src", "agents");
const DIRECT_AGENT_FILE = "executor-direct.ts";
const DIRECT_AGENT_EXPORT = "executorDirectAgent";
const DIRECT_AGENT_REGISTRY_NAME = "executor-direct";
const DIRECT_EXECUTION_MARKER_PATTERN = /\b(?:executor-direct|direct-execution)\b/;
const RUNNER_OPERATOR_ROLE_PATTERN =
  /\b(?:runner\s+agent|operator\s+agent|light-executor)\b|agent=["'](?:runner|operator)["']/;

const stripNegationBlocks = (source: string): string =>
  source
    .replace(/<not-a-runner>[\s\S]*?<\/not-a-runner>/g, "")
    .replace(/<not-this-role>[\s\S]*?<\/not-this-role>/g, "");

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

  it("exports the executor-direct agent without adding runner-style agents", () => {
    const exported = Object.keys(registry);
    expect(exported).toContain(DIRECT_AGENT_EXPORT);
    expect(registry.agents).toHaveProperty(DIRECT_AGENT_REGISTRY_NAME);
    expect(registry.agents).not.toHaveProperty("runner");
    expect(registry.agents).not.toHaveProperty("operator");
    expect(registry.agents).not.toHaveProperty("light-executor");
  });

  it("keeps executor-direct.ts as the only direct-execution agent file", () => {
    const files = readdirSync(AGENTS_DIR).filter((file) => file.endsWith(".ts"));
    const directFiles = files.filter((file) => file.toLowerCase().includes("direct"));
    expect(directFiles).toEqual([DIRECT_AGENT_FILE]);
  });

  it("does not mix direct-execution routing with runner-style agent wording", () => {
    const files = readdirSync(AGENTS_DIR).filter((file) => file.endsWith(".ts"));

    for (const file of files) {
      const source = stripNegationBlocks(readFileSync(join(AGENTS_DIR, file), "utf-8")).toLowerCase();
      const mixesDirectExecutionWithRunnerRoles =
        DIRECT_EXECUTION_MARKER_PATTERN.test(source) && RUNNER_OPERATOR_ROLE_PATTERN.test(source);

      expect(mixesDirectExecutionWithRunnerRoles).toBe(false);
    }
  });
});
