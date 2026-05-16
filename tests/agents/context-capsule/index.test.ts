import { describe, expect, it } from "bun:test";
import * as capsule from "@/agents/context-capsule";

describe("context capsule module index", () => {
  it("exports the stable public API surface", () => {
    expect(typeof capsule.CAPSULE_STATUSES).toBe("object");
    expect(typeof capsule.slugifyCapsuleTopic).toBe("function");
    expect(typeof capsule.assertCapsuleSafe).toBe("function");
    expect(typeof capsule.applyContextCapsulePrefix).toBe("function");
  });
});
