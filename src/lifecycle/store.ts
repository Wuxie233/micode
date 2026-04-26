import { existsSync, mkdirSync, readdirSync, rmSync } from "node:fs";
import { join } from "node:path";
import * as v from "valibot";

import { LifecycleRecordSchema } from "@/lifecycle/schemas";
import type { LifecycleRecord } from "@/lifecycle/types";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

export interface LifecycleStoreOptions {
  readonly baseDir?: string;
  readonly schema?: v.GenericSchema<unknown, LifecycleRecord>;
}

export interface LifecycleStore {
  readonly save: (record: LifecycleRecord) => Promise<void>;
  readonly load: (issueNumber: number) => Promise<LifecycleRecord | null>;
  readonly delete: (issueNumber: number) => Promise<void>;
  readonly list: () => Promise<readonly number[]>;
}

const JSON_SUFFIX = ".json";
const JSON_INDENT = 2;
const MIN_ISSUE_NUMBER = 1;
const DECIMAL_RADIX = 10;
const LOG_SCOPE = "lifecycle.store";
const ISSUE_SEPARATOR = "; ";
const ISSUE_FILE_PATTERN = /^\d+$/;

const validateIssueNumber = (issueNumber: number): void => {
  if (Number.isSafeInteger(issueNumber) && issueNumber >= MIN_ISSUE_NUMBER) return;
  throw new Error(`Invalid issue number: ${issueNumber}`);
};

const toIssueNumber = (entry: string): number | null => {
  if (!entry.endsWith(JSON_SUFFIX)) return null;

  const stem = entry.slice(0, -JSON_SUFFIX.length);
  if (!ISSUE_FILE_PATTERN.test(stem)) return null;

  const issueNumber = Number.parseInt(stem, DECIMAL_RADIX);
  if (Number.isSafeInteger(issueNumber) && issueNumber >= MIN_ISSUE_NUMBER) return issueNumber;
  return null;
};

const isIssueNumber = (issueNumber: number | null): issueNumber is number => issueNumber !== null;

const formatIssues = (issues: readonly v.BaseIssue<unknown>[]): string => {
  return issues.map((issue) => issue.message).join(ISSUE_SEPARATOR);
};

const parseRecord = (
  content: string,
  location: string,
  schema: v.GenericSchema<unknown, LifecycleRecord>,
): LifecycleRecord | null => {
  let raw: unknown;
  try {
    raw = JSON.parse(content);
  } catch (error) {
    log.warn(LOG_SCOPE, `Malformed lifecycle record JSON: ${location}: ${extractErrorMessage(error)}`);
    return null;
  }

  const parsed = v.safeParse(schema, raw);
  if (parsed.success) return parsed.output;

  log.warn(LOG_SCOPE, `Invalid lifecycle record schema: ${location}: ${formatIssues(parsed.issues)}`);
  return null;
};

export function createLifecycleStore(options: LifecycleStoreOptions = {}): LifecycleStore {
  const baseDir = options.baseDir ?? config.lifecycle.lifecycleDir;
  const schema = options.schema ?? LifecycleRecordSchema;

  const ensureDir = (): void => {
    if (existsSync(baseDir)) return;
    mkdirSync(baseDir, { recursive: true });
  };

  const getPath = (issueNumber: number): string => {
    validateIssueNumber(issueNumber);
    return join(baseDir, `${issueNumber}${JSON_SUFFIX}`);
  };

  return {
    async save(record: LifecycleRecord): Promise<void> {
      ensureDir();
      const location = getPath(record.issueNumber);
      await Bun.write(location, JSON.stringify(record, null, JSON_INDENT));
    },

    async load(issueNumber: number): Promise<LifecycleRecord | null> {
      const location = getPath(issueNumber);
      if (!existsSync(location)) return null;

      const content = await Bun.file(location).text();
      return parseRecord(content, location, schema);
    },

    async delete(issueNumber: number): Promise<void> {
      const location = getPath(issueNumber);
      rmSync(location, { force: true });
    },

    async list(): Promise<readonly number[]> {
      if (!existsSync(baseDir)) return [];

      return readdirSync(baseDir)
        .map(toIssueNumber)
        .filter(isIssueNumber)
        .sort((left, right) => left - right);
    },
  };
}
