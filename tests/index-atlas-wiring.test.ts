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

  it("plugin exports atlas-translator agent", () => {
    expect(agents["atlas-translator"]).toBeDefined();
    expect(agents["atlas-translator"].mode).toBe("subagent");
  });

  it("atlas tools barrel exposes the three runners", () => {
    expect(typeof atlasTools.runAtlasInit).toBe("function");
    expect(typeof atlasTools.runAtlasStatus).toBe("function");
    expect(typeof atlasTools.runAtlasRefresh).toBe("function");
  });

  it("declares four atlas slash commands including atlas-translate", () => {
    expect(atlasCommandDefinitions).toHaveLength(4);
    const names = atlasCommandDefinitions.map((d) => d.name);
    expect(names).toContain("/atlas-translate");
  });

  it("atlas-translate command has a description mentioning translation", () => {
    const def = atlasCommandDefinitions.find((d) => d.name === "/atlas-translate");
    expect(def).toBeDefined();
    expect(def?.description.toLowerCase()).toContain("translat");
  });
});
