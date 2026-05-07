import { describe, expect, it } from "bun:test";

import { criticAgent } from "../../src/agents/critic";

describe("critic agent", () => {
  it("is a subagent with read-only tool restrictions", () => {
    expect(criticAgent.mode).toBe("subagent");
    expect(criticAgent.tools?.write).toBe(false);
    expect(criticAgent.tools?.edit).toBe(false);
    expect(criticAgent.tools?.bash).toBe(false);
    expect(criticAgent.tools?.task).toBe(false);
  });

  it("uses a low temperature for evidence-disciplined critique", () => {
    expect(criticAgent.temperature).toBeLessThanOrEqual(0.3);
  });

  it("describes itself as a read-only adversarial critic", () => {
    const description = criticAgent.description ?? "";
    expect(description.toLowerCase()).toContain("read-only");
    expect(description.toLowerCase()).toContain("critic");
  });

  it("declares the micode subagent environment", () => {
    const prompt = criticAgent.prompt ?? "";
    expect(prompt).toContain("micode");
    expect(prompt).toContain("SUBAGENT");
  });

  it("prompt forbids mutation, commits, deploys, restarts, and file edits", () => {
    const prompt = (criticAgent.prompt ?? "").toLowerCase();
    expect(prompt).toContain("never");
    expect(prompt).toContain("commit");
    expect(prompt).toContain("deploy");
    expect(prompt).toContain("restart");
    expect(prompt).toContain("mutation");
    expect(prompt).toContain("read-only");
  });

  it("prompt enumerates all five roles", () => {
    const prompt = (criticAgent.prompt ?? "").toLowerCase();
    expect(prompt).toContain("archaeologist");
    expect(prompt).toContain("conservative");
    expect(prompt).toContain("redteam");
    expect(prompt).toContain("yagni");
    expect(prompt).toContain("cross-family");
  });

  it("prompt declares Codex-style bug bar discipline", () => {
    const prompt = (criticAgent.prompt ?? "").toLowerCase();
    expect(prompt).toContain("bug bar");
    expect(prompt).toContain("evidence");
    expect(prompt).toContain("severity");
  });

  it("prompt enforces severity tiers and CANNOT_ASSESS fallback", () => {
    const prompt = criticAgent.prompt ?? "";
    expect(prompt).toContain("P0");
    expect(prompt).toContain("P1");
    expect(prompt).toContain("P2");
    expect(prompt).toContain("P3");
    expect(prompt).toContain("CANNOT_ASSESS");
  });

  it("prompt allows APPROVED outcome when no blocking findings exist", () => {
    const prompt = criticAgent.prompt ?? "";
    expect(prompt).toContain("APPROVED");
  });

  it("prompt requires role parameter and lists supported roles when missing", () => {
    const prompt = (criticAgent.prompt ?? "").toLowerCase();
    expect(prompt).toContain("role");
    expect(prompt).toContain("supported roles");
  });

  it("prompt declares cross-family preflight and degraded fallback", () => {
    const prompt = criticAgent.prompt ?? "";
    expect(prompt.toLowerCase()).toContain("provider");
    expect(prompt).toContain("degraded");
  });

  it("prompt forbids overlap with executor, planner, and reviewer", () => {
    const prompt = (criticAgent.prompt ?? "").toLowerCase();
    expect(prompt).toContain("not the executor");
    expect(prompt).toContain("not the planner");
    expect(prompt).toContain("not the reviewer");
  });

  it("prompt forbids treating intentional changes as bugs", () => {
    const prompt = (criticAgent.prompt ?? "").toLowerCase();
    expect(prompt).toContain("intentional");
  });
});
