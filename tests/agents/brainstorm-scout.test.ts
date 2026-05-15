import { describe, expect, it } from "bun:test";

import { brainstormScoutAgent } from "@/agents/brainstorm-scout";
import { LENS_SWARM_PROTOCOL } from "@/agents/lens-swarm-protocol";

describe("brainstorm-scout agent", () => {
  it("is a read-only subagent", () => {
    expect(brainstormScoutAgent.mode).toBe("subagent");
    expect(brainstormScoutAgent.tools?.write).toBe(false);
    expect(brainstormScoutAgent.tools?.edit).toBe(false);
    expect(brainstormScoutAgent.tools?.bash).toBe(false);
    expect(brainstormScoutAgent.tools?.task).toBe(false);
  });

  it("uses evidence-disciplined low temperature", () => {
    expect(brainstormScoutAgent.temperature).toBeLessThanOrEqual(0.3);
  });

  it("describes itself as read-only scout, not critic or reviewer", () => {
    const description = (brainstormScoutAgent.description ?? "").toLowerCase();
    const prompt = (brainstormScoutAgent.prompt ?? "").toLowerCase();

    expect(description).toContain("read-only");
    expect(description).toContain("scout");
    expect(prompt).toContain("not the critic");
    expect(prompt).toContain("not the reviewer");
    expect(prompt).toContain("not the executor");
  });

  it("injects the shared Lens Swarm protocol", () => {
    expect(brainstormScoutAgent.prompt).toContain(LENS_SWARM_PROTOCOL);
  });

  it("requires lens id, proposal excerpt, scope, and output limit", () => {
    const prompt = brainstormScoutAgent.prompt ?? "";

    expect(prompt).toContain("lens id");
    expect(prompt).toContain("proposal/design excerpt");
    expect(prompt).toContain("scope");
    expect(prompt).toContain("expected output limit");
  });

  it("requires the short scout output sections and forbids reviewer verdicts", () => {
    const prompt = brainstormScoutAgent.prompt ?? "";

    expect(prompt).toContain("Lens");
    expect(prompt).toContain("Findings");
    expect(prompt).toContain("Cannot Assess");
    expect(prompt).toContain("Suggested synthesis notes");
    expect(prompt).toContain("NEVER emit APPROVED");
    expect(prompt).toContain("CHANGES_REQUESTED");
  });
});
