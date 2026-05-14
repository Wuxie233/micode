import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BRAINSTORMER = readFileSync(join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"), "utf-8");
const COMMANDER = readFileSync(join(__dirname, "..", "..", "src", "agents", "commander.ts"), "utf-8");
const OCTTO = readFileSync(join(__dirname, "..", "..", "src", "agents", "octto.ts"), "utf-8");
const PLANNER = readFileSync(join(__dirname, "..", "..", "src", "agents", "planner.ts"), "utf-8");
const EXECUTOR = readFileSync(join(__dirname, "..", "..", "src", "agents", "executor.ts"), "utf-8");
const REVIEWER = readFileSync(join(__dirname, "..", "..", "src", "agents", "reviewer.ts"), "utf-8");
const AGENTS_MD = readFileSync(join(__dirname, "..", "..", "AGENTS.md"), "utf-8");

function extractBlock(source: string, tagName: string): string {
  const openTag = `<${tagName}`;
  const closeTag = `</${tagName}>`;
  const start = source.indexOf(openTag);
  expect(start).toBeGreaterThanOrEqual(0);

  const end = source.indexOf(closeTag, start);
  expect(end).toBeGreaterThanOrEqual(0);

  return source.slice(start, end + closeTag.length);
}

function extractEffectFirstBlock(source: string): string {
  return extractBlock(source, "effect-first-reporting");
}

describe("brainstormer.ts sub-decision additions", () => {
  it("declares the sub-decision-identification phase", () => {
    expect(BRAINSTORMER).toContain('<phase name="sub-decision-identification"');
  });

  it("keeps the heuristic expansion checklist", () => {
    expect(BRAINSTORMER).toContain("启发式扩展清单");
  });

  it("routes question channel selection through AGENTS.md / Interactive Question Tools", () => {
    expect(BRAINSTORMER).toMatch(/AGENTS\.md.*channel|Interactive Question Tools/i);
  });

  it("documents conservative defaults for missed sub-decisions", () => {
    expect(BRAINSTORMER).toContain("保守默认");
  });

  it("declares Commitments as an optional design section", () => {
    expect(BRAINSTORMER).toContain('<section name="Commitments" optional="true">');
  });

  it("writes the commitments heading into design output guidance", () => {
    expect(BRAINSTORMER).toContain("## 承诺清单");
  });
});

describe("brainstormer.ts and commander.ts requirement check-off", () => {
  it("both mention the requirement checklist", () => {
    expect(BRAINSTORMER).toContain("需求核对表");
    expect(COMMANDER).toContain("需求核对表");
  });

  it("both mention defaulted decisions in the terminal report", () => {
    expect(BRAINSTORMER).toContain("本次按默认决定的事项");
    expect(COMMANDER).toContain("本次按默认决定的事项");
  });

  it("keeps the three-state checkoff markers in brainstormer", () => {
    expect(BRAINSTORMER).toMatch(/[✓⚠✗]/);
  });
});

describe("octto.ts semantic alignment", () => {
  it("mentions the requirement checklist", () => {
    expect(OCTTO).toContain("需求核对表");
  });

  it("mentions defaulted decisions in the terminal report", () => {
    expect(OCTTO).toContain("本次按默认决定的事项");
  });

  it("does not byte-identically mirror commander effect-first reporting", () => {
    expect(extractEffectFirstBlock(OCTTO)).not.toBe(extractEffectFirstBlock(COMMANDER));
  });
});

describe("planner/executor/reviewer no-mid-execution-interrupt", () => {
  it("all declare a critical no-mid-execution-interrupt block", () => {
    expect(PLANNER).toContain('<no-mid-execution-interrupt priority="critical"');
    expect(EXECUTOR).toContain('<no-mid-execution-interrupt priority="critical"');
    expect(REVIEWER).toContain('<no-mid-execution-interrupt priority="critical"');
  });

  it("all forbid octto_ask during mid-execution", () => {
    expect(PLANNER).toContain("不允许调用 octto_ask");
    expect(EXECUTOR).toContain("不允许调用 octto_ask");
    expect(REVIEWER).toContain("不允许调用 octto_ask");
  });

  it("executor surfaces defaulted decisions", () => {
    expect(EXECUTOR).toContain("按默认决定的事项");
  });

  it("executor and reviewer use the missing sub-decision observation marker", () => {
    expect(EXECUTOR).toContain("Sub-decision observation: missing");
    expect(REVIEWER).toContain("Sub-decision observation: missing");
  });

  it("keeps the reviewer final-marker-rule unique", () => {
    expect((REVIEWER.match(/verdict MUST appear as the LAST line/g) ?? []).length).toBe(1);
  });

  it("does not create byte-identical no-mid-execution-interrupt mirrors", () => {
    const plannerBlock = extractBlock(PLANNER, "no-mid-execution-interrupt");
    const executorBlock = extractBlock(EXECUTOR, "no-mid-execution-interrupt");
    const reviewerBlock = extractBlock(REVIEWER, "no-mid-execution-interrupt");

    expect(plannerBlock).not.toBe(executorBlock);
    expect(plannerBlock).not.toBe(reviewerBlock);
    expect(executorBlock).not.toBe(reviewerBlock);
  });
});

describe("AGENTS.md sub-decision and requirement check-off mirror", () => {
  it("declares sub-decision and check-off sections", () => {
    expect(AGENTS_MD).toContain("## Sub-decision Identification 约定");
    expect(AGENTS_MD).toContain("## Requirement Check-off 约定");
  });

  it("documents the key terms", () => {
    expect(AGENTS_MD).toContain("需求核对表");
    expect(AGENTS_MD).toContain("承诺清单");
    expect(AGENTS_MD).toContain("启发式扩展清单");
    expect(AGENTS_MD).toContain("保守默认");
  });

  it("preserves the Behavior section mirror", () => {
    expect(AGENTS_MD).toContain("## Behavior 段约定");
  });

  it("documents the drift guard source", () => {
    expect(AGENTS_MD).toMatch(/单源.*brainstormer\.ts|grep-based/i);
  });
});
