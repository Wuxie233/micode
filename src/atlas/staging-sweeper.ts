import { existsSync, readdirSync, rmSync, statSync } from "node:fs";
import { join } from "node:path";

import { createAtlasPaths } from "./paths";

export async function sweepOrphanStaging(
  projectRoot: string,
  activeRunIds: ReadonlySet<string>,
): Promise<readonly string[]> {
  const paths = createAtlasPaths(projectRoot);
  if (!existsSync(paths.staging)) return [];
  const removed: string[] = [];
  for (const entry of readdirSync(paths.staging)) {
    const full = join(paths.staging, entry);
    if (!statSync(full).isDirectory()) continue;
    if (activeRunIds.has(entry)) continue;
    rmSync(full, { recursive: true, force: true });
    removed.push(entry);
  }
  return removed;
}
