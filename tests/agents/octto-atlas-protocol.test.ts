import { describe, expect, it } from "bun:test";

import { ATLAS_MENTAL_MODEL_PROTOCOL } from "@/agents/atlas-mental-model";
import { octtoAgent } from "@/agents/octto";

describe("octto prompt atlas protocol injection", () => {
  it("includes the canonical ATLAS_MENTAL_MODEL_PROTOCOL string", () => {
    expect(octtoAgent.prompt).toContain(ATLAS_MENTAL_MODEL_PROTOCOL);
  });

  it("does not duplicate the protocol block", () => {
    const p = octtoAgent.prompt ?? "";
    const matches = p.match(/<atlas-mental-model/gu) ?? [];
    expect(matches.length).toBe(1);
  });
});
