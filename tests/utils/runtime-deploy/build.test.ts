import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { runBuild } from "@/utils/runtime-deploy/build";

const MIN_BUNDLE_BYTES = 1024;
const BUNDLE_BYTES = 2048;
const PASSING_BUILD = "exit 0";
const FAILING_BUILD = "exit 7";
const SMALL_BUNDLE = "x";
const INVALID_PACKAGE_JSON = "{";

let runtime: string;

beforeEach(() => {
  runtime = mkdtempSync(join(tmpdir(), "rd-build-"));
});

afterEach(() => {
  rmSync(runtime, { recursive: true, force: true });
});

describe("runBuild", () => {
  it("verifies an existing bundle when build script succeeds", async () => {
    writeFakePackage(runtime, PASSING_BUILD);
    mkdirSync(join(runtime, "dist"), { recursive: true });
    writeFileSync(join(runtime, "dist", "index.js"), SMALL_BUNDLE.repeat(BUNDLE_BYTES));
    const r = await runBuild({ runtime, runInstall: false, minBundleBytes: MIN_BUNDLE_BYTES });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.bundleBytes).toBeGreaterThanOrEqual(BUNDLE_BYTES);
      expect(r.installRan).toBe(false);
    }
  });

  it("runs install before a successful build when requested", async () => {
    writeFakePackage(runtime, PASSING_BUILD);
    mkdirSync(join(runtime, "dist"), { recursive: true });
    writeFileSync(join(runtime, "dist", "index.js"), SMALL_BUNDLE.repeat(BUNDLE_BYTES));
    const r = await runBuild({ runtime, runInstall: true, minBundleBytes: MIN_BUNDLE_BYTES });
    expect(r.kind).toBe("ok");
    if (r.kind === "ok") {
      expect(r.installRan).toBe(true);
    }
  });

  it("fails with stage=install when install exits non-zero", async () => {
    writeFileSync(join(runtime, "package.json"), INVALID_PACKAGE_JSON);
    const r = await runBuild({ runtime, runInstall: true, minBundleBytes: MIN_BUNDLE_BYTES });
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.stage).toBe("install");
  });

  it("fails when bundle is missing after build", async () => {
    writeFakePackage(runtime, PASSING_BUILD);
    const r = await runBuild({ runtime, runInstall: false, minBundleBytes: MIN_BUNDLE_BYTES });
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.stage).toBe("verify");
  });

  it("fails when bundle is too small", async () => {
    writeFakePackage(runtime, PASSING_BUILD);
    mkdirSync(join(runtime, "dist"), { recursive: true });
    writeFileSync(join(runtime, "dist", "index.js"), SMALL_BUNDLE);
    const r = await runBuild({ runtime, runInstall: false, minBundleBytes: MIN_BUNDLE_BYTES });
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.stage).toBe("verify");
  });

  it("fails with stage=build when build script exits non-zero", async () => {
    writeFakePackage(runtime, FAILING_BUILD);
    const r = await runBuild({ runtime, runInstall: false, minBundleBytes: MIN_BUNDLE_BYTES });
    expect(r.kind).toBe("failed");
    if (r.kind === "failed") expect(r.stage).toBe("build");
  });
});

function writeFakePackage(dir: string, buildBody: string): void {
  const pkg = { name: "fake", scripts: { build: `sh -c "${buildBody}"` } };
  writeFileSync(join(dir, "package.json"), JSON.stringify(pkg));
}
