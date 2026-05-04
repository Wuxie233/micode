import { existsSync, mkdirSync, rmdirSync, statSync } from "node:fs";
import { join } from "node:path";

const DEFAULT_STALE_MS = 60_000;

export interface AcquireOptions {
  readonly staleMs?: number;
}

export type AcquireResult = { readonly ok: true; readonly lockPath: string } | { readonly ok: false };

export async function acquireRenameLock(skillDir: string, options: AcquireOptions = {}): Promise<AcquireResult> {
  mkdirSync(skillDir, { recursive: true });
  const lockPath = join(skillDir, ".lock");
  const staleMs = options.staleMs ?? DEFAULT_STALE_MS;
  if (existsSync(lockPath)) {
    const stat = statSync(lockPath);
    if (Date.now() - stat.mtimeMs > staleMs) rmdirSync(lockPath);
  }
  try {
    mkdirSync(lockPath);
    return { ok: true, lockPath };
  } catch {
    // intentional: lock held by another process
    return { ok: false };
  }
}

export function releaseRenameLock(lockPath: string): void {
  try {
    rmdirSync(lockPath);
  } catch {
    // intentional: idempotent release
  }
}
