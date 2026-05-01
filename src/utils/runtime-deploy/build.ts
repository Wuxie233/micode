// Runs install (when needed) and `bun run build` in the runtime checkout, then
// verifies the produced dist/index.js is present and non-trivial.

import { existsSync, statSync } from "node:fs";
import { join } from "node:path";
import { $ } from "bun";

import type { BuildResult } from "@/utils/runtime-deploy/types";

export interface BuildInput {
  readonly runtime: string;
  readonly runInstall: boolean;
  readonly minBundleBytes: number;
}

export async function runBuild(input: BuildInput): Promise<BuildResult> {
  if (input.runInstall) {
    const install = await $`bun install --frozen-lockfile`.cwd(input.runtime).nothrow().quiet();
    if (install.exitCode !== 0) {
      return { kind: "failed", stage: "install", detail: install.stderr.toString().trim() || "install failed" };
    }
  }

  const build = await $`bun run build`.cwd(input.runtime).nothrow().quiet();
  if (build.exitCode !== 0) {
    return { kind: "failed", stage: "build", detail: build.stderr.toString().trim() || "build failed" };
  }

  const bundle = join(input.runtime, "dist", "index.js");
  if (!existsSync(bundle)) {
    return { kind: "failed", stage: "verify", detail: `bundle missing: ${bundle}` };
  }

  const size = statSync(bundle).size;
  if (size < input.minBundleBytes) {
    return { kind: "failed", stage: "verify", detail: `bundle smaller than ${input.minBundleBytes} bytes: ${size}` };
  }

  return { kind: "ok", bundleBytes: size, installRan: input.runInstall };
}
