import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const COMMANDER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "commander.ts"), "utf-8");
const BRAINSTORMER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"), "utf-8");

const COORDINATORS = [
  { name: "commander", source: COMMANDER_SOURCE },
  { name: "brainstormer", source: BRAINSTORMER_SOURCE },
] as const;

const SPECIALIST_NAMES = [
  "product-manager",
  "software-architect",
  "ux-designer",
  "architecture-quality-inspector",
  "rubric-reviewer",
] as const;

describe("specialist routing contract (cross-coordinator)", () => {
  for (const coord of COORDINATORS) {
    describe(coord.name, () => {
      for (const specialist of SPECIALIST_NAMES) {
        it(`declares ${specialist} by name`, () => {
          expect(coord.source).toContain(specialist);
        });

        it(`describes ${specialist} as read-only and user-triggered`, () => {
          const lower = coord.source.toLowerCase();
          // Each specialist's description in the available-subagents / agents
          // block must mention "read-only" and either "user-triggered" or
          // "user explicitly" so coordinators do not auto-spawn it.
          const re = new RegExp(`${specialist}[\\s\\S]{0,500}(read-only|does not mutate|never mutates)`);
          expect(lower).toMatch(re);
          const re2 = new RegExp(`${specialist}[\\s\\S]{0,500}(user-?triggered|user explicitly|only when the user)`);
          expect(lower).toMatch(re2);
        });

        it(`does NOT route ${specialist} via output-class`, () => {
          // Specialists are explicitly excluded from output-class routing.
          const re = new RegExp(`<output-class[^>]*agent="${specialist}"`);
          expect(coord.source).not.toMatch(re);
        });
      }

      it("contains a <specialist-dispatch> block", () => {
        expect(coord.source).toMatch(/<specialist-dispatch[\s\S]*?<\/specialist-dispatch>/);
      });

      it("specialist-dispatch declares user-triggered, no auto-spawn, at most once per phase", () => {
        const block = coord.source.match(/<specialist-dispatch[\s\S]*?<\/specialist-dispatch>/);
        expect(block).not.toBeNull();
        const body = (block?.[0] ?? "").toLowerCase();
        expect(body).toContain("user-triggered");
        expect(body).toMatch(/never\s+auto.?spawn|不\s*自动\s*派/);
        expect(body).toMatch(/at most.*once.*phase|每阶段.*最多.*一次|once per phase/);
        expect(body).toContain("output-class");
      });
    });
  }

  it("commander header agent list mentions all five specialists", () => {
    const headerMatch = COMMANDER_SOURCE.match(/Available micode agents:[^\n]+/);
    expect(headerMatch).not.toBeNull();
    const header = (headerMatch?.[0] ?? "").toLowerCase();
    for (const specialist of SPECIALIST_NAMES) {
      expect(header).toContain(specialist);
    }
  });

  it("commander declares each specialist in the agents block as a subagent", () => {
    for (const specialist of SPECIALIST_NAMES) {
      const re = new RegExp(`<agent\\s+name="${specialist}"\\s+mode="subagent"`);
      expect(COMMANDER_SOURCE).toMatch(re);
    }
  });

  it("brainstormer declares each specialist in the available-subagents block", () => {
    for (const specialist of SPECIALIST_NAMES) {
      const re = new RegExp(`<subagent\\s+name="${specialist}">`);
      expect(BRAINSTORMER_SOURCE).toMatch(re);
    }
  });

  it("specialist-dispatch block is byte-identical between commander and brainstormer (no drift)", () => {
    const commanderBlock = COMMANDER_SOURCE.match(/<specialist-dispatch[\s\S]*?<\/specialist-dispatch>/);
    const brainstormerBlock = BRAINSTORMER_SOURCE.match(/<specialist-dispatch[\s\S]*?<\/specialist-dispatch>/);

    expect(commanderBlock).not.toBeNull();
    expect(brainstormerBlock).not.toBeNull();
    expect(commanderBlock?.[0]).toBe(brainstormerBlock?.[0]);
  });

  it("neither coordinator collapses critic and specialists into one block", () => {
    // critic stays adversarial (its own block / description); specialists are
    // a separate decision-aid layer. Guard against accidentally renaming or
    // merging.
    expect(COMMANDER_SOURCE).toContain("critic");
    expect(BRAINSTORMER_SOURCE).toContain("critic");
    // specialist-dispatch must not list the critic agent as a standalone role
    // (critic has its own AGENTS.md section "Adversarial Subagent Review").
    // Use a word boundary so "critical" and "architecture-quality-inspector"
    // do not create false positives.
    const commanderBlock = COMMANDER_SOURCE.match(/<specialist-dispatch[\s\S]*?<\/specialist-dispatch>/);
    expect(commanderBlock?.[0]).not.toMatch(/\bcritic\b/);
  });

  it("agent name spellings do not drift between coordinators", () => {
    for (const specialist of SPECIALIST_NAMES) {
      expect(COMMANDER_SOURCE).toContain(specialist);
      expect(BRAINSTORMER_SOURCE).toContain(specialist);
    }
    // Common typo guards.
    expect(COMMANDER_SOURCE).not.toMatch(/<agent name="product-managers"/);
    expect(COMMANDER_SOURCE).not.toMatch(/<agent name="ux_designer"/);
    expect(COMMANDER_SOURCE).not.toMatch(/<agent name="rubric_reviewer"/);
    expect(BRAINSTORMER_SOURCE).not.toMatch(/<subagent name="product-managers">/);
    expect(BRAINSTORMER_SOURCE).not.toMatch(/<subagent name="ux_designer">/);
    expect(BRAINSTORMER_SOURCE).not.toMatch(/<subagent name="rubric_reviewer">/);
  });
});
