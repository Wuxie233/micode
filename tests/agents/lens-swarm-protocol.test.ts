import { describe, expect, it } from "bun:test";

import { LENS_SWARM_PROTOCOL } from "@/agents/lens-swarm-protocol";

describe("Lens Swarm protocol prompt fragment", () => {
  it("declares swarm as read-only discovery/review, not execution", () => {
    const protocol = LENS_SWARM_PROTOCOL.toLowerCase();

    expect(protocol).toContain("lens swarm protocol");
    expect(protocol).toContain("read-only");
    expect(protocol).toContain("not an execution mechanism");
    expect(protocol).toContain("does not mutate");
  });

  it("enumerates the default lens pool", () => {
    const protocol = LENS_SWARM_PROTOCOL;

    expect(protocol).toContain("history-archaeology");
    expect(protocol).toContain("entrypoint-boundary");
    expect(protocol).toContain("regression-drift-guard");
    expect(protocol).toContain("safety-recovery");
    expect(protocol).toContain("minimal-scope-yagni");
    expect(protocol).toContain("contract-integration");
  });

  it("requires coordinator synthesis and explicit adoption decisions", () => {
    const protocol = LENS_SWARM_PROTOCOL;

    expect(protocol).toContain("coordinator synthesis");
    expect(protocol).toContain("采纳");
    expect(protocol).toContain("不采纳");
    expect(protocol).toContain("Cannot Assess");
  });

  it("keeps critic role compatibility explicit", () => {
    const protocol = LENS_SWARM_PROTOCOL;

    expect(protocol).toContain("critic");
    expect(protocol).toContain("redteam");
    expect(protocol).toContain("yagni");
    expect(protocol).toContain("explicit critic-role compatibility");
  });
});
