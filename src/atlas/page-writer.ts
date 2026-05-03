import { mkdirSync, renameSync, writeFileSync } from "node:fs";
import { dirname, join, relative } from "node:path";

import type { StagingManager } from "./staging";

interface StagedWrite {
  readonly target: string;
  readonly stagedAt: string;
}

const writes = new WeakMap<StagingManager, StagedWrite[]>();

export function stagePageWrite(staging: StagingManager, target: string, content: string): void {
  const list = writes.get(staging) ?? [];
  const rel = relative(staging.projectRoot, target);
  const stagedAt = join(staging.dir, rel);
  mkdirSync(dirname(stagedAt), { recursive: true });
  writeFileSync(stagedAt, content, "utf8");
  list.push({ target, stagedAt });
  writes.set(staging, list);
}

export async function commitStagedPages(staging: StagingManager): Promise<readonly string[]> {
  const list = writes.get(staging) ?? [];
  const moved: string[] = [];
  for (const entry of list) {
    mkdirSync(dirname(entry.target), { recursive: true });
    renameSync(entry.stagedAt, entry.target);
    moved.push(entry.target);
  }
  writes.delete(staging);
  staging.cleanup();
  return moved;
}
