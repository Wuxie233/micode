import { describe, expect, it } from "bun:test";
import { classifySpawnError, INTERNAL_CLASSES } from "@/tools/spawn-agent/classify";
import { verifyMarker } from "@/tools/spawn-agent/verifier";
import { VERIFIER_CONFIDENCE, VERIFIER_DECISIONS } from "@/tools/spawn-agent/verifier-types";

async function runPipeline(text: string, verdict: "narrative" | "final" | "null"): Promise<string> {
  const c = classifySpawnError({ assistantText: text });
  if (c.class !== INTERNAL_CLASSES.NEEDS_VERIFICATION) return c.class;
  const result = await verifyMarker(
    { assistantText: text, marker: c.markerHit ?? "" },
    {
      timeoutMs: 1000,
      maxOutputChars: 4000,
      runClassification: async () => {
        if (verdict === "null") throw new Error("verifier offline");
        return JSON.stringify({
          decision: verdict === "final" ? VERIFIER_DECISIONS.FINAL : VERIFIER_DECISIONS.NARRATIVE,
          confidence: VERIFIER_CONFIDENCE.HIGH,
          reason: "stub",
        });
      },
    },
  );
  if (result === null) return INTERNAL_CLASSES.SUCCESS;
  if (result.decision === VERIFIER_DECISIONS.NARRATIVE) return INTERNAL_CLASSES.SUCCESS;
  return c.ambiguousKind ?? INTERNAL_CLASSES.SUCCESS;
}

describe("classify + verify pipeline", () => {
  it("narrative CHANGES REQUESTED becomes success", async () => {
    const text = "Reviewer might mark CHANGES REQUESTED if anything broke. Tests pass.";
    expect(await runPipeline(text, "narrative")).toBe(INTERNAL_CLASSES.SUCCESS);
  });

  it("BUILD FAILED inside fenced code becomes success", async () => {
    const text = "Example output:\n```\nBUILD FAILED\n```\nThe actual build succeeded.";
    expect(await runPipeline(text, "narrative")).toBe(INTERNAL_CLASSES.SUCCESS);
  });

  it("TEST FAILED on its own line is task_error without verifier consultation", async () => {
    const text = "Logs:\nTEST FAILED\n";
    expect(await runPipeline(text, "null")).toBe(INTERNAL_CLASSES.TASK_ERROR);
  });

  it("BLOCKED: as whole output is blocked without verifier consultation", async () => {
    expect(await runPipeline("BLOCKED:", "null")).toBe(INTERNAL_CLASSES.BLOCKED);
  });

  it("verifier unavailable on narrative falls back to success", async () => {
    const text = "All good. Will print 'BUILD FAILED' if broken.";
    expect(await runPipeline(text, "null")).toBe(INTERNAL_CLASSES.SUCCESS);
  });

  it("verifier reports final on narrative input upgrades to preserved kind", async () => {
    const text = "Some text. CHANGES REQUESTED. More text.";
    expect(await runPipeline(text, "final")).toBe(INTERNAL_CLASSES.TASK_ERROR);
  });
});
