import { describe, expect, it } from "bun:test";

import { atlasCommandDefinitions, parseAtlasInitArgs, parseAtlasTranslateArgs } from "@/atlas/commands";

describe("atlas slash commands", () => {
  it("declares four commands with descriptions", () => {
    const names = atlasCommandDefinitions.map((command) => command.name);
    expect(names).toEqual(["/atlas-init", "/atlas-status", "/atlas-refresh", "/atlas-translate"]);
    for (const command of atlasCommandDefinitions) {
      expect(command.description.length).toBeGreaterThan(0);
    }
  });

  it("atlas-init description mentions reconcile and force-rebuild", () => {
    const init = atlasCommandDefinitions.find((c) => c.name === "/atlas-init");
    expect(init?.description).toContain("--reconcile");
    expect(init?.description).toContain("--force-rebuild");
  });

  it("atlas-translate description mentions translation and optional path", () => {
    const translate = atlasCommandDefinitions.find((c) => c.name === "/atlas-translate");
    expect(translate?.description.toLowerCase()).toContain("translat");
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

  it("parseAtlasTranslateArgs defaults to 'all' when no argument is given", () => {
    expect(parseAtlasTranslateArgs([])).toEqual({ target: "all" });
  });

  it("parseAtlasTranslateArgs returns the provided path argument", () => {
    expect(parseAtlasTranslateArgs(["20-behavior"])).toEqual({ target: "20-behavior" });
    expect(parseAtlasTranslateArgs(["10-impl/runner.md"])).toEqual({ target: "10-impl/runner.md" });
  });
});
