import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { commitStagedPages, stagePageWrite } from "@/atlas/page-writer";
import { createStagingManager } from "@/atlas/staging";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "atlas-writer-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("page writer", () => {
  it("stages content and atomic-renames into vault on commit", async () => {
    const staging = createStagingManager(projectRoot, "run-1");
    staging.create();
    const target = join(projectRoot, "atlas", "10-impl", "x.md");
    stagePageWrite(staging, target, "hello world");
    expect(existsSync(target)).toBe(false);
    await commitStagedPages(staging);
    expect(readFileSync(target, "utf8")).toBe("hello world");
  });

  it("rolls back staging without writing on rollback", async () => {
    const staging = createStagingManager(projectRoot, "run-2");
    staging.create();
    const target = join(projectRoot, "atlas", "10-impl", "y.md");
    stagePageWrite(staging, target, "should not land");
    staging.rollback();
    expect(existsSync(target)).toBe(false);
    expect(existsSync(staging.dir)).toBe(false);
  });

  it("commit refuses if any staged file's parent target overlap is missing", async () => {
    const staging = createStagingManager(projectRoot, "run-3");
    staging.create();
    stagePageWrite(staging, join(projectRoot, "atlas", "10-impl", "deep", "z.md"), "content");
    await commitStagedPages(staging);
    expect(readFileSync(join(projectRoot, "atlas", "10-impl", "deep", "z.md"), "utf8")).toBe("content");
  });
});
