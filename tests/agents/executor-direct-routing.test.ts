// tests/agents/executor-direct-routing.test.ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const EXECUTOR_DIRECT_AGENT = "executor-direct";
const EXECUTOR_AGENT = "executor";
const COMMANDER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "commander.ts"), "utf-8");
const BRAINSTORMER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"), "utf-8");
const EXECUTOR_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "executor.ts"), "utf-8");

const COORDINATORS = [
  { name: "commander", source: COMMANDER_SOURCE },
  { name: "brainstormer", source: BRAINSTORMER_SOURCE },
];

const PRESERVED_OUTPUT_CLASSES = [
  { name: "location", agent: "codebase-locator" },
  { name: "explanation", agent: "codebase-analyzer" },
  { name: "diagnosis", agent: "investigator" },
  { name: "mutation", agent: EXECUTOR_AGENT },
] as const;

const findOutputAgent = (source: string, output: string): string | undefined => {
  const match = source.match(new RegExp(`<output-class name="${output}" agent="([^"]+)">`));

  return match?.[1];
};

const findOutputBody = (source: string, output: string, agent: string): string => {
  const match = source.match(
    new RegExp(`<output-class name="${output}" agent="${agent}">([\\s\\S]*?)<\\/output-class>`),
  );

  return match?.[1] ?? "";
};

describe("executor-direct routing contract (cross-coordinator)", () => {
  for (const coord of COORDINATORS) {
    describe(coord.name, () => {
      it("declares direct-execution as the executor-direct output class", () => {
        expect(findOutputAgent(coord.source, "direct-execution")).toBe(EXECUTOR_DIRECT_AGENT);
      });

      it("describes direct-execution as no-plan and bounded or scoped", () => {
        const body = findOutputBody(coord.source, "direct-execution", EXECUTOR_DIRECT_AGENT).toLowerCase();

        expect(body).toContain("no plan");
        expect(body).toMatch(/bounded|scoped/);
      });

      it("preserves existing routing class agent mappings", () => {
        for (const outputClass of PRESERVED_OUTPUT_CLASSES) {
          expect(findOutputAgent(coord.source, outputClass.name)).toBe(outputClass.agent);
        }
      });

      it("registers executor-direct in its agents or subagents listing", () => {
        const agentTag = /<agent\s+name="executor-direct"[^>]*mode="subagent"/.test(coord.source);
        const subagentTag = /<subagent\s+name="executor-direct">/.test(coord.source);

        expect(agentTag || subagentTag).toBe(true);
      });
    });
  }

  it("both coordinators agree on the executor-direct agent name spelling", () => {
    expect(findOutputAgent(COMMANDER_SOURCE, "direct-execution")).toBe(EXECUTOR_DIRECT_AGENT);
    expect(findOutputAgent(BRAINSTORMER_SOURCE, "direct-execution")).toBe(EXECUTOR_DIRECT_AGENT);
    expect(COMMANDER_SOURCE).not.toMatch(/executor_direct|executordirect/i);
    expect(BRAINSTORMER_SOURCE).not.toMatch(/executor_direct|executordirect/i);
  });

  it("keeps mutation routed to executor, not executor-direct", () => {
    for (const coord of COORDINATORS) {
      expect(findOutputAgent(coord.source, "mutation")).toBe(EXECUTOR_AGENT);
    }
  });

  it("executor prompt declares the plan input contract and executor-direct handoff", () => {
    expect(EXECUTOR_SOURCE).toContain("<input-contract");
    expect(EXECUTOR_SOURCE).toContain("thoughts/shared/plans/");
    expect(EXECUTOR_SOURCE).toContain(EXECUTOR_DIRECT_AGENT);
  });
});
