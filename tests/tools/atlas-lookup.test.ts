import { describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAtlasLookupTool } from "@/tools/atlas/lookup";

const makeTmp = (): string => mkdtempSync(join(tmpdir(), "atlas-lookup-"));

const writeNode = (root: string, rel: string, body: string): void => {
  const full = join(root, rel);
  mkdirSync(join(full, ".."), { recursive: true });
  writeFileSync(full, body);
};

const ctx = (directory: string): Parameters<typeof createAtlasLookupTool>[0] =>
  ({ directory }) as Parameters<typeof createAtlasLookupTool>[0];

const runLookup = async (root: string, args: { query: string; layer?: string; limit?: number }): Promise<string> => {
  const { atlas_lookup } = createAtlasLookupTool(ctx(root));
  const exec = atlas_lookup.execute.bind(atlas_lookup) as (a: typeof args) => Promise<string>;
  return exec(args);
};

describe("atlas_lookup tool", () => {
  it("returns 'Atlas not initialized' when atlas/ vault is missing", async () => {
    const root = makeTmp();
    try {
      const out = await runLookup(root, { query: "lifecycle" });
      expect(out).toContain("Atlas not initialized");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("matches a node by H1 title and returns its excerpt", async () => {
    const root = makeTmp();
    try {
      writeNode(root, "atlas/00-index.md", "---\ntags: [atlas]\n---\n# Index\n");
      writeNode(
        root,
        "atlas/10-impl/lifecycle-state-machine.md",
        "---\ntags: [atlas, impl]\n---\n# Lifecycle State Machine\n\n生命周期状态机摘要。\n\n## Sources\n\n- code:src/lifecycle/runner.ts\n",
      );
      const out = await runLookup(root, { query: "lifecycle" });
      expect(out).toContain("Lifecycle State Machine");
      expect(out).toContain("生命周期状态机摘要");
      expect(out).toContain("atlas/10-impl/lifecycle-state-machine.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("filters by layer when layer arg is supplied", async () => {
    const root = makeTmp();
    try {
      writeNode(root, "atlas/00-index.md", "---\ntags: [atlas]\n---\n# Index\n");
      writeNode(root, "atlas/10-impl/lifecycle.md", "---\ntags: [atlas, impl]\n---\n# Lifecycle\n\nimpl summary.\n");
      writeNode(
        root,
        "atlas/40-decisions/lifecycle.md",
        "---\ntags: [atlas, decision]\n---\n# Lifecycle Decision\n\ndecision summary.\n",
      );
      const out = await runLookup(root, { query: "lifecycle", layer: "decision" });
      expect(out).toContain("Lifecycle Decision");
      expect(out).not.toContain("impl summary");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("respects limit", async () => {
    const root = makeTmp();
    try {
      writeNode(root, "atlas/00-index.md", "---\ntags: [atlas]\n---\n# Index\n");
      for (let i = 0; i < 5; i += 1) {
        writeNode(
          root,
          `atlas/10-impl/topic-${i}.md`,
          `---\ntags: [atlas, impl]\n---\n# Topic ${i}\n\nlookup-target body ${i}.\n`,
        );
      }
      const out = await runLookup(root, { query: "lookup-target", limit: 2 });
      const matches = (out.match(/^### /gmu) ?? []).length;
      expect(matches).toBe(2);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("excludes _meta and _archive directories", async () => {
    const root = makeTmp();
    try {
      writeNode(root, "atlas/00-index.md", "---\ntags: [atlas]\n---\n# Index\n");
      writeNode(root, "atlas/_meta/log/init.md", "---\ntags: [atlas]\n---\n# Init Log\n\nshould-not-appear.\n");
      writeNode(root, "atlas/_archive/old.md", "---\ntags: [atlas]\n---\n# Archived\n\nshould-not-appear.\n");
      const out = await runLookup(root, { query: "should-not-appear" });
      expect(out).not.toContain("Init Log");
      expect(out).not.toContain("Archived");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("renders code: source bullets as GitHub permalinks", async () => {
    const root = makeTmp();
    try {
      writeFileSync(
        join(root, "package.json"),
        JSON.stringify({ repository: { url: "https://github.com/foo/bar.git" } }),
      );
      writeNode(root, "atlas/00-index.md", "---\ntags: [atlas]\n---\n# Index\n");
      writeNode(
        root,
        "atlas/10-impl/runner.md",
        "---\ntags: [atlas, impl]\n---\n# Runner\n\nrunner-summary.\n\n## Sources\n\n- code:src/runner.ts\n",
      );
      const out = await runLookup(root, { query: "runner-summary" });
      expect(out).toContain("https://github.com/foo/bar/blob/");
      expect(out).toContain("src/runner.ts");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("returns no-hit guidance when query matches nothing", async () => {
    const root = makeTmp();
    try {
      writeNode(root, "atlas/00-index.md", "---\ntags: [atlas]\n---\n# Index\n");
      writeNode(root, "atlas/10-impl/x.md", "---\ntags: [atlas, impl]\n---\n# X\n\nbody.\n");
      const out = await runLookup(root, { query: "completely-unrelated-zzz" });
      expect(out).toContain("No atlas nodes matched");
      expect(out).toContain("00-index.md");
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });
});
