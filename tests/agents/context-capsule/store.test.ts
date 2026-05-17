import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createCapsuleToken, hashText, renderCapsuleDocument } from "@/agents/context-capsule/format";
import { findLatestContextCapsule, parseContextCapsuleDocument } from "@/agents/context-capsule/store";
import type { ContextCapsuleFrontmatter } from "@/agents/context-capsule/types";

function frontmatter(overrides: Partial<ContextCapsuleFrontmatter> = {}): ContextCapsuleFrontmatter {
  return {
    lifecycle_issue: 91,
    branch: "issue-91-working-context-capsule",
    head_sha: "abc123",
    worktree: "/root/CODE/issue-91-working-context-capsule",
    created_at: "2026-05-17T00:00:00.000Z",
    source_files: ["src/agents/executor.ts"],
    source_hashes: { "src/agents/executor.ts": "executor-hash" },
    conversation_anchor: null,
    generated_by: null,
    dispatch_kind: null,
    parent_capsule: null,
    ...overrides,
  };
}

describe("context capsule store", () => {
  it("parses frontmatter with yaml and preserves the markdown body", () => {
    const document = renderCapsuleDocument(
      frontmatter({
        lifecycle_issue: null,
        branch: "feature: capsule",
        source_files: ["zeta.md", "alpha.md"],
        source_hashes: { "zeta.md": "z-hash", "alpha.md": "a-hash" },
      }),
      "## Capsule\n\n- Keep this body intact.\n",
    );

    const parsed = parseContextCapsuleDocument(document);

    expect(parsed.frontmatter).toEqual(
      frontmatter({
        lifecycle_issue: null,
        branch: "feature: capsule",
        source_files: ["alpha.md", "zeta.md"],
        source_hashes: { "alpha.md": "a-hash", "zeta.md": "z-hash" },
      }),
    );
    expect(parsed.body).toBe("## Capsule\n\n- Keep this body intact.\n");
  });

  it("returns null when the capsule directory is missing", async () => {
    const root = mkdtempSync(join(tmpdir(), "capsule-store-missing-"));
    try {
      await expect(findLatestContextCapsule(join(root, "thoughts/shared/context-capsules"))).resolves.toBeNull();
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });

  it("finds the latest capsule by created_at and returns path, content, sha, and token", async () => {
    const root = mkdtempSync(join(tmpdir(), "capsule-store-"));
    const directory = join(root, "thoughts/shared/context-capsules");
    mkdirSync(directory, { recursive: true });
    try {
      const olderFrontmatter = frontmatter({ created_at: "2026-05-17T00:00:00.000Z", head_sha: "older" });
      const newerFrontmatter = frontmatter({ created_at: "2026-05-17T00:05:00.000Z", head_sha: "newer" });
      const older = renderCapsuleDocument(olderFrontmatter, "Older capsule");
      const newer = renderCapsuleDocument(newerFrontmatter, "Newer capsule");

      writeFileSync(join(directory, "2026-05-17T000000Z-older.md"), older);
      writeFileSync(join(directory, "ignore.txt"), "not a capsule");
      const newestPath = join(directory, "2026-05-17T000500Z-newer.md");
      writeFileSync(newestPath, newer);

      const latest = await findLatestContextCapsule(directory);

      expect(latest).toEqual({
        path: newestPath,
        content: newer,
        sha: hashText(newer),
        token: createCapsuleToken(newerFrontmatter),
      });
    } finally {
      rmSync(root, { force: true, recursive: true });
    }
  });
});
