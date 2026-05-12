import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";

import { commitAndPush } from "@/lifecycle/commits";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK = (s = ""): RunResult => ({ stdout: s, stderr: "", exitCode: 0 });
const FAIL = (e = "boom"): RunResult => ({ stdout: "", stderr: e, exitCode: 1 });

const runner = (handler: (args: readonly string[]) => RunResult): LifecycleRunner => ({
  git: async (args) => handler(args),
  gh: async () => OK(),
});

describe("commitAndPush recovery hints", () => {
  let sleep: ReturnType<typeof spyOn>;

  beforeEach(() => {
    sleep = spyOn(Bun, "sleep").mockResolvedValue(undefined);
  });

  afterEach(() => {
    sleep.mockRestore();
  });

  it("push_failed after retry attaches push_failed hint with safeToRetry=true", async () => {
    let pushAttempts = 0;
    const r = runner((args) => {
      const k = args.join(" ");
      if (k === "add --all") return OK();
      if (k.startsWith("commit -m")) return OK();
      if (k === "rev-parse HEAD") return OK("abc123\n");
      if (k.startsWith("push")) {
        pushAttempts += 1;
        return FAIL("network");
      }
      if (k.startsWith("diff-tree")) return OK();
      return OK();
    });
    const outcome = await commitAndPush(r, {
      cwd: "/r",
      issueNumber: 67,
      branch: "issue/67-x",
      type: "feat",
      scope: "lifecycle",
      summary: "x",
      push: true,
    });
    expect(outcome.committed).toBe(true);
    expect(outcome.pushed).toBe(false);
    expect(pushAttempts).toBe(2);
    expect(outcome.recoveryHint?.failureKind).toBe("push_failed");
    expect(outcome.recoveryHint?.safeToRetry).toBe(true);
    expect(outcome.recoveryHint?.issueNumber).toBe(67);
  });

  it("stage failure attaches unknown hint with safeToRetry=false", async () => {
    const r = runner((args) => {
      if (args[0] === "add") return FAIL("perm denied");
      return OK();
    });
    const outcome = await commitAndPush(r, {
      cwd: "/r",
      issueNumber: 67,
      branch: "issue/67-x",
      type: "feat",
      scope: "lifecycle",
      summary: "x",
      push: true,
    });
    expect(outcome.committed).toBe(false);
    expect(outcome.recoveryHint?.failureKind).toBe("unknown");
    expect(outcome.recoveryHint?.safeToRetry).toBe(false);
    expect(outcome.recoveryHint?.recommendedNextAction).toBe("ask_user");
  });

  it("commit failure attaches unknown hint with safeToRetry=false", async () => {
    const r = runner((args) => {
      const k = args.join(" ");
      if (k === "add --all") return OK();
      if (k.startsWith("commit -m")) return FAIL("commit rejected");
      return OK();
    });
    const outcome = await commitAndPush(r, {
      cwd: "/r",
      issueNumber: 67,
      branch: "issue/67-x",
      type: "feat",
      scope: "lifecycle",
      summary: "x",
      push: true,
    });
    expect(outcome.committed).toBe(false);
    expect(outcome.recoveryHint?.failureKind).toBe("unknown");
    expect(outcome.recoveryHint?.safeToRetry).toBe(false);
  });

  it("sha lookup failure attaches unknown hint with safeToRetry=false", async () => {
    const r = runner((args) => {
      const k = args.join(" ");
      if (k === "add --all") return OK();
      if (k.startsWith("commit -m")) return OK();
      if (k === "rev-parse HEAD") return FAIL("missing HEAD");
      return OK();
    });
    const outcome = await commitAndPush(r, {
      cwd: "/r",
      issueNumber: 67,
      branch: "issue/67-x",
      type: "feat",
      scope: "lifecycle",
      summary: "x",
      push: true,
    });
    expect(outcome.committed).toBe(true);
    expect(outcome.sha).toBeNull();
    expect(outcome.pushed).toBe(false);
    expect(outcome.recoveryHint?.failureKind).toBe("unknown");
    expect(outcome.recoveryHint?.safeToRetry).toBe(false);
  });

  it("nothing-to-commit returns no hint (not a failure)", async () => {
    const r = runner((args) => {
      const k = args.join(" ");
      if (k === "add --all") return OK();
      if (k.startsWith("commit -m")) return { stdout: "nothing to commit", stderr: "", exitCode: 1 };
      return OK();
    });
    const outcome = await commitAndPush(r, {
      cwd: "/r",
      issueNumber: 67,
      branch: "issue/67-x",
      type: "feat",
      scope: "lifecycle",
      summary: "x",
      push: true,
    });
    expect(outcome.committed).toBe(false);
    expect(outcome.recoveryHint).toBeUndefined();
  });
});
