import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const BUILD_INJECTION_EXPORT = "buildInjectionBlock";
const FORBIDDEN_INDEX_TOKENS = ["injectSkillContext", BUILD_INJECTION_EXPORT, "<skill-context>"] as const;
const MODULE_CANDIDATES = [
  "@/skill-autopilot/runner",
  "@/skill-autopilot/loader",
  "@/skill-autopilot/push-guard",
  "@/skill-autopilot/stale-sweep",
] as const;

async function tryImport(path: string): Promise<Record<string, unknown> | null> {
  try {
    return (await import(path)) as Record<string, unknown>;
  } catch {
    return null;
  }
}

describe("no-injection regression", () => {
  it("has no injector module on disk", () => {
    const root = process.cwd();
    expect(existsSync(join(root, "src/skill-autopilot/injector"))).toBe(false);
    expect(existsSync(join(root, "src/skill-autopilot/injector/hook.ts"))).toBe(false);
  });

  it("has no buildInjectionBlock export from skill-autopilot modules", async () => {
    for (const path of MODULE_CANDIDATES) {
      const module = await tryImport(path);
      if (module === null) continue;

      expect(Object.keys(module)).not.toContain(BUILD_INJECTION_EXPORT);
    }
  });

  it("does not contain chat.params skill injection helper in src/index.ts", () => {
    const text = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    for (const token of FORBIDDEN_INDEX_TOKENS) {
      expect(text).not.toContain(token);
    }
  });
});
