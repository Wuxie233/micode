// tests/integration/atlas-lookup-registration.test.ts
import { describe, expect, it } from "bun:test";

import { createAtlasLookupTool } from "@/tools";

describe("atlas_lookup tool registration surface", () => {
  it("createAtlasLookupTool is exported from @/tools", () => {
    expect(typeof createAtlasLookupTool).toBe("function");
  });

  it("returns a tool definition keyed by atlas_lookup", () => {
    const ctx = { directory: process.cwd() } as Parameters<typeof createAtlasLookupTool>[0];
    const tools = createAtlasLookupTool(ctx);
    expect(tools.atlas_lookup).toBeDefined();
    expect(typeof tools.atlas_lookup.execute).toBe("function");
    expect(typeof tools.atlas_lookup.description).toBe("string");
    expect(tools.atlas_lookup.description.toLowerCase()).toContain("atlas");
  });

  it("includes layer and limit args", () => {
    const ctx = { directory: process.cwd() } as Parameters<typeof createAtlasLookupTool>[0];
    const { atlas_lookup } = createAtlasLookupTool(ctx);
    const args = atlas_lookup.args as Record<string, unknown>;
    expect(args.query).toBeDefined();
    expect(args.layer).toBeDefined();
    expect(args.limit).toBeDefined();
  });
});
