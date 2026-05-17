import { beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContextCapsule } from "@/agents/context-capsule/builder";
import { parseContextCapsuleDocument } from "@/agents/context-capsule/store";

let outputDir: string;

beforeEach(() => {
  outputDir = mkdtempSync(join(tmpdir(), "capsule-v2-"));
});

describe("builder v2 fields", () => {
  it("writes conversation_anchor, generated_by, dispatch_kind, parent_capsule into frontmatter", () => {
    const result = buildContextCapsule({
      topic: "conv-test",
      lifecycleIssue: null,
      branch: "issue/x",
      headSha: "abc",
      worktree: "/tmp/x",
      sourceFiles: [],
      confirmedFacts: ["ok"],
      outputDir,
      conversationAnchor: "anchor-xyz",
      generatedBy: "commander",
      dispatchKind: "executor-direct",
      parentCapsuleSha: "deadbeef",
      createdAt: new Date("2026-05-17T00:00:00Z"),
    });
    expect(result.status).toBe("fresh");
    if (result.status !== "fresh") return;
    expect(result.frontmatter.conversation_anchor).toBe("anchor-xyz");
    expect(result.frontmatter.generated_by).toBe("commander");
    expect(result.frontmatter.dispatch_kind).toBe("executor-direct");
    expect(result.frontmatter.parent_capsule).toBe("deadbeef");
    expect(result.document).toContain("conversation_anchor:");
    expect(result.document).toContain("dispatch_kind:");
  });

  it("v1 callers (no v2 fields) still produce capsule with v2 fields=null", () => {
    const result = buildContextCapsule({
      topic: "v1-compat",
      lifecycleIssue: 42,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp/y",
      sourceFiles: [],
      confirmedFacts: ["fact"],
      outputDir,
    });
    expect(result.status).toBe("fresh");
    if (result.status !== "fresh") return;
    expect(result.frontmatter.conversation_anchor).toBeNull();
    expect(result.frontmatter.generated_by).toBeNull();
    expect(result.frontmatter.dispatch_kind).toBeNull();
    expect(result.frontmatter.parent_capsule).toBeNull();
  });

  it("v2 capsule file name uses conv-<anchor>- prefix when lifecycleIssue is null", () => {
    const result = buildContextCapsule({
      topic: "fix-hub",
      lifecycleIssue: null,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp/z",
      sourceFiles: [],
      confirmedFacts: ["fact"],
      outputDir,
      conversationAnchor: "anchor-001",
      generatedBy: "commander",
      dispatchKind: "executor-direct",
    });
    if (result.status !== "fresh") throw new Error("expected fresh");
    expect(result.path).toContain("conv-anchor-001-");
  });

  it("v1 lifecycle-issue capsule file name keeps issue-<N>- prefix", () => {
    const result = buildContextCapsule({
      topic: "lifecycle",
      lifecycleIssue: 91,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp/v1",
      sourceFiles: [],
      confirmedFacts: ["fact"],
      outputDir,
    });
    if (result.status !== "fresh") throw new Error("expected fresh");
    expect(result.path).toContain("issue-91-");
  });

  it("secret filter still triggers when v2 fields present", () => {
    const result = buildContextCapsule({
      topic: "leak",
      lifecycleIssue: null,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp/leak",
      sourceFiles: [],
      confirmedFacts: ["Authorization: Bearer abcdef1234567890"],
      outputDir,
      conversationAnchor: "a",
      generatedBy: "commander",
      dispatchKind: "executor-direct",
    });
    expect(result.status).toBe("blocked");
  });

  it("frontmatter round-trips through parseContextCapsuleDocument", () => {
    const result = buildContextCapsule({
      topic: "round",
      lifecycleIssue: null,
      branch: "main",
      headSha: "abc",
      worktree: "/tmp/r",
      sourceFiles: [],
      confirmedFacts: ["x"],
      outputDir,
      conversationAnchor: "anchor-42",
      generatedBy: "octto",
      dispatchKind: "single-subagent",
      parentCapsuleSha: null,
    });
    if (result.status !== "fresh") throw new Error("expected fresh");
    const parsed = parseContextCapsuleDocument(result.document);
    expect(parsed.frontmatter.conversation_anchor).toBe("anchor-42");
    expect(parsed.frontmatter.generated_by).toBe("octto");
    expect(parsed.frontmatter.dispatch_kind).toBe("single-subagent");
    expect(parsed.frontmatter.parent_capsule).toBeNull();
  });
});
