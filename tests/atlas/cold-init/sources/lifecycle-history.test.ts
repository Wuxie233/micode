import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectLifecycleHistory } from "@/atlas/cold-init/sources/lifecycle-history";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "cold-init-lh-"));
  mkdirSync(join(projectRoot, "thoughts", "lifecycle"), { recursive: true });
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("collectLifecycleHistory", () => {
  it("returns empty when no lifecycle dir", async () => {
    const empty = mkdtempSync(join(tmpdir(), "no-lc-"));
    const out = await collectLifecycleHistory(empty);
    expect(out).toHaveLength(0);
    rmSync(empty, { recursive: true, force: true });
  });

  it("parses lifecycle records and sorts by mtime desc", async () => {
    writeFileSync(
      join(projectRoot, "thoughts", "lifecycle", "1.json"),
      JSON.stringify({
        issueNumber: 1,
        title: "first",
        state: "closed",
        artifacts: { design: ["thoughts/shared/designs/a.md"], plan: [], ledger: [] },
      }),
      "utf8",
    );
    writeFileSync(
      join(projectRoot, "thoughts", "lifecycle", "2.json"),
      JSON.stringify({
        issueNumber: 2,
        title: "second",
        state: "in_progress",
        artifacts: { design: [], plan: ["thoughts/shared/plans/b.md"], ledger: [] },
      }),
      "utf8",
    );
    const out = await collectLifecycleHistory(projectRoot);
    expect(out).toHaveLength(2);
    expect(out.every((e) => e.pointer.startsWith("lifecycle:"))).toBe(true);
  });

  it("skips malformed records", async () => {
    writeFileSync(join(projectRoot, "thoughts", "lifecycle", "bad.json"), "not json", "utf8");
    const out = await collectLifecycleHistory(projectRoot);
    expect(out).toHaveLength(0);
  });
});
