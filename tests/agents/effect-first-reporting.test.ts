import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const COMMANDER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "commander.ts"), "utf-8");
const BRAINSTORMER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"), "utf-8");
const OCTTO_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "octto.ts"), "utf-8");
const AGENTS_MD = readFileSync(join(__dirname, "..", "..", "AGENTS.md"), "utf-8");

const SECTION_LABELS = ["预期表现", "你可以怎么验收", "已知限制", "实现记录"] as const;
const EXCEPTION_KEYS = ["blocked", "failed-stop"] as const;

const PRIMARIES_WITH_BLOCK = [
  {
    name: "commander",
    source: COMMANDER_SOURCE,
    relatedRule: /不(?:替代|影响)\s*intent-?classification|does not replace.*intent-?classification/i,
  },
  {
    name: "brainstormer",
    source: BRAINSTORMER_SOURCE,
    relatedRule: /不(?:替代|影响)\s*intent-?classification|does not replace.*intent-?classification/i,
  },
  {
    name: "octto",
    source: OCTTO_SOURCE,
    relatedRule: /不替代\s*design-?document-?format|does not replace.*design-?document-?format/i,
  },
] as const;

const effectFirstBlock = (source: string) => source.match(/<effect-first-reporting[\s\S]*?<\/effect-first-reporting>/);

describe("effect-first-reporting prompt block", () => {
  for (const agent of PRIMARIES_WITH_BLOCK) {
    describe(agent.name, () => {
      it("declares exactly one <effect-first-reporting> block", () => {
        const opens = agent.source.match(/<effect-first-reporting[\s>]/g) ?? [];
        const closes = agent.source.match(/<\/effect-first-reporting>/g) ?? [];
        expect(opens).toHaveLength(1);
        expect(closes).toHaveLength(1);
      });

      it("contains all four section labels verbatim", () => {
        const block = effectFirstBlock(agent.source);
        expect(block).not.toBeNull();
        const body = block?.[0] ?? "";
        for (const label of SECTION_LABELS) {
          expect(body).toContain(label);
        }
      });

      it("declares blocked and failed-stop exception rules", () => {
        const block = effectFirstBlock(agent.source);
        expect(block).not.toBeNull();
        const body = block?.[0] ?? "";
        for (const key of EXCEPTION_KEYS) {
          expect(body).toContain(key);
        }
      });

      it("explicitly supplements completion-notify and the agent's adjacent policy block", () => {
        const block = effectFirstBlock(agent.source);
        expect(block).not.toBeNull();
        const body = block?.[0] ?? "";
        // Block must clarify it supplements rather than replaces existing rules.
        expect(body).toMatch(/补充|不替代|supplement|does not replace/i);
        expect(body.toLowerCase()).toMatch(/completion-?notify/);
        expect(body).toMatch(agent.relatedRule);
      });
    });
  }

  describe("placement (commander)", () => {
    it("commander block is placed AFTER </completion-notify> and BEFORE <intent-classification>", () => {
      const completionEnd = COMMANDER_SOURCE.indexOf("</completion-notify>");
      const blockOpen = COMMANDER_SOURCE.search(/<effect-first-reporting[\s>]/);
      const intentOpen = COMMANDER_SOURCE.search(/<intent-classification[\s>]/);

      expect(completionEnd).toBeGreaterThan(-1);
      expect(blockOpen).toBeGreaterThan(-1);
      expect(intentOpen).toBeGreaterThan(-1);

      expect(blockOpen).toBeGreaterThan(completionEnd);
      expect(blockOpen).toBeLessThan(intentOpen);
    });
  });

  describe("placement (brainstormer)", () => {
    it("brainstormer block is placed AFTER </completion-notify>", () => {
      const completionEnd = BRAINSTORMER_SOURCE.indexOf("</completion-notify>");
      const blockOpen = BRAINSTORMER_SOURCE.search(/<effect-first-reporting[\s>]/);
      expect(completionEnd).toBeGreaterThan(-1);
      expect(blockOpen).toBeGreaterThan(-1);
      expect(blockOpen).toBeGreaterThan(completionEnd);
    });
  });

  describe("placement (octto)", () => {
    it("octto block is placed AFTER </completion-notify> and BEFORE <design-document-format>", () => {
      const completionEnd = OCTTO_SOURCE.indexOf("</completion-notify>");
      const blockOpen = OCTTO_SOURCE.search(/<effect-first-reporting[\s>]/);
      const designOpen = OCTTO_SOURCE.search(/<design-document-format[\s>]/);

      expect(completionEnd).toBeGreaterThan(-1);
      expect(blockOpen).toBeGreaterThan(-1);
      expect(designOpen).toBeGreaterThan(-1);

      expect(blockOpen).toBeGreaterThan(completionEnd);
      expect(blockOpen).toBeLessThan(designOpen);
    });
  });

  describe("drift guard", () => {
    it("commander and brainstormer effect-first blocks are byte-identical", () => {
      const commanderBlock = effectFirstBlock(COMMANDER_SOURCE);
      const brainstormerBlock = effectFirstBlock(BRAINSTORMER_SOURCE);

      expect(commanderBlock).not.toBeNull();
      expect(brainstormerBlock).not.toBeNull();
      expect(commanderBlock?.[0]).toBe(brainstormerBlock?.[0]);
    });

    it("octto block is semantically aligned but NOT required to be byte-identical to commander", () => {
      // Sanity: octto is intentionally tailored (mentions brainstorm session
      // semantics like end_brainstorm / design document path). It must NOT be
      // byte-identical to commander; if a future edit collapses them, this
      // test forces a deliberate decision.
      const commanderBlock = effectFirstBlock(COMMANDER_SOURCE);
      const octtoBlock = effectFirstBlock(OCTTO_SOURCE);

      expect(commanderBlock).not.toBeNull();
      expect(octtoBlock).not.toBeNull();
      expect(octtoBlock?.[0]).not.toBe(commanderBlock?.[0]);

      // But octto MUST mention its workflow-specific terms, otherwise it has
      // drifted into a generic copy.
      const octtoBody = octtoBlock?.[0] ?? "";
      expect(octtoBody).toMatch(/brainstorm|end_brainstorm|design.{0,20}文档|session/i);
    });
  });

  describe("AGENTS.md mirror", () => {
    it("declares the section heading", () => {
      expect(AGENTS_MD).toMatch(/##\s+Effect-First User-Facing Reports/);
    });

    it("contains all four section labels verbatim", () => {
      for (const label of SECTION_LABELS) {
        expect(AGENTS_MD).toContain(label);
      }
    });

    it("declares blocked and failed-stop exceptions", () => {
      expect(AGENTS_MD).toContain("blocked");
      expect(AGENTS_MD).toContain("failed-stop");
    });

    it("clarifies it does NOT replace completion-notify or intent-classification", () => {
      const lower = AGENTS_MD.toLowerCase();
      expect(lower).toMatch(/不替代\s*completion-?notify|does not replace.*completion-?notify/);
      expect(lower).toMatch(/不替代\s*intent-?classification|does not replace.*intent-?classification/);
    });

    it("declares the drift-guard relationship between commander, brainstormer, and octto", () => {
      // Section must explain that commander and brainstormer are byte-identical,
      // octto is semantically aligned only.
      expect(AGENTS_MD).toMatch(/byte-identical/i);
      expect(AGENTS_MD).toContain("octto");
      expect(AGENTS_MD).toMatch(/effect-first-reporting/i);
    });
  });
});
