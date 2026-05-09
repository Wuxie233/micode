import { describe, expect, it } from "bun:test";
import { renderAtlasStatusLine } from "@/atlas/atlas-status";

describe("renderAtlasStatusLine", () => {
  it("renders bare status without detail", () => {
    expect(renderAtlasStatusLine("no-change")).toBe("Atlas status: no-change");
  });

  it("appends detail with em-dash separator", () => {
    expect(renderAtlasStatusLine("delta-created", "thoughts/shared/atlas-deltas/2026-05-10-x-delta.md")).toBe(
      "Atlas status: delta-created — thoughts/shared/atlas-deltas/2026-05-10-x-delta.md",
    );
  });

  it("trims whitespace in detail", () => {
    expect(renderAtlasStatusLine("stale-detected", "  10-impl/foo.md conflict  ")).toBe(
      "Atlas status: stale-detected — 10-impl/foo.md conflict",
    );
  });

  it("treats empty / whitespace-only detail as bare", () => {
    expect(renderAtlasStatusLine("cannot-assess", "")).toBe("Atlas status: cannot-assess");
    expect(renderAtlasStatusLine("cannot-assess", "   ")).toBe("Atlas status: cannot-assess");
  });
});
