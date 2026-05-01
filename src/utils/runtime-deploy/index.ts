import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { runBuild } from "@/utils/runtime-deploy/build";
import { RUNTIME_DEPLOY_PATHS } from "@/utils/runtime-deploy/paths";
import { runPreflight } from "@/utils/runtime-deploy/preflight";
import { runSync } from "@/utils/runtime-deploy/sync";
import type { DeployReport } from "@/utils/runtime-deploy/types";

const LOCKFILE_NAME = "bun.lock";

export interface RuntimeDeployInput {
  readonly source?: string;
  readonly runtime?: string;
  readonly mode: "dry-run" | "apply";
  readonly force?: boolean;
  readonly skipToolingCheck?: boolean;
  readonly runBuildStep?: boolean;
  readonly minBundleBytes?: number;
}

export async function runRuntimeDeploy(input: RuntimeDeployInput): Promise<DeployReport> {
  const source = input.source ?? RUNTIME_DEPLOY_PATHS.source;
  const runtime = input.runtime ?? RUNTIME_DEPLOY_PATHS.runtime;
  const minBundleBytes = input.minBundleBytes ?? RUNTIME_DEPLOY_PATHS.minBundleBytes;

  const preflight = await runPreflight({
    source,
    runtime,
    force: input.force,
    skipToolingCheck: input.skipToolingCheck,
  });

  if (preflight.kind !== "ok") {
    return { preflight, sync: null, build: null, mode: input.mode, ready: false };
  }

  const runInstall = needsInstall(source, runtime);
  const sync = await runSync({ source, runtime, dryRun: input.mode === "dry-run" });
  if (sync.kind !== "ok") {
    return { preflight, sync, build: null, mode: input.mode, ready: false };
  }

  if (input.mode === "dry-run" || input.runBuildStep === false) {
    return { preflight, sync, build: null, mode: input.mode, ready: false };
  }

  const build = await runBuild({ runtime, runInstall, minBundleBytes });
  const ready = build.kind === "ok";

  return { preflight, sync, build, mode: input.mode, ready };
}

function needsInstall(source: string, runtime: string): boolean {
  const sourceLock = readLock(source);
  const runtimeLock = readLock(runtime);
  if (sourceLock === null && runtimeLock === null) return false;
  return sourceLock !== runtimeLock;
}

function readLock(root: string): string | null {
  const file = join(root, LOCKFILE_NAME);
  if (!existsSync(file)) return null;
  return readFileSync(file, "utf8");
}

export { RUNTIME_DEPLOY_PATHS } from "@/utils/runtime-deploy/paths";
export { formatReport } from "@/utils/runtime-deploy/report";
export type { DeployReport } from "@/utils/runtime-deploy/types";
