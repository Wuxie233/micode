// src/utils/config.ts
// Centralized configuration constants
// Organized by domain for easy discovery and maintenance

import { homedir } from "node:os";
import { join } from "node:path";

const BYTES_PER_KB = 1024;
const LARGE_FILE_KB = 100;
const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const ANSWER_TIMEOUT_MINUTES = 5;
const REVIEW_TIMEOUT_MINUTES = 10;
const SUBAGENT_TRANSIENT_BACKOFF_FIRST_MS = 5000;
const SUBAGENT_TRANSIENT_BACKOFF_SECOND_MS = 15_000;

const OCTTO_PORT_ENV = "OCTTO_PORT";
const OCTTO_PUBLIC_BASE_URL_ENV = "OCTTO_PUBLIC_BASE_URL";
const OCTTO_PORTAL_TOKEN_ENV = "OCTTO_PORTAL_TOKEN";
const OCTTO_PORTAL_BASE_URL_ENV = "OCTTO_PORTAL_BASE_URL";
const OCTTO_PORT_DEFAULT = 0;
const OCTTO_PORT_MIN = 0;
const OCTTO_PORT_MAX = 65_535;
const OCTTO_PUBLIC_BASE_URL_DEFAULT = "";
const TRAILING_SLASH_PATTERN = /\/+$/;
const DECIMAL_RADIX = 10;

function readOcttoPort(): number {
  const raw = process.env[OCTTO_PORT_ENV];
  if (raw === undefined || raw === "") return OCTTO_PORT_DEFAULT;
  const parsed = Number.parseInt(raw, DECIMAL_RADIX);
  if (!Number.isFinite(parsed) || parsed < OCTTO_PORT_MIN || parsed > OCTTO_PORT_MAX) {
    return OCTTO_PORT_DEFAULT;
  }
  return parsed;
}

function readOcttoPublicBaseUrl(): string {
  const raw = process.env[OCTTO_PUBLIC_BASE_URL_ENV];
  if (raw === undefined) return OCTTO_PUBLIC_BASE_URL_DEFAULT;
  return raw.trim().replace(TRAILING_SLASH_PATTERN, "");
}

function readOcttoPortalToken(): string {
  return (process.env[OCTTO_PORTAL_TOKEN_ENV] ?? "").trim();
}

function readOcttoPortalBaseUrl(): string {
  const raw = process.env[OCTTO_PORTAL_BASE_URL_ENV];
  if (raw === undefined) return "https://octto.wuxie233.com";
  return raw.trim().replace(TRAILING_SLASH_PATTERN, "");
}

/**
 * Application configuration constants.
 * All values are compile-time constants - no runtime configuration.
 */
export const config = {
  /**
   * Auto-compaction settings
   */
  compaction: {
    /** Trigger compaction when context usage exceeds this ratio */
    threshold: 0.7,
    /** Minimum time between compaction attempts (ms) */
    cooldownMs: 120_000,
    /** Maximum time to wait for compaction to complete (ms) */
    timeoutMs: 120_000,
  },

  /**
   * Context window monitoring settings
   */
  contextWindow: {
    /** Show warning when context usage exceeds this ratio */
    warningThreshold: 0.7,
    /** Show critical warning when context usage exceeds this ratio */
    criticalThreshold: 0.85,
    /** Minimum time between warning toasts (ms) */
    warningCooldownMs: 120_000,
  },

  /**
   * Token estimation settings
   */
  tokens: {
    /** Characters per token for estimation */
    charsPerToken: 4,
    /** Default context window limit (tokens) */
    defaultContextLimit: 200_000,
    /** Default max output tokens */
    defaultMaxOutputTokens: 50_000,
    /** Safety margin for output (ratio of remaining context) */
    safetyMargin: 0.5,
    /** Lines to preserve when truncating output */
    preserveHeaderLines: 3,
  },

  /**
   * File path patterns and directories
   */
  paths: {
    /** Directory for ledger files */
    ledgerDir: "thoughts/ledgers",
    /** Prefix for ledger filenames */
    ledgerPrefix: "CONTINUITY_",
    /** Context files to inject from project root */
    rootContextFiles: ["README.md", "ARCHITECTURE.md", "CODE_STYLE.md"] as readonly string[],
    /** Context files to collect when walking up directories */
    dirContextFiles: ["README.md"] as readonly string[],
    /** Pattern to match plan files */
    planPattern: /thoughts\/shared\/plans\/.*\.md$/,
    /** Pattern to match ledger files */
    ledgerPattern: /thoughts\/ledgers\/CONTINUITY_.*\.md$/,
    /** Directory for mindmodel files */
    mindmodelDir: ".mindmodel",
    /** Mindmodel manifest filename */
    mindmodelManifest: "manifest.yaml",
    /** Mindmodel system file */
    mindmodelSystem: "system.md",
  },

  /**
   * Timeout settings
   */
  timeouts: {
    /** BTCA command timeout (ms) */
    btcaMs: 120_000,
    /** Success toast duration (ms) */
    toastSuccessMs: 3000,
    /** Warning toast duration (ms) */
    toastWarningMs: 4000,
    /** Error toast duration (ms) */
    toastErrorMs: 5000,
  },

  /**
   * Various limits
   */
  limits: {
    /** File size threshold for triggering extraction (bytes) */
    largeFileBytes: LARGE_FILE_KB * BYTES_PER_KB,
    /** Max lines to return without extraction */
    maxLinesNoExtract: 200,
    /** Max lines in PTY buffer */
    ptyMaxBufferLines: 50_000,
    /** Default read limit for PTY */
    ptyDefaultReadLimit: 500,
    /** Max line length for PTY output */
    ptyMaxLineLength: 2000,
    /** Max matches to show from ast-grep */
    astGrepMaxMatches: 100,
    /** Context cache TTL (ms) */
    contextCacheTtlMs: 30_000,
    /** Max entries in context cache */
    contextCacheMaxSize: 100,
  },

  /**
   * Octto (browser-based brainstorming) settings
   */
  octto: {
    /** Answer timeout (ms) - 5 minutes */
    answerTimeoutMs: ANSWER_TIMEOUT_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND,
    /** Review timeout (ms) - 10 minutes */
    reviewTimeoutMs: REVIEW_TIMEOUT_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND,
    /** Max iterations in brainstorm loop */
    maxIterations: 50,
    /** Max follow-up questions per branch */
    maxQuestions: 15,
    /** State directory for brainstorm sessions */
    stateDir: "thoughts/brainstorms",
    /** Bind address for brainstorm server */
    bindAddress: "127.0.0.1",
    /** Allow overriding bind address for remote access */
    allowRemoteBind: false,
    /** Server port (0 = Bun chooses a free port). Read from OCTTO_PORT env var. */
    port: readOcttoPort(),
    /** Public base URL for session links when running behind a reverse proxy. Read from OCTTO_PUBLIC_BASE_URL env var. */
    publicBaseUrl: readOcttoPublicBaseUrl(),
    portalToken: readOcttoPortalToken(),
    portalBaseUrl: readOcttoPortalBaseUrl(),
    persistedSessionTtlHours: 168,
    persistedSessionsDir: "thoughts/octto/sessions",
    conversationsPollIntervalMs: 3000,
  },

  lifecycle: {
    autoPush: true,
    mergeStrategy: "auto" as "auto" | "pr" | "local-merge",
    failedSessionTtlHours: 24,
    pushRetryBackoffMs: 5000,
    prCheckTimeoutMs: 600_000,
    lifecycleDir: "thoughts/lifecycle",
  },

  subagent: {
    transientRetries: 2,
    transientBackoffMs: [
      SUBAGENT_TRANSIENT_BACKOFF_FIRST_MS,
      SUBAGENT_TRANSIENT_BACKOFF_SECOND_MS,
    ] as readonly number[],
    maxResumesPerSession: 3,
    failedSessionTtlHours: 24,
    resumeSweepIntervalMs: 600_000,
  },

  /**
   * Model settings
   */
  model: {
    /** Plugin fallback model when no opencode.json or micode.json model is configured */
    default: "openai/gpt-5.2-codex",
  },

  /**
   * Think mode settings
   */
  thinking: {
    /** Budget tokens for thinking mode */
    budgetTokens: 128_000,
  },

  /**
   * Mindmodel v2 settings
   */
  mindmodel: {
    /** Override log file within .mindmodel/ */
    overrideLogFile: "overrides.log",
    /** Maximum automatic retries on constraint violation */
    reviewMaxRetries: 1,
    /** Enable/disable constraint review */
    reviewEnabled: true,
    /** Category groups for v2 structure */
    categoryGroups: ["stack", "architecture", "patterns", "style", "components", "domain", "ops"] as readonly string[],
  },

  /**
   * Fetch loop prevention settings
   */
  fetch: {
    /** Inject warning after this many calls to the same resource */
    warnThreshold: 3,
    /** Hard block after this many calls to the same resource */
    maxCallsPerResource: 5,
    /** Cache TTL in milliseconds (5 minutes) */
    cacheTtlMs: 300_000,
    /** Max cached entries per session (LRU eviction) */
    cacheMaxEntries: 50,
  },

  projectMemory: {
    storageDir: join(homedir(), ".config", "opencode", "project-memory"),
    dbFileName: "memory.db",
    sensitivity: ["public", "internal", "secret"] as readonly string[],
    statuses: ["active", "superseded", "tentative", "hypothesis", "deprecated"] as readonly string[],
    defaultLookupLimit: 10,
    snippetMaxChars: 240,
    promoteOnLifecycleFinish: true,
    refuseWritesOnDegradedIdentity: true,
  },
} as const;

/** Plugin fallback model — single source of truth for the default model string */
export const DEFAULT_MODEL = config.model.default;
