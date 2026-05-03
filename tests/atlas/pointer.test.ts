import { describe, expect, it } from "bun:test";

import { formatPointer, POINTER_KINDS, parsePointer } from "@/atlas/pointer";

describe("source pointer codec", () => {
  it("parses lifecycle pointers", () => {
    expect(parsePointer("lifecycle:26")).toEqual({ kind: POINTER_KINDS.LIFECYCLE, value: "26" });
  });

  it("parses thoughts pointers preserving slashes", () => {
    expect(parsePointer("thoughts:shared/designs/x.md")).toEqual({
      kind: POINTER_KINDS.THOUGHTS,
      value: "shared/designs/x.md",
    });
  });

  it("parses pm, mindmodel, code", () => {
    expect(parsePointer("pm:abc")).toEqual({ kind: POINTER_KINDS.PROJECT_MEMORY, value: "abc" });
    expect(parsePointer("mindmodel:patterns/x")).toEqual({ kind: POINTER_KINDS.MINDMODEL, value: "patterns/x" });
    expect(parsePointer("code:src/x.ts")).toEqual({ kind: POINTER_KINDS.CODE, value: "src/x.ts" });
  });

  it("rejects unknown prefixes", () => {
    expect(() => parsePointer("weird:x")).toThrow();
  });

  it("formats round trip", () => {
    const sources = ["lifecycle:1", "thoughts:a.md", "pm:e", "mindmodel:c/d", "code:src/s.ts"];
    for (const source of sources) {
      const parsed = parsePointer(source);
      expect(formatPointer(parsed)).toBe(source);
    }
  });
});
