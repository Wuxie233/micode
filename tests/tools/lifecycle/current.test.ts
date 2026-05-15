import { describe, expect, it } from "bun:test";

import { ARTIFACT_KINDS, LIFECYCLE_MODES, LIFECYCLE_STATES, type LifecycleRecord } from "@/lifecycle/types";
import { createLifecycleCurrentTool } from "@/tools/lifecycle/current";

const mkRecord = (overrides: Partial<LifecycleRecord> = {}): LifecycleRecord => ({
  issueNumber: 6,
  issueUrl: "https://github.com/owner/repo/issues/6",
  mode: LIFECYCLE_MODES.REMOTE,
  localId: null,
  repoRoot: "/repo",
  remoteCapable: true,
  branch: "issue/6-redesign",
  worktree: "/tmp/wt",
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

const exec = async (resolver: { current: () => Promise<unknown> }): Promise<string> => {
  const tool = createLifecycleCurrentTool(resolver as Parameters<typeof createLifecycleCurrentTool>[0]);
  const out = await (tool as { execute: (args: unknown, ctx: unknown) => Promise<string> }).execute({}, {});
  return out;
};

describe("lifecycle_current tool", () => {
  it("renders resolved markdown with the issue row", async () => {
    const out = await exec({
      current: async () => ({ kind: "resolved", record: mkRecord() }),
    });
    expect(out).toContain("## Active lifecycle");
    expect(out).toContain("| Issue / Local ID | Mode | Branch | Worktree | State |");
    expect(out).toContain("| 6 | `remote` |");
  });

  it("renders resolved local-only markdown with the local identity", async () => {
    const out = await exec({
      current: async () => ({
        kind: "resolved",
        record: mkRecord({
          issueNumber: -202605160001,
          issueUrl: "",
          mode: LIFECYCLE_MODES.LOCAL_ONLY,
          localId: "local-20260516-0001",
          remoteCapable: false,
          branch: "local/local-20260516-0001",
        }),
      }),
    });
    expect(out).toContain("## Active lifecycle");
    expect(out).toContain("| local-20260516-0001 | `local-only` | `local/local-20260516-0001` |");
    expect(out).not.toContain("| -202605160001 |");
  });

  it("renders none when nothing is active", async () => {
    const out = await exec({ current: async () => ({ kind: "none" }) });
    expect(out).toContain("## No active lifecycle");
  });

  it("renders ambiguous with candidates", async () => {
    const out = await exec({
      current: async () => ({
        kind: "ambiguous",
        candidates: [
          {
            issueNumber: 3,
            branch: "issue/3-old",
            worktree: null,
            state: "in_progress",
            stale: true,
            staleReason: "branch missing",
          },
          {
            issueNumber: 9,
            branch: "issue/9-active",
            worktree: "/tmp/issue-9-active",
            state: "branch_ready",
            stale: false,
            staleReason: null,
          },
        ],
      }),
    });
    expect(out).toContain("## Ambiguous");
    expect(out).toContain("| Issue / Local ID | Mode | Branch | Worktree | State | Stale | Reason |");
    expect(out).toContain("| 3 | `remote` | `issue/3-old` | `-` | `in_progress` | `true` | branch missing |");
    expect(out).toContain("| 9 | `remote` | `issue/9-active` | `/tmp/issue-9-active` | `branch_ready` | `false` | - |");
  });

  it("renders ambiguous local-only and remote candidates without issue-only guidance", async () => {
    const out = await exec({
      current: async () => ({
        kind: "ambiguous",
        candidates: [
          {
            issueNumber: -202605160002,
            mode: LIFECYCLE_MODES.LOCAL_ONLY,
            localId: "local-20260516-0002",
            branch: "local/local-20260516-0002",
            worktree: "/tmp/local-20260516-0002",
            state: "in_progress",
            stale: false,
            staleReason: null,
          },
          {
            issueNumber: 9,
            mode: LIFECYCLE_MODES.REMOTE,
            localId: null,
            branch: "issue/9-active",
            worktree: "/tmp/issue-9-active",
            state: "branch_ready",
            stale: false,
            staleReason: null,
          },
        ],
      }),
    });
    expect(out).toContain(
      "| local-20260516-0002 | `local-only` | `local/local-20260516-0002` | `/tmp/local-20260516-0002` | `in_progress` | `false` | - |",
    );
    expect(out).toContain("| 9 | `remote` | `issue/9-active` | `/tmp/issue-9-active` | `branch_ready` | `false` | - |");
    expect(out).toContain("Select the matching issue_number or local_id explicitly");
    expect(out).not.toContain("run lifecycle_resume first");
  });

  it("renders failure header when resolver throws", async () => {
    const out = await exec({
      current: async () => {
        throw new Error("boom");
      },
    });
    expect(out).toContain("## lifecycle_current failed");
    expect(out).toContain("boom");
  });
});
