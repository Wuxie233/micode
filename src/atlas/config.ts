export const ATLAS_ROOT_DIRNAME = "atlas";
export const ATLAS_IMPL_DIR = "10-impl";
export const ATLAS_BEHAVIOR_DIR = "20-behavior";
export const ATLAS_DECISIONS_DIR = "40-decisions";
export const ATLAS_RISKS_DIR = "50-risks";
export const ATLAS_TIMELINE_DIR = "60-timeline";
export const ATLAS_ARCHIVE_DIR = "_archive";
export const ATLAS_META_DIR = "_meta";
export const ATLAS_CHALLENGES_DIR = "challenges";
export const ATLAS_LOG_DIR = "log";
export const ATLAS_STAGING_DIR = "staging";

export const ATLAS_SCHEMA_VERSION = 1;
export const ATLAS_SCHEMA_VERSION_FILE = "schema-version";
export const ATLAS_INDEX_FILE = "00-index.md";
export const ATLAS_DISMISSED_CHALLENGES_FILE = "_dismissed.json";
export const ATLAS_LOCK_FILE = ".write.lock";

export const ATLAS_CHALLENGE_CAP_PER_RUN = 20;
export const ATLAS_WORKER_CONCURRENCY_MAX = 6;
export const ATLAS_RECENT_HUMAN_EDIT_LIFECYCLE_WINDOW = 5;
export const ATLAS_CLAIM_HASH_HEX_LENGTH = 12;

const SECONDS_PER_MINUTE = 60;
const MS_PER_SECOND = 1000;
const STALE_LOCK_MINUTES = 30;
export const ATLAS_STALE_LOCK_MS = STALE_LOCK_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;

export const ATLAS_COMMIT_PREFIX = "atlas:";
export const ATLAS_HANDOFF_MARKER_BEGIN = "<!-- micode:atlas:handoff:begin -->";
export const ATLAS_HANDOFF_MARKER_END = "<!-- micode:atlas:handoff:end -->";
export const ATLAS_SPAWN_MARKER_BEGIN = "<!-- micode:atlas:spawn:begin -->";
export const ATLAS_SPAWN_MARKER_END = "<!-- micode:atlas:spawn:end -->";
