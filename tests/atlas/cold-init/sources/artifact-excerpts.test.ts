import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { collectArtifactExcerpts } from "@/atlas/cold-init/sources/artifact-excerpts";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "cold-init-art-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("collectArtifactExcerpts", () => {
  it("returns empty when no thoughts dir", async () => {
    const out = await collectArtifactExcerpts(projectRoot);
    expect(out).toHaveLength(0);
  });

  it("extracts title from H1 and tags kind", async () => {
    const dir = join(projectRoot, "thoughts", "shared", "designs");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "feature.md"), "---\ndate: 2026-01-01\n---\n\n# Feature Title\n\nBody here.", "utf8");
    const out = await collectArtifactExcerpts(projectRoot);
    expect(out).toHaveLength(1);
    expect(out[0].title).toBe("Feature Title");
    expect(out[0].kind).toBe("design");
    expect(out[0].pointer).toContain("shared/designs/feature.md");
  });

  it("falls back to filename when no H1", async () => {
    const dir = join(projectRoot, "thoughts", "shared", "plans");
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "plain.md"), "no heading body", "utf8");
    const out = await collectArtifactExcerpts(projectRoot);
    expect(out[0].title).toBe("plain");
  });
});
