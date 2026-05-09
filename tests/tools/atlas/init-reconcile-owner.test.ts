import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAtlasInit } from "@/tools/atlas/init";

describe("runAtlasInit reconcile owner string", () => {
  it("reports user-triggered ownership in dry-run report (not lifecycle-finish)", async () => {
    const root = mkdtempSync(join(tmpdir(), "atlas-init-"));
    mkdirSync(join(root, "atlas"));
    const result = await runAtlasInit({
      projectRoot: root,
      mode: "reconcile",
      projectName: "x",
      projectType: "server",
    });
    expect(result.outcome).toBe("dry-run");
    expect(result.report).toContain("user-triggered");
    expect(result.report).not.toContain("lifecycle-finish");
  });
});
