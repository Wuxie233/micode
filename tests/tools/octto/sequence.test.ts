// tests/tools/octto/sequence.test.ts
import { describe, expect, it } from "bun:test";

import { normalizeSequence } from "../../../src/tools/octto/sequence";

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
});
