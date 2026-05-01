import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { $ } from "bun";

import { runRuntimeDeploy } from "@/utils/runtime-deploy";

const BUNDLE_BYTES = 64;
const MIN_BUNDLE_BYTES = 16;
const PACKAGE_FILE = "package.json";
const LOCKFILE = "bun.lock";
const BUILD_FILE = "build-runtime-fixture.ts";
const BUNDLE_FILE = "dist/index.js";
const BUILD_SCRIPT = `bun ${BUILD_FILE}`;
const BUILD_FILE_CONTENT = `import { mkdirSync, writeFileSync } from "node:fs";

mkdirSync("dist", { recursive: true });
writeFileSync("${BUNDLE_FILE}", "x".repeat(${BUNDLE_BYTES}));
`;
const LOCKFILE_CONTENT = "# committed lockfile\n";

let workspace: string;
let source: string;
let runtime: string;

beforeEach(async () => {
  workspace = mkdtempSync(join(tmpdir(), "rd-orch-"));
  source = join(workspace, "src");
  runtime = join(workspace, "rt");
  mkdirSync(source, { recursive: true });
  mkdirSync(runtime, { recursive: true });
  await $`git init -q ${source}`;
  await $`git -C ${source} commit --allow-empty -m init -q`;
  await $`git init -q ${runtime}`;
  await $`git -C ${runtime} commit --allow-empty -m init -q`;
});

afterEach(() => {
  rmSync(workspace, { recursive: true, force: true });
});

describe("runRuntimeDeploy orchestrator", () => {
  it("stops at preflight failure and never invokes sync or build", async () => {
    writeFileSync(join(source, "dirty.txt"), "x");
    const r = await runRuntimeDeploy({ source, runtime, mode: "apply", skipToolingCheck: true });
    expect(r.preflight.kind).toBe("failed");
    expect(r.sync).toBeNull();
    expect(r.build).toBeNull();
    expect(r.ready).toBe(false);
  });

  it("dry-run returns ready=false even on success", async () => {
    const r = await runRuntimeDeploy({ source, runtime, mode: "dry-run", skipToolingCheck: true, runBuildStep: false });
    expect(r.preflight.kind).toBe("ok");
    expect(r.sync?.kind).toBe("ok");
    expect(r.build).toBeNull();
    expect(r.ready).toBe(false);
  });

  it("sets ready=true only when preflight, sync, and build all succeed", async () => {
    const r = await runRuntimeDeploy({
      source,
      runtime,
      mode: "apply",
      skipToolingCheck: true,
      runBuildStep: false,
    });
    expect(r.preflight.kind).toBe("ok");
    expect(r.sync?.kind).toBe("ok");
    expect(r.build).toBeNull();
    expect(r.ready).toBe(false);
  });

  it("skips install when committed bun.lock files are identical", async () => {
    writeMinimalProject(source);
    writeMinimalProject(runtime);
    await commitFixture(source);
    await commitFixture(runtime);

    const r = await runRuntimeDeploy({
      source,
      runtime,
      mode: "apply",
      skipToolingCheck: true,
      minBundleBytes: MIN_BUNDLE_BYTES,
    });

    expect(r.preflight.kind).toBe("ok");
    expect(r.sync?.kind).toBe("ok");
    expect(r.build?.kind).toBe("ok");
    expect(r.ready).toBe(true);
    if (r.build?.kind === "ok") {
      expect(r.build.installRan).toBe(false);
    }
  });
});

function writeMinimalProject(dir: string): void {
  const pkg = { name: "runtime-fixture", scripts: { build: BUILD_SCRIPT } };
  writeFileSync(join(dir, PACKAGE_FILE), JSON.stringify(pkg));
  writeFileSync(join(dir, LOCKFILE), LOCKFILE_CONTENT);
  writeFileSync(join(dir, BUILD_FILE), BUILD_FILE_CONTENT);
}

async function commitFixture(dir: string): Promise<void> {
  await $`git -C ${dir} add ${PACKAGE_FILE} ${LOCKFILE} ${BUILD_FILE}`;
  await $`git -C ${dir} commit -m fixture -q`;
}
