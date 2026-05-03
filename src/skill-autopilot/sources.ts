// Lifted from src/skill-evolution/sources.ts (issue #24); behavior preserved.
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { createJournalStore } from "@/lifecycle/journal/store";
import type { JournalEvent } from "@/lifecycle/journal/types";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

const LOG_SCOPE = "skill-autopilot.sources";
const LIFECYCLE_RECORD_SUFFIX = ".md";
const LEDGER_FILE_PATTERN = /^CONTINUITY_.+\.md$/;

export interface JournalReadInput {
  readonly cwd: string;
  readonly issueNumber: number;
}
export interface LifecycleReadInput {
  readonly cwd: string;
  readonly issueNumber: number;
}
export interface LedgerReadInput {
  readonly cwd: string;
}
export interface LedgerText {
  readonly path: string;
  readonly text: string;
}

export async function readJournalEvents(input: JournalReadInput): Promise<readonly JournalEvent[]> {
  const baseDir = join(input.cwd, config.lifecycle.lifecycleDir);
  const store = createJournalStore({ baseDir });
  try {
    return await store.list(input.issueNumber);
  } catch (error) {
    log.warn(LOG_SCOPE, `journal read failed: ${extractErrorMessage(error)}`);
    return [];
  }
}

export async function readLifecycleRecord(input: LifecycleReadInput): Promise<string | null> {
  const file = join(input.cwd, config.lifecycle.lifecycleDir, `${input.issueNumber}${LIFECYCLE_RECORD_SUFFIX}`);
  if (!existsSync(file)) return null;
  try {
    return readFileSync(file, "utf-8");
  } catch (error) {
    log.warn(LOG_SCOPE, `lifecycle record read failed: ${extractErrorMessage(error)}`);
    return null;
  }
}

export async function readLedgerTexts(input: LedgerReadInput): Promise<readonly LedgerText[]> {
  const dir = join(input.cwd, config.paths.ledgerDir);
  if (!existsSync(dir)) return [];
  let entries: string[];
  try {
    entries = readdirSync(dir);
  } catch (error) {
    log.warn(LOG_SCOPE, `ledger dir read failed: ${extractErrorMessage(error)}`);
    return [];
  }

  const ledgers: LedgerText[] = [];
  for (const name of entries) {
    if (!LEDGER_FILE_PATTERN.test(name)) continue;
    const file = join(dir, name);
    try {
      ledgers.push({ path: file, text: readFileSync(file, "utf-8") });
    } catch (error) {
      log.warn(LOG_SCOPE, `ledger file read failed (${file}): ${extractErrorMessage(error)}`);
    }
  }
  return ledgers;
}
