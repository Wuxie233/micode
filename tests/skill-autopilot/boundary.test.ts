import { describe, expect, it } from "bun:test";

import { isWriteAllowedForDirectory } from "@/skill-autopilot/boundary";
import { config } from "@/utils/config";

describe("isWriteAllowedForDirectory", () => {
  it("blocks the runtime install path", () => {
    const r = isWriteAllowedForDirectory(config.skillAutopilot.runtimeInstallPath);
    expect(r.allowed).toBe(false);
    expect(r.reason).toMatch(/runtime install/);
  });

  it("blocks subpaths of the runtime install path", () => {
    const r = isWriteAllowedForDirectory(`${config.skillAutopilot.runtimeInstallPath}/src`);
    expect(r.allowed).toBe(false);
  });

  it("allows ordinary project directories", () => {
    expect(isWriteAllowedForDirectory("/root/CODE/issue-27-skill-autopilot").allowed).toBe(true);
  });
});
