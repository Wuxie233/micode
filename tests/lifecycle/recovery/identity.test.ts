import { describe, expect, it } from "bun:test";

import { probeRuntimeIdentity } from "@/lifecycle/recovery/identity";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });
const fail = (): RunResult => ({ stdout: "", stderr: "boom", exitCode: 1 });

const createRunner = (overrides: {
  branch?: RunResult;
  origin?: RunResult;
  toplevel?: RunResult;
}): LifecycleRunner => ({
  async git(args) {
    if (args.includes("--abbrev-ref")) return overrides.branch ?? ok("issue/10-feature\n");
    if (args.includes("get-url")) return overrides.origin ?? ok("git@github.com:Wuxie233/micode.git\n");
    if (args.includes("--show-toplevel")) return overrides.toplevel ?? ok("/tmp/wt\n");
    return ok();
  },
  async gh() {
    return ok();
  },
});

describe("probeRuntimeIdentity", () => {
  it("returns trimmed values when all probes succeed", async () => {
    const identity = await probeRuntimeIdentity(createRunner({}), "/tmp/wt");
    expect(identity).toEqual({
      branch: "issue/10-feature",
      origin: "git@github.com:Wuxie233/micode.git",
      worktree: "/tmp/wt",
    });
  });

  it("returns null fields when probes fail", async () => {
    const identity = await probeRuntimeIdentity(
      createRunner({ branch: fail(), origin: fail(), toplevel: fail() }),
      "/tmp/wt",
    );
    expect(identity).toEqual({ branch: null, origin: null, worktree: "/tmp/wt" });
  });
});
