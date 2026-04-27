import { describe, expect, it } from "bun:test";

import { isOcttoForbiddenError, OcttoForbiddenError } from "@/octto/session/errors";

describe("OcttoForbiddenError", () => {
  it("carries the offending octto session id and the actual owner", () => {
    const err = new OcttoForbiddenError("octto-abc", "owner-xyz", "caller-qrs");
    expect(err.octtoSessionId).toBe("octto-abc");
    expect(err.ownerSessionID).toBe("owner-xyz");
    expect(err.callerSessionID).toBe("caller-qrs");
    expect(err.name).toBe("OcttoForbiddenError");
    expect(err instanceof Error).toBe(true);
  });

  it("isOcttoForbiddenError narrows correctly", () => {
    const err: unknown = new OcttoForbiddenError("a", "b", "c");
    expect(isOcttoForbiddenError(err)).toBe(true);
    expect(isOcttoForbiddenError(new Error("nope"))).toBe(false);
    expect(isOcttoForbiddenError("string")).toBe(false);
  });
});
