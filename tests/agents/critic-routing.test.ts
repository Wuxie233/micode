import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const COMMANDER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "commander.ts"), "utf-8");
const BRAINSTORMER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"), "utf-8");

const COORDINATORS = [
  { name: "commander", source: COMMANDER_SOURCE },
  { name: "brainstormer", source: BRAINSTORMER_SOURCE },
];

describe("critic routing contract (cross-coordinator)", () => {
  for (const coord of COORDINATORS) {
    describe(coord.name, () => {
      it("declares critic as an available subagent", () => {
        expect(coord.source).toContain("critic");
      });

      it("describes critic as read-only and never-mutates", () => {
        const lower = coord.source.toLowerCase();
        expect(lower).toMatch(/critic[\s\S]{0,400}(read-only|does not mutate|never mutates)/);
      });
    });
  }

  it("brainstormer mentions all five critic roles in its available-subagents description", () => {
    const lower = BRAINSTORMER_SOURCE.toLowerCase();
    expect(lower).toContain("archaeologist");
    expect(lower).toContain("conservative");
    expect(lower).toContain("redteam");
    expect(lower).toContain("yagni");
    expect(lower).toContain("cross-family");
  });

  it("brainstormer signals user-triggered semantics for critic", () => {
    const lower = BRAINSTORMER_SOURCE.toLowerCase();
    expect(lower).toMatch(/critic[\s\S]{0,400}(user.?triggered|user explicitly|only when the user)/);
  });

  it("commander lists critic alongside investigator in the available-agents block", () => {
    const match = COMMANDER_SOURCE.match(/<agent name="critic" mode="([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("subagent");
  });

  it("commander header agent list mentions critic", () => {
    const headerMatch = COMMANDER_SOURCE.match(/Available micode agents:[^\n]+/);
    expect(headerMatch).not.toBeNull();
    expect((headerMatch?.[0] ?? "").toLowerCase()).toContain("critic");
  });

  it("both coordinators agree on the critic agent name spelling", () => {
    expect(COMMANDER_SOURCE).toContain("critic");
    expect(BRAINSTORMER_SOURCE).toContain("critic");
    expect(COMMANDER_SOURCE).not.toMatch(/<agent name="critique"/);
    expect(COMMANDER_SOURCE).not.toMatch(/<agent name="critics"/);
    expect(BRAINSTORMER_SOURCE).not.toMatch(/<subagent name="critique">/);
    expect(BRAINSTORMER_SOURCE).not.toMatch(/<subagent name="critics">/);
  });

  it("neither coordinator routes critic via output-class (critic is user-triggered, not output-routed)", () => {
    expect(COMMANDER_SOURCE).not.toMatch(/<output-class[^>]*agent="critic"/);
    expect(BRAINSTORMER_SOURCE).not.toMatch(/<output-class[^>]*agent="critic"/);
  });
});
