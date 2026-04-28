import { describe, expect, it } from "bun:test";

import { PROGRESS_KINDS, type ProgressOutcome } from "@/lifecycle/progress";
import { createLifecycleLogProgressTool } from "@/tools/lifecycle/log-progress";

interface ToolArgs {
  readonly kind: string;
  readonly summary: string;
  readonly details?: string;
  readonly issue_number?: number;
}

const exec = async (
  fakeLog: (input: {
    kind: string;
    summary: string;
    details?: string;
    issueNumber?: number;
  }) => Promise<ProgressOutcome>,
  args: ToolArgs,
): Promise<string> => {
  const tool = createLifecycleLogProgressTool({ log: fakeLog });
  const out = await (tool as { execute: (args: unknown, ctx: unknown) => Promise<string> }).execute(args, {});
  return out;
};

describe("lifecycle_log_progress tool", () => {
  it("renders success markdown with issue and kind", async () => {
    const out = await exec(async () => ({ issueNumber: 6, kind: PROGRESS_KINDS.STATUS, commentUrl: "https://x/y/1" }), {
      kind: "status",
      summary: "ok",
    });
    expect(out).toContain("## Progress logged");
    expect(out).toContain("issue=#6");
    expect(out).toContain("kind=status");
    expect(out).toContain("https://x/y/1");
  });

  it("rejects unknown kinds with failure markdown", async () => {
    const out = await exec(async () => ({ issueNumber: 0, kind: PROGRESS_KINDS.STATUS, commentUrl: null }), {
      kind: "nonsense",
      summary: "x",
    });
    expect(out).toContain("## lifecycle_log_progress failed");
    expect(out).toContain("invalid kind: nonsense");
  });

  it("renders failure markdown when log throws", async () => {
    const out = await exec(
      async () => {
        throw new Error("boom");
      },
      { kind: "status", summary: "x" },
    );
    expect(out).toContain("## lifecycle_log_progress failed");
    expect(out).toContain("boom");
  });
});
