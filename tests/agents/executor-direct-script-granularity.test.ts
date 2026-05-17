import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { executorDirectAgent } from "../../src/agents/executor-direct";

const REPO_ROOT = join(__dirname, "..", "..");
const COMMANDER_SOURCE = readFileSync(join(REPO_ROOT, "src", "agents", "commander.ts"), "utf-8");
const BRAINSTORMER_SOURCE = readFileSync(join(REPO_ROOT, "src", "agents", "brainstormer.ts"), "utf-8");
const AGENTS_MD = readFileSync(join(REPO_ROOT, "AGENTS.md"), "utf-8");

const EXECUTOR_DIRECT_PROMPT = executorDirectAgent.prompt ?? "";

const findOutputBody = (source: string, output: string, agent: string): string => {
  const match = source.match(
    new RegExp(`<output-class name="${output}" agent="${agent}">([\\s\\S]*?)<\\/output-class>`),
  );

  return match?.[1] ?? "";
};

const DIRECT_EXECUTION_COMMANDER = findOutputBody(COMMANDER_SOURCE, "direct-execution", "executor-direct");
const DIRECT_EXECUTION_BRAINSTORMER = findOutputBody(BRAINSTORMER_SOURCE, "direct-execution", "executor-direct");

describe("executor-direct script granularity guard (issue #96)", () => {
  describe("executor-direct prompt", () => {
    it("contains a script-granularity-guard block", () => {
      expect(EXECUTOR_DIRECT_PROMPT).toContain("<script-granularity-guard");
      expect(EXECUTOR_DIRECT_PROMPT).toContain("</script-granularity-guard>");
    });

    it("clarifies single session means one subagent session, not one bash command or one generated script", () => {
      const prompt = EXECUTOR_DIRECT_PROMPT.toLowerCase();
      expect(prompt).toContain("single session");
      expect(prompt).toContain("one subagent session");
      // Forbidden equivalences explicitly called out:
      expect(prompt).toMatch(/not\s+one\s+bash\s+command/);
      expect(prompt).toMatch(/not\s+one\s+(generated\s+)?script/);
    });

    it("prefers native read/edit/write for file mutation", () => {
      const prompt = EXECUTOR_DIRECT_PROMPT.toLowerCase();
      expect(prompt).toMatch(/prefer\s+native\s+(read\/edit\/write|read,?\s+edit,?\s+write)/);
    });

    it("preserves normal per-operation tool cadence", () => {
      const prompt = EXECUTOR_DIRECT_PROMPT.toLowerCase();
      expect(prompt).toMatch(/per[-\s]operation\s+tool\s+cadence/);
    });

    it("forbids one generated script combining discovery + mutation + verification + reporting", () => {
      const prompt = EXECUTOR_DIRECT_PROMPT.toLowerCase();
      // All four responsibility words must be named in the forbidden-combination rule.
      expect(prompt).toContain("discovery");
      expect(prompt).toContain("mutation");
      expect(prompt).toContain("verification");
      expect(prompt).toContain("reporting");
      // And the rule must explicitly say a script must not combine them.
      expect(prompt).toMatch(/must\s+not\s+combine|never\s+combine|do\s+not\s+combine/);
    });

    it("keeps single-purpose mechanical scripts explicitly allowed (does not ban python/shell)", () => {
      const prompt = EXECUTOR_DIRECT_PROMPT.toLowerCase();
      // The narrow exception must be present.
      expect(prompt).toMatch(/single[-\s]purpose|one\s+narrow\s+mechanical/);
      // Negative assertion: the prompt must NOT outright ban python or shell.
      expect(prompt).not.toMatch(/never\s+use\s+python/);
      expect(prompt).not.toMatch(/never\s+use\s+shell/);
      expect(prompt).not.toMatch(/python\s+is\s+forbidden/);
      expect(prompt).not.toMatch(/shell\s+is\s+forbidden/);
    });
  });

  describe("non-regression on existing executor-direct prompt contract", () => {
    it("still declares the four escalation targets", () => {
      const prompt = EXECUTOR_DIRECT_PROMPT.toLowerCase();
      expect(prompt).toContain("investigator");
      expect(prompt).toContain("planner");
      expect(prompt).toContain("executor");
      expect(prompt).toContain("user confirmation");
    });

    it("still forbids spawn_agent, plans, lifecycle ownership, default commit/push, restart, secret output", () => {
      const prompt = EXECUTOR_DIRECT_PROMPT.toLowerCase();
      expect(prompt).toContain("spawn_agent");
      expect(prompt).toContain("plan");
      expect(prompt).toContain("lifecycle");
      expect(prompt).toContain("commit");
      expect(prompt).toContain("push");
      expect(prompt).toContain("restart");
      expect(prompt).toContain("secret");
    });

    it("still requires the execution-envelope, self-review, verification rules", () => {
      const prompt = EXECUTOR_DIRECT_PROMPT.toLowerCase();
      expect(prompt).toContain("execution envelope");
      expect(prompt).toContain("self-review");
      expect(prompt).toContain("verification");
    });
  });

  describe("commander direct-execution output-class", () => {
    it("declares the executor-direct output-class is present", () => {
      expect(DIRECT_EXECUTION_COMMANDER.length).toBeGreaterThan(0);
    });

    it("references the script-granularity rule (single session is not one script)", () => {
      const body = DIRECT_EXECUTION_COMMANDER.toLowerCase();
      expect(body).toMatch(/script\s+granularity|one\s+subagent\s+session|not\s+one\s+(generated\s+)?script/);
    });
  });

  describe("brainstormer direct-execution output-class", () => {
    it("declares the executor-direct output-class is present", () => {
      expect(DIRECT_EXECUTION_BRAINSTORMER.length).toBeGreaterThan(0);
    });

    it("references the script-granularity rule (single session is not one script)", () => {
      const body = DIRECT_EXECUTION_BRAINSTORMER.toLowerCase();
      expect(body).toMatch(/script\s+granularity|one\s+subagent\s+session|not\s+one\s+(generated\s+)?script/);
    });
  });

  describe("AGENTS.md project mirror", () => {
    it("has the executor-direct Script Granularity Guard section heading", () => {
      expect(AGENTS_MD).toMatch(/^##\s+executor-direct\s+Script\s+Granularity\s+Guard\s*$/m);
    });

    it("documents single-session-is-one-subagent-session, native-file-ops-first, multi-purpose-script-ban", () => {
      const md = AGENTS_MD.toLowerCase();
      expect(md).toMatch(/one\s+subagent\s+session/);
      expect(md).toMatch(/native\s+(read\/edit\/write|read,?\s+edit,?\s+write)/);
      expect(md).toMatch(/discovery.*mutation.*verification.*reporting|多用途|multi[-\s]purpose/s);
    });

    it("names the prompt single-source for drift guard", () => {
      // The mirror must point at src/agents/executor-direct.ts (single source of truth).
      expect(AGENTS_MD).toContain("src/agents/executor-direct.ts");
    });
  });
});
