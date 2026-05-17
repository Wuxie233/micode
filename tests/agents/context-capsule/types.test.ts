import { describe, expect, it } from "bun:test";
import {
  CAPSULE_STATUSES,
  type CapsuleFreshnessStatus,
  type ContextCapsuleBuildInput,
  type ContextCapsuleFreshnessInput,
  type ContextCapsuleFrontmatter,
  DISPATCH_KINDS,
  type DispatchKind,
  GENERATOR_AGENTS,
  type GeneratorAgent,
  isCapsuleStatus,
  isDispatchKind,
  isGeneratorAgent,
} from "@/agents/context-capsule/types";

describe("context capsule types", () => {
  it("enumerates all user-visible capsule statuses", () => {
    expect(CAPSULE_STATUSES).toEqual(["none", "fresh", "partially-stale", "discarded", "skipped", "blocked"]);
    expect(isCapsuleStatus("fresh")).toBe(true);
    expect(isCapsuleStatus("partially-stale")).toBe(true);
    expect(isCapsuleStatus("blocked:secret")).toBe(false);
    expect(isCapsuleStatus("unknown")).toBe(false);
  });

  it("allows the required frontmatter shape", () => {
    const frontmatter: ContextCapsuleFrontmatter = {
      lifecycle_issue: 91,
      branch: "issue-91-working-context-capsule",
      head_sha: "abc123",
      worktree: "/root/CODE/issue-91-working-context-capsule",
      created_at: "2026-05-17T00:00:00.000Z",
      source_files: ["src/agents/executor.ts"],
      source_hashes: { "src/agents/executor.ts": "hash" },
    };

    expect(frontmatter.lifecycle_issue).toBe(91);
    const status: CapsuleFreshnessStatus = "fresh";
    expect(status).toBe("fresh");
  });
});

describe("v2 frontmatter fields", () => {
  it("declares dispatch_kind enum", () => {
    expect(DISPATCH_KINDS).toEqual(["parallel-fanout", "single-subagent", "executor-direct"]);
    const kind: DispatchKind = "executor-direct";
    expect(kind).toBe("executor-direct");
  });

  it("declares generated_by enum", () => {
    expect(GENERATOR_AGENTS).toEqual(["brainstormer", "commander", "octto", "executor"]);
    const agent: GeneratorAgent = "commander";
    expect(agent).toBe("commander");
  });

  it("guards dispatch_kind values", () => {
    expect(isDispatchKind("executor-direct")).toBe(true);
    expect(isDispatchKind("unknown")).toBe(false);
  });

  it("guards generated_by values", () => {
    expect(isGeneratorAgent("commander")).toBe(true);
    expect(isGeneratorAgent("planner")).toBe(false);
  });

  it("allows v2 fields to be omitted in BuildInput (v1 callers unchanged)", () => {
    const input: ContextCapsuleBuildInput = {
      topic: "x",
      lifecycleIssue: 1,
      branch: "main",
      headSha: "deadbeef",
      worktree: "/tmp",
      sourceFiles: [],
      confirmedFacts: [],
    };
    expect(input.conversationAnchor).toBeUndefined();
    expect(input.generatedBy).toBeUndefined();
    expect(input.dispatchKind).toBeUndefined();
    expect(input.parentCapsuleSha).toBeUndefined();
  });

  it("allows v2 fields to be null in frontmatter (degraded v1 capsules)", () => {
    const frontmatter: ContextCapsuleFrontmatter = {
      lifecycle_issue: 1,
      branch: "main",
      head_sha: "deadbeef",
      worktree: "/tmp",
      created_at: "2026-05-17T00:00:00Z",
      source_files: [],
      source_hashes: {},
      conversation_anchor: null,
      generated_by: null,
      dispatch_kind: null,
      parent_capsule: null,
    };
    expect(frontmatter.conversation_anchor).toBeNull();
  });

  it("freshness input accepts expectedConversationAnchor", () => {
    const input: ContextCapsuleFreshnessInput = {
      expectedLifecycleIssue: null,
      expectedConversationAnchor: "anchor-abc",
      branch: "main",
      headSha: "x",
      worktree: "/tmp",
      sourceHashes: {},
      frontmatter: {
        lifecycle_issue: null,
        branch: "main",
        head_sha: "x",
        worktree: "/tmp",
        created_at: "2026-05-17T00:00:00Z",
        source_files: [],
        source_hashes: {},
        conversation_anchor: "anchor-abc",
        generated_by: "commander",
        dispatch_kind: "executor-direct",
        parent_capsule: null,
      },
    };
    expect(input.expectedConversationAnchor).toBe("anchor-abc");
  });
});
