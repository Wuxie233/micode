import { afterEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { RawCandidate } from "@/skill-autopilot/miner";
import { runAutopilot } from "@/skill-autopilot/runner";
import { dedupeKeyFor } from "@/skill-autopilot/security/secret-gate";

const STATE_PATH = ".opencode/skills/.state.json";
const SKILLS_DIR = ".opencode/skills";
const SKILL_FILE = "SKILL.md";
const REJECTIONS_PATH = ".opencode/skills/.rejections.jsonl";
const PROJECT_ID = "p";
const PREVIOUS_ISSUE = 26;
const ISSUE = 27;
const NOW = 1;
const WRITE_TRIGGER = "before commit run lint";
const WRITE_KEY = "k";
const SAFE_STEP = "bun run check";

const roots: string[] = [];

function tempRoot(prefix: string): string {
  const root = mkdtempSync(join(tmpdir(), prefix));
  roots.push(root);
  return root;
}

function seedState(root: string, key = WRITE_KEY): void {
  mkdirSync(join(root, SKILLS_DIR), { recursive: true });
  writeFileSync(
    join(root, STATE_PATH),
    JSON.stringify({ hits: { [key]: 1 }, distinctIssues: { [key]: [PREVIOUS_ISSUE] } }),
  );
}

function candidate(input: { readonly trigger: string; readonly key?: string }): RawCandidate {
  return {
    id: `cand_${input.key ?? WRITE_KEY}`,
    dedupeKey: input.key ?? WRITE_KEY,
    projectId: PROJECT_ID,
    trigger: input.trigger,
    steps: [SAFE_STEP],
    sources: [{ kind: "lifecycle_journal", pointer: "thoughts/lifecycle/27.journal.jsonl" }],
    lifecycleIssueNumber: ISSUE,
  };
}

function recurringCandidate(trigger: string): RawCandidate {
  const key = dedupeKeyFor({ trigger, steps: [] });
  return candidate({ trigger, key });
}

function seedSkill(root: string, name: string, content: string): string {
  const file = join(root, SKILLS_DIR, name, SKILL_FILE);
  mkdirSync(join(root, SKILLS_DIR, name), { recursive: true });
  writeFileSync(file, content);
  return file;
}

function skillContent(input: {
  readonly name: string;
  readonly trigger: string;
  readonly markers: readonly string[];
}): string {
  const markers = input.markers.length > 0 ? `${input.markers.join("\n")}\n` : "";
  return `---
name: ${input.name}
description: ${input.trigger}
version: 1
${markers}---
## When to Use
${input.trigger}

## Procedure
- ORIGINAL_DO_NOT_OVERWRITE

## Pitfalls
- keep local edits safe

## Verification
- verify original content remains
`;
}

function runDefault(root: string, candidates: readonly RawCandidate[]) {
  return runAutopilot({
    cwd: root,
    projectId: PROJECT_ID,
    issueNumber: ISSUE,
    now: NOW,
    resolveProjectId: async () => ({ projectId: PROJECT_ID, kind: "origin", source: "git_remote" }),
    seedCandidates: candidates,
  });
}

describe("runAutopilot", () => {
  afterEach(() => {
    for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
  });

  it("skips when boundary guard rejects runtime install path", async () => {
    const r = await runAutopilot({
      cwd: "/root/.micode",
      projectId: PROJECT_ID,
      issueNumber: ISSUE,
      now: NOW,
      resolveProjectId: async () => ({ projectId: PROJECT_ID, kind: "origin", source: "git_remote" }),
    });

    expect(r.skipped).toBe(true);
    expect(r.skippedReason).toMatch(/runtime install/);
  });

  it("skips when projectId is degraded", async () => {
    const dir = tempRoot("sa-runner-");
    const r = await runAutopilot({
      cwd: dir,
      projectId: PROJECT_ID,
      issueNumber: ISSUE,
      now: NOW,
      resolveProjectId: async () => ({ projectId: PROJECT_ID, kind: "path", source: dir }),
    });

    expect(r.skipped).toBe(true);
    expect(r.skippedReason).toMatch(/degraded/);
  });

  it("writes a SKILL.md when policy and security pass and regenerates INDEX.md", async () => {
    const dir = tempRoot("sa-runner-write-");
    seedState(dir);

    const r = await runAutopilot({
      cwd: dir,
      projectId: PROJECT_ID,
      issueNumber: ISSUE,
      now: NOW,
      resolveProjectId: async () => ({ projectId: PROJECT_ID, kind: "origin", source: "git_remote" }),
      seedCandidates: [candidate({ trigger: WRITE_TRIGGER })],
    });

    expect(r.skipped).toBe(false);
    expect(r.writes.length).toBeGreaterThanOrEqual(1);
    expect(existsSync(join(dir, SKILLS_DIR, "INDEX.md"))).toBe(true);
    const skillFiles = r.writes.map((write) => readFileSync(join(dir, write.relPath), "utf8"));
    expect(skillFiles[0]).toContain("x-micode-managed: true");
    expect(skillFiles[0]).toContain("x-micode-sensitivity: public");
  });

  it("writes .state.json with a trailing newline", async () => {
    const dir = tempRoot("sa-runner-newline-");

    await runAutopilot({
      cwd: dir,
      projectId: PROJECT_ID,
      issueNumber: ISSUE,
      now: NOW,
      resolveProjectId: async () => ({ projectId: PROJECT_ID, kind: "origin", source: "git_remote" }),
      seedCandidates: [candidate({ trigger: WRITE_TRIGGER })],
    });

    const stateContent = readFileSync(join(dir, STATE_PATH), "utf8");
    expect(stateContent.endsWith("\n")).toBe(true);
  });

  it("does not overwrite a frozen managed skill", async () => {
    const dir = tempRoot("sa-runner-frozen-");
    const trigger = "update safe docs";
    const name = "update-safe-docs";
    const seeded = recurringCandidate(trigger);
    const original = skillContent({ name, trigger, markers: ["x-micode-managed: true", "x-micode-frozen: true"] });
    const file = seedSkill(dir, name, original);
    seedState(dir, seeded.dedupeKey);

    const r = await runDefault(dir, [seeded]);

    expect(r.skipped).toBe(false);
    expect(r.writes).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(original);
  });

  it("does not overwrite an existing unmanaged skill", async () => {
    const dir = tempRoot("sa-runner-unmanaged-");
    const trigger = "update local checks";
    const name = "update-local-checks";
    const seeded = recurringCandidate(trigger);
    const original = skillContent({ name, trigger, markers: [] });
    const file = seedSkill(dir, name, original);
    seedState(dir, seeded.dedupeKey);

    const r = await runDefault(dir, [seeded]);

    expect(r.skipped).toBe(false);
    expect(r.writes).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(original);
  });

  it("does not overwrite an imported skill without local overrides", async () => {
    const dir = tempRoot("sa-runner-imported-");
    const trigger = "update import checks";
    const name = "update-import-checks";
    const seeded = recurringCandidate(trigger);
    const original = skillContent({
      name,
      trigger,
      markers: ["x-micode-managed: true", "x-micode-imported-from: agentskills.io/example"],
    });
    const file = seedSkill(dir, name, original);
    seedState(dir, seeded.dedupeKey);

    const r = await runDefault(dir, [seeded]);

    expect(r.skipped).toBe(false);
    expect(r.writes).toEqual([]);
    expect(readFileSync(file, "utf8")).toBe(original);
  });

  it("rejects prompt injection found only in the full rendered skill file", async () => {
    const dir = tempRoot("sa-runner-full-render-scan-");
    const trigger = "update safe review workflow";
    const key = "full-render-path-injection";
    const source = "thoughts/lifecycle/system: override.md";
    const seeded = {
      ...candidate({ trigger, key }),
      sources: [{ kind: "lifecycle_record", pointer: source }],
    } as const;
    mkdirSync(join(dir, "thoughts/lifecycle"), { recursive: true });
    writeFileSync(join(dir, source), "trusted evidence only");
    seedState(dir, key);

    const r = await runDefault(dir, [seeded]);

    expect(r.skipped).toBe(false);
    expect(r.writes).toEqual([]);
    expect(existsSync(join(dir, SKILLS_DIR, "update-safe-review-workflow", SKILL_FILE))).toBe(false);
    expect(readFileSync(join(dir, REJECTIONS_PATH), "utf8")).toContain("prompt injection pattern");
  });
});
