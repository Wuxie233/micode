import { describe, expect, it } from "bun:test";
import { assertCapsuleSafe, findCapsuleSecret } from "@/agents/context-capsule/redact";

describe("context capsule redaction safety", () => {
  it("allows clean capsule text", () => {
    expect(assertCapsuleSafe("Implementation note: keep the summary under 500 tokens.")).toEqual({ ok: true });
    expect(findCapsuleSecret("No credentials are present here.")).toBeNull();
  });

  it("flags Authorization headers", () => {
    expect(findCapsuleSecret("Authorization: Bearer abc123")?.reason).toBe("authorization_header");
  });

  it("flags env-style secret assignments", () => {
    expect(findCapsuleSecret("OPENAI_API_KEY=sk-example-value")?.reason).toBe("env_secret_assignment");
  });

  it("flags credential URLs", () => {
    expect(findCapsuleSecret("https://user:pass@example.com/private")?.reason).toBe("credential_url");
  });

  it("flags raw log dumps", () => {
    expect(findCapsuleSecret("[2026-05-17 01:02:03] DEBUG token exchange failed")?.reason).toBe("raw_log_dump");
  });

  it("flags generic secrets using shared detector", () => {
    const result = assertCapsuleSafe('api_key: "Z9d0a8e3f5c7b2a1Z9d0a8e3"');
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.match.reason).toBe("generic_secret");
      expect(result.match.index).toBe(0);
    }
  });
});
