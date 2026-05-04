import { join } from "node:path";

import {
  ATLAS_ARCHIVE_DIR,
  ATLAS_BEHAVIOR_DIR,
  ATLAS_CHALLENGES_DIR,
  ATLAS_DECISIONS_DIR,
  ATLAS_DISMISSED_CHALLENGES_FILE,
  ATLAS_IMPL_DIR,
  ATLAS_INDEX_FILE,
  ATLAS_LOCK_FILE,
  ATLAS_LOG_DIR,
  ATLAS_META_DIR,
  ATLAS_RISKS_DIR,
  ATLAS_ROOT_DIRNAME,
  ATLAS_SCHEMA_VERSION_FILE,
  ATLAS_STAGING_DIR,
  ATLAS_TIMELINE_DIR,
} from "./config";

export interface AtlasPaths {
  readonly projectRoot: string;
  readonly root: string;
  readonly impl: string;
  readonly behavior: string;
  readonly decisions: string;
  readonly risks: string;
  readonly timeline: string;
  readonly archive: string;
  readonly meta: string;
  readonly challenges: string;
  readonly log: string;
  readonly staging: string;
  readonly indexFile: string;
  readonly schemaVersionFile: string;
  readonly lockFile: string;
  readonly dismissedChallengesFile: string;
  readonly runStaging: (runId: string) => string;
}

export function createAtlasPaths(projectRoot: string): AtlasPaths {
  const root = join(projectRoot, ATLAS_ROOT_DIRNAME);
  const meta = join(root, ATLAS_META_DIR);
  const challenges = join(meta, ATLAS_CHALLENGES_DIR);
  const staging = join(meta, ATLAS_STAGING_DIR);
  return {
    projectRoot,
    root,
    impl: join(root, ATLAS_IMPL_DIR),
    behavior: join(root, ATLAS_BEHAVIOR_DIR),
    decisions: join(root, ATLAS_DECISIONS_DIR),
    risks: join(root, ATLAS_RISKS_DIR),
    timeline: join(root, ATLAS_TIMELINE_DIR),
    archive: join(root, ATLAS_ARCHIVE_DIR),
    meta,
    challenges,
    log: join(meta, ATLAS_LOG_DIR),
    staging,
    indexFile: join(root, ATLAS_INDEX_FILE),
    schemaVersionFile: join(meta, ATLAS_SCHEMA_VERSION_FILE),
    lockFile: join(meta, ATLAS_LOCK_FILE),
    dismissedChallengesFile: join(challenges, ATLAS_DISMISSED_CHALLENGES_FILE),
    runStaging: (runId: string) => join(staging, runId),
  };
}
