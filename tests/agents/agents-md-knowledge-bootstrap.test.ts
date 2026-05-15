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

  it("states orchestrator does not collect intent questionnaire and atlas-initializer self-infers", () => {
    // After 2026-05-14 questionnaire removal, the Dispatch rules section must
    // (a) explicitly state intent.* questionnaire is no longer collected at orchestrator entry
    // (b) state atlas-initializer self-infers intent in phase 2 from README/package.json/ARCHITECTURE.md
    // (c) NOT mention the deleted intent.pitch / intent.user / intent.shape keys
    // (d) NOT mention the deleted DEFAULT_BOOTSTRAP_ANSWERS fallback
    expect(AGENTS_MD).toMatch(/不再收集 intent\.\* 问卷|orchestrator 入口不再收集 intent/);
    expect(AGENTS_MD).toMatch(/atlas-initializer.*phase 2.*推断|自行.*README.*package\.json.*ARCHITECTURE/);
    expect(AGENTS_MD).not.toContain("intent.pitch");
    expect(AGENTS_MD).not.toContain("intent.user");
    expect(AGENTS_MD).not.toContain("intent.shape");
    expect(AGENTS_MD).not.toContain("DEFAULT_BOOTSTRAP_ANSWERS");
  });

  it("states the three commands do not require lifecycle ownership preflight", () => {
    expect(AGENTS_MD).toMatch(
      /\/all-init.*\/all-rebuild.*\/all-status[\s\S]*(不需要|do not require).*lifecycle ownership preflight|三条命令[\s\S]*(不需要|do not require).*lifecycle ownership preflight/,
    );
  });

  it("states the three commands do not start lifecycle or run lifecycle git setup", () => {
    expect(AGENTS_MD).toMatch(/(不启动|do not start).*lifecycle|不进入 lifecycle|不会.*lifecycle_start_request/);
    expect(AGENTS_MD).toMatch(/(不创建|do not create).*GitHub issues?|不创建.*GitHub issue/);
    expect(AGENTS_MD).toMatch(/(不创建|do not create).*lifecycle branches?|不创建.*lifecycle branch/);
    expect(AGENTS_MD).toMatch(/(不运行|do not run).*ownership preflight|不执行.*ownership preflight/);
  });

  it("states the three commands do NOT replace /init /mindmodel /atlas-init", () => {
    expect(AGENTS_MD).toMatch(/不替换|do not replace|保留.*\/init.*\/mindmodel.*\/atlas-init/);
  });
});
