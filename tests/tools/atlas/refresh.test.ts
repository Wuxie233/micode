import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runAtlasRefresh } from "@/tools/atlas/refresh";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-refresh-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("runAtlasRefresh", () => {
  it("refuses without an init'd vault", async () => {
    const result = await runAtlasRefresh({ projectRoot, target: "10-impl/runner" });
    expect(result.outcome).toBe("rejected");
  });

  it("acquires lock, writes a placeholder log entry, and releases", async () => {
    const result = await runAtlasRefresh({ projectRoot, target: "10-impl/runner", initIfMissing: true });
    expect(result.outcome).toBe("ok");
    expect(existsSync(join(projectRoot, "atlas", "_meta", "log"))).toBe(true);
  });
});
