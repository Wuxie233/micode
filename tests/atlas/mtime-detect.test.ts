import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, statSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectHumanEdit } from "@/atlas/mtime-detect";
import { renderEmptyNode } from "@/atlas/templates";
import { ATLAS_LAYERS, ATLAS_NODE_STATUSES } from "@/atlas/types";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atlas-mtime-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

const writeNode = (path: string, lastWrittenMtime: number): void => {
  mkdirSync(dir, { recursive: true });
  const text = renderEmptyNode({
    id: "impl/x",
    layer: ATLAS_LAYERS.IMPL,
    status: ATLAS_NODE_STATUSES.ACTIVE,
    summary: "x",
    sources: [],
    lastVerifiedCommit: "",
    lastWrittenMtime,
  });
  writeFileSync(path, text, "utf8");
};

describe("detectHumanEdit", () => {
  it("returns false when frontmatter mtime matches file mtime", async () => {
    const path = join(dir, "x.md");
    writeNode(path, 0);
    const stat = statSync(path);
    const mtime = Math.trunc(stat.mtimeMs);
    writeNode(path, mtime);
    utimesSync(path, stat.atime, new Date(mtime));
    const result = await detectHumanEdit(path);
    expect(result.edited).toBe(false);
  });

  it("returns true when file mtime drifted from frontmatter", async () => {
    const path = join(dir, "y.md");
    writeNode(path, 100);
    const stat = statSync(path);
    expect(stat.mtimeMs).not.toBe(100);
    const result = await detectHumanEdit(path);
    expect(result.edited).toBe(true);
  });

  it("returns false when node is missing", async () => {
    const result = await detectHumanEdit(join(dir, "missing.md"));
    expect(result.edited).toBe(false);
    expect(result.reason).toBe("missing");
  });
});
