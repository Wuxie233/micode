import { describe, expect, it } from "bun:test";
import {
  createCapsuleToken,
  hashText,
  renderCapsuleDocument,
  slugifyCapsuleTopic,
} from "@/agents/context-capsule/format";
import type { ContextCapsuleFrontmatter } from "@/agents/context-capsule/types";

function frontmatter(overrides: Partial<ContextCapsuleFrontmatter> = {}): ContextCapsuleFrontmatter {
  return {
    lifecycle_issue: 91,
    branch: "issue-91-working-context-capsule",
    head_sha: "abc123",
    worktree: "/root/CODE/issue-91-working-context-capsule",
    created_at: "2026-05-17T00:00:00.000Z",
    source_files: ["src/agents/executor.ts", "src/agents/planner.ts"],
    source_hashes: {
      "src/agents/executor.ts": "executor-hash",
      "src/agents/planner.ts": "planner-hash",
    },
    ...overrides,
  };
}

describe("context capsule formatting", () => {
  it("hashes text with sha256", () => {
    expect(hashText("context capsule")).toBe("2a0cc1dc1abe60fe526081192f8e2f7b1fad29dc66748f83eb2a197e4608c771");
  });

  it("slugifies topics with a stable fallback", () => {
    expect(slugifyCapsuleTopic("Working Context Capsule / Subagent User Prompt Pro")).toBe(
      "working-context-capsule-subagent-user-prompt-pro",
    );
    expect(slugifyCapsuleTopic("!!!")).toBe("context-capsule");
    expect(slugifyCapsuleTopic("a".repeat(100))).toBe("a".repeat(80));
  });

  it("renders deterministic frontmatter with sorted arrays and records", () => {
    const document = renderCapsuleDocument(
      frontmatter({
        branch: 'feature: "capsule"',
        lifecycle_issue: null,
        source_files: ["zeta.md", "alpha.md"],
        source_hashes: { "zeta.md": "z-hash", "alpha.md": "a-hash" },
      }),
      "Body line\n",
    );

    expect(document).toBe(`---
lifecycle_issue: null
branch: "feature: \\"capsule\\""
head_sha: "abc123"
worktree: "/root/CODE/issue-91-working-context-capsule"
created_at: "2026-05-17T00:00:00.000Z"
source_files:
  - "alpha.md"
  - "zeta.md"
source_hashes:
  "alpha.md": "a-hash"
  "zeta.md": "z-hash"
---

Body line
`);
  });

  it("renders empty collections inline", () => {
    const document = renderCapsuleDocument(frontmatter({ source_files: [], source_hashes: {} }), "Body");

    expect(document).toContain("source_files:[]");
    expect(document).toContain("source_hashes:{}");
  });

  it("creates a stable token independent of source hash order", () => {
    const left = frontmatter({ source_hashes: { "b.ts": "b", "a.ts": "a" } });
    const right = frontmatter({ source_hashes: { "a.ts": "a", "b.ts": "b" } });

    expect(createCapsuleToken(left)).toBe(createCapsuleToken(right));
    expect(createCapsuleToken(left)).toHaveLength(16);
  });

  it("changes the token when identity fields change", () => {
    expect(createCapsuleToken(frontmatter({ head_sha: "abc123" }))).not.toBe(
      createCapsuleToken(frontmatter({ head_sha: "def456" })),
    );
  });
});
