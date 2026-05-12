import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const AGENTS_MD = readFileSync(join(__dirname, "..", "..", "AGENTS.md"), "utf-8");

describe("project AGENTS.md: Knowledge Bootstrap Commands section", () => {
  it("contains a section heading naming the three commands", () => {
    expect(AGENTS_MD).toContain("## Knowledge Bootstrap Commands");
  });

  it("documents /all-init mode and behaviour", () => {
    expect(AGENTS_MD).toContain("/all-init");
    expect(AGENTS_MD).toContain("missing-only");
  });

  it("documents /all-rebuild mode and confirm requirement", () => {
    expect(AGENTS_MD).toContain("/all-rebuild");
    expect(AGENTS_MD).toContain("refresh-all");
    expect(AGENTS_MD.toLowerCase()).toContain("confirm");
  });

  it("documents /all-status mode and read-only nature", () => {
    expect(AGENTS_MD).toContain("/all-status");
    expect(AGENTS_MD).toContain("status-only");
    expect(AGENTS_MD.toLowerCase()).toMatch(/read[- ]only|只读/);
  });

  it("names the knowledge-bootstrap-orchestrator agent as the routing target", () => {
    expect(AGENTS_MD).toContain("knowledge-bootstrap-orchestrator");
  });

  it("states the three commands do NOT replace /init /mindmodel /atlas-init", () => {
    expect(AGENTS_MD).toMatch(/不替换|do not replace|保留.*\/init.*\/mindmodel.*\/atlas-init/);
  });
});
