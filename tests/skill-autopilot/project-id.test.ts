import { describe, expect, it } from "bun:test";

import { resolveStrictProjectId } from "@/skill-autopilot/project-id";

describe("resolveStrictProjectId", () => {
  it("returns ok when underlying resolver returns a remote-derived identity", async () => {
    const r = await resolveStrictProjectId("/root/CODE/issue-27-skill-autopilot", {
      resolveProjectId: async () => ({
        projectId: "github:Wuxie233/micode",
        kind: "origin",
        source: "github.com/Wuxie233/micode",
      }),
    });
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.identity.projectId).toBe("github:Wuxie233/micode");
  });

  it("fails closed when the identity is degraded (path-only)", async () => {
    const r = await resolveStrictProjectId("/tmp/no-remote", {
      resolveProjectId: async () => ({
        projectId: "path:/tmp/no-remote",
        kind: "path",
        source: "/tmp/no-remote",
      }),
    });
    expect(r.ok).toBe(false);
    if (r.ok) return;
    expect(r.reason).toMatch(/degraded/);
  });
});
