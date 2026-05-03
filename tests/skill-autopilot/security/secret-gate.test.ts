import { describe, expect, it } from "bun:test";

import { dedupeKeyFor, sanitizeCandidateInput } from "@/skill-autopilot/security/secret-gate";

describe("secret-gate (lifted from #24 sanitize.ts)", () => {
  it("rejects trigger containing a secret", () => {
    const r = sanitizeCandidateInput({ trigger: "use AKIAABCDEFGHIJKLMNOP", steps: ["x"] });
    expect(r.ok).toBe(false);
  });

  it("dedupeKeyFor is stable for normalized input", () => {
    const a = dedupeKeyFor({ trigger: "  t  ", steps: ["a"] });
    const b = dedupeKeyFor({ trigger: "t", steps: ["a"] });
    expect(a).toBe(b);
  });
});
