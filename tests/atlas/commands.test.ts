import { describe, expect, it } from "bun:test";

import { atlasCommandDefinitions, parseAtlasInitArgs } from "@/atlas/commands";

describe("atlas slash commands", () => {
  it("declares three commands with descriptions", () => {
    const names = atlasCommandDefinitions.map((command) => command.name);
    expect(names).toEqual(["/atlas-init", "/atlas-status", "/atlas-refresh"]);
    for (const command of atlasCommandDefinitions) {
      expect(command.description.length).toBeGreaterThan(0);
    }
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
