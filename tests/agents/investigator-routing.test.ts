// tests/agents/investigator-routing.test.ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const COMMANDER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "commander.ts"), "utf-8");
const BRAINSTORMER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"), "utf-8");

const COORDINATORS = [
  { name: "commander", source: COMMANDER_SOURCE },
  { name: "brainstormer", source: BRAINSTORMER_SOURCE },
];

describe("investigator routing contract (cross-coordinator)", () => {
  for (const coord of COORDINATORS) {
    describe(coord.name, () => {
      it("declares routing by requested output, not by keywords", () => {
        expect(coord.source).toContain("routing-by-requested-output");
        expect(coord.source).not.toMatch(/trigger\s+keywords?\s*:/i);
        expect(coord.source).not.toMatch(/keyword\s+list/i);
      });

      it("names all four output classes: location, explanation, diagnosis, mutation", () => {
        const lower = coord.source.toLowerCase();
        expect(lower).toContain("location");
        expect(lower).toContain("explanation");
        expect(lower).toContain("diagnosis");
        expect(lower).toContain("mutation");
      });

      it("maps diagnosis to investigator and mutation to executor", () => {
        // Diagnosis class declaration must mention agent="investigator".
        const diagnosisBlock = coord.source.match(/<output-class name="diagnosis" agent="([^"]+)">/);
        expect(diagnosisBlock).not.toBeNull();
        expect(diagnosisBlock?.[1]).toBe("investigator");

        // Mutation class declaration must reference executor as the agent.
        const mutationBlock = coord.source.match(/<output-class name="mutation" agent="([^"]+)">/);
        expect(mutationBlock).not.toBeNull();
        expect(mutationBlock?.[1]).toBe("executor");
      });

      it("preserves locator and analyzer responsibilities", () => {
        // Per design: "Preserve existing responsibilities for codebase-locator,
        // codebase-analyzer, pattern-finder, executor, and reviewer."
        expect(coord.source).toMatch(/<output-class name="location" agent="codebase-locator">/);
        expect(coord.source).toMatch(/<output-class name="explanation" agent="codebase-analyzer">/);
      });

      it("describes investigator as read-only, side-effect-free", () => {
        // The investigator output-class block must mention that the agent never
        // mutates. Read the diagnosis block and assert content.
        const diagnosisMatch = coord.source.match(
          /<output-class name="diagnosis" agent="investigator">([\s\S]*?)<\/output-class>/,
        );
        expect(diagnosisMatch).not.toBeNull();
        const body = (diagnosisMatch?.[1] ?? "").toLowerCase();
        expect(body).toMatch(/never mutates|read-only|does not mutate/);
      });
    });
  }

  it("both coordinators agree on the investigator agent name spelling", () => {
    expect(COMMANDER_SOURCE).toContain("investigator");
    expect(BRAINSTORMER_SOURCE).toContain("investigator");
    // No drift to "investagator" / "investagor" / camelCase variants in prompt strings.
    expect(COMMANDER_SOURCE).not.toMatch(/investagator|investagor/i);
    expect(BRAINSTORMER_SOURCE).not.toMatch(/investagator|investagor/i);
  });
});
