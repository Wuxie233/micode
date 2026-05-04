import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

const LIFECYCLE_DIR = join("thoughts", "lifecycle");
const JSON_SUFFIX = ".json";
const LOG_SCOPE = "atlas.cold-init.lifecycle";

export interface LifecycleHistoryEntry {
  readonly pointer: string;
  readonly issueNumber: number;
  readonly title: string;
  readonly state: string;
  readonly designPointers: readonly string[];
  readonly planPointers: readonly string[];
  readonly ledgerPointers: readonly string[];
  readonly modifiedAtMs: number;
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const readPointers = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) return [];
  return value.filter((p): p is string => typeof p === "string");
};

const readNumber = (value: unknown): number => {
  if (typeof value === "number") return value;
  if (typeof value === "string") return Number(value);
  return Number.NaN;
};

const readString = (value: unknown): string => {
  return typeof value === "string" ? value : "";
};

const parseEntry = (raw: string, modifiedAtMs: number): LifecycleHistoryEntry | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;
    const artifacts = isRecord(parsed.artifacts) ? parsed.artifacts : {};
    const issueNumber = readNumber(parsed.issueNumber);
    if (Number.isNaN(issueNumber)) return null;
    return {
      pointer: `lifecycle:${issueNumber}`,
      issueNumber,
      title: readString(parsed.title) || readString(parsed.summary),
      state: readString(parsed.state),
      designPointers: readPointers(artifacts.design),
      planPointers: readPointers(artifacts.plan),
      ledgerPointers: readPointers(artifacts.ledger),
      modifiedAtMs,
    };
  } catch (error) {
    log.warn(LOG_SCOPE, `parse failed: ${extractErrorMessage(error)}`);
    return null;
  }
};

export async function collectLifecycleHistory(projectRoot: string): Promise<readonly LifecycleHistoryEntry[]> {
  const dir = join(projectRoot, LIFECYCLE_DIR);
  if (!existsSync(dir)) return [];
  const out: LifecycleHistoryEntry[] = [];
  for (const name of readdirSync(dir)) {
    if (!name.endsWith(JSON_SUFFIX)) continue;
    const full = join(dir, name);
    const raw = readFileSync(full, "utf8");
    const stat = statSync(full);
    const entry = parseEntry(raw, stat.mtimeMs);
    if (entry !== null) out.push(entry);
  }
  return out.sort((a, b) => b.modifiedAtMs - a.modifiedAtMs);
}
