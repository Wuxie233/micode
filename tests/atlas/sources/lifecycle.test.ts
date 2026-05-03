import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectLifecycleSources } from "@/atlas/sources/lifecycle";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-src-lc-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("collectLifecycleSources", () => {
  it("returns lifecycle pointers for terminal records", async () => {
    const dir = join(projectRoot, "thoughts", "lifecycle");
    mkdirSync(dir, { recursive: true });
    writeFileSync(
      join(dir, "26.json"),
      JSON.stringify({
        issueNumber: 26,
        state: "terminal",
        artifacts: { design: ["thoughts/shared/designs/x.md"], plan: [], ledger: [], commit: [], pr: [], worktree: [] },
        notes: [],
        updatedAt: 1,
      }),
      "utf8",
    );
    const sources = await collectLifecycleSources(projectRoot);
    expect(sources).toContainEqual(expect.objectContaining({ pointer: "lifecycle:26", state: "terminal" }));
  });

  it("returns empty when lifecycle dir missing", async () => {
    expect(await collectLifecycleSources(projectRoot)).toEqual([]);
  });
});
