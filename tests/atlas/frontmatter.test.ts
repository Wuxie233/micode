import { describe, expect, it } from "bun:test";

import { parseFrontmatter, serializeFrontmatter } from "@/atlas/frontmatter";
import { ATLAS_LAYERS, ATLAS_NODE_STATUSES } from "@/atlas/types";

const SAMPLE = `---
id: impl/lifecycle
layer: impl
status: active
last_verified_commit: abc123
last_written_mtime: 1700000000000
sources:
  - lifecycle:26
  - thoughts:shared/designs/x.md
---

# Body
`;

describe("frontmatter codec", () => {
  it("parses required fields", () => {
    const result = parseFrontmatter(SAMPLE);
    expect(result.frontmatter.id).toBe("impl/lifecycle");
    expect(result.frontmatter.layer).toBe(ATLAS_LAYERS.IMPL);
    expect(result.frontmatter.status).toBe(ATLAS_NODE_STATUSES.ACTIVE);
    expect(result.frontmatter.last_verified_commit).toBe("abc123");
    expect(result.frontmatter.last_written_mtime).toBe(1700000000000);
    expect(result.frontmatter.sources).toEqual(["lifecycle:26", "thoughts:shared/designs/x.md"]);
    expect(result.body.startsWith("# Body")).toBe(true);
  });

  it("round trips unknown extras", () => {
    const withExtra = SAMPLE.replace("sources:", "custom: keep-me\nsources:");
    const parsed = parseFrontmatter(withExtra);
    expect(parsed.frontmatter.extras.custom).toBe("keep-me");
    const serialized = serializeFrontmatter(parsed.frontmatter, parsed.body);
    expect(serialized).toContain("custom: keep-me");
  });

  it("rejects missing required fields", () => {
    expect(() => parseFrontmatter("---\nid: x\n---\nbody")).toThrow();
  });

  it("rejects unknown layer or status", () => {
    const bad = SAMPLE.replace("layer: impl", "layer: weird");
    expect(() => parseFrontmatter(bad)).toThrow();
  });

  it("serializes deterministically", () => {
    const parsed = parseFrontmatter(SAMPLE);
    const serialized = serializeFrontmatter(parsed.frontmatter, parsed.body);
    const reparsed = parseFrontmatter(serialized);
    expect(reparsed.frontmatter).toEqual(parsed.frontmatter);
    expect(reparsed.body).toEqual(parsed.body);
  });
});
