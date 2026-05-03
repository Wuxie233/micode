import { existsSync, mkdirSync, rmSync } from "node:fs";

import { createAtlasPaths } from "./paths";

export interface StagingManager {
  readonly projectRoot: string;
  readonly runId: string;
  readonly dir: string;
  readonly create: () => void;
  readonly cleanup: () => void;
  readonly rollback: () => void;
}

export function createStagingManager(projectRoot: string, runId: string): StagingManager {
  const paths = createAtlasPaths(projectRoot);
  const dir = paths.runStaging(runId);
  return {
    projectRoot,
    runId,
    dir,
    create: () => {
      if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
    },
    cleanup: () => {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    },
    rollback: () => {
      if (existsSync(dir)) rmSync(dir, { recursive: true, force: true });
    },
  };
}
