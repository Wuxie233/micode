import { existsSync, mkdirSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { ATLAS_STALE_LOCK_MS } from "./config";
import { createAtlasPaths } from "./paths";

interface LockPayload {
  readonly pid: number;
  readonly runId: string;
  readonly acquiredAt: number;
}

export interface WriteLock {
  readonly lockFile: string;
  readonly runId: string;
}

const isProcessAlive = (pid: number): boolean => {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
};

const isStale = (payload: LockPayload): boolean => {
  if (isProcessAlive(payload.pid)) return false;
  return Date.now() - payload.acquiredAt > ATLAS_STALE_LOCK_MS;
};

const canReclaimExistingLock = (lockFile: string): boolean => {
  if (!existsSync(lockFile)) return true;
  try {
    const existing = JSON.parse(readFileSync(lockFile, "utf8")) as LockPayload;
    return isStale(existing);
  } catch {
    // malformed lock file is reclaimable
    return true;
  }
};

export async function acquireWriteLock(projectRoot: string, runId: string): Promise<WriteLock | null> {
  const paths = createAtlasPaths(projectRoot);
  mkdirSync(dirname(paths.lockFile), { recursive: true });
  if (!canReclaimExistingLock(paths.lockFile)) return null;
  const payload: LockPayload = { pid: process.pid, runId, acquiredAt: Date.now() };
  writeFileSync(paths.lockFile, JSON.stringify(payload), "utf8");
  return { lockFile: paths.lockFile, runId };
}

export function releaseWriteLock(lock: WriteLock): void {
  if (existsSync(lock.lockFile)) unlinkSync(lock.lockFile);
}
