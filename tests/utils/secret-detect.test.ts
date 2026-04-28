import { describe, expect, it } from "bun:test";
import { detectSecret } from "@/utils/secret-detect";

describe("detectSecret", () => {
  it("returns null for clean text", () => {
    expect(detectSecret("decided to cache user permissions for 30s")).toBeNull();
  });

  it("flags AWS access keys", () => {
    expect(detectSecret("AKIAIOSFODNN7EXAMPLE")?.reason).toBe("aws_access_key");
  });

  it("flags GitHub PAT prefixes", () => {
    expect(detectSecret("token=ghp_abcdefghijklmnopqrstuvwxyz0123456789")?.reason).toBe("github_token");
  });

  it("flags generic api key patterns", () => {
    expect(detectSecret('api_key: "Z9d0a8e3f5c7b2a1Z9d0a8e3"')?.reason).toBe("generic_secret");
  });

  it("flags PEM blocks", () => {
    expect(detectSecret("-----BEGIN RSA PRIVATE KEY-----")?.reason).toBe("pem_block");
  });

  it("flags JWT-shaped tokens", () => {
    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.SflKxwRJSMeKKF2QT4fwpMeJf36POk6yJV_adQssw5c";
    expect(detectSecret(jwt)?.reason).toBe("jwt");
  });
});
