import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";

const AGENTS_MD = readFileSync("AGENTS.md", "utf8");

describe("AGENTS.md conflict resolver and response UX mirror", () => {
  it("documents auto conflict resolver recovery and semantic question fallback", () => {
    expect(AGENTS_MD).toContain("conflict resolver");
    expect(AGENTS_MD).toContain("merge_conflict");
    expect(AGENTS_MD).toContain("built-in question");
    expect(AGENTS_MD).toContain("semantic ambiguity");
  });

  it("documents decision-minimal response contract", () => {
    expect(AGENTS_MD).toContain("decision-minimal");
    expect(AGENTS_MD).toContain("raw recovery hint");
    expect(AGENTS_MD).toContain("subagent raw reports");
  });

  it("preserves hard safety boundaries and read-only lost update audit", () => {
    expect(AGENTS_MD).toContain("no force push");
    expect(AGENTS_MD).toContain("--force-with-lease");
    expect(AGENTS_MD).toContain("reset --hard");
    expect(AGENTS_MD).toContain("lost-update audit");
    expect(AGENTS_MD).toContain("read-only");
  });
});
