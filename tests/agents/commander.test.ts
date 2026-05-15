import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { primaryAgent } from "../../src/agents/commander";

const COMMANDER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "commander.ts"), "utf-8");

describe("commander agent", () => {
  it("should not reference handoff agents in prompt", () => {
    expect(primaryAgent.prompt).not.toContain("handoff-creator");
    expect(primaryAgent.prompt).not.toContain("handoff-resumer");
    expect(primaryAgent.prompt).not.toContain('<phase name="handoff">');
  });

  it("should still reference ledger", () => {
    expect(primaryAgent.prompt).toContain("ledger");
    expect(primaryAgent.prompt).toContain('<resume-handling priority="critical">');
  });

  it("should document commander lifecycle routing rules", () => {
    expect(primaryAgent.prompt).toContain(
      "Quick-mode tasks (typo fixes, version bumps, single-line patches) do NOT enter the v9 lifecycle. No issue, no worktree, no lifecycle_* calls.",
    );
    expect(primaryAgent.prompt).toContain(
      "Complex tasks routed through the brainstormer: brainstormer owns every lifecycle_* call (start, record_artifact, finish). You do NOT call lifecycle_start_request yourself.",
    );
    expect(primaryAgent.prompt).toContain(
      "Your only lifecycle responsibility is to ensure the user's request reaches brainstormer when the request is non-trivial.",
    );
    expect(primaryAgent.prompt).toContain(
      "Use the /issue slash command when the user asks to inspect or manually transition an active lifecycle.",
    );
  });

  it("documents routing by requested output, not by keyword triggers", () => {
    const source = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "..", "src", "agents", "commander.ts"),
      "utf-8",
    );

    expect(source).toContain("routing-by-requested-output");
    // The four output classes must each be named.
    expect(source.toLowerCase()).toContain("location");
    expect(source.toLowerCase()).toContain("explanation");
    expect(source.toLowerCase()).toContain("diagnosis");
    expect(source.toLowerCase()).toContain("mutation");
    // No keyword trigger lists.
    expect(source).not.toMatch(/trigger\s+keywords?\s*:/i);
  });

  it("references investigator as the diagnostic read-only specialist", () => {
    const source = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "..", "src", "agents", "commander.ts"),
      "utf-8",
    );

    expect(source).toContain("investigator");
    // Must distinguish investigator from executor on side effects.
    expect(source.toLowerCase()).toContain("read-only");
    expect(source.toLowerCase()).toContain("side effect");
  });

  it("does not weaken executor by routing implementation work elsewhere", () => {
    const source = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "..", "src", "agents", "commander.ts"),
      "utf-8",
    );

    // executor must still own delivery/mutation/commits per the design constraints.
    expect(source).toMatch(/executor[\s\S]{0,200}(delivery|mutation|commit)/i);
  });
});

describe("commander routing: direct-execution output class", () => {
  function commanderBlock(blockName: string): string {
    return COMMANDER_SOURCE.match(new RegExp(`<${blockName}[^>]*>([\\s\\S]*?)<\\/${blockName}>`))?.[0] ?? "";
  }

  function commanderOutputBody(output: string, agent: string): string {
    return (
      COMMANDER_SOURCE.match(
        new RegExp(`<output-class name="${output}" agent="${agent}">([\\s\\S]*?)<\\/output-class>`),
      )?.[1] ?? ""
    );
  }

  it("declares an output-class for direct-execution mapped to executor-direct", () => {
    const match = COMMANDER_SOURCE.match(/<output-class name="direct-execution" agent="([^"]+)">/);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("executor-direct");
  });

  it("describes direct-execution as no-plan, bounded scope, single-agent", () => {
    const match = COMMANDER_SOURCE.match(
      /<output-class name="direct-execution" agent="executor-direct">([\s\S]*?)<\/output-class>/,
    );
    expect(match).not.toBeNull();
    const body = (match?.[1] ?? "").toLowerCase();
    expect(body).toContain("no plan");
    expect(body).toMatch(/bounded|scoped/);
    expect(body).toContain("single");
  });

  it("clarifies that the mutation class requires a plan and routes to executor", () => {
    const match = COMMANDER_SOURCE.match(/<output-class name="mutation" agent="executor">([\s\S]*?)<\/output-class>/);
    expect(match).not.toBeNull();
    const body = (match?.[1] ?? "").toLowerCase();
    expect(body).toContain("plan");
  });

  it("registers executor-direct in the agents table", () => {
    expect(COMMANDER_SOURCE).toMatch(/<agent\s+name="executor-direct"[^>]*mode="subagent"/);
  });

  it("anti-patterns warn against routing investigator/planner work to executor-direct", () => {
    const lower = COMMANDER_SOURCE.toLowerCase();
    expect(lower).toContain("executor-direct");
    expect(lower).toMatch(/executor-direct.*not.*investigat|not.*investigator.*executor-direct/);
  });

  it("documents the same narrow explicit bounded direct exception as brainstormer", () => {
    const body = commanderOutputBody("direct-execution", "executor-direct").toLowerCase();

    expect(body).toContain("explicit bounded exception");
    expect(body).toMatch(/user.*(explicit|direct)|explicit.*user/);
    expect(body).toContain("named targets");
    expect(body).toContain("verification");
    expect(body).toMatch(/no side[-\s]?effect|side[-\s]?effect boundary/);
    expect(body).toMatch(/no .*contract|contract.*no/);
  });

  it("keeps high-risk behavior changes out of executor-direct", () => {
    const combined = `${commanderBlock("non-trivial-detector")}\n${commanderOutputBody(
      "direct-execution",
      "executor-direct",
    )}`.toLowerCase();

    expect(combined).toContain("agent routing");
    expect(combined).toContain("tool permissions");
    expect(combined).toContain("lifecycle rules");
    expect(combined).toContain("slash command contract");
    expect(combined).toContain("runtime boot registration");
    expect(combined).toContain("deploy/restart policy");
    expect(combined).toMatch(/lifecycle \+ planner \+ executor|planner \+ executor/);
  });

  it("requires runtime direct fixes to disclose deploy status", () => {
    const body = commanderOutputBody("direct-execution", "executor-direct").toLowerCase();

    expect(body).toContain("bun run deploy:runtime");
    expect(body).toMatch(/live opencode runtime|live runtime/);
    expect(body).toMatch(/not (yet )?effective|尚未生效|not deployed/);
  });
});

describe("commander Chinese intent classification", () => {
  function commanderSource(): string {
    return require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "..", "src", "agents", "commander.ts"),
      "utf-8",
    );
  }

  function brainstormerSource(): string {
    return require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"),
      "utf-8",
    );
  }

  it("declares an <intent-classification> block", () => {
    expect(commanderSource()).toMatch(/<intent-classification[^>]*>/);
    expect(commanderSource()).toContain("</intent-classification>");
  });

  it("intent-classification block is placed BEFORE routing-by-requested-output", () => {
    const src = commanderSource();
    const intentOpen = src.search(/<intent-classification[^>]*>/);
    const routingOpen = src.indexOf("<routing-by-requested-output");

    expect(intentOpen).toBeGreaterThan(-1);
    expect(routingOpen).toBeGreaterThan(-1);
    expect(intentOpen).toBeLessThan(routingOpen);
  });

  it("declares the four Chinese intent enum values", () => {
    const src = commanderSource();
    expect(src).toContain("快速修复");
    expect(src).toContain("设计");
    expect(src).toContain("调试");
    expect(src).toContain("运维");
  });

  it("declares the user-visible output template with 意图 and 理由", () => {
    const src = commanderSource();
    expect(src).toContain("意图:");
    expect(src).toContain("理由:");
  });

  it("declares first-turn-only behavior", () => {
    const src = commanderSource().toLowerCase();
    expect(src).toMatch(/first[-\s]turn|第一回合|首回合|新请求.*第一/);
  });

  it("includes worked examples for bounded direct exception and high-risk plan routing", () => {
    const src = commanderSource();
    const block = src.match(/<intent-classification[\s\S]*?<\/intent-classification>/);
    expect(block).not.toBeNull();
    const body = block?.[0] ?? "";

    expect(body).toContain("快速修复");
    expect(body).toContain("设计");
    expect(body).toContain("explicit bounded exception");
    expect(body).toMatch(/agent routing|tool permissions|lifecycle rules|runtime boot registration/);
  });

  it("intent-classification block is byte-identical to the brainstormer block (no drift)", () => {
    const commanderBlock = commanderSource().match(/<intent-classification[\s\S]*?<\/intent-classification>/);
    const brainstormerBlock = brainstormerSource().match(/<intent-classification[\s\S]*?<\/intent-classification>/);

    expect(commanderBlock).not.toBeNull();
    expect(brainstormerBlock).not.toBeNull();
    expect(commanderBlock?.[0]).toBe(brainstormerBlock?.[0]);
  });
});
