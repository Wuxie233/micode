import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAutopilot } from "@/skill-autopilot/runner";

const STATE_PATH = ".opencode/skills/.state.json";

const roots: string[] = [];

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function seedState(root: string): void {
  mkdirSync(join(root, ".opencode/skills"), { recursive: true });
  writeFileSync(join(root, STATE_PATH), JSON.stringify({ hits: { k: 1 }, distinctIssues: { k: [26] } }));
}

describe("runAutopilot", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("skips when boundary guard rejects runtime install path", async () => {
    const r = await runAutopilot({
      cwd: "/root/.micode",
      projectId: "p",
      issueNumber: 27,
      now: 1,
      resolveProjectId: async () => ({ projectId: "p", kind: "origin", source: "git_remote" }),
    });

    expect(r.skipped).toBe(true);
    expect(r.skippedReason).toMatch(/runtime install/);
  });

  it("skips when projectId is degraded", async () => {
    const dir = tempRoot("sa-runner-");
    const r = await runAutopilot({
      cwd: dir,
      projectId: "p",
      issueNumber: 27,
      now: 1,
      resolveProjectId: async () => ({ projectId: "p", kind: "path", source: dir }),
    });

    expect(r.skipped).toBe(true);
    expect(r.skippedReason).toMatch(/degraded/);
  });

  it("writes a SKILL.md when policy and security pass and regenerates INDEX.md", async () => {
    const dir = tempRoot("sa-runner-write-");
    seedState(dir);

    const r = await runAutopilot({
      cwd: dir,
      projectId: "p",
      issueNumber: 27,
      now: 1,
      resolveProjectId: async () => ({ projectId: "p", kind: "origin", source: "git_remote" }),
      seedCandidates: [
        {
          id: "cand_1",
          dedupeKey: "k",
          projectId: "p",
          trigger: "before commit run lint",
          steps: ["bun run check"],
          sources: [{ kind: "lifecycle_journal", pointer: "thoughts/lifecycle/27.journal.jsonl" }],
          lifecycleIssueNumber: 27,
        },
      ],
    });

    expect(r.skipped).toBe(false);
    expect(r.writes.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(dir, ".opencode/skills/INDEX.md"))).toBe(true);
    const skillFiles = r.writes.map((write) => readFileSync(join(dir, write.relPath), "utf8"));
    expect(skillFiles[0]).toContain("x-micode-managed: true");
  });
});
