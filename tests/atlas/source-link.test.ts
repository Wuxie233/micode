import { describe, expect, it } from "bun:test";

import { formatSourceLink } from "@/atlas/source-link";

const REPO_BASE = "https://github.com/Wuxie233/micode";

describe("formatSourceLink", () => {
  it("renders code: pointer as a GitHub permalink markdown link", () => {
    const out = formatSourceLink("code:src/lifecycle/runner.ts", { repoBase: REPO_BASE, ref: "main" });
    expect(out).toBe(`[查看源码 src/lifecycle/runner.ts](${REPO_BASE}/blob/main/src/lifecycle/runner.ts)`);
  });

  it("uses the supplied commit ref when present", () => {
    const out = formatSourceLink("code:src/foo.ts", { repoBase: REPO_BASE, ref: "abc1234" });
    expect(out).toBe(`[查看源码 src/foo.ts](${REPO_BASE}/blob/abc1234/src/foo.ts)`);
  });

  it("preserves a line anchor in the path", () => {
    const out = formatSourceLink("code:src/foo.ts#L10-L20", { repoBase: REPO_BASE, ref: "main" });
    expect(out).toBe(`[查看源码 src/foo.ts#L10-L20](${REPO_BASE}/blob/main/src/foo.ts#L10-L20)`);
  });

  it("returns the original bullet for non-code pointers", () => {
    expect(formatSourceLink("lifecycle:42", { repoBase: REPO_BASE, ref: "main" })).toBe("lifecycle:42");
    expect(formatSourceLink("thoughts:shared/designs/foo.md", { repoBase: REPO_BASE, ref: "main" })).toBe(
      "thoughts:shared/designs/foo.md",
    );
  });

  it("returns the original bullet when input is not a parseable pointer", () => {
    expect(formatSourceLink("just plain text", { repoBase: REPO_BASE, ref: "main" })).toBe("just plain text");
  });

  it("strips a trailing slash from repoBase before joining", () => {
    const out = formatSourceLink("code:src/x.ts", { repoBase: `${REPO_BASE}/`, ref: "main" });
    expect(out).toBe(`[查看源码 src/x.ts](${REPO_BASE}/blob/main/src/x.ts)`);
  });
});
