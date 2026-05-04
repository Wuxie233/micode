import { resolve } from "node:path";

import { config } from "@/utils/config";

export interface BoundaryDecision {
  readonly allowed: boolean;
  readonly reason: string;
}

const ALLOWED_REASON = "ok";

export function isWriteAllowedForDirectory(directory: string): BoundaryDecision {
  const dir = resolve(directory);
  const runtime = resolve(config.skillAutopilot.runtimeInstallPath);
  if (dir === runtime || dir.startsWith(`${runtime}/`)) {
    return { allowed: false, reason: `directory equals or is under runtime install path (${runtime})` };
  }
  return { allowed: true, reason: ALLOWED_REASON };
}
