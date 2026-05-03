import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { archiveNode } from "@/atlas/archive";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-archive-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("archiveNode", () => {
  it("moves a node into _archive preserving relative path", () => {
    const source = join(projectRoot, "atlas", "10-impl", "obsolete.md");
    mkdirSync(join(projectRoot, "atlas", "10-impl"), { recursive: true });
    writeFileSync(source, "node body", "utf8");
    const archived = archiveNode(projectRoot, source);
    expect(existsSync(source)).toBe(false);
    expect(existsSync(archived)).toBe(true);
    expect(archived).toBe(join(projectRoot, "atlas", "_archive", "10-impl", "obsolete.md"));
    expect(readFileSync(archived, "utf8")).toBe("node body");
  });

  it("throws when source is outside vault", () => {
    expect(() => archiveNode(projectRoot, join(projectRoot, "src", "x.ts"))).toThrow();
  });

  it("throws when source missing", () => {
    expect(() => archiveNode(projectRoot, join(projectRoot, "atlas", "10-impl", "ghost.md"))).toThrow();
  });
});
