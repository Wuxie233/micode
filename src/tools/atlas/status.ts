import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { scanBrokenWikilinks } from "@/atlas/broken-link-scanner";
import { createAtlasPaths } from "@/atlas/paths";

export interface StatusInput {
  readonly projectRoot: string;
}

export interface StatusReport {
  readonly openChallenges: number;
  readonly brokenWikilinks: number;
  readonly orphanStagingDirs: number;
  readonly staleNodes: number;
  readonly lastSuccessfulRun: string | null;
  readonly spawnReceiptDiff: number;
}

const STATUS_OPEN_LINE = "status: open";

const countOpenChallenges = (challengesDir: string): number => {
  if (!existsSync(challengesDir)) return 0;
  let count = 0;
  for (const entry of readdirSync(challengesDir)) {
    if (!entry.endsWith(".md")) continue;
    const raw = readFileSync(join(challengesDir, entry), "utf8");
    if (raw.includes(STATUS_OPEN_LINE)) count += 1;
  }
  return count;
};

const countOrphanStaging = (stagingDir: string): number => {
  if (!existsSync(stagingDir)) return 0;
  return readdirSync(stagingDir).length;
};

const findLastSuccessfulRun = (logDir: string): string | null => {
  if (!existsSync(logDir)) return null;
  const entries = readdirSync(logDir)
    .filter((e) => e.endsWith(".md"))
    .sort();
  for (let i = entries.length - 1; i >= 0; i -= 1) {
    const raw = readFileSync(join(logDir, entries[i]), "utf8");
    if (raw.includes("outcome: succeeded")) return entries[i].replace(/\.md$/, "");
  }
  return null;
};

export async function runAtlasStatus(input: StatusInput): Promise<StatusReport> {
  const paths = createAtlasPaths(input.projectRoot);
  const broken = await scanBrokenWikilinks(input.projectRoot);
  return {
    openChallenges: countOpenChallenges(paths.challenges),
    brokenWikilinks: broken.length,
    orphanStagingDirs: countOrphanStaging(paths.staging),
    staleNodes: 0,
    lastSuccessfulRun: findLastSuccessfulRun(paths.log),
    spawnReceiptDiff: 0,
  };
}
