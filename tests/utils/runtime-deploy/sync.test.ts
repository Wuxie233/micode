import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runSync } from "@/utils/runtime-deploy/sync";

let workspace: string;
let source: string;
let runtime: string;

beforeEach(() => {
  workspace = mkdtempSync(join(tmpdir(), "rd-sync-"));
  source = join(workspace, "src");
  runtime = join(workspace, "rt");
  mkdirSync(source, { recursive: true });
  mkdirSync(runtime, { recursive: true });
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("runSync", () => {
  it("copies project files into the runtime path", async () => {
    writeFileSync(join(source, "a.ts"), "export const a = 1;");
    const r = await runSync({ source, runtime, dryRun: false });
    expect(r.kind).toBe("ok");
    expect(existsSync(join(runtime, "a.ts"))).toBe(true);
    expect(readFileSync(join(runtime, "a.ts"), "utf8")).toBe("export const a = 1;");
  });

  it("preserves runtime-local node_modules", async () => {
    mkdirSync(join(runtime, "node_modules"), { recursive: true });
    writeFileSync(join(runtime, "node_modules", "marker.txt"), "keep");
    writeFileSync(join(source, "a.ts"), "x");
    await runSync({ source, runtime, dryRun: false });
    expect(existsSync(join(runtime, "node_modules", "marker.txt"))).toBe(true);
  });

  it("preserves runtime-local thoughts directory", async () => {
    mkdirSync(join(runtime, "thoughts"), { recursive: true });
    writeFileSync(join(runtime, "thoughts", "ledger.md"), "keep");
    writeFileSync(join(source, "a.ts"), "x");
    await runSync({ source, runtime, dryRun: false });
    expect(existsSync(join(runtime, "thoughts", "ledger.md"))).toBe(true);
  });

  it("preserves runtime-local log files through wildcard exclusion", async () => {
    writeFileSync(join(runtime, "debug.log"), "keep");
    writeFileSync(join(source, "a.ts"), "x");
    await runSync({ source, runtime, dryRun: false });
    expect(readFileSync(join(runtime, "debug.log"), "utf8")).toBe("keep");
  });

  it("removes stale project files in runtime", async () => {
    writeFileSync(join(runtime, "stale.ts"), "old");
    writeFileSync(join(source, "fresh.ts"), "new");
    await runSync({ source, runtime, dryRun: false });
    expect(existsSync(join(runtime, "stale.ts"))).toBe(false);
    expect(existsSync(join(runtime, "fresh.ts"))).toBe(true);
  });

  it("does not write anything in dry-run mode", async () => {
    writeFileSync(join(source, "a.ts"), "x");
    const r = await runSync({ source, runtime, dryRun: true });
    expect(r.kind).toBe("ok");
    expect(existsSync(join(runtime, "a.ts"))).toBe(false);
  });
});
