import { describe, expect, it } from "bun:test";

import { questionPermissionFor } from "../../../src/tools/opencode-question/permission";

describe("questionPermissionFor", () => {
  it("fills question:allow when permission is undefined", () => {
    expect(questionPermissionFor(undefined)).toEqual({ question: "allow" });
  });

  it("fills question:allow when permission is set but lacks question key", () => {
    const input = { edit: "allow" as const, bash: "allow" as const };
    expect(questionPermissionFor(input)).toEqual({
      edit: "allow",
      bash: "allow",
      question: "allow",
    });
  });

  it("preserves a user-supplied question:allow string override", () => {
    const input = { question: "allow" as const, edit: "allow" as const };
    const out = questionPermissionFor(input);
    expect(out).toBe(input);
    expect(out.question).toBe("allow");
  });

  it("preserves a user-supplied question:deny string override (user wins)", () => {
    const input = { question: "deny" as const };
    expect(questionPermissionFor(input)).toBe(input);
    expect(questionPermissionFor(input)).toEqual({ question: "deny" });
  });

  it("preserves a user-supplied question pattern-map override", () => {
    const input = { question: { "secret-*": "deny", "*": "allow" } } as const;
    const out = questionPermissionFor(input);
    expect(out).toBe(input);
    expect(out.question).toEqual({ "secret-*": "deny", "*": "allow" });
  });

  it("does not mutate the input object", () => {
    const input = { edit: "allow" as const };
    const out = questionPermissionFor(input);
    expect(out).not.toBe(input);
    expect((input as Record<string, unknown>).question).toBeUndefined();
  });

  it("does not interfere with edit/bash/webfetch/external_directory keys", () => {
    const input = {
      edit: "allow" as const,
      bash: "ask" as const,
      webfetch: "deny" as const,
      external_directory: { "/tmp/**": "allow" as const, "*": "deny" as const },
    };

    expect(questionPermissionFor(input)).toEqual({
      edit: "allow",
      bash: "ask",
      webfetch: "deny",
      external_directory: { "/tmp/**": "allow", "*": "deny" },
      question: "allow",
    });
  });
});
