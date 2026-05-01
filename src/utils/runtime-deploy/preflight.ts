import { existsSync } from "node:fs";
import { $ } from "bun";

import type { PreflightFailed, PreflightResult } from "@/utils/runtime-deploy/types";

const REQUIRED_TOOLS = {
  Rsync: "rsync",
  Bun: "bun",
} as const;

const UNKNOWN_COMMIT = "unknown";

export interface PreflightInput {
  readonly source: string;
  readonly runtime: string;
  readonly force?: boolean;
  readonly skipToolingCheck?: boolean;
  readonly which?: (tool: string) => string | null;
}

export async function runPreflight(input: PreflightInput): Promise<PreflightResult> {
  if (!existsSync(input.source)) {
    return { kind: "failed", reason: "source-missing", detail: `Source path not found: ${input.source}` };
  }

  if (!existsSync(input.runtime)) {
    return { kind: "failed", reason: "runtime-missing", detail: `Runtime path not found: ${input.runtime}` };
  }

  const sourceDirty = await isDirty(input.source);
  if (sourceDirty) {
    return { kind: "failed", reason: "source-dirty", detail: `Source has uncommitted changes: ${input.source}` };
  }

  if (!input.force) {
    const runtimeDirty = await isDirty(input.runtime);
    if (runtimeDirty) {
      return { kind: "failed", reason: "runtime-dirty", detail: `Runtime has uncommitted changes: ${input.runtime}` };
    }
  }

  if (!input.skipToolingCheck) {
    const toolMissing = missingTool(input.which ?? Bun.which);
    if (toolMissing) return toolMissing;
  }

  const sourceCommit = await commitOf(input.source);
  const runtimeCommit = await commitOf(input.runtime);
  return { kind: "ok", sourceCommit, runtimeCommit };
}

async function isDirty(repo: string): Promise<boolean> {
  const out = await $`git -C ${repo} status --porcelain`.text();
  return out.trim().length > 0;
}

async function commitOf(repo: string): Promise<string> {
  try {
    return (await $`git -C ${repo} rev-parse HEAD`.text()).trim();
  } catch {
    // Repos without a HEAD can still be inspected for other preflight failures.
    return UNKNOWN_COMMIT;
  }
}

function missingTool(which: (tool: string) => string | null): PreflightFailed | null {
  if (which(REQUIRED_TOOLS.Rsync) === null) {
    return { kind: "failed", reason: "rsync-missing", detail: "rsync is not installed on PATH" };
  }

  if (which(REQUIRED_TOOLS.Bun) === null) {
    return { kind: "failed", reason: "bun-missing", detail: "bun is not installed on PATH" };
  }

  return null;
}
