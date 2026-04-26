import { describe, expect, it } from "bun:test";

import { formatForbidden } from "@/tools/octto/forbidden";

describe("formatForbidden", () => {
  it("returns the canonical Markdown error including the offending session id", () => {
    const out = formatForbidden("octto-abc");
    expect(out).toContain("## Forbidden");
    expect(out).toContain("Session octto-abc");
    expect(out).toContain("different OpenCode conversation");
    expect(out).toContain("call start_session in this conversation");
  });
});
