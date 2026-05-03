import { describe, expect, it } from "bun:test";

import { decideSovereignty } from "@/skill-autopilot/writer/sovereignty";

describe("decideSovereignty", () => {
  it("skips when tombstone present and content hash matches", () => {
    const r = decideSovereignty({ tombstone: { contentHashes: ["h1"] }, current: null, candidateHash: "h1" });
    expect(r.proceed).toBe(false);
  });

  it("proceeds when tombstone present but content hash differs", () => {
    const r = decideSovereignty({ tombstone: { contentHashes: ["h2"] }, current: null, candidateHash: "h1" });
    expect(r.proceed).toBe(true);
  });

  it("skips frozen files", () => {
    const r = decideSovereignty({
      tombstone: null,
      current: { frontmatter: { name: "n", description: "d", version: 1, "x-micode-frozen": true } },
      candidateHash: "h",
    });
    expect(r.proceed).toBe(false);
  });

  it("skips files without managed marker", () => {
    const r = decideSovereignty({
      tombstone: null,
      current: { frontmatter: { name: "n", description: "d", version: 1 } },
      candidateHash: "h",
    });
    expect(r.proceed).toBe(false);
  });

  it("skips imported-from without local-overrides", () => {
    const r = decideSovereignty({
      tombstone: null,
      current: {
        frontmatter: {
          name: "n",
          description: "d",
          version: 1,
          "x-micode-managed": true,
          "x-micode-imported-from": "https://x",
        },
      },
      candidateHash: "h",
    });
    expect(r.proceed).toBe(false);
  });

  it("proceeds when imported-from has local-overrides", () => {
    const r = decideSovereignty({
      tombstone: null,
      current: {
        frontmatter: {
          name: "n",
          description: "d",
          version: 1,
          "x-micode-managed": true,
          "x-micode-imported-from": "https://x",
          "x-micode-local-overrides": true,
        },
      },
      candidateHash: "h",
    });
    expect(r.proceed).toBe(true);
  });

  it("proceeds when target is fresh (no current, no tombstone)", () => {
    expect(decideSovereignty({ tombstone: null, current: null, candidateHash: "h" }).proceed).toBe(true);
  });
});
