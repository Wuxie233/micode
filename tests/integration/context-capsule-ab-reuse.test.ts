import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildContextCapsule,
  evaluateContextCapsuleFreshness as checkContextCapsuleFreshness,
  hashText,
} from "@/agents/context-capsule";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "context-capsule-ab-reuse-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

describe("context capsule A→B reuse integration", () => {
  it("accepts a same-lifecycle capsule as fresh for a later subagent prompt", () => {
    const worktree = makeTempDir();
    const executorSource = "executor confirmed context";
    const planSource = "plan confirmed context";
    const capsule = buildContextCapsule({
      topic: "A to B Reuse",
      lifecycleIssue: 91,
      branch: "issue-91-working-context-capsule",
      headSha: "abc123",
      worktree,
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
      confirmedFacts: ["Batch 1 approved", "Batch 2 approved"],
      sourceFiles: [
        { path: "thoughts/shared/plans/issue-91-plan.md", content: planSource },
        { path: "src/agents/executor.ts", content: executorSource },
      ],
    });

    expect(capsule.status).toBe("fresh");
    if (capsule.status !== "fresh") throw new Error("expected fresh capsule");

    expect(
      checkContextCapsuleFreshness({
        expectedLifecycleIssue: 91,
        branch: "issue-91-working-context-capsule",
        headSha: "abc123",
        worktree,
        sourceHashes: {
          "thoughts/shared/plans/issue-91-plan.md": hashText(planSource),
          "src/agents/executor.ts": hashText(executorSource),
        },
        frontmatter: capsule.frontmatter,
      }),
    ).toEqual({
      status: "fresh",
      reasons: [],
      staleSourceFiles: [],
    });
  });

  it("marks same-lifecycle reuse as partially-stale when HEAD or source hashes drift", () => {
    const worktree = makeTempDir();
    const executorSource = "executor confirmed context";
    const planSource = "plan confirmed context";
    const capsule = buildContextCapsule({
      topic: "Partially Stale Reuse",
      lifecycleIssue: 91,
      branch: "issue-91-working-context-capsule",
      headSha: "abc123",
      worktree,
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
      confirmedFacts: ["Batch 3 approved"],
      sourceFiles: [
        { path: "thoughts/shared/plans/issue-91-plan.md", content: planSource },
        { path: "src/agents/executor.ts", content: executorSource },
      ],
    });

    expect(capsule.status).toBe("fresh");
    if (capsule.status !== "fresh") throw new Error("expected fresh capsule");

    expect(
      checkContextCapsuleFreshness({
        expectedLifecycleIssue: 91,
        branch: "issue-91-working-context-capsule",
        headSha: "def456",
        worktree,
        sourceHashes: {
          "thoughts/shared/plans/issue-91-plan.md": hashText("plan confirmed context changed"),
          "src/agents/executor.ts": hashText(executorSource),
        },
        frontmatter: capsule.frontmatter,
      }),
    ).toEqual({
      status: "partially-stale",
      reasons: ["head_sha_changed", "source_hashes_changed"],
      staleSourceFiles: ["thoughts/shared/plans/issue-91-plan.md"],
    });
  });

  it("discards A→B reuse when the branch no longer matches", () => {
    const worktree = makeTempDir();
    const capsule = buildContextCapsule({
      topic: "Branch Mismatch Reuse",
      lifecycleIssue: 91,
      branch: "issue-91-working-context-capsule",
      headSha: "abc123",
      worktree,
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
      confirmedFacts: ["Batch 4 started"],
      sourceFiles: [{ path: "src/agents/executor.ts", content: "executor confirmed context" }],
    });

    expect(capsule.status).toBe("fresh");
    if (capsule.status !== "fresh") throw new Error("expected fresh capsule");

    expect(
      checkContextCapsuleFreshness({
        expectedLifecycleIssue: 91,
        branch: "issue-92-other-work",
        headSha: "abc123",
        worktree,
        sourceHashes: { "src/agents/executor.ts": hashText("executor confirmed context") },
        frontmatter: capsule.frontmatter,
      }),
    ).toEqual({
      status: "discarded",
      reasons: ["branch_mismatch"],
      staleSourceFiles: [],
    });
  });

  it("blocks capsule creation before reuse when source context contains secrets", () => {
    const worktree = makeTempDir();
    const capsule = buildContextCapsule({
      topic: "Secret Bearing Reuse",
      lifecycleIssue: 91,
      branch: "issue-91-working-context-capsule",
      headSha: "abc123",
      worktree,
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
      confirmedFacts: ["Batch 4 started"],
      sourceFiles: [{ path: "src/agents/executor.ts", content: "OPENAI_API_KEY=sk-test-1234567890abcdef" }],
    });

    expect(capsule).toEqual({
      status: "blocked",
      reason: "secret_detected",
      detail: "sourceFiles:src/agents/executor.ts: env_secret_assignment",
    });
    expect(readdirSync(worktree)).toEqual([]);
  });
});
