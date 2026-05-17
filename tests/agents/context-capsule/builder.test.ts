import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContextCapsule } from "@/agents/context-capsule/builder";
import { hashText } from "@/agents/context-capsule/format";

const tempDirs: string[] = [];

function makeTempDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "context-capsule-builder-"));
  tempDirs.push(dir);
  return dir;
}

afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { force: true, recursive: true });
});

describe("context capsule builder", () => {
  it("builds frontmatter, body, document, and immutable file artifact", () => {
    const worktree = makeTempDir();
    const outputDir = join(worktree, "capsules");
    const result = buildContextCapsule({
      topic: "Working Context Capsule / Subagent User Prompt Pro",
      lifecycleIssue: 91,
      branch: "issue-91-working-context-capsule",
      headSha: "abc123",
      worktree,
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
      outputDir,
      confirmedFacts: ["Batch 1 approved", "bun 1.3.13 available"],
      sourceFiles: [
        { path: "src/agents/executor.ts", content: "executor source" },
        { path: "src/agents/planner.ts", content: "planner source" },
      ],
    });

    expect(result.status).toBe("fresh");
    if (result.status !== "fresh") throw new Error("expected fresh capsule");

    expect(result.path).toStartWith(outputDir);
    expect(result.path).toEndWith(".md");
    expect(result.frontmatter).toEqual({
      lifecycle_issue: 91,
      conversation_anchor: null,
      generated_by: null,
      dispatch_kind: null,
      parent_capsule: null,
      branch: "issue-91-working-context-capsule",
      head_sha: "abc123",
      worktree,
      created_at: "2026-05-17T00:00:00.000Z",
      source_files: ["src/agents/executor.ts", "src/agents/planner.ts"],
      source_hashes: {
        "src/agents/executor.ts": hashText("executor source"),
        "src/agents/planner.ts": hashText("planner source"),
      },
    });
    expect(result.body).toContain("## Confirmed Facts");
    expect(result.body).toContain("- Batch 1 approved");
    expect(result.body).toContain("## Source Files");
    expect(result.body).toContain(`- \`src/agents/executor.ts\` — sha256: ${hashText("executor source")}`);
    expect(result.document).toContain("source_hashes:");
    expect(result.sha).toBe(hashText(result.document));
    expect(result.token).toHaveLength(16);
    expect(result.warnings).toEqual([]);
    expect(readFileSync(result.path, "utf8")).toBe(result.document);
  });

  it("uses the default shared context-capsules directory under the worktree", () => {
    const worktree = makeTempDir();
    const result = buildContextCapsule({
      topic: "Default Output",
      lifecycleIssue: null,
      branch: "main",
      headSha: "def456",
      worktree,
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
      confirmedFacts: [],
      sourceFiles: [],
    });

    expect(result.status).toBe("fresh");
    if (result.status !== "fresh") throw new Error("expected fresh capsule");
    expect(result.path).toStartWith(join(worktree, "thoughts", "shared", "context-capsules"));
  });

  it("blocks writes when capsule input contains secrets", () => {
    const worktree = makeTempDir();
    const outputDir = join(worktree, "capsules");
    const result = buildContextCapsule({
      topic: "Secret Input",
      lifecycleIssue: 91,
      branch: "issue-91-working-context-capsule",
      headSha: "abc123",
      worktree,
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
      outputDir,
      confirmedFacts: ["Authorization: Bearer abc123"],
      sourceFiles: [{ path: "src/agents/executor.ts", content: "executor source" }],
    });

    expect(result).toEqual({
      status: "blocked",
      reason: "secret_detected",
      detail: "confirmedFacts: authorization_header",
    });
    expect(readdirSync(worktree)).toEqual([]);
  });

  it("warns about soft window ratio without blocking the write", () => {
    const worktree = makeTempDir();
    const result = buildContextCapsule({
      topic: "Large Capsule",
      lifecycleIssue: 91,
      branch: "issue-91-working-context-capsule",
      headSha: "abc123",
      worktree,
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
      softWindowRatio: 1.25,
      confirmedFacts: ["Large but safe context"],
      sourceFiles: [{ path: "src/agents/executor.ts", content: "executor source" }],
    });

    expect(result.status).toBe("fresh");
    if (result.status !== "fresh") throw new Error("expected fresh capsule");
    expect(result.warnings).toEqual(["soft_window_ratio: 1.25"]);
    expect(readFileSync(result.path, "utf8")).toBe(result.document);
  });
});
