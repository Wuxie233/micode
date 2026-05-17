import { describe, expect, it } from "bun:test";

import { CONTEXT_CAPSULE_PROTOCOL } from "@/agents/context-capsule-protocol";
import { octtoAgent } from "@/agents/octto";

describe("octto context capsule prompt", () => {
  const prompt = octtoAgent.prompt ?? "";

  it("injects the shared context capsule protocol and octto v2 hook", () => {
    expect(prompt).toContain(CONTEXT_CAPSULE_PROTOCOL);
    expect(prompt).toContain('<context-capsule-v2-hook scope="octto">');
  });

  it("keeps auto-resume reuse through reusable context capsules explicit", () => {
    expect(prompt).toContain("auto-resume");
    expect(prompt).toContain("findReusableContextCapsule");
  });
});
