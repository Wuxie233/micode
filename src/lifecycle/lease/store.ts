import { existsSync, mkdirSync, readFileSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

import { parseLeaseRecord } from "./schemas";
import type { LeaseAcquireInput, LeaseAcquireOutcome, LeaseRecord } from "./types";

const LOG_SCOPE = "lifecycle.lease";
const MIN_ISSUE_NUMBER = 1;
const TEMP_SUFFIX = ".tmp";
const JSON_INDENT = 2;

export interface LeaseStoreOptions {
  readonly baseDir?: string;
  readonly suffix?: string;
  readonly now?: () => number;
}

export interface LeaseStore {
  readonly acquire: (input: LeaseAcquireInput) => Promise<LeaseAcquireOutcome>;
  readonly heartbeat: (issueNumber: number, owner: string) => Promise<LeaseRecord | null>;
  readonly release: (issueNumber: number, owner: string) => Promise<boolean>;
  readonly load: (issueNumber: number) => Promise<LeaseRecord | null>;
}

const validateIssueNumber = (issueNumber: number): void => {
  if (Number.isSafeInteger(issueNumber) && issueNumber >= MIN_ISSUE_NUMBER) return;
  throw new Error(`Invalid issue number: ${issueNumber}`);
};

const ensureDir = (dir: string): void => {
  if (existsSync(dir)) return;
  mkdirSync(dir, { recursive: true });
};

const readLease = (path: string): LeaseRecord | null => {
  if (!existsSync(path)) return null;
  let raw: unknown;
  try {
    raw = JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    log.warn(LOG_SCOPE, `malformed lease ${path}: ${extractErrorMessage(error)}`);
    return null;
  }
  const parsed = parseLeaseRecord(raw);
  if (!parsed.ok) {
    log.warn(LOG_SCOPE, `invalid lease ${path}: ${parsed.issues.join("; ")}`);
    return null;
  }
  return parsed.lease;
};

const writeLease = (path: string, lease: LeaseRecord): void => {
  const tempPath = `${path}${TEMP_SUFFIX}`;
  writeFileSync(tempPath, JSON.stringify(lease, null, JSON_INDENT));
  renameSync(tempPath, path);
};

const isExpired = (lease: LeaseRecord, now: number): boolean => now - lease.heartbeatAt > lease.ttlMs;

const createIssuePath = (baseDir: string, suffix: string): ((issueNumber: number) => string) => {
  return (issueNumber: number): string => {
    validateIssueNumber(issueNumber);
    return join(baseDir, `${issueNumber}${suffix}`);
  };
};

const createLease = (input: LeaseAcquireInput, at: number): LeaseRecord => ({
  issueNumber: input.issueNumber,
  owner: input.owner,
  host: input.host,
  branch: input.branch,
  worktree: input.worktree,
  acquiredAt: at,
  heartbeatAt: at,
  ttlMs: input.ttlMs,
});

const acquireLease = (
  baseDir: string,
  pathFor: (issueNumber: number) => string,
  now: () => number,
  input: LeaseAcquireInput,
): LeaseAcquireOutcome => {
  ensureDir(baseDir);
  const path = pathFor(input.issueNumber);
  const current = readLease(path);
  const at = now();
  const fresh = createLease(input, at);
  if (current === null) {
    writeLease(path, fresh);
    return { kind: "acquired", lease: fresh };
  }
  if (current.owner === input.owner) {
    const refreshed: LeaseRecord = { ...current, heartbeatAt: at, ttlMs: input.ttlMs };
    writeLease(path, refreshed);
    return { kind: "acquired", lease: refreshed };
  }
  if (!isExpired(current, at)) return { kind: "held", current };
  writeLease(path, fresh);
  return { kind: "expired_stolen", lease: fresh, previous: current };
};

const refreshLease = (
  pathFor: (issueNumber: number) => string,
  now: () => number,
  issueNumber: number,
  owner: string,
): LeaseRecord | null => {
  const path = pathFor(issueNumber);
  const current = readLease(path);
  if (!current) return null;
  if (current.owner !== owner) return null;
  const refreshed: LeaseRecord = { ...current, heartbeatAt: now() };
  writeLease(path, refreshed);
  return refreshed;
};

const releaseLease = (pathFor: (issueNumber: number) => string, issueNumber: number, owner: string): boolean => {
  const path = pathFor(issueNumber);
  const current = readLease(path);
  if (!current) return false;
  if (current.owner !== owner) return false;
  rmSync(path, { force: true });
  return true;
};

export function createLeaseStore(options: LeaseStoreOptions = {}): LeaseStore {
  const baseDir = options.baseDir ?? config.lifecycle.lifecycleDir;
  const suffix = options.suffix ?? config.lifecycle.leaseSuffix;
  const now = options.now ?? Date.now;
  const pathFor = createIssuePath(baseDir, suffix);

  return {
    async acquire(input) {
      return acquireLease(baseDir, pathFor, now, input);
    },

    async heartbeat(issueNumber, owner) {
      return refreshLease(pathFor, now, issueNumber, owner);
    },

    async release(issueNumber, owner) {
      return releaseLease(pathFor, issueNumber, owner);
    },

    async load(issueNumber) {
      return readLease(pathFor(issueNumber));
    },
  };
}
