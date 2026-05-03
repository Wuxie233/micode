import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { readPage } from "@/atlas/page-reader";
import { renderEmptyNode } from "@/atlas/templates";
import { ATLAS_LAYERS, ATLAS_NODE_STATUSES } from "@/atlas/types";

let dir: string;

beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), "atlas-reader-"));
});

afterEach(() => {
  rmSync(dir, { recursive: true, force: true });
});

describe("readPage", () => {
  it("reads a node and returns frontmatter + body sections", async () => {
    const file = join(dir, "node.md");
    mkdirSync(dir, { recursive: true });
    const text = renderEmptyNode({
      id: "impl/x",
      layer: ATLAS_LAYERS.IMPL,
      status: ATLAS_NODE_STATUSES.ACTIVE,
      summary: "x summary",
      sources: ["code:src/x.ts"],
      lastVerifiedCommit: "abc",
      lastWrittenMtime: 100,
      connections: ["[[20-behavior/x]]"],
    });
    writeFileSync(file, text, "utf8");
    const node = await readPage(file);
    expect(node.frontmatter.id).toBe("impl/x");
    expect(node.summary).toContain("x summary");
    expect(node.connections).toEqual(["[[20-behavior/x]]"]);
    expect(node.sourcesBody).toEqual(["code:src/x.ts"]);
  });

  it("returns null on missing file", async () => {
    const node = await readPage(join(dir, "missing.md"));
    expect(node).toBe(null);
  });

  it("throws on malformed frontmatter", async () => {
    const file = join(dir, "broken.md");
    writeFileSync(file, "no frontmatter at all", "utf8");
    await expect(readPage(file)).rejects.toThrow();
  });
});
