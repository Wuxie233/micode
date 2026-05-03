import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { hasRejection, recordRejection, runSecurityPipeline } from "@/skill-autopilot/security/pipeline";

const baseBody = `## When to Use\nt\n## Procedure\n- s\n## Pitfalls\n- p\n## Verification\n- v\n`;

function input(overrides: Partial<{ body: string; description: string; steps: readonly string[]; name: string }>) {
  return {
    name: overrides.name ?? "lint",
    description: overrides.description ?? "Run lint",
    trigger: "t",
    steps: overrides.steps ?? ["bun run check"],
    body: overrides.body ?? baseBody,
    frontmatter: { name: overrides.name ?? "lint", description: "x", version: 1 },
  };
}

describe("runSecurityPipeline", () => {
  it("passes a clean candidate", () => {
    const r = runSecurityPipeline(input({}), { dirname: "lint" });
    expect(r.ok).toBe(true);
  });

  it("returns the first failing gate's reason", () => {
    const r = runSecurityPipeline(input({ steps: ["rm -rf /"] }), { dirname: "lint" });
    expect(r.ok).toBe(false);
  });
});

describe("rejections journal", () => {
  it("appends and detects rejections by dedup key", () => {
    const dir = mkdtempSync(join(tmpdir(), "sa-rej-"));
    const file = join(dir, ".rejections.jsonl");
    recordRejection(file, { dedupeKey: "abc", reason: "pii", at: 1 });
    expect(hasRejection(file, "abc")).toBe(true);
    expect(hasRejection(file, "xyz")).toBe(false);
    const text = readFileSync(file, "utf8");
    expect(text).toContain("abc");
  });
});
