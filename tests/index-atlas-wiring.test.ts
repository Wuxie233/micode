import { describe, expect, it } from "bun:test";

import { agents } from "@/agents";
import { atlasCommandDefinitions } from "@/atlas/commands";
import * as atlasTools from "@/tools/atlas";

describe("atlas wiring", () => {
  it("plugin exports atlas agents", () => {
    expect(agents["atlas-compiler"]).toBeDefined();
    expect(agents["atlas-worker-build"]).toBeDefined();
    expect(agents["atlas-worker-behavior"]).toBeDefined();
  });

  it("atlas tools barrel exposes the three runners", () => {
    expect(typeof atlasTools.runAtlasInit).toBe("function");
    expect(typeof atlasTools.runAtlasStatus).toBe("function");
    expect(typeof atlasTools.runAtlasRefresh).toBe("function");
  });

  it("declares four atlas slash commands", () => {
    const names = atlasCommandDefinitions.map((command) => command.name);

    expect(atlasCommandDefinitions).toHaveLength(4);
    expect(names).toContain("/atlas-translate");
  });
});
