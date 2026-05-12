import { describe, expect, it } from "bun:test";
import { RECOVERY_SECTION_HEADER } from "@/lifecycle/recovery/hint-format";
import type { LifecycleCandidateSummary } from "@/lifecycle/resolver";
import { ARTIFACT_KINDS, LIFECYCLE_STATES, type LifecycleRecord } from "@/lifecycle/types";
import { createLifecycleCurrentTool } from "@/tools/lifecycle/current";

const mkRecord = (overrides: Partial<LifecycleRecord> = {}): LifecycleRecord => ({
  issueNumber: 67,
  issueUrl: "https://github.com/owner/repo/issues/67",
  branch: "issue/67-active",
  worktree: "/tmp/issue-67-active",
  state: LIFECYCLE_STATES.IN_PROGRESS,
  artifacts: {
    [ARTIFACT_KINDS.DESIGN]: [],
    [ARTIFACT_KINDS.PLAN]: [],
    [ARTIFACT_KINDS.LEDGER]: [],
    [ARTIFACT_KINDS.COMMIT]: [],
    [ARTIFACT_KINDS.PR]: [],
    [ARTIFACT_KINDS.WORKTREE]: [],
  },
  notes: [],
  updatedAt: 0,
  ...overrides,
});

const mkCandidate = (overrides: Partial<LifecycleCandidateSummary> = {}): LifecycleCandidateSummary => ({
  issueNumber: 67,
  branch: "issue/67-active",
  worktree: "/tmp/issue-67-active",
  state: LIFECYCLE_STATES.IN_PROGRESS,
  stale: false,
  staleReason: null,
  ...overrides,
});

const exec = async (resolver: { current: () => Promise<unknown> }): Promise<string> => {
  const tool = createLifecycleCurrentTool(resolver as Parameters<typeof createLifecycleCurrentTool>[0]);
  return (tool as { execute: (args: unknown, ctx: unknown) => Promise<string> }).execute({}, {});
};

describe("lifecycle_current recovery hint", () => {
  it("renders ambiguous candidate metadata and recommends stale cleanup when candidates are stale", async () => {
    const out = await exec({
      current: async () => ({
        kind: "ambiguous",
        candidates: [
          mkCandidate({
            issueNumber: 12,
            branch: "issue/12-old",
            worktree: null,
            stale: true,
            staleReason: "branch missing",
          }),
          mkCandidate({ issueNumber: 67, branch: "issue/67-active", worktree: "/tmp/issue-67-active" }),
        ],
      }),
    });

    expect(out).toContain("## Ambiguous active lifecycle");
    expect(out).toContain("| Issue # | Branch | Worktree | State | Stale | Reason |");
    expect(out).toContain("| 12 | `issue/12-old` | `-` | `in_progress` | `true` | branch missing |");
    expect(out).toContain("| 67 | `issue/67-active` | `/tmp/issue-67-active` | `in_progress` | `false` | - |");
    expect(out).toContain(RECOVERY_SECTION_HEADER);
    expect(out).toContain("**failure_kind:** `ambiguous_lifecycle`");
    expect(out).toContain("**recommended_next_action:** `clean_stale_records`");
  });

  it("recommends asking the user when ambiguous candidates are all fresh", async () => {
    const out = await exec({
      current: async () => ({
        kind: "ambiguous",
        candidates: [mkCandidate({ issueNumber: 67 }), mkCandidate({ issueNumber: 68, branch: "issue/68-other" })],
      }),
    });

    expect(out).toContain(RECOVERY_SECTION_HEADER);
    expect(out).toContain("**recommended_next_action:** `ask_user`");
    expect(out).not.toContain("**recommended_next_action:** `clean_stale_records`");
  });

  it("omits recovery hints for resolved and none results", async () => {
    const resolved = await exec({ current: async () => ({ kind: "resolved", record: mkRecord() }) });
    const none = await exec({ current: async () => ({ kind: "none" }) });

    expect(resolved).toContain("## Active lifecycle");
    expect(resolved).not.toContain(RECOVERY_SECTION_HEADER);
    expect(none).toContain("## No active lifecycle");
    expect(none).not.toContain(RECOVERY_SECTION_HEADER);
  });
});
