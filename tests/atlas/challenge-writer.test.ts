import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeChallenge } from "@/atlas/challenge-writer";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-cw-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("writeChallenge", () => {
  it("creates a markdown challenge in atlas/_meta/challenges with first-person body", async () => {
    const file = await writeChallenge(projectRoot, {
      target: "10-impl/runner.md",
      reason: "I see X in source Y, which differs from what the node says.",
      proposedChange: "I suggest changing it to Z.",
      sources: ["lifecycle:26", "code:src/lifecycle/runner.ts"],
      runId: "agent2-26-100",
    });
    expect(existsSync(file)).toBe(true);
    const body = readFileSync(file, "utf8");
    expect(body).toContain("status: open");
    expect(body).toContain("target: 10-impl/runner.md");
    expect(body).toContain("I see X");
    expect(body).toContain("I suggest changing it to Z.");
    expect(body).toContain("- lifecycle:26");
  });

  it("namespaces files under run id", async () => {
    await writeChallenge(projectRoot, {
      target: "20-behavior/x.md",
      reason: "r",
      proposedChange: "p",
      sources: [],
      runId: "agent2-26-200",
    });
    const files = readdirSync(join(projectRoot, "atlas", "_meta", "challenges"));
    expect(files.some((f) => f.startsWith("agent2-26-200-"))).toBe(true);
  });
});
