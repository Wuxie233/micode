import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { basename, dirname, join } from "node:path";
import {
  buildContextCapsule,
  evaluateContextCapsuleFreshness,
  findReusableContextCapsule,
  hashText,
} from "@/agents/context-capsule";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "context-capsule-v1-regression-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

describe("context capsule v1 regression coverage", () => {
  it("emits issue-prefixed filenames for v1 lifecycle builds", () => {
    const worktree = makeTempDir();
    const capsule = buildContextCapsule({
      topic: "V1 Lifecycle Prefix",
      lifecycleIssue: 93,
      branch: "issue-93-working-context-capsule-v2-trigger-reuse-anchor",
      headSha: "abc123",
      worktree,
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
      confirmedFacts: ["v1 lifecycle prefix remains stable"],
      sourceFiles: [{ path: "src/agents/executor.ts", content: "executor v1 context" }],
    });

    expect(capsule.status).toBe("fresh");
    if (capsule.status !== "fresh") throw new Error("expected fresh capsule");

    expect(dirname(capsule.path)).toBe(join(worktree, "thoughts", "shared", "context-capsules"));
    expect(basename(capsule.path)).toStartWith("issue-93-");
    expect(capsule.path).not.toContain("conv-");
  });

  it("finds v1 lifecycle capsules without requiring conversation anchor equality", async () => {
    const worktree = makeTempDir();
    const lifecycleCapsule = buildContextCapsule({
      topic: "Lifecycle Match",
      lifecycleIssue: 93,
      branch: "issue-93-working-context-capsule-v2-trigger-reuse-anchor",
      headSha: "abc123",
      worktree,
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
      conversationAnchor: "other-anchor",
      confirmedFacts: ["lifecycle match should win"],
      sourceFiles: [{ path: "src/agents/executor.ts", content: "lifecycle context" }],
    });
    const conversationFallback = buildContextCapsule({
      topic: "Conversation Fallback",
      lifecycleIssue: null,
      branch: "issue-93-working-context-capsule-v2-trigger-reuse-anchor",
      headSha: "abc123",
      worktree,
      createdAt: new Date("2026-05-17T00:01:00.000Z"),
      conversationAnchor: "requested-anchor",
      confirmedFacts: ["conversation fallback should not override lifecycle match"],
      sourceFiles: [{ path: "src/agents/commander.ts", content: "conversation context" }],
    });

    expect(lifecycleCapsule.status).toBe("fresh");
    expect(conversationFallback.status).toBe("fresh");
    if (lifecycleCapsule.status !== "fresh") throw new Error("expected fresh lifecycle capsule");

    await expect(
      findReusableContextCapsule({
        directory: join(worktree, "thoughts", "shared", "context-capsules"),
        lifecycleIssue: 93,
        conversationAnchor: "requested-anchor",
        branch: "issue-93-working-context-capsule-v2-trigger-reuse-anchor",
        worktree,
      }),
    ).resolves.toMatchObject({
      path: lifecycleCapsule.path,
      sha: lifecycleCapsule.sha,
      token: lifecycleCapsule.token,
    });
  });

  it("preserves v1 freshness semantics when expectedConversationAnchor is omitted", () => {
    const worktree = makeTempDir();
    const sourceContent = "executor confirmed context";
    const capsule = buildContextCapsule({
      topic: "V1 Freshness",
      lifecycleIssue: 93,
      branch: "issue-93-working-context-capsule-v2-trigger-reuse-anchor",
      headSha: "abc123",
      worktree,
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
      conversationAnchor: "capsule-anchor",
      confirmedFacts: ["omitted expectedConversationAnchor should not discard"],
      sourceFiles: [{ path: "src/agents/executor.ts", content: sourceContent }],
    });

    expect(capsule.status).toBe("fresh");
    if (capsule.status !== "fresh") throw new Error("expected fresh capsule");

    expect(
      evaluateContextCapsuleFreshness({
        expectedLifecycleIssue: 93,
        branch: "issue-93-working-context-capsule-v2-trigger-reuse-anchor",
        headSha: "abc123",
        worktree,
        sourceHashes: { "src/agents/executor.ts": hashText(sourceContent) },
        frontmatter: capsule.frontmatter,
      }),
    ).toEqual({
      status: "fresh",
      reasons: [],
      staleSourceFiles: [],
    });
  });

  it("renders byte-identical documents for identical v1 builds with fixed createdAt", () => {
    const worktree = makeTempDir();
    const sourceFiles = [
      { path: "thoughts/shared/plans/issue-93-plan.md", content: "plan confirmed context" },
      { path: "src/agents/executor.ts", content: "executor confirmed context" },
    ];
    const input = {
      topic: "Byte Identical V1",
      lifecycleIssue: 93,
      branch: "issue-93-working-context-capsule-v2-trigger-reuse-anchor",
      headSha: "abc123",
      worktree,
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
      confirmedFacts: ["same v1 input renders the same document"],
      sourceFiles,
    };

    const first = buildContextCapsule(input);
    const second = buildContextCapsule(input);

    expect(first.status).toBe("fresh");
    expect(second.status).toBe("fresh");
    if (first.status !== "fresh" || second.status !== "fresh") throw new Error("expected fresh capsules");

    expect(second.document).toBe(first.document);
    expect(second.sha).toBe(first.sha);
    expect(second.token).toBe(first.token);
    expect(second.path).toBe(first.path);
  });
});
