import { describe, expect, it } from "bun:test";

import { agents, brainstormScoutAgent } from "@/agents/index";
import { DEFAULT_MODEL } from "@/utils/config";

describe("brainstorm-scout registration", () => {
  it("registers brainstorm-scout at the default model", () => {
    expect(agents["brainstorm-scout"]).toBeDefined();
    expect(agents["brainstorm-scout"].mode).toBe("subagent");
    expect(agents["brainstorm-scout"].model).toBe(DEFAULT_MODEL);
  });

  it("registers brainstorm-scout with read-only tool restrictions", () => {
    const agent = agents["brainstorm-scout"];

    expect(agent.tools?.write).toBe(false);
    expect(agent.tools?.edit).toBe(false);
    expect(agent.tools?.bash).toBe(false);
    expect(agent.tools?.task).toBe(false);
  });

  it("re-exports brainstormScoutAgent from the agents barrel", () => {
    expect(brainstormScoutAgent).toBeDefined();
    expect(brainstormScoutAgent.mode).toBe("subagent");
  });
});
