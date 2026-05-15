import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

import {
  isDegradedProjectIdentity,
  normalizeProjectOrigin,
  projectIdForSource,
  resolveProjectId,
} from "@/utils/project-id";

let workdir: string;

beforeEach(async () => {
  workdir = mkdtempSync(join(tmpdir(), "pid-"));
  await $`git init -q`.cwd(workdir);
});

afterEach(() => {
  rmSync(workdir, { recursive: true, force: true });
});

describe("resolveProjectId", () => {
  it("derives a stable id from origin url when present", async () => {
    await $`git remote add origin https://github.com/Wuxie233/micode.git`.cwd(workdir);
    const a = await resolveProjectId(workdir);
    const b = await resolveProjectId(workdir);
    expect(a.kind).toBe("origin");
    expect(a.projectId).toEqual(b.projectId);
    expect(a.projectId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("normalizes ssh and https forms of the same remote to the same id", async () => {
    await $`git remote add origin https://github.com/Wuxie233/micode.git`.cwd(workdir);
    const httpsId = (await resolveProjectId(workdir)).projectId;
    await $`git remote set-url origin git@github.com:Wuxie233/micode.git`.cwd(workdir);
    const sshId = (await resolveProjectId(workdir)).projectId;
    expect(sshId).toBe(httpsId);
  });

  it("falls back to git toplevel hash when origin is missing", async () => {
    const result = await resolveProjectId(workdir);
    expect(result.kind).toBe("path");
    expect(result.projectId).toMatch(/^[0-9a-f]{16}$/);
  });

  it("returns kind=path when not in a git repo", async () => {
    const plain = mkdtempSync(join(tmpdir(), "plain-"));
    try {
      const result = await resolveProjectId(plain);
      expect(result.kind).toBe("path");
    } finally {
      rmSync(plain, { recursive: true, force: true });
    }
  });
});

describe("normalizeProjectOrigin", () => {
  it("normalizes HTTPS origins", () => {
    expect(normalizeProjectOrigin(" https://GitHub.com/Wuxie233/micode.git ")).toBe("github.com/wuxie233/micode");
  });

  it("normalizes SSH origins", () => {
    expect(normalizeProjectOrigin("git@GitHub.com:Wuxie233/micode.git")).toBe("github.com/wuxie233/micode");
  });

  it("normalizes mixed-case URL host and path", () => {
    expect(normalizeProjectOrigin("HTTPS://GitHub.COM/Wuxie233/MiCode.GIT")).toBe("github.com/wuxie233/micode");
  });

  it("normalizes non-URL fallback without owner/name rewriting", () => {
    expect(normalizeProjectOrigin(" Wuxie233/MiCode.git ")).toBe("wuxie233/micode");
  });

  it("does not remove fork parent or rewrite owner", () => {
    expect(normalizeProjectOrigin("https://github.com/ForkOwner/micode.git")).toBe("github.com/forkowner/micode");
    expect(normalizeProjectOrigin("https://github.com/ParentOwner/micode.git")).toBe("github.com/parentowner/micode");
  });
});

describe("projectIdForSource", () => {
  it("returns a stable 16-character sha1 hex prefix", () => {
    const source = "github.com/wuxie233/micode";
    const a = projectIdForSource(source);
    const b = projectIdForSource(source);
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{16}$/);
    expect(projectIdForSource("github.com/other/micode")).not.toBe(a);
  });
});

describe("isDegradedProjectIdentity", () => {
  it("treats non-origin identities as degraded", () => {
    expect(
      isDegradedProjectIdentity({
        projectId: projectIdForSource("github.com/wuxie233/micode"),
        kind: "origin",
        source: "github.com/wuxie233/micode",
      }),
    ).toBe(false);
    expect(
      isDegradedProjectIdentity({
        projectId: projectIdForSource(workdir),
        kind: "path",
        source: workdir,
      }),
    ).toBe(true);
  });
});
