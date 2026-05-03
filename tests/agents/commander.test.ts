import { describe, expect, it } from "bun:test";
import { primaryAgent } from "../../src/agents/commander";

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
