import { describe, expect, it } from "bun:test";

import { agents } from "@/agents";

describe("notification-courier agent registration", () => {
  it("is registered in the agents map under the kebab-case name", () => {
    expect(agents["notification-courier"]).toBeDefined();
  });

  it("is registered as a subagent", () => {
    expect(agents["notification-courier"]?.mode).toBe("subagent");
  });
});
