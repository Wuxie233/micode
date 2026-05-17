import { beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { evaluateContextCapsuleFreshness } from "@/agents/context-capsule/freshness";
import { findReusableContextCapsule } from "@/agents/context-capsule/store";
import type { ContextCapsuleFrontmatter } from "@/agents/context-capsule/types";

function writeCapsule(dir: string, name: string, fm: Partial<ContextCapsuleFrontmatter>): string {
  const fullFm: ContextCapsuleFrontmatter = {
    lifecycle_issue: null,
    branch: "main",
    head_sha: "abc",
    worktree: "/tmp/w",
    created_at: "2026-05-17T00:00:00Z",
    source_files: [],
    source_hashes: {},
    conversation_anchor: null,
    generated_by: null,
    dispatch_kind: null,
    parent_capsule: null,
    ...fm,
  };
  const doc = [
    "---",
    `lifecycle_issue: ${fullFm.lifecycle_issue ?? "null"}`,
    `branch: "${fullFm.branch}"`,
    `head_sha: "${fullFm.head_sha}"`,
    `worktree: "${fullFm.worktree}"`,
    `created_at: "${fullFm.created_at}"`,
    "source_files: []",
    "source_hashes: {}",
    `conversation_anchor: ${fullFm.conversation_anchor === null ? "null" : `"${fullFm.conversation_anchor}"`}`,
    `generated_by: ${fullFm.generated_by === null ? "null" : `"${fullFm.generated_by}"`}`,
    `dispatch_kind: ${fullFm.dispatch_kind === null ? "null" : `"${fullFm.dispatch_kind}"`}`,
    `parent_capsule: ${fullFm.parent_capsule === null ? "null" : `"${fullFm.parent_capsule}"`}`,
    "---",
    "",
    "body",
    "",
  ].join("\n");
  const path = join(dir, name);
  writeFileSync(path, doc, "utf8");
  return path;
}

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "capsule-store-v2-"));
  mkdirSync(dir, { recursive: true });
});

describe("findReusableContextCapsule v2 matcher", () => {
  it("returns null when directory has no matching capsule", async () => {
    const result = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: 99,
      conversationAnchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
    });
    expect(result).toBeNull();
  });

  it("v1 (lifecycle_issue) match wins over v2 conversation_anchor match", async () => {
    writeCapsule(dir, "issue-7-a-aaaaaaaaaaaaaaaa.md", {
      lifecycle_issue: 7,
      branch: "main",
      worktree: "/tmp/w",
      created_at: "2026-05-17T00:00:00Z",
    });
    writeCapsule(dir, "conv-anchor-x-b-bbbbbbbbbbbbbbbb.md", {
      lifecycle_issue: null,
      conversation_anchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
      created_at: "2026-05-17T01:00:00Z",
    });
    const result = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: 7,
      conversationAnchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
    });
    expect(result?.path).toContain("issue-7-");
  });

  it("v2 fallback returns latest (conversation_anchor, branch, worktree) when lifecycle is null", async () => {
    writeCapsule(dir, "conv-anchor-x-a-aaaaaaaaaaaaaaaa.md", {
      conversation_anchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
      created_at: "2026-05-17T00:00:00Z",
    });
    writeCapsule(dir, "conv-anchor-x-b-bbbbbbbbbbbbbbbb.md", {
      conversation_anchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
      created_at: "2026-05-17T02:00:00Z",
    });
    const result = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: null,
      conversationAnchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
    });
    expect(result?.path).toContain("conv-anchor-x-b-");
  });

  it("v2 fallback ignores capsules with mismatched conversation_anchor", async () => {
    writeCapsule(dir, "conv-anchor-other.md", {
      conversation_anchor: "anchor-other",
      branch: "main",
      worktree: "/tmp/w",
    });
    const result = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: null,
      conversationAnchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
    });
    expect(result).toBeNull();
  });

  it("v2 fallback ignores capsules with mismatched branch", async () => {
    writeCapsule(dir, "conv-anchor-x-other-branch.md", {
      conversation_anchor: "anchor-x",
      branch: "feature/other",
      worktree: "/tmp/w",
    });
    const result = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: null,
      conversationAnchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
    });
    expect(result).toBeNull();
  });

  it("v2 fallback ignores capsules with mismatched worktree", async () => {
    writeCapsule(dir, "conv-anchor-x-other-worktree.md", {
      conversation_anchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/other-w",
    });
    const result = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: null,
      conversationAnchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
    });
    expect(result).toBeNull();
  });

  it("returns null when conversationAnchor is null and no lifecycle match", async () => {
    writeCapsule(dir, "conv-a.md", {
      conversation_anchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
    });
    const result = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: null,
      conversationAnchor: null,
      branch: "main",
      worktree: "/tmp/w",
    });
    expect(result).toBeNull();
  });

  it("deterministic tie-break: equal created_at falls back to path lex order", async () => {
    writeCapsule(dir, "conv-anchor-x-b.md", {
      conversation_anchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
      created_at: "2026-05-17T00:00:00Z",
    });
    writeCapsule(dir, "conv-anchor-x-a.md", {
      conversation_anchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
      created_at: "2026-05-17T00:00:00Z",
    });
    const result = await findReusableContextCapsule({
      directory: dir,
      lifecycleIssue: null,
      conversationAnchor: "anchor-x",
      branch: "main",
      worktree: "/tmp/w",
    });
    expect(result?.path).toMatch(/conv-anchor-x-a\.md$/);
  });
});

describe("evaluateContextCapsuleFreshness v2 conversation dimension", () => {
  const base = {
    branch: "main",
    headSha: "abc",
    worktree: "/tmp/w",
    sourceHashes: {},
  };

  it("discards when frontmatter conversation_anchor mismatches expected", () => {
    const result = evaluateContextCapsuleFreshness({
      ...base,
      expectedLifecycleIssue: null,
      expectedConversationAnchor: "anchor-current",
      frontmatter: {
        lifecycle_issue: null,
        branch: "main",
        head_sha: "abc",
        worktree: "/tmp/w",
        created_at: "2026-05-17T00:00:00Z",
        source_files: [],
        source_hashes: {},
        conversation_anchor: "anchor-old",
        generated_by: "commander",
        dispatch_kind: "executor-direct",
        parent_capsule: null,
      },
    });
    expect(result.status).toBe("discarded");
    expect(result.reasons).toContain("conversation_anchor_mismatch");
  });

  it("does NOT check conversation_anchor when expected is undefined (v1 backwards compat)", () => {
    const result = evaluateContextCapsuleFreshness({
      ...base,
      expectedLifecycleIssue: 7,
      frontmatter: {
        lifecycle_issue: 7,
        branch: "main",
        head_sha: "abc",
        worktree: "/tmp/w",
        created_at: "2026-05-17T00:00:00Z",
        source_files: [],
        source_hashes: {},
        conversation_anchor: "anchor-anything",
        generated_by: "commander",
        dispatch_kind: "executor-direct",
        parent_capsule: null,
      },
    });
    expect(result.status).toBe("fresh");
  });

  it("fresh when v2 conversation_anchor matches and lifecycle null on both sides", () => {
    const result = evaluateContextCapsuleFreshness({
      ...base,
      expectedLifecycleIssue: null,
      expectedConversationAnchor: "anchor-x",
      frontmatter: {
        lifecycle_issue: null,
        branch: "main",
        head_sha: "abc",
        worktree: "/tmp/w",
        created_at: "2026-05-17T00:00:00Z",
        source_files: [],
        source_hashes: {},
        conversation_anchor: "anchor-x",
        generated_by: "commander",
        dispatch_kind: "executor-direct",
        parent_capsule: null,
      },
    });
    expect(result.status).toBe("fresh");
  });
});
