import { afterEach, describe, expect, it } from "bun:test";
import { execFileSync } from "node:child_process";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { JournalEvent, JournalEventKind } from "@/lifecycle/journal/types";
import { runAutopilot } from "@/skill-autopilot/runner";

const PREFIX = "sa-lifecycle-commit-";
const PROJECT_ID = "p";
const PROJECT_SOURCE = "git_remote";
const FIRST_ISSUE = 26;
const SECOND_ISSUE = 27;
const FIRST_NOW = 1;
const SECOND_NOW = 2;
const MIN_WRITES = 1;
const HIT_COUNT = 2;
const UTF8 = "utf8";
const SKILLS_DIR = ".opencode/skills";
const INDEX_PATH = `${SKILLS_DIR}/INDEX.md`;
const STATE_PATH = `${SKILLS_DIR}/.state.json`;
const REQUEST_MARKDOWN = "## Request\n\nRun lint and tests before commits\n";
const REVIEW_SUMMARY = "approved";
const LINT_SUMMARY = "run lint";
const TEST_SUMMARY = "run tests";
const REVIEW_OUTCOME = "approved";

interface SkillState {
  readonly hits: Record<string, number>;
  readonly distinctIssues: Record<string, readonly number[]>;
}

const roots: string[] = [];

function runGit(root: string, args: readonly string[]): string {
  return execFileSync("git", [...args], { cwd: root, encoding: UTF8 });
}

function tempRoot(): string {
  const root = mkdtempSync(join(tmpdir(), PREFIX));
  roots.push(root);
  return root;
}

function gitInit(root: string): void {
  runGit(root, ["init", "-q"]);
}

function journalEvent(
  kind: JournalEventKind,
  issueNumber: number,
  seq: number,
  summary: string,
  reviewOutcome: JournalEvent["reviewOutcome"] = null,
): JournalEvent {
  return {
    kind,
    issueNumber,
    seq,
    at: seq,
    batchId: null,
    taskId: null,
    attempt: 0,
    summary,
    commitMarker: null,
    reviewOutcome,
  };
}

function writeLifecycle(root: string, issueNumber: number): void {
  const dir = join(root, "thoughts/lifecycle");
  mkdirSync(dir, { recursive: true });
  const events = [
    journalEvent("review_completed", issueNumber, 1, REVIEW_SUMMARY, REVIEW_OUTCOME),
    journalEvent("batch_completed", issueNumber, 2, LINT_SUMMARY),
    journalEvent("batch_completed", issueNumber, 3, TEST_SUMMARY),
  ];
  writeFileSync(join(dir, `${issueNumber}.journal.jsonl`), `${events.map(JSON.stringify).join("\n")}\n`);
  writeFileSync(join(dir, `${issueNumber}.md`), REQUEST_MARKDOWN);
}

function isNumberRecord(value: unknown): value is Record<string, number> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every((entry) => typeof entry === "number");
}

function isIssueRecord(value: unknown): value is Record<string, readonly number[]> {
  if (typeof value !== "object" || value === null) return false;
  return Object.values(value).every(
    (entry) => Array.isArray(entry) && entry.every((issue) => typeof issue === "number"),
  );
}

function parseState(text: string): SkillState {
  const parsed: unknown = JSON.parse(text);
  if (typeof parsed !== "object" || parsed === null) throw new Error("invalid state");
  if (!("hits" in parsed) || !("distinctIssues" in parsed)) throw new Error("invalid state");
  if (!isNumberRecord(parsed.hits) || !isIssueRecord(parsed.distinctIssues)) throw new Error("invalid state");
  return { hits: parsed.hits, distinctIssues: parsed.distinctIssues };
}

describe("lifecycle commit e2e", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("writes SKILL.md and INDEX.md as untracked lifecycle commit changes", async () => {
    const root = tempRoot();
    gitInit(root);
    writeLifecycle(root, FIRST_ISSUE);
    writeLifecycle(root, SECOND_ISSUE);

    await runAutopilot({
      cwd: root,
      projectId: PROJECT_ID,
      issueNumber: FIRST_ISSUE,
      now: FIRST_NOW,
      resolveProjectId: async () => ({ projectId: PROJECT_ID, kind: "origin", source: PROJECT_SOURCE }),
    });
    const outcome = await runAutopilot({
      cwd: root,
      projectId: PROJECT_ID,
      issueNumber: SECOND_ISSUE,
      now: SECOND_NOW,
      resolveProjectId: async () => ({ projectId: PROJECT_ID, kind: "origin", source: PROJECT_SOURCE }),
    });

    expect(outcome.writes.length).toBeGreaterThanOrEqual(MIN_WRITES);
    const write = outcome.writes[0];
    expect(write).toBeDefined();
    if (!write) return;
    expect(existsSync(join(root, write.relPath))).toBe(true);
    expect(existsSync(join(root, INDEX_PATH))).toBe(true);
    const state = parseState(readFileSync(join(root, STATE_PATH), UTF8));
    expect(Object.values(state.hits)).toContain(HIT_COUNT);
    expect(Object.values(state.distinctIssues)).toContainEqual([FIRST_ISSUE, SECOND_ISSUE]);
    expect(readFileSync(join(root, INDEX_PATH), UTF8)).toContain("hits=");
    expect(runGit(root, ["status", "--porcelain", "--untracked-files=all"])).toContain(SKILLS_DIR);
  });
});
