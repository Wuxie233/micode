import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { createAtlasPaths } from "./paths";
import type { AtlasSpawnOutcome } from "./types";

export interface LogEntry {
  readonly runId: string;
  readonly narrative: string;
  readonly touched: readonly string[];
  readonly challenges: readonly string[];
  readonly outcome: AtlasSpawnOutcome;
}

const renderBullets = (items: readonly string[]): string =>
  items.length === 0 ? "_none_" : items.map((s) => `- ${s}`).join("\n");

const renderBody = (entry: LogEntry): string => {
  return `# agent2 run ${entry.runId}

outcome: ${entry.outcome}

## Narrative

${entry.narrative}

## Touched

${renderBullets(entry.touched)}

## Challenges

${renderBullets(entry.challenges)}
`;
};

export async function writeMaintenanceLog(projectRoot: string, entry: LogEntry): Promise<string> {
  const paths = createAtlasPaths(projectRoot);
  mkdirSync(paths.log, { recursive: true });
  const file = join(paths.log, `${entry.runId}.md`);
  writeFileSync(file, renderBody(entry), "utf8");
  return file;
}
