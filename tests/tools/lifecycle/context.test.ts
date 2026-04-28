import { describe, expect, it } from "bun:test";

import { type ContextSnapshot, PROGRESS_KINDS } from "@/lifecycle/progress";
import { createLifecycleContextTool } from "@/tools/lifecycle/context";

const exec = async (
  fakeContext: (input?: { issueNumber?: number }) => Promise<ContextSnapshot>,
  args: { issue_number?: number } = {},
): Promise<string> => {
  const tool = createLifecycleContextTool({ context: fakeContext });
  const out = await (tool as { execute: (args: unknown, ctx: unknown) => Promise<string> }).execute(args, {});
  return out;
};

describe("lifecycle_context tool", () => {
  it("renders body and recent progress entries", async () => {
    const snapshot: ContextSnapshot = {
      issueNumber: 6,
      body: "issue body content",
      recentProgress: [
        {
          kind: PROGRESS_KINDS.STATUS,
          summary: "did x",
          createdAt: "2026-01-01",
          url: "https://x/y/1",
        },
      ],
    };
    const out = await exec(async () => snapshot);

    expect(out).toContain("## Lifecycle context (issue #6)");
    expect(out).toContain("issue body content");
    expect(out).toContain("**status**");
    expect(out).toContain("did x");
    expect(out).toContain("https://x/y/1");
  });

  it("renders empty progress placeholder when no entries", async () => {
    const out = await exec(async () => ({
      issueNumber: 6,
      body: "b",
      recentProgress: [],
    }));
    expect(out).toContain("_no progress entries yet_");
  });

  it("renders failure markdown when context throws", async () => {
    const out = await exec(async () => {
      throw new Error("bad");
    });
    expect(out).toContain("## lifecycle_context failed");
    expect(out).toContain("bad");
  });
});
