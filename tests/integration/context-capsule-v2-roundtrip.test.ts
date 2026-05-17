import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildContextCapsule,
  evaluateContextCapsuleFreshness,
  findReusableContextCapsule,
  hashText,
  parseContextCapsuleDocument,
} from "@/agents/context-capsule";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "context-capsule-v2-roundtrip-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

describe("context capsule v2 roundtrip integration", () => {
  it("builds a v2 capsule, finds it by conversation anchor, parses it, and evaluates it as fresh", async () => {
    const worktree = makeTempDir();
    const outputDir = join(worktree, "thoughts", "shared", "context-capsules");
    const sourceFiles = [
      { path: "src/agents/commander.ts", content: "commander confirmed context" },
      { path: "src/agents/executor.ts", content: "executor confirmed context" },
    ];

    const capsule = buildContextCapsule({
      topic: "Anchor A Reuse",
      lifecycleIssue: null,
      conversationAnchor: "anchor-A",
      generatedBy: "commander",
      dispatchKind: "single-subagent",
      branch: "issue-93-working-context-capsule-v2-trigger-reuse-anchor",
      headSha: "abc123",
      worktree,
      outputDir,
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
      confirmedFacts: ["anchor-A can reuse confirmed context"],
      sourceFiles,
    });

    expect(capsule.status).toBe("fresh");
    if (capsule.status !== "fresh") throw new Error("expected fresh capsule");

    const reusable = await findReusableContextCapsule({
      directory: outputDir,
      lifecycleIssue: null,
      conversationAnchor: "anchor-A",
      branch: "issue-93-working-context-capsule-v2-trigger-reuse-anchor",
      worktree,
    });

    expect(reusable?.path).toBe(capsule.path);
    expect(reusable?.sha).toBe(capsule.sha);
    expect(reusable?.token).toBe(capsule.token);

    const parsed = parseContextCapsuleDocument(reusable?.content ?? "");
    expect(parsed.frontmatter).toEqual(capsule.frontmatter);
    expect(parsed.body).toContain("- anchor-A can reuse confirmed context");

    expect(
      evaluateContextCapsuleFreshness({
        expectedLifecycleIssue: null,
        expectedConversationAnchor: "anchor-A",
        branch: "issue-93-working-context-capsule-v2-trigger-reuse-anchor",
        headSha: "abc123",
        worktree,
        sourceHashes: Object.fromEntries(sourceFiles.map((source) => [source.path, hashText(source.content)])),
        frontmatter: parsed.frontmatter,
      }),
    ).toEqual({
      status: "fresh",
      reasons: [],
      staleSourceFiles: [],
    });
  });

  it("returns null for a different conversation anchor", async () => {
    const worktree = makeTempDir();
    const outputDir = join(worktree, "thoughts", "shared", "context-capsules");
    const capsule = buildContextCapsule({
      topic: "Anchor A Only",
      lifecycleIssue: null,
      conversationAnchor: "anchor-A",
      branch: "issue-93-working-context-capsule-v2-trigger-reuse-anchor",
      headSha: "abc123",
      worktree,
      outputDir,
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
      confirmedFacts: ["only anchor-A should match"],
      sourceFiles: [],
    });

    expect(capsule.status).toBe("fresh");

    await expect(
      findReusableContextCapsule({
        directory: outputDir,
        lifecycleIssue: null,
        conversationAnchor: "anchor-B",
        branch: "issue-93-working-context-capsule-v2-trigger-reuse-anchor",
        worktree,
      }),
    ).resolves.toBeNull();
  });

  it("prefers a lifecycle capsule over a same-anchor conversation capsule for lifecycle queries", async () => {
    const worktree = makeTempDir();
    const outputDir = join(worktree, "thoughts", "shared", "context-capsules");
    const branch = "issue-93-working-context-capsule-v2-trigger-reuse-anchor";

    const conversationCapsule = buildContextCapsule({
      topic: "Anchor A Fallback",
      lifecycleIssue: null,
      conversationAnchor: "anchor-A",
      generatedBy: "commander",
      dispatchKind: "executor-direct",
      branch,
      headSha: "abc123",
      worktree,
      outputDir,
      createdAt: new Date("2026-05-17T01:00:00.000Z"),
      confirmedFacts: ["same anchor fallback context"],
      sourceFiles: [],
    });
    const lifecycleCapsule = buildContextCapsule({
      topic: "Lifecycle Wins",
      lifecycleIssue: 93,
      conversationAnchor: "anchor-A",
      generatedBy: "executor",
      dispatchKind: "parallel-fanout",
      branch,
      headSha: "abc123",
      worktree,
      outputDir,
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
      confirmedFacts: ["lifecycle context wins over same anchor"],
      sourceFiles: [],
    });

    expect(conversationCapsule.status).toBe("fresh");
    expect(lifecycleCapsule.status).toBe("fresh");
    if (lifecycleCapsule.status !== "fresh") throw new Error("expected fresh lifecycle capsule");

    const reusable = await findReusableContextCapsule({
      directory: outputDir,
      lifecycleIssue: 93,
      conversationAnchor: "anchor-A",
      branch,
      worktree,
    });

    expect(reusable?.path).toBe(lifecycleCapsule.path);
    const parsed = parseContextCapsuleDocument(reusable?.content ?? "");
    expect(parsed.frontmatter.lifecycle_issue).toBe(93);
    expect(parsed.frontmatter.conversation_anchor).toBe("anchor-A");
    expect(parsed.body).toContain("- lifecycle context wins over same anchor");
  });

  it("returns null when both lifecycle issue and conversation anchor are null", async () => {
    const worktree = makeTempDir();
    const outputDir = join(worktree, "thoughts", "shared", "context-capsules");
    const capsule = buildContextCapsule({
      topic: "Anchor A Present",
      lifecycleIssue: null,
      conversationAnchor: "anchor-A",
      branch: "issue-93-working-context-capsule-v2-trigger-reuse-anchor",
      headSha: "abc123",
      worktree,
      outputDir,
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
      confirmedFacts: ["null query must not match anchor-A"],
      sourceFiles: [],
    });

    expect(capsule.status).toBe("fresh");

    await expect(
      findReusableContextCapsule({
        directory: outputDir,
        lifecycleIssue: null,
        conversationAnchor: null,
        branch: "issue-93-working-context-capsule-v2-trigger-reuse-anchor",
        worktree,
      }),
    ).resolves.toBeNull();
  });
});
