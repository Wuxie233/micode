import { describe, expect, it } from "bun:test";

import { decideRewireOrChallenge } from "@/atlas/rewire-guard";

describe("decideRewireOrChallenge", () => {
  it("returns rewire when target was not human-edited", () => {
    const decision = decideRewireOrChallenge({
      target: "10-impl/x.md",
      humanEdited: false,
      runsSinceEdit: 100,
      windowSize: 5,
    });
    expect(decision.action).toBe("rewire");
  });

  it("returns challenge when human-edited within window", () => {
    const decision = decideRewireOrChallenge({
      target: "10-impl/x.md",
      humanEdited: true,
      runsSinceEdit: 2,
      windowSize: 5,
    });
    expect(decision.action).toBe("challenge");
  });

  it("returns rewire when human-edited but outside window", () => {
    const decision = decideRewireOrChallenge({
      target: "10-impl/x.md",
      humanEdited: true,
      runsSinceEdit: 10,
      windowSize: 5,
    });
    expect(decision.action).toBe("rewire");
  });
});
