import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { getAtlasSummary } from "@/atlas/auto-inject";

const makeTmpVault = (): string => mkdtempSync(join(tmpdir(), "atlas-auto-inject-"));

const writeFile = (root: string, rel: string, body: string): void => {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body);
};

describe("getAtlasSummary", () => {
  it("returns null when atlas/ vault does not exist", async () => {
    const root = makeTmpVault();
    try {
      expect(await getAtlasSummary(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns null when atlas/00-index.md is missing", async () => {
    const root = makeTmpVault();
    try {
      mkdirSync(join(root, "atlas"));
      expect(await getAtlasSummary(root)).toBeNull();
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("includes the index body verbatim when vault is initialized", async () => {
    const root = makeTmpVault();
    try {
      writeFile(
        root,
        "atlas/00-index.md",
        "---\ntags: [atlas, index]\n---\n# micode Atlas Index\n\nDescription.\n\n## Build Layer\n\n- [[Plugin Composition]]\n",
      );
      const out = await getAtlasSummary(root);
      expect(out).not.toBeNull();
      expect(out).toContain("# micode Atlas Index");
      expect(out).toContain("Plugin Composition");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("respects the maxBytes budget", async () => {
    const root = makeTmpVault();
    try {
      const long = "x".repeat(20000);
      writeFile(root, "atlas/00-index.md", `---\ntags: [atlas]\n---\n# Index\n\n${long}\n`);
      const out = await getAtlasSummary(root, { maxBytes: 500 });
      expect(out).not.toBeNull();
      expect(Buffer.byteLength(out ?? "", "utf8")).toBeLessThanOrEqual(500);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("appends excerpts from allowlisted nodes when present", async () => {
    const root = makeTmpVault();
    try {
      writeFile(root, "atlas/00-index.md", "---\ntags: [atlas]\n---\n# Index\n\nIntro.\n");
      writeFile(
        root,
        "atlas/10-impl/lifecycle-state-machine.md",
        "---\ntags: [atlas, impl]\n---\n# Lifecycle State Machine\n\n生命周期状态机摘要文本。\n",
      );
      const out = (await getAtlasSummary(root)) ?? "";
      expect(out).toContain("Lifecycle State Machine");
      expect(out).toContain("生命周期状态机摘要文本");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
