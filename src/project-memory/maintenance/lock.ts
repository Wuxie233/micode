const MS_PER_SECOND = 1000;
const SECONDS_PER_MINUTE = 60;
const DEFAULT_TTL_MINUTES = 5;
const DEFAULT_TTL_MS = DEFAULT_TTL_MINUTES * SECONDS_PER_MINUTE * MS_PER_SECOND;

interface LockRecord {
  readonly token: symbol;
  readonly expiresAt: number;
}

export interface MaintenanceLock {
  readonly projectId: string;
  release(): Promise<void>;
}

export interface AcquireMaintenanceLockOptions {
  readonly ttlMs?: number;
}

const locks = new Map<string, LockRecord>();

function expiryFrom(now: number, ttlMs: number): number {
  return now + Math.max(0, ttlMs);
}

function isActive(record: LockRecord | undefined, now: number): boolean {
  return record !== undefined && record.expiresAt > now;
}

export async function acquireMaintenanceLock(
  projectId: string,
  options: AcquireMaintenanceLockOptions = {},
): Promise<MaintenanceLock | null> {
  const now = Date.now();
  const current = locks.get(projectId);
  if (isActive(current, now)) return null;

  const token = Symbol(projectId);
  locks.set(projectId, {
    token,
    expiresAt: expiryFrom(now, options.ttlMs ?? DEFAULT_TTL_MS),
  });

  return {
    projectId,
    async release(): Promise<void> {
      if (locks.get(projectId)?.token === token) {
        locks.delete(projectId);
      }
    },
  };
}
