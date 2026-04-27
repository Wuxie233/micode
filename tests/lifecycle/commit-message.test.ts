import { describe, expect, it } from "bun:test";

import { buildLifecycleCommitMessage } from "@/lifecycle/commit-message";

describe("buildLifecycleCommitMessage", () => {
  it("builds a conventional commit message with issue reference", () => {
    expect(
      buildLifecycleCommitMessage({
        type: "feat",
        scope: "lifecycle",
        summary: "add commit flow",
        issueNumber: 12,
      }),
    ).toBe("feat(lifecycle): add commit flow (#12)");
  });

  it("throws for empty scope", () => {
    expect(() =>
      buildLifecycleCommitMessage({
        type: "fix",
        scope: "",
        summary: "repair commit flow",
        issueNumber: 1,
      }),
    ).toThrow("Invalid commit scope: ");
  });

  it("throws for invalid scope characters", () => {
    expect(() =>
      buildLifecycleCommitMessage({
        type: "chore",
        scope: "Bad_Scope",
        summary: "prepare commit flow",
        issueNumber: 1,
      }),
    ).toThrow("Invalid commit scope: Bad_Scope");
  });

  it("throws for multi-line summary", () => {
    expect(() =>
      buildLifecycleCommitMessage({
        type: "docs",
        scope: "lifecycle",
        summary: "document commit flow\nwith details",
        issueNumber: 1,
      }),
    ).toThrow("Commit summary must be single-line");
  });

  it("throws for non-positive issue number", () => {
    expect(() =>
      buildLifecycleCommitMessage({
        type: "test",
        scope: "lifecycle",
        summary: "cover commit flow",
        issueNumber: 0,
      }),
    ).toThrow("Invalid issue number: 0");
  });
});
