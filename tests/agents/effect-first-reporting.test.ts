import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { KNOWLEDGE_CONTEXT_SECTION } from "@/agents/knowledge-context-section";

const COMMANDER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "commander.ts"), "utf-8");
const BRAINSTORMER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"), "utf-8");
const OCTTO_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "octto.ts"), "utf-8");
const AGENTS_MD = readFileSync(join(__dirname, "..", "..", "AGENTS.md"), "utf-8");

const SECTION_LABELS = ["预期表现", "你可以怎么验收", "已知限制", "本次知识上下文", "实现记录"] as const;
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
const expandedEffectFirstBlock = (source: string): string | null => {
  const block = effectFirstBlock(source);
  // biome-ignore lint/suspicious/noTemplateCurlyInString: matching a placeholder in source prompt text, not a template string
  return block?.[0].replace("${KNOWLEDGE_CONTEXT_SECTION}", KNOWLEDGE_CONTEXT_SECTION) ?? null;
};

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
        const block = expandedEffectFirstBlock(agent.source);
        expect(block).not.toBeNull();
        const body = block ?? "";
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

  describe("knowledge-context subsection placement", () => {
    for (const agent of PRIMARIES_WITH_BLOCK) {
      it(`${agent.name} places 本次知识上下文 immediately before 实现记录`, () => {
        const block = expandedEffectFirstBlock(agent.source) ?? "";
        const knowledgeOpen = block.search(/<section name="本次知识上下文">/);
        const implOpen = block.search(/<section name="实现记录">/);
        expect(knowledgeOpen).toBeGreaterThan(-1);
        expect(implOpen).toBeGreaterThan(-1);
        expect(knowledgeOpen).toBeLessThan(implOpen);
      });

      it(`${agent.name} knowledge-context subsection mentions Atlas status and Project Memory status lines`, () => {
        const block = expandedEffectFirstBlock(agent.source);
        expect(block).not.toBeNull();
        const body = block ?? "";
        expect(body).toContain("Atlas status:");
        expect(body).toContain("Project Memory status:");
      });
    }
  });

  describe("drift guard", () => {
    it("commander and brainstormer effect-first blocks are byte-identical", () => {
      const commanderBlock = effectFirstBlock(COMMANDER_SOURCE);
      const brainstormerBlock = effectFirstBlock(BRAINSTORMER_SOURCE);

      expect(commanderBlock).not.toBeNull();
      expect(brainstormerBlock).not.toBeNull();
      expect(commanderBlock?.[0]).toBe(brainstormerBlock?.[0]);
    });

    it("knowledge-context subsection is byte-identical across all three primaries", () => {
      const extractKnowledge = (src: string): string | null => {
        const match = expandedEffectFirstBlock(src)?.match(/<section name="本次知识上下文">[\s\S]*?<\/section>/);
        return match?.[0] ?? null;
      };
      const commanderK = extractKnowledge(COMMANDER_SOURCE);
      const brainstormerK = extractKnowledge(BRAINSTORMER_SOURCE);
      const octtoK = extractKnowledge(OCTTO_SOURCE);
      expect(commanderK).not.toBeNull();
      expect(brainstormerK).not.toBeNull();
      expect(octtoK).not.toBeNull();
      expect(commanderK).toBe(brainstormerK);
      expect(commanderK).toBe(octtoK);
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

    it("documents the 本次知识上下文 subsection", () => {
      expect(AGENTS_MD).toContain("本次知识上下文");
      expect(AGENTS_MD).toMatch(/Atlas status|Project Memory status/);
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
