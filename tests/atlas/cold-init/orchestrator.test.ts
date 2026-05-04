import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runColdInit } from "@/atlas/cold-init/orchestrator";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "orch-"));
  mkdirSync(join(projectRoot, "src", "alpha"), { recursive: true });
  writeFileSync(join(projectRoot, "src", "alpha", "index.ts"), "// alpha module\n", "utf8");
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("runColdInit", () => {
  it("returns ok and reports nodesWritten without asking when askQuestions=false", async () => {
    let asked = 0;
    const out = await runColdInit(
      { projectRoot, options: { askQuestions: false, questionTimeoutMs: 1000 } },
      {
        projectMemory: { list: async () => [] },
        askQuestions: async () => {
          asked += 1;
          return {};
        },
        writeVault: async () => ({ nodesWritten: 4, stagingDir: "/tmp/x", logPath: "/tmp/x/log.md" }),
      },
    );
    expect(out.status).toBe("ok");
    expect(out.nodesWritten).toBe(4);
    expect(asked).toBe(0);
  });

  it("invokes askQuestions and forwards the returned answers", async () => {
    let received: Record<string, string> | null = null;
    const out = await runColdInit(
      { projectRoot, options: { askQuestions: true, questionTimeoutMs: 1000 } },
      {
        projectMemory: { list: async () => [] },
        askQuestions: async () => ({ "intent.pitch": "Demo project" }),
        writeVault: async (i) => {
          received = { ...i.answers };
          return { nodesWritten: 5, stagingDir: "/tmp/y", logPath: "/tmp/y/log.md" };
        },
      },
    );
    expect(out.questionsAsked).toBeGreaterThan(0);
    expect(received).toEqual({ "intent.pitch": "Demo project" });
  });

  it("continues when askQuestions throws", async () => {
    const out = await runColdInit(
      { projectRoot, options: { askQuestions: true, questionTimeoutMs: 1000 } },
      {
        projectMemory: { list: async () => [] },
        askQuestions: async () => {
          throw new Error("octto down");
        },
        writeVault: async () => ({ nodesWritten: 1, stagingDir: "/tmp/z", logPath: "/tmp/z/log.md" }),
      },
    );
    expect(out.status).toBe("ok");
  });
});
