import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAtlasAutoInjectHook } from "@/hooks/atlas-auto-inject";

const ATLAS_PROTOCOL_FOOTER =
  "Atlas mental model protocol: active. Report final status with one of: " +
  "consulted | no-change | delta-created | stale-detected | blocked | cannot-assess.";

const writeAtlasIndex = (root: string, body: string): void => {
  mkdirSync(join(root, "atlas"), { recursive: true });
  writeFileSync(join(root, "atlas", "00-index.md"), body);
};

const makeCtx = (directory: string) => ({ directory }) as unknown as Parameters<typeof createAtlasAutoInjectHook>[0];

describe("createAtlasAutoInjectHook", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "atlas-auto-inject-hook-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("injects <atlas-context> into system prompt for brainstormer when atlas exists", async () => {
    writeAtlasIndex(testDir, "# micode Atlas Index\n\nProject map root.\n");
    const hook = createAtlasAutoInjectHook(makeCtx(testDir));
    const output: { options?: Record<string, unknown>; system?: string } = {
      options: { agent: "brainstormer" },
      system: "EXISTING_SYSTEM",
    };

    await hook["chat.params"]({ sessionID: "s1" }, output);

    expect(output.system).toContain("<atlas-context>");
    expect(output.system).toContain("</atlas-context>");
    expect(output.system).toContain("# micode Atlas Index");
    expect(output.system).toContain(ATLAS_PROTOCOL_FOOTER);
    expect(output.system).toContain("EXISTING_SYSTEM");
    expect((output.system ?? "").indexOf("# micode Atlas Index")).toBeLessThan(
      (output.system ?? "").indexOf(ATLAS_PROTOCOL_FOOTER),
    );
    expect((output.system ?? "").indexOf(ATLAS_PROTOCOL_FOOTER)).toBeLessThan(
      (output.system ?? "").indexOf("</atlas-context>"),
    );
    // injected block should be prepended (visible before existing content)
    expect((output.system ?? "").indexOf("<atlas-context>")).toBeLessThan(
      (output.system ?? "").indexOf("EXISTING_SYSTEM"),
    );
  });

  it("injects for planner agent", async () => {
    writeAtlasIndex(testDir, "# micode Atlas Index\n\nProject map root.\n");
    const hook = createAtlasAutoInjectHook(makeCtx(testDir));
    const output: { options?: Record<string, unknown>; system?: string } = {
      options: { agent: "planner" },
    };

    await hook["chat.params"]({ sessionID: "s2" }, output);

    expect(output.system).toBeDefined();
    expect(output.system).toContain("<atlas-context>");
    expect(output.system).toContain("# micode Atlas Index");
    expect(output.system).toContain(ATLAS_PROTOCOL_FOOTER);
  });

  it("does NOT inject for commander", async () => {
    writeAtlasIndex(testDir, "# micode Atlas Index\n\nProject map root.\n");
    const hook = createAtlasAutoInjectHook(makeCtx(testDir));
    const output: { options?: Record<string, unknown>; system?: string } = {
      options: { agent: "commander" },
      system: "EXISTING_SYSTEM",
    };

    await hook["chat.params"]({ sessionID: "s3" }, output);

    expect(output.system).toBe("EXISTING_SYSTEM");
  });

  it("does NOT inject when agent is unset", async () => {
    writeAtlasIndex(testDir, "# micode Atlas Index\n\nProject map root.\n");
    const hook = createAtlasAutoInjectHook(makeCtx(testDir));
    const output: { options?: Record<string, unknown>; system?: string } = {
      system: "EXISTING_SYSTEM",
    };

    await hook["chat.params"]({ sessionID: "s4" }, output);

    expect(output.system).toBe("EXISTING_SYSTEM");
  });

  it("does NOT inject for unknown subagent (e.g. executor, reviewer)", async () => {
    writeAtlasIndex(testDir, "# micode Atlas Index\n\nProject map root.\n");
    const hook = createAtlasAutoInjectHook(makeCtx(testDir));
    const output: { options?: Record<string, unknown>; system?: string } = {
      options: { agent: "executor" },
      system: "EXISTING_SYSTEM",
    };

    await hook["chat.params"]({ sessionID: "s5" }, output);

    expect(output.system).toBe("EXISTING_SYSTEM");
  });

  it("leaves system prompt untouched when atlas vault is missing", async () => {
    // no atlas/ directory created
    const hook = createAtlasAutoInjectHook(makeCtx(testDir));
    const output: { options?: Record<string, unknown>; system?: string } = {
      options: { agent: "brainstormer" },
      system: "EXISTING_SYSTEM",
    };

    await hook["chat.params"]({ sessionID: "s6" }, output);

    expect(output.system).toBe("EXISTING_SYSTEM");
  });

  it("leaves system prompt untouched when atlas/00-index.md is missing", async () => {
    mkdirSync(join(testDir, "atlas"), { recursive: true });
    const hook = createAtlasAutoInjectHook(makeCtx(testDir));
    const output: { options?: Record<string, unknown>; system?: string } = {
      options: { agent: "brainstormer" },
      system: "EXISTING_SYSTEM",
    };

    await hook["chat.params"]({ sessionID: "s7" }, output);

    expect(output.system).toBe("EXISTING_SYSTEM");
  });

  it("creates output.system when none was set originally", async () => {
    writeAtlasIndex(testDir, "# micode Atlas Index\n\nProject map root.\n");
    const hook = createAtlasAutoInjectHook(makeCtx(testDir));
    const output: { options?: Record<string, unknown>; system?: string } = {
      options: { agent: "brainstormer" },
    };

    await hook["chat.params"]({ sessionID: "s8" }, output);

    expect(output.system).toBeDefined();
    expect(output.system).toContain("<atlas-context>");
  });

  it("does not throw and does not mutate system when getAtlasSummary throws", async () => {
    // Create a vault with index, but make the index a directory to provoke read failure.
    mkdirSync(join(testDir, "atlas", "00-index.md"), { recursive: true });
    const hook = createAtlasAutoInjectHook(makeCtx(testDir));
    const output: { options?: Record<string, unknown>; system?: string } = {
      options: { agent: "brainstormer" },
      system: "EXISTING_SYSTEM",
    };

    await hook["chat.params"]({ sessionID: "s9" }, output);

    expect(output.system).toBe("EXISTING_SYSTEM");
  });
});
