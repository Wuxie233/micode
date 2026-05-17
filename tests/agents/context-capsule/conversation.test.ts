import { describe, expect, it } from "bun:test";
import { resolveConversationAnchor } from "@/agents/context-capsule/conversation";

describe("context capsule conversation anchor", () => {
  it("returns null for missing, empty, and whitespace-only session ids", () => {
    expect(resolveConversationAnchor(null)).toBeNull();
    expect(resolveConversationAnchor(undefined)).toBeNull();
    expect(resolveConversationAnchor("")).toBeNull();
    expect(resolveConversationAnchor("   \n\t  ")).toBeNull();
  });

  it("returns a deterministic 16-character lowercase hex anchor", () => {
    const anchor = resolveConversationAnchor("session-abc-123");

    expect(anchor).toMatch(/^[a-f0-9]{16}$/);
    expect(resolveConversationAnchor("session-abc-123")).toBe(anchor);
  });

  it("returns different anchors for different session ids", () => {
    expect(resolveConversationAnchor("session-abc-123")).not.toBe(resolveConversationAnchor("session-def-456"));
  });

  it("does not leak raw session id substrings", () => {
    const sessionId = "sensitive-session-id-987654321";
    const anchor = resolveConversationAnchor(sessionId);

    expect(anchor).not.toContain("sensitive");
    expect(anchor).not.toContain("session");
    expect(anchor).not.toContain("987654321");
  });

  it("trims whitespace before hashing", () => {
    expect(resolveConversationAnchor("  session-abc-123\n")).toBe(resolveConversationAnchor("session-abc-123"));
  });
});
