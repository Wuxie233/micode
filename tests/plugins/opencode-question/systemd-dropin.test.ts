import { describe, expect, it } from "bun:test";
import { readFile } from "node:fs/promises";

const DROPIN_PATH = "/etc/systemd/system/opencode-web.service.d/question-tool.conf";

async function loadDropin(): Promise<string> {
  return await readFile(DROPIN_PATH, "utf-8");
}

describe("opencode question tool systemd drop-in", () => {
  it("exists, is readable, and is not empty", async () => {
    const dropin = await loadDropin();

    expect(dropin.trim().length).toBeGreaterThan(0);
  });

  it("contains exactly one Service section", async () => {
    const dropin = await loadDropin();
    const serviceSections = dropin.match(/^\s*\[Service\]\s*$/gm) ?? [];

    expect(serviceSections).toHaveLength(1);
  });

  it("enables only the built-in question tool environment flag", async () => {
    const dropin = await loadDropin();

    expect(dropin).toMatch(
      /^\s*Environment=(?:"OPENCODE_ENABLE_QUESTION_TOOL=1"|'OPENCODE_ENABLE_QUESTION_TOOL=1'|OPENCODE_ENABLE_QUESTION_TOOL=1)\s*$/m,
    );
    expect(dropin).not.toMatch(/\b(?:HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)\b/);
    expect(dropin).not.toMatch(/^\s*Environment=(?:['"])?HOME=/m);
    expect(dropin).not.toMatch(/^\s*Environment=(?:['"])?OCTTO_/m);
  });

  it("does not override service execution or restart behavior", async () => {
    const dropin = await loadDropin();

    expect(dropin).not.toMatch(/^\s*(?:ExecStart|ExecStartPre|ExecStartPost|Restart)\s*=/m);
  });

  it("does not mention OpenCode restart instructions", async () => {
    const dropin = await loadDropin();

    expect(dropin).not.toMatch(/systemctl\s+restart/i);
    expect(dropin).not.toContain("restart-opencode-detached");
  });
});
