import { describe, expect, it } from "bun:test";

import { extractWikilinks, formatWikilink, parseWikilink, rewriteWikilinks } from "@/atlas/wikilink";

describe("wikilink codec", () => {
  it("parses a single link", () => {
    expect(parseWikilink("[[20-behavior/economy-system]]")).toBe("20-behavior/economy-system");
  });

  it("returns null on invalid format", () => {
    expect(parseWikilink("not a link")).toBe(null);
    expect(parseWikilink("[[ ]]")).toBe(null);
  });

  it("formats a link", () => {
    expect(formatWikilink("10-impl/runner")).toBe("[[10-impl/runner]]");
  });

  it("extracts all links from text", () => {
    const text = "see [[a/b]] and [[c/d]] but not [c]";
    expect(extractWikilinks(text)).toEqual(["a/b", "c/d"]);
  });

  it("rewrites only matching targets", () => {
    const text = "- [[old/x]]\n- [[other/y]]";
    const out = rewriteWikilinks(text, { "old/x": "new/x" });
    expect(out).toBe("- [[new/x]]\n- [[other/y]]");
  });
});
