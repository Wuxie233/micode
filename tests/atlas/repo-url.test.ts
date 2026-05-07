import { describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ATLAS_REPO_FALLBACK_BASE, resolveRepoBase } from "@/atlas/repo-url";

const makeTmp = (): string => mkdtempSync(join(tmpdir(), "atlas-repo-url-"));

describe("resolveRepoBase", () => {
  it("reads https URL from package.json#repository.url", () => {
    const root = makeTmp();
    try {
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ repository: { type: "git", url: "https://github.com/foo/bar.git" } }),
      );
      expect(resolveRepoBase(root)).toBe("https://github.com/foo/bar");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("normalizes git+https URLs", () => {
    const root = makeTmp();
    try {
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ repository: { url: "git+https://github.com/foo/bar.git" } }),
      );
      expect(resolveRepoBase(root)).toBe("https://github.com/foo/bar");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("normalizes git@ SSH URLs", () => {
    const root = makeTmp();
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ repository: { url: "git@github.com:foo/bar.git" } }));
      expect(resolveRepoBase(root)).toBe("https://github.com/foo/bar");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("accepts a plain string repository field", () => {
    const root = makeTmp();
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ repository: "https://github.com/foo/bar" }));
      expect(resolveRepoBase(root)).toBe("https://github.com/foo/bar");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back when package.json is missing", () => {
    const root = makeTmp();
    try {
      expect(resolveRepoBase(root)).toBe(ATLAS_REPO_FALLBACK_BASE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back when package.json has no repository field", () => {
    const root = makeTmp();
    try {
      writeFileSync(join(root, "package.json"), JSON.stringify({ name: "demo" }));
      expect(resolveRepoBase(root)).toBe(ATLAS_REPO_FALLBACK_BASE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("falls back when package.json is malformed", () => {
    const root = makeTmp();
    try {
      writeFileSync(join(root, "package.json"), "{ not json");
      expect(resolveRepoBase(root)).toBe(ATLAS_REPO_FALLBACK_BASE);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
