// tests/tools/octto/sequence.test.ts
import { describe, expect, it } from "bun:test";

import { normalizeSequence } from "../../../src/tools/sequence";

describe("octto sequence arguments", () => {
  const first = { id: "a" };
  const second = { id: "b" };

  it("keeps arrays in order", () => {
    expect(normalizeSequence([first, second])).toEqual([first, second]);
  });

  it("wraps a single object", () => {
    expect(normalizeSequence(first)).toEqual([first]);
  });

  it("converts indexed records in numeric order", () => {
    expect(normalizeSequence({ "1": second, "0": first })).toEqual([first, second]);
  });

  it("returns an empty sequence for omitted values", () => {
    expect(normalizeSequence(undefined)).toEqual([]);
  });

  describe("stringified inputs (host runtime serialization fallback)", () => {
    it("decodes a stringified array of objects", () => {
      expect(normalizeSequence(JSON.stringify([first, second]))).toEqual([first, second]);
    });

    it("decodes a stringified single object and wraps it", () => {
      expect(normalizeSequence(JSON.stringify(first))).toEqual([first]);
    });

    it("decodes a stringified indexed record in numeric order", () => {
      expect(normalizeSequence(JSON.stringify({ "1": second, "0": first }))).toEqual([first, second]);
    });

    it("decodes a stringified empty array as an empty sequence", () => {
      expect(normalizeSequence("[]")).toEqual([]);
    });

    it("tolerates surrounding whitespace before parsing", () => {
      expect(normalizeSequence(`  ${JSON.stringify([first])}  `)).toEqual([first]);
    });
  });

  describe("string fallbacks", () => {
    it("wraps a plain non-JSON string as a single value", () => {
      expect(normalizeSequence("not-json")).toEqual(["not-json"]);
    });

    it("wraps malformed JSON-looking strings without throwing", () => {
      expect(() => normalizeSequence("[")).not.toThrow();
      expect(normalizeSequence("[")).toEqual(["["]);
    });
  });
});
