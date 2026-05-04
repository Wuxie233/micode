import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { scanBrokenWikilinks } from "@/atlas/broken-link-scanner";
import { renderEmptyNode } from "@/atlas/templates";
import { ATLAS_LAYERS, ATLAS_NODE_STATUSES } from "@/atlas/types";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-broken-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

const writeNode = (rel: string, connections: readonly string[]): void => {
  const file = join(projectRoot, "atlas", `${rel}.md`);
  mkdirSync(join(file, ".."), { recursive: true });
  writeFileSync(
    file,
    renderEmptyNode({
      id: rel,
      layer: ATLAS_LAYERS.IMPL,
      status: ATLAS_NODE_STATUSES.ACTIVE,
      summary: "x",
      sources: [],
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
      connections,
    }),
    "utf8",
  );
};

describe("scanBrokenWikilinks", () => {
  it("reports targets that do not exist", async () => {
    writeNode("10-impl/a", ["[[20-behavior/missing]]"]);
    const broken = await scanBrokenWikilinks(projectRoot);
    expect(broken).toEqual([{ source: "10-impl/a", target: "20-behavior/missing" }]);
  });

  it("ignores valid links", async () => {
    writeNode("10-impl/a", ["[[10-impl/b]]"]);
    writeNode("10-impl/b", []);
    const broken = await scanBrokenWikilinks(projectRoot);
    expect(broken).toEqual([]);
  });

  it("returns empty when vault missing", async () => {
    expect(await scanBrokenWikilinks(join(projectRoot, "no-vault"))).toEqual([]);
  });
});
