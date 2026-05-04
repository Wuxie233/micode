import { describe, expect, it } from "bun:test";

import { validateUserPerspective } from "@/lifecycle/user-perspective-guard";

describe("validateUserPerspective", () => {
  it("accepts a file with a populated User Perspective section", () => {
    const result = validateUserPerspective(`# Title\n\n## User Perspective\n\nThe user wants Y.\n\n## Other\n`);
    expect(result.ok).toBe(true);
  });

  it("rejects a file without the section heading", () => {
    const result = validateUserPerspective(`# Title\n\n## Approach\n\nx\n`);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("User Perspective");
  });

  it("rejects when the section is empty", () => {
    const result = validateUserPerspective(`## User Perspective\n\n## Other\n`);
    expect(result.ok).toBe(false);
    expect(result.reason).toContain("non-empty");
  });

  it("trims leading whitespace lines when checking emptiness", () => {
    const result = validateUserPerspective(`## User Perspective\n   \n\n## Other\n`);
    expect(result.ok).toBe(false);
  });
});
