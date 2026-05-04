import { existsSync } from "node:fs";

import { writeMaintenanceLog } from "@/atlas/log-writer";
import { createAtlasPaths } from "@/atlas/paths";
import { ATLAS_SPAWN_OUTCOMES } from "@/atlas/types";
import { acquireWriteLock, releaseWriteLock } from "@/atlas/write-lock";
import { runAtlasInit } from "./init";

export interface RefreshInput {
  readonly projectRoot: string;
  readonly target: string;
  readonly initIfMissing?: boolean;
}

export type RefreshOutcome = "ok" | "rejected" | "locked";

export interface RefreshResult {
  readonly outcome: RefreshOutcome;
  readonly reason?: string;
}

const MS_PER_SECOND = 1000;

export async function runAtlasRefresh(input: RefreshInput): Promise<RefreshResult> {
  const paths = createAtlasPaths(input.projectRoot);
  if (!existsSync(paths.root)) {
    if (input.initIfMissing !== true) return { outcome: "rejected", reason: "atlas/ not initialised" };
    await runAtlasInit({ projectRoot: input.projectRoot, mode: "fresh", projectName: "atlas", projectType: "server" });
  }
  const runId = `refresh-${Math.floor(Date.now() / MS_PER_SECOND)}`;
  const lock = await acquireWriteLock(input.projectRoot, runId);
  if (lock === null) return { outcome: "locked", reason: "another atlas run is in progress" };
  try {
    await writeMaintenanceLog(input.projectRoot, {
      runId,
      narrative: `Manual refresh of ${input.target}.`,
      touched: [input.target],
      challenges: [],
      outcome: ATLAS_SPAWN_OUTCOMES.SUCCEEDED,
    });
    return { outcome: "ok" };
  } finally {
    releaseWriteLock(lock);
  }
}
