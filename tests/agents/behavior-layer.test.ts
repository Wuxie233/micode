import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BRAINSTORMER = readFileSync(join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"), "utf-8");
const COMMANDER = readFileSync(join(__dirname, "..", "..", "src", "agents", "commander.ts"), "utf-8");
const PLANNER = readFileSync(join(__dirname, "..", "..", "src", "agents", "planner.ts"), "utf-8");
const EXECUTOR = readFileSync(join(__dirname, "..", "..", "src", "agents", "executor.ts"), "utf-8");
const REVIEWER = readFileSync(join(__dirname, "..", "..", "src", "agents", "reviewer.ts"), "utf-8");
const AGENTS_MD = readFileSync(join(__dirname, "..", "..", "AGENTS.md"), "utf-8");

describe("brainstormer.ts behavior-layer additions", () => {
  it("includes <behavior-alignment> child block inside effect-first-reporting", () => {
    expect(BRAINSTORMER).toContain(
      '<behavior-alignment description="Align user-visible report with design.md ## Behavior section">',
    );
  });
  it("includes <behavior-section-maintenance> top-level block", () => {
    expect(BRAINSTORMER).toContain('<behavior-section-maintenance priority="high"');
  });
  it("declares ## Behavior as optional 10th design.md section", () => {
    expect(BRAINSTORMER).toContain('<section name="Behavior" optional="true">');
  });
  it("finalizing phase mentions ## Behavior produce + atlas_lookup", () => {
    expect(BRAINSTORMER).toContain("## Behavior");
    expect(BRAINSTORMER).toContain("atlas_lookup");
  });
});

describe("commander.ts behavior-alignment mirror", () => {
  it("includes the same <behavior-alignment> child block", () => {
    expect(COMMANDER).toContain(
      '<behavior-alignment description="Align user-visible report with design.md ## Behavior section">',
    );
  });
});

describe("planner.ts behavior-mapping additions", () => {
  it("declares <behavior-mapping-rules> block", () => {
    expect(PLANNER).toContain('<behavior-mapping-rules priority="critical"');
  });
  it("skeleton template contains ## 行为承诺映射 section", () => {
    expect(PLANNER).toContain("## 行为承诺映射");
  });
  it("understand-design phase mentions atlas_lookup for 20-behavior", () => {
    expect(PLANNER).toMatch(/atlas_lookup\\?` 查相关 atlas\/20-behavior/);
  });
});

describe("executor.ts context-brief + checkpoint additions", () => {
  it("context-brief template carries 行为承诺 pointer", () => {
    expect(EXECUTOR).toContain("本次 Task 对应的行为承诺");
  });
  it("declares <behavior-checkpoint-maintenance> block", () => {
    expect(EXECUTOR).toContain('<behavior-checkpoint-maintenance priority="high"');
  });
  it("mentions 'Atlas 行为节点审视' as the batch checkpoint output marker", () => {
    expect(EXECUTOR).toContain("Atlas 行为节点审视");
  });
});

describe("reviewer.ts behavior-consistency additions", () => {
  it('checklist contains <section name="behavior-consistency">', () => {
    expect(REVIEWER).toContain('<section name="behavior-consistency">');
  });
  it("declares <behavior-drift-detection> block", () => {
    expect(REVIEWER).toContain('<behavior-drift-detection priority="medium"');
  });
  it("output-format template mentions 行为一致性 line", () => {
    expect(REVIEWER).toContain("行为一致性");
  });
  it("escalate marker 'Behavior observation: drift-lesson' exists", () => {
    expect(REVIEWER).toContain("Behavior observation: drift-lesson");
  });
  it("final-marker-rule remains intact (verdict MUST appear as the LAST line)", () => {
    const occurrences = REVIEWER.match(/verdict MUST appear as the LAST line/g) ?? [];
    expect(occurrences.length).toBe(1);
  });
});

describe("AGENTS.md behavior-section mirror", () => {
  it("declares the section heading", () => {
    expect(AGENTS_MD).toMatch(/##\s+Behavior 段约定/);
  });
  it("describes the 5-phase loop", () => {
    expect(AGENTS_MD).toContain("5 阶段闭环");
  });
  it("describes agent-driven + user-role split", () => {
    expect(AGENTS_MD).toContain("全 agent 驱动 + 用户角色");
  });
  it("explicitly forbids Gherkin / .feature files", () => {
    expect(AGENTS_MD).toContain("不引入 Gherkin");
  });
  it("explicitly forbids atlas_target field", () => {
    expect(AGENTS_MD).toMatch(/不引入 `?atlas_target`? 字段/);
  });
  it("explicitly forbids sink-to-Atlas auto-flow (preserves atlas-boundary)", () => {
    expect(AGENTS_MD).toContain("不引入 sink-to-Atlas");
  });
});
