import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectModuleEntries } from "@/atlas/sources/module-map";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-src-mod-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("collectModuleEntries", () => {
  it("identifies modules with index.ts and reads leading comment", async () => {
    const dir = join(projectRoot, "src", "lifecycle");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.ts"), "// Lifecycle state machine module\nexport {};\n", "utf8");
    const modules = await collectModuleEntries(projectRoot);
    expect(modules).toContainEqual({
      name: "lifecycle",
      pointer: "code:src/lifecycle",
      responsibility: "Lifecycle state machine module",
      relativePath: "src/lifecycle",
    });
  });

  it("falls back to unknown responsibility when no leading comment", async () => {
    const dir = join(projectRoot, "src", "tools");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "index.ts"), "export {};\n", "utf8");
    const modules = await collectModuleEntries(projectRoot);
    const tools = modules.find((m) => m.name === "tools");
    expect(tools?.responsibility).toBe("(unknown responsibility)");
  });

  it("returns empty when src missing", async () => {
    expect(await collectModuleEntries(projectRoot)).toEqual([]);
  });
});
