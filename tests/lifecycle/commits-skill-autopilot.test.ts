import { describe, expect, it, spyOn } from "bun:test";

import { type CommitAndPushInput, commitAndPush } from "@/lifecycle/commits";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const CWD = "/tmp/micode";
const ISSUE_NUMBER = 27;
const BRANCH = "issue/27-skill-autopilot";
const SHA = "abc123def456";
const EMPTY_OUTPUT = "";
const OK_EXIT_CODE = 0;
const HOOK_FAILURE = "autopilot failed";
const STAGE_EVENT = `git:add:${CWD}`;
const COMMIT_EVENT = `git:commit:${CWD}`;
const SHA_EVENT = `git:rev-parse:${CWD}`;
const HOOK_EVENT = `hook:${CWD}:${ISSUE_NUMBER}`;
const WARN_MODULE = "[lifecycle.commits]";

const createRun = (stdout = EMPTY_OUTPUT): RunResult => ({
  stdout,
  stderr: EMPTY_OUTPUT,
  exitCode: OK_EXIT_CODE,
});

const createInput = (preStageHook: CommitAndPushInput["preStageHook"]): CommitAndPushInput => ({
  cwd: CWD,
  issueNumber: ISSUE_NUMBER,
  branch: BRANCH,
  type: "feat",
  scope: "lifecycle",
  summary: "run skill autopilot hook",
  push: false,
  preStageHook,
});

const createRunner = (events: string[]): LifecycleRunner => ({
  git: async (args, options) => {
    events.push(`git:${args[0]}:${options?.cwd ?? ""}`);
    if (args[0] === "rev-parse") return createRun(`${SHA}\n`);
    return createRun();
  },
  gh: async () => createRun(),
});

describe("commitAndPush preStageHook", () => {
  it("invokes preStageHook before staging when supplied", async () => {
    const events: string[] = [];
    const runner = createRunner(events);

    const outcome = await commitAndPush(
      runner,
      createInput(async (cwd, issueNumber) => {
        events.push(`hook:${cwd}:${issueNumber}`);
      }),
    );

    expect(outcome).toEqual({ committed: true, sha: SHA, pushed: false, retried: false, note: null });
    expect(events).toEqual([HOOK_EVENT, STAGE_EVENT, COMMIT_EVENT, SHA_EVENT]);
  });

  it("swallows preStageHook errors and continues to stage", async () => {
    const events: string[] = [];
    const runner = createRunner(events);
    const warn = spyOn(console, "warn").mockImplementation(() => undefined);

    try {
      const outcome = await commitAndPush(
        runner,
        createInput(async () => {
          throw new Error(HOOK_FAILURE);
        }),
      );

      expect(outcome.committed).toBe(true);
      expect(events).toEqual([STAGE_EVENT, COMMIT_EVENT, SHA_EVENT]);
      expect(warn).toHaveBeenCalledWith(`${WARN_MODULE} preStageHook failed: ${HOOK_FAILURE}`);
    } finally {
      warn.mockRestore();
    }
  });
});
