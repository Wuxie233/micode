import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { writeMaintenanceLog } from "@/atlas/log-writer";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-log-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("writeMaintenanceLog", () => {
  it("writes a first-person markdown entry under _meta/log/", async () => {
    const file = await writeMaintenanceLog(projectRoot, {
      runId: "agent2-26-100",
      narrative: "I touched three nodes and opened one challenge.",
      touched: ["10-impl/a.md", "20-behavior/b.md"],
      challenges: ["agent2-26-100-x-abc123.md"],
      outcome: "succeeded",
    });

    expect(existsSync(file)).toBe(true);
    const body = readFileSync(file, "utf8");
    expect(body).toContain("# agent2 run agent2-26-100");
    expect(body).toContain("I touched three nodes");
    expect(body).toContain("- 10-impl/a.md");
    expect(body).toContain("outcome: succeeded");
  });
});
