import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

const LIFECYCLE_DIR = join("thoughts", "lifecycle");
const JSON_SUFFIX = ".json";
const LOG_SCOPE = "atlas.sources.lifecycle";
const EMPTY_POINTERS: readonly string[] = [];

export interface LifecycleSource {
  readonly pointer: string;
  readonly issueNumber: number;
  readonly state: string;
  readonly designPointers: readonly string[];
  readonly planPointers: readonly string[];
  readonly ledgerPointers: readonly string[];
}

const isRecord = (value: unknown): value is Record<string, unknown> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const readIssueNumber = (value: unknown): number => {
  if (typeof value === "number" || typeof value === "string") return Number(value);
  return Number.NaN;
};

const readState = (value: unknown): string => {
  if (value === null || value === undefined) return "";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean" || typeof value === "bigint") return String(value);
  return "";
};

const readPointers = (value: unknown): readonly string[] => {
  if (!Array.isArray(value)) return EMPTY_POINTERS;
  return value.filter((pointer): pointer is string => typeof pointer === "string");
};

const parseRecord = (raw: string): LifecycleSource | null => {
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isRecord(parsed)) return null;

    const artifacts = isRecord(parsed.artifacts) ? parsed.artifacts : {};
    const issueNumber = readIssueNumber(parsed.issueNumber);
    return {
      pointer: `lifecycle:${issueNumber}`,
      issueNumber,
      state: readState(parsed.state),
      designPointers: readPointers(artifacts.design),
      planPointers: readPointers(artifacts.plan),
      ledgerPointers: readPointers(artifacts.ledger),
    };
  } catch (error) {
    log.warn(LOG_SCOPE, `parse failed: ${extractErrorMessage(error)}`);
    return null;
  }
};

export async function collectLifecycleSources(projectRoot: string): Promise<readonly LifecycleSource[]> {
  const dir = join(projectRoot, LIFECYCLE_DIR);
  if (!existsSync(dir)) return [];
  const out: LifecycleSource[] = [];
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(JSON_SUFFIX)) continue;
    const raw = readFileSync(join(dir, entry), "utf8");
    const record = parseRecord(raw);
    if (record !== null) out.push(record);
  }
  return out;
}
