import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

import { runAutopilot } from "@/skill-autopilot/runner";
import { config } from "@/utils/config";

describe("self-hosting boundary", () => {
  it("skips when cwd equals the runtime install path", async () => {
    const r = await runAutopilot({
      cwd: config.skillAutopilot.runtimeInstallPath,
      projectId: "p",
      issueNumber: 27,
      now: 1,
      resolveProjectId: async () => ({ projectId: "p", source: "git_remote", degraded: false }),
    });
    expect(r.skipped).toBe(true);
    expect(r.skippedReason).toMatch(/runtime install/);
    expect(existsSync(join(config.skillAutopilot.runtimeInstallPath, ".opencode/skills/.state.json"))).toBe(false);
  });

  it("skips when cwd is a sub-directory of the runtime install path", async () => {
    const r = await runAutopilot({
      cwd: `${config.skillAutopilot.runtimeInstallPath}/src/skill-autopilot`,
      projectId: "p",
      issueNumber: 27,
      now: 1,
      resolveProjectId: async () => ({ projectId: "p", source: "git_remote", degraded: false }),
    });
    expect(r.skipped).toBe(true);
  });
});
