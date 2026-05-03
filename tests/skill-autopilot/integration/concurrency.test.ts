import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAutopilot } from "@/skill-autopilot/runner";

const LIFECYCLE_DIR = "thoughts/lifecycle";
const SKILLS_DIR = ".opencode/skills";
const REQUEST_TEXT = "## Request\n\nRun lint then tests\n";
const roots: string[] = [];

function journalEntry(
  issue: number,
  seq: number,
  kind: "batch_completed" | "review_completed",
  summary: string,
): string {
  return JSON.stringify({
    kind,
    issueNumber: issue,
    seq,
    at: seq,
    batchId: `batch-${seq}`,
    taskId: `task-${seq}`,
    attempt: 1,
    summary,
    commitMarker: null,
    reviewOutcome: kind === "review_completed" ? "approved" : null,
  });
}

function journalText(issue: number): string {
  return `${journalEntry(issue, 1, "review_completed", "approved")}\n${journalEntry(issue, 2, "batch_completed", "lint")}\n${journalEntry(issue, 3, "batch_completed", "test")}\n`;
}

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), "sa-conc-"));
  roots.push(root);
  return root;
}

function seedLifecycle(root: string, issue: number): void {
  mkdirSync(join(root, LIFECYCLE_DIR), { recursive: true });
  writeFileSync(join(root, `${LIFECYCLE_DIR}/${issue}.journal.jsonl`), journalText(issue));
  writeFileSync(join(root, `${LIFECYCLE_DIR}/${issue}.md`), REQUEST_TEXT);
}

describe("concurrency", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("two parallel runs produce a single skill", async () => {
    const dir = tempRoot();
    seedLifecycle(dir, 26);
    seedLifecycle(dir, 27);

    await runAutopilot({
      cwd: dir,
      projectId: "p",
      issueNumber: 26,
      now: 1,
      resolveProjectId: async () => ({ projectId: "p", kind: "origin", source: "git_remote" }),
    });

    const [first, second] = await Promise.all([
      runAutopilot({
        cwd: dir,
        projectId: "p",
        issueNumber: 27,
        now: 2,
        resolveProjectId: async () => ({ projectId: "p", kind: "origin", source: "git_remote" }),
      }),
      runAutopilot({
        cwd: dir,
        projectId: "p",
        issueNumber: 27,
        now: 3,
        resolveProjectId: async () => ({ projectId: "p", kind: "origin", source: "git_remote" }),
      }),
    ]);

    const writes = [...first.writes, ...second.writes];
    expect(writes.length).toBeGreaterThanOrEqual(1);
    const names = new Set(writes.map((write) => write.skillName));
    expect(names.size).toBe(1);

    const dirs = readdirSync(join(dir, SKILLS_DIR)).filter((entry) => {
      return !entry.startsWith(".") && statSync(join(dir, SKILLS_DIR, entry)).isDirectory();
    });
    expect(dirs).toHaveLength(1);
    expect(existsSync(join(dir, SKILLS_DIR, dirs[0] ?? "", "SKILL.md"))).toBe(true);
  });
});
