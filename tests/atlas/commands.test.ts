import { describe, expect, it } from "bun:test";

import { atlasCommandDefinitions, parseAtlasInitArgs } from "@/atlas/commands";

describe("atlas slash commands", () => {
  it("declares three commands with descriptions", () => {
    const names = atlasCommandDefinitions.map((command) => command.name);
    expect(names).toEqual(["/atlas-init", "/atlas-status", "/atlas-refresh"]);
    for (const command of atlasCommandDefinitions) {
      expect(command.description.length).toBeGreaterThan(0);
    }
    const atlasInitDescription = [
      "Cold-start the project atlas vault: discover, plan, optionally ask Octto questions,",
      "and write a usable Obsidian vault (use --reconcile or --force-rebuild on existing vaults)",
    ].join(" ");
    expect(atlasCommandDefinitions[0]?.description).toBe(atlasInitDescription);
  });

  it("parses --reconcile and --force-rebuild flags for /atlas-init", () => {
    expect(parseAtlasInitArgs([])).toEqual({ mode: "fresh" });
    expect(parseAtlasInitArgs(["--reconcile"])).toEqual({ mode: "reconcile" });
    expect(parseAtlasInitArgs(["--force-rebuild"])).toEqual({ mode: "force-rebuild" });
  });

  it("rejects unknown flags", () => {
    expect(() => parseAtlasInitArgs(["--weird"])).toThrow();
  });

  it("rejects passing both --reconcile and --force-rebuild", () => {
    expect(() => parseAtlasInitArgs(["--reconcile", "--force-rebuild"])).toThrow();
  });
});
