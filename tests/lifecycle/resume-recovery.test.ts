import { describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, rmSync } from "node:fs";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";

import { createResolver, StaleRecordError } from "@/lifecycle/resolver";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import type { LifecycleStore } from "@/lifecycle/store";
import { ARTIFACT_KINDS, LIFECYCLE_STATES, type LifecycleRecord } from "@/lifecycle/types";
import { createLifecycleResumeTool, type ResolverResumeHandle } from "@/tools/lifecycle/resume";

const ISSUE_NUMBER = 67;
const TOOL_CONTEXT = {} as unknown as ToolContext;

const ok = (s = ""): RunResult => ({ stdout: s, stderr: "", exitCode: 0 });

const record = (branch = "issue/67-recovered"): LifecycleRecord => ({
  issueNumber: ISSUE_NUMBER,
  issueUrl: `https://github.com/Wuxie233/micode/issues/${ISSUE_NUMBER}`,
  branch,
  worktree: "/tmp/issue-67",
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
});

const stringify = (outcome: ToolResult): string => {
  if (typeof outcome === "string") return outcome;
  return outcome.output;
};

const fakeStore = (records: readonly LifecycleRecord[], open: readonly number[]): LifecycleStore => {
  const map = new Map(records.map((r) => [r.issueNumber, r]));
  return {
    async save(r) {
      map.set(r.issueNumber, r);
    },
    async load(n) {
      return map.get(n) ?? null;
    },
    async delete(n) {
      map.delete(n);
    },
    async list() {
      return [...map.keys()].sort((a, b) => a - b);
    },
    async listOpen() {
      return [...open];
    },
  };
};

type ExecuteSignature = (raw: unknown, ctx: ToolContext) => Promise<ToolResult>;

const callExecute = async (resolver: ResolverResumeHandle, args: unknown): Promise<string> => {
  const toolDef = createLifecycleResumeTool(resolver);
  const exec = toolDef.execute.bind(toolDef) as unknown as ExecuteSignature;
  return stringify(await exec(args, TOOL_CONTEXT));
};

describe("lifecycle_resume recovery", () => {
  it("uses forceRefresh when force_refresh is true", async () => {
    const calls: string[] = [];
    const resolver: ResolverResumeHandle = {
      resume: async () => {
        calls.push("resume");
        return record("issue/67-resume");
      },
      forceRefresh: async () => {
        calls.push("forceRefresh");
        return record("issue/67-force-refresh");
      },
    };

    const output = await callExecute(resolver, { issue_number: ISSUE_NUMBER, force_refresh: true });

    expect(calls).toEqual(["forceRefresh"]);
    expect(output).toContain("## Lifecycle resumed");
    expect(output).toContain("issue/67-force-refresh");
  });

  it("uses resume by default", async () => {
    const calls: string[] = [];
    const resolver: ResolverResumeHandle = {
      resume: async () => {
        calls.push("resume");
        return record("issue/67-resume");
      },
      forceRefresh: async () => {
        calls.push("forceRefresh");
        return record("issue/67-force-refresh");
      },
    };

    const output = await callExecute(resolver, { issue_number: ISSUE_NUMBER });

    expect(calls).toEqual(["resume"]);
    expect(output).toContain("issue/67-resume");
  });

  it("renders stale record recovery hint with candidate summary", async () => {
    const resolver: ResolverResumeHandle = {
      resume: async () => {
        throw new StaleRecordError({
          issueNumber: ISSUE_NUMBER,
          branch: "issue/67-stale",
          worktree: "/tmp/stale-67",
          state: LIFECYCLE_STATES.BRANCH_READY,
          stale: true,
          staleReason: "branch_merged_into_base",
        });
      },
      forceRefresh: async () => record(),
    };

    const output = await callExecute(resolver, { issue_number: ISSUE_NUMBER });

    expect(output.startsWith("## lifecycle_resume failed")).toBe(true);
    expect(output).toContain("### Recovery hint");
    expect(output).toContain("**failure_kind:** `stale_record`");
    expect(output).toContain("**recommended_next_action:** `clean_stale_records`");
    expect(output).toContain("**summary:** branch_merged_into_base");
    expect(output).toContain("**candidates:**");
    expect(output).toContain(
      "| 67 | `issue/67-stale` | `/tmp/stale-67` | `branch_ready` | `true` | branch_merged_into_base |",
    );
  });

  it("retains generic failure output for non-stale errors", async () => {
    const resolver: ResolverResumeHandle = {
      resume: async () => {
        throw new Error("issue_not_found: #67");
      },
      forceRefresh: async () => record(),
    };

    const output = await callExecute(resolver, { issue_number: ISSUE_NUMBER });

    expect(output).toBe("## lifecycle_resume failed\n\nissue_not_found: #67");
  });

  it("force-refreshes issue identity from a validated worktree artifact instead of main cwd", async () => {
    const issueNumber = 96;
    const mainCwd = "/root/CODE/micode";
    const artifactWorktree = "/root/CODE/issue-96-x";
    const createdArtifactWorktree = !existsSync(artifactWorktree);
    if (createdArtifactWorktree) mkdirSync(artifactWorktree, { recursive: true });

    try {
      const body = [
        "<!-- micode:lifecycle:state:begin -->",
        `state: ${LIFECYCLE_STATES.IN_PROGRESS}`,
        "<!-- micode:lifecycle:state:end -->",
        "<!-- micode:lifecycle:artifacts:begin -->",
        "| Kind | Pointer |",
        "| --- | --- |",
        `| ${ARTIFACT_KINDS.WORKTREE} | ${artifactWorktree} |`,
        "<!-- micode:lifecycle:artifacts:end -->",
      ].join("\n");
      const runner: LifecycleRunner = {
        git: async (args, opts) => {
          const k = args.join(" ");
          if (k === "rev-parse --abbrev-ref HEAD" && opts?.cwd === artifactWorktree) return ok("issue/96-x");
          if (k === "rev-parse --abbrev-ref HEAD") return ok("main");
          if (k === "rev-parse --show-toplevel") return ok(mainCwd);
          if (k === "worktree list --porcelain") return ok(`worktree ${mainCwd}\nworktree ${artifactWorktree}\n`);
          return ok();
        },
        gh: async () => ok(JSON.stringify({ body })),
      };
      const corruptedLocalRecord: LifecycleRecord = {
        ...record("main"),
        issueNumber,
        issueUrl: `https://github.com/Wuxie233/micode/issues/${issueNumber}`,
        worktree: mainCwd,
        state: LIFECYCLE_STATES.BRANCH_READY,
      };
      const resolver = createResolver({
        runner,
        store: fakeStore([corruptedLocalRecord], [issueNumber]),
        cwd: mainCwd,
      });

      const output = await callExecute(resolver, { issue_number: issueNumber, force_refresh: true });

      expect(output).toContain("## Lifecycle resumed");
      expect(output).toContain("issue/96-x");
      expect(output).toContain(artifactWorktree);
      expect(output).not.toContain("`main`");
      expect(output).not.toContain(mainCwd);
    } finally {
      if (createdArtifactWorktree) rmSync(artifactWorktree, { recursive: true, force: true });
    }
  });
});
