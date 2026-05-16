import { describe, expect, it } from "bun:test";
import {
  CAPSULE_STATUSES,
  type CapsuleFreshnessStatus,
  type ContextCapsuleFrontmatter,
  isCapsuleStatus,
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
