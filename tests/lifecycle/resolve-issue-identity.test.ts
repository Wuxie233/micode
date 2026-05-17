import { describe, expect, it } from "bun:test";
import { resolveIssueIdentity } from "@/lifecycle/recovery/resolve-issue-identity";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import { ARTIFACT_KINDS, LIFECYCLE_STATES, type LifecycleRecord } from "@/lifecycle/types";

const ok = (s = ""): RunResult => ({ stdout: s, stderr: "", exitCode: 0 });
const fail = (e = ""): RunResult => ({ stdout: "", stderr: e, exitCode: 1 });

const mkRecord = (n: number, overrides: Partial<LifecycleRecord> = {}): LifecycleRecord => ({
  issueNumber: n,
  issueUrl: `https://github.com/o/r/issues/${n}`,
  branch: `issue/${n}-x`,
  worktree: `/wt/${n}`,
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

const noopGh: LifecycleRunner["gh"] = async () => ok("");

const gitFromMain: LifecycleRunner["git"] = async (args) => {
  const k = args.join(" ");
  if (k === "rev-parse --abbrev-ref HEAD") return ok("main");
  if (k === "rev-parse --show-toplevel") return ok("/root/CODE/micode");
  if (k === "worktree list --porcelain") return ok("worktree /root/CODE/micode\nworktree /root/CODE/issue-98-x\n");
  return ok("");
};

describe("resolveIssueIdentity source priority", () => {
  it("explicit input always wins over every other source", async () => {
    const id = await resolveIssueIdentity({
      runner: { git: gitFromMain, gh: noopGh },
      cwd: "/root/CODE/micode",
      issueNumberHint: 98,
      localRecord: mkRecord(98, { branch: "issue/99-other", worktree: "/wt/99-other" }),
      explicit: { branch: "issue/98-x", worktree: "/root/CODE/issue-98-x" },
    });
    expect(id.source).toBe("explicit");
    expect(id.branch).toBe("issue/98-x");
    expect(id.worktree).toBe("/root/CODE/issue-98-x");
    expect(id.issueNumber).toBe(98);
  });

  it("local high-confidence record beats issue-body artifact and git worktree", async () => {
    const id = await resolveIssueIdentity({
      runner: { git: gitFromMain, gh: noopGh },
      cwd: "/root/CODE/micode",
      issueNumberHint: 98,
      localRecord: mkRecord(98, {
        branch: "issue/98-real",
        worktree: "/root/CODE/issue-98-real",
        artifacts: {
          ...mkRecord(98).artifacts,
          [ARTIFACT_KINDS.WORKTREE]: ["/root/CODE/issue-98-x"],
        },
      }),
      explicit: null,
    });
    expect(id.source).toBe("local-record");
    expect(id.branch).toBe("issue/98-real");
    expect(id.worktree).toBe("/root/CODE/issue-98-real");
  });

  it("a record with branch=main / worktree=base is NOT high-confidence; falls through to artifact", async () => {
    const id = await resolveIssueIdentity({
      runner: { git: gitFromMain, gh: noopGh },
      cwd: "/root/CODE/micode",
      issueNumberHint: 98,
      localRecord: mkRecord(98, { branch: "main", worktree: "/root/CODE/micode" }),
      issueBodyArtifacts: { worktree: ["/root/CODE/issue-98-x"] },
      explicit: null,
      fsExists: () => true,
    });
    expect(id.source).toBe("issue-body-artifact");
    expect(id.worktree).toBe("/root/CODE/issue-98-x");
    expect(id.branch).toBe("issue/98-x");
  });

  it("uses git worktree/ref when local record absent and no usable artifact", async () => {
    const gitMatched: LifecycleRunner["git"] = async (args) => {
      const k = args.join(" ");
      if (k === "rev-parse --abbrev-ref HEAD") return ok("issue/98-x");
      if (k === "rev-parse --show-toplevel") return ok("/root/CODE/issue-98-x");
      return ok("");
    };
    const id = await resolveIssueIdentity({
      runner: { git: gitMatched, gh: noopGh },
      cwd: "/root/CODE/issue-98-x",
      issueNumberHint: 98,
      localRecord: null,
      explicit: null,
    });
    expect(id.source).toBe("git-worktree");
    expect(id.branch).toBe("issue/98-x");
    expect(id.worktree).toBe("/root/CODE/issue-98-x");
  });

  it("falls back to cwd only when every higher source is absent or inconclusive", async () => {
    const id = await resolveIssueIdentity({
      runner: { git: gitFromMain, gh: noopGh },
      cwd: "/root/CODE/micode",
      issueNumberHint: 98,
      localRecord: null,
      explicit: null,
    });
    expect(id.source).toBe("cwd-fallback");
    expect(id.branch).toBe("main");
    expect(id.worktree).toBe("/root/CODE/micode");
  });

  it("multiple valid issue-body worktree artifacts are ambiguous and never auto-picked", async () => {
    const gitWithTwoRegisteredArtifacts: LifecycleRunner["git"] = async (args, opts) => {
      const k = args.join(" ");
      if (k === "rev-parse --abbrev-ref HEAD" && opts?.cwd === "/root/CODE/issue-98-x") return ok("issue/98-x");
      if (k === "rev-parse --abbrev-ref HEAD" && opts?.cwd === "/root/CODE/issue-98-alt") return ok("issue/98-alt");
      if (k === "rev-parse --abbrev-ref HEAD") return ok("main");
      if (k === "rev-parse --show-toplevel") return ok("/root/CODE/micode");
      if (k === "worktree list --porcelain") {
        return ok("worktree /root/CODE/micode\nworktree /root/CODE/issue-98-x\nworktree /root/CODE/issue-98-alt\n");
      }
      return ok("");
    };
    const id = await resolveIssueIdentity({
      runner: { git: gitWithTwoRegisteredArtifacts, gh: noopGh },
      cwd: "/root/CODE/micode",
      issueNumberHint: 98,
      localRecord: null,
      issueBodyArtifacts: {
        worktree: ["/root/CODE/issue-98-x", "/root/CODE/issue-98-alt"],
      },
      explicit: null,
      fsExists: () => true,
    });
    expect(id.source).not.toBe("issue-body-artifact");
    expect(id.ambiguous).toBe(true);
    expect(id.ambiguityReason).toContain("multiple_worktree_artifacts");
  });

  it("ignores stale issue-body artifacts before deciding ambiguity and accepts one remaining valid artifact", async () => {
    const gitWithOneRegisteredArtifact: LifecycleRunner["git"] = async (args, opts) => {
      const k = args.join(" ");
      if (k === "rev-parse --abbrev-ref HEAD" && opts?.cwd === "/root/CODE/issue-98-x") return ok("issue/98-x");
      if (k === "rev-parse --abbrev-ref HEAD") return ok("main");
      if (k === "rev-parse --show-toplevel") return ok("/root/CODE/micode");
      if (k === "worktree list --porcelain") return ok("worktree /root/CODE/micode\nworktree /root/CODE/issue-98-x\n");
      return ok("");
    };
    const id = await resolveIssueIdentity({
      runner: { git: gitWithOneRegisteredArtifact, gh: noopGh },
      cwd: "/root/CODE/micode",
      issueNumberHint: 98,
      localRecord: null,
      issueBodyArtifacts: {
        worktree: ["/root/CODE/issue-98-x", "/root/CODE/stale-issue-98-alt"],
      },
      explicit: null,
      fsExists: (p) => p === "/root/CODE/issue-98-x",
    });
    expect(id.source).toBe("issue-body-artifact");
    expect(id.ambiguous).toBe(false);
    expect(id.branch).toBe("issue/98-x");
    expect(id.worktree).toBe("/root/CODE/issue-98-x");
  });

  it("rejects high-confidence local record when branch issue number does not match the hint", async () => {
    const id = await resolveIssueIdentity({
      runner: { git: gitFromMain, gh: noopGh },
      cwd: "/root/CODE/micode",
      issueNumberHint: 98,
      localRecord: mkRecord(99, { branch: "issue/99-other", worktree: "/root/CODE/issue-99-other" }),
      explicit: null,
    });
    expect(id.source).not.toBe("local-record");
    expect(id.issueNumber).toBe(98);
  });

  it("rejects issue-body artifact when derived branch issue number does not match the hint", async () => {
    const gitWithMismatchedArtifact: LifecycleRunner["git"] = async (args, opts) => {
      const k = args.join(" ");
      if (k === "rev-parse --abbrev-ref HEAD" && opts?.cwd === "/root/CODE/issue-99-other") return ok("issue/99-other");
      if (k === "rev-parse --abbrev-ref HEAD") return ok("main");
      if (k === "rev-parse --show-toplevel") return ok("/root/CODE/micode");
      if (k === "worktree list --porcelain")
        return ok("worktree /root/CODE/micode\nworktree /root/CODE/issue-99-other\n");
      return ok("");
    };
    const id = await resolveIssueIdentity({
      runner: { git: gitWithMismatchedArtifact, gh: noopGh },
      cwd: "/root/CODE/micode",
      issueNumberHint: 98,
      localRecord: null,
      issueBodyArtifacts: { worktree: ["/root/CODE/issue-99-other"] },
      explicit: null,
      fsExists: () => true,
    });
    expect(id.source).not.toBe("issue-body-artifact");
    expect(id.branch).toBe("main");
  });

  it("rejects git worktree branch when issue number does not match the hint", async () => {
    const gitMismatched: LifecycleRunner["git"] = async (args) => {
      const k = args.join(" ");
      if (k === "rev-parse --abbrev-ref HEAD") return ok("issue/99-other");
      if (k === "rev-parse --show-toplevel") return ok("/root/CODE/issue-99-other");
      return ok("");
    };
    const id = await resolveIssueIdentity({
      runner: { git: gitMismatched, gh: noopGh },
      cwd: "/root/CODE/issue-99-other",
      issueNumberHint: 98,
      localRecord: null,
      explicit: null,
    });
    expect(id.source).toBe("cwd-fallback");
    expect(id.branch).toBe("issue/99-other");
  });

  it("issue-body worktree artifact that does not exist on disk is ignored, never used", async () => {
    const id = await resolveIssueIdentity({
      runner: { git: gitFromMain, gh: noopGh },
      cwd: "/root/CODE/micode",
      issueNumberHint: 98,
      localRecord: null,
      issueBodyArtifacts: { worktree: ["/root/CODE/does-not-exist"] },
      explicit: null,
      fsExists: () => false,
    });
    expect(id.source).not.toBe("issue-body-artifact");
  });

  it("returns the resolved identity in a stable shape with branch + worktree + issueNumber + source", async () => {
    const id = await resolveIssueIdentity({
      runner: { git: gitFromMain, gh: noopGh },
      cwd: "/root/CODE/micode",
      issueNumberHint: 98,
      localRecord: mkRecord(98),
      explicit: null,
    });
    expect(typeof id.branch).toBe("string");
    expect(typeof id.worktree).toBe("string");
    expect(id.issueNumber).toBe(98);
    expect(typeof id.source).toBe("string");
  });
});
