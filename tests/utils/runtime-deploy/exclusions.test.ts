import { describe, expect, it } from "bun:test";

import { isExcluded, RUNTIME_LOCAL_EXCLUSIONS, toRsyncExcludeArgs } from "@/utils/runtime-deploy/exclusions";

describe("runtime-deploy exclusions", () => {
  it("preserves runtime-local state directories", () => {
    expect(RUNTIME_LOCAL_EXCLUSIONS).toContain("node_modules");
    expect(RUNTIME_LOCAL_EXCLUSIONS).toContain("thoughts");
    expect(RUNTIME_LOCAL_EXCLUSIONS).toContain(".git");
    expect(RUNTIME_LOCAL_EXCLUSIONS).toContain("dist");
  });

  it("excludes .opencode/skills so deploy-runtime sync never deletes runtime-side skills", () => {
    expect(RUNTIME_LOCAL_EXCLUSIONS).toContain(".opencode/skills");
    expect(isExcluded(".opencode/skills")).toBe(true);
    expect(isExcluded(".opencode/skills/lint/SKILL.md")).toBe(true);
  });

  it("excludes secret and env files", () => {
    expect(RUNTIME_LOCAL_EXCLUSIONS).toContain(".env");
    expect(RUNTIME_LOCAL_EXCLUSIONS).toContain(".env.*");
  });

  it("renders rsync --exclude flags", () => {
    const args = toRsyncExcludeArgs(["node_modules", ".env"]);
    expect(args).toEqual(["--exclude", "node_modules", "--exclude", ".env"]);
  });

  it("matches a path against the exclusion list", () => {
    expect(isExcluded("node_modules/foo")).toBe(true);
    expect(isExcluded("thoughts/shared/plans/x.md")).toBe(true);
    expect(isExcluded("src/index.ts")).toBe(false);
  });

  it("treats top-level dotfiles in the list correctly", () => {
    expect(isExcluded(".env")).toBe(true);
    expect(isExcluded(".env.local")).toBe(true);
    expect(isExcluded(".gitignore")).toBe(false);
  });

  it("matches wildcard patterns for top-level and nested filenames", () => {
    expect(isExcluded("debug.log")).toBe(true);
    expect(isExcluded("logs/debug.log")).toBe(true);
  });
});
