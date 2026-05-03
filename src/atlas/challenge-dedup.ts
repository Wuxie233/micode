import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import { createAtlasPaths } from "./paths";

const LOG_SCOPE = "atlas.challenge-dedup";
const JSON_INDENT = 2;

export interface DismissedEntry {
  readonly target: string;
  readonly claimHash: string;
  readonly dismissedAt: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function isDismissedEntry(value: unknown): value is DismissedEntry {
  if (!isRecord(value)) return false;
  return (
    typeof value.target === "string" && typeof value.claimHash === "string" && typeof value.dismissedAt === "string"
  );
}

function normalizeDismissedEntries(value: unknown): readonly DismissedEntry[] {
  if (!Array.isArray(value)) return [];
  return value.filter(isDismissedEntry);
}

export function loadDismissedChallenges(projectRoot: string): readonly DismissedEntry[] {
  const paths = createAtlasPaths(projectRoot);
  if (!existsSync(paths.dismissedChallengesFile)) return [];
  try {
    const parsed: unknown = JSON.parse(readFileSync(paths.dismissedChallengesFile, "utf8"));
    return normalizeDismissedEntries(parsed);
  } catch (error) {
    log.warn(LOG_SCOPE, `parse failed: ${extractErrorMessage(error)}`);
    return [];
  }
}

export function isDismissed(projectRoot: string, target: string, claimHash: string): boolean {
  return loadDismissedChallenges(projectRoot).some((e) => e.target === target && e.claimHash === claimHash);
}

export function addDismissedChallenge(projectRoot: string, entry: DismissedEntry): void {
  const paths = createAtlasPaths(projectRoot);
  mkdirSync(dirname(paths.dismissedChallengesFile), { recursive: true });
  const existing = loadDismissedChallenges(projectRoot);
  const next = [...existing, entry];
  writeFileSync(paths.dismissedChallengesFile, JSON.stringify(next, null, JSON_INDENT), "utf8");
}
