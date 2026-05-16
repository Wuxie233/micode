import { describe, expect, it } from "bun:test";

import { createLifecycleTools } from "@/tools/lifecycle";

describe("lifecycle tool index lost update audit wiring", () => {
  it("registers lifecycle_lost_update_audit", () => {
    const tools = createLifecycleTools({} as never);
    expect(Object.keys(tools)).toContain("lifecycle_lost_update_audit");
  });
});
