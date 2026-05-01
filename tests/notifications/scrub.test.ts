import { describe, expect, it } from "bun:test";

import { containsSecret, scrubSummary } from "@/notifications/scrub";

describe("scrubSummary", () => {
  it("collapses internal whitespace and trims edges", () => {
    expect(scrubSummary("  hello\n\tworld  ", 50)).toBe("hello world");
  });

  it("removes ASCII control characters except space", () => {
    expect(scrubSummary("a\u0001b\u0002c", 50)).toBe("abc");
  });

  it("truncates to maxChars and appends an ellipsis when over budget", () => {
    const long = "x".repeat(300);
    const out = scrubSummary(long, 50);
    expect(out.length).toBe(50);
    expect(out.endsWith("...")).toBe(true);
  });

  it("returns an empty string when input is only whitespace", () => {
    expect(scrubSummary("   \n\t  ", 50)).toBe("");
  });
});

describe("containsSecret", () => {
  it("flags github tokens", () => {
    expect(containsSecret("token=ghp_AAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(true);
  });

  it("does not flag normal plain text", () => {
    expect(containsSecret("Lifecycle finished, please review on octto portal")).toBe(false);
  });
});
