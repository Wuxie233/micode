import { existsSync } from "node:fs";
import { appendFile, mkdir, readFile } from "node:fs/promises";
import { join } from "node:path";

import { config } from "@/utils/config";

const NEWLINE = "\n";
const MAX_DETAIL_CHARS = 240;
const REDACTED_SECRET = "[REDACTED]";
const CREDENTIAL_PATTERNS: readonly RegExp[] = [
  /\bBearer\s+[A-Za-z0-9._~+/=-]+/gi,
  /\b(api[_-]?key|password|secret)\b\s*[:=]\s*[^\s,;"'`{}\]]+/gi,
  /\bsecret\s+[^\s,;"'`{}\]]+/gi,
  /\bsk-[A-Za-z0-9_-]{20,}\b/g,
];

export interface MaintenanceJournalEvent {
  readonly projectId: string;
  readonly action: string;
  readonly at?: number;
  readonly entityIds?: readonly string[];
  readonly entryIds?: readonly string[];
  readonly sourceIds?: readonly string[];
  readonly reasons?: readonly string[];
  readonly counts?: Readonly<Record<string, number>>;
  readonly details?: string;
  readonly entrySummaries?: readonly string[];
}

export interface MaintenanceJournalOptions {
  readonly dir?: string;
}

export interface ReadMaintenanceJournalOptions extends MaintenanceJournalOptions {
  readonly limit?: number;
}

function truncateDetail(value: string): string {
  return value.length <= MAX_DETAIL_CHARS ? value : value.slice(0, MAX_DETAIL_CHARS);
}

function redactCredentialLikeSubstrings(value: string): string {
  return CREDENTIAL_PATTERNS.reduce((redacted, pattern) => redacted.replace(pattern, REDACTED_SECRET), value);
}

function sanitizeJournalText(value: string): string {
  return truncateDetail(redactCredentialLikeSubstrings(value));
}

function sanitizeStringArray(values: readonly string[] | undefined, truncate = false): readonly string[] | undefined {
  if (values === undefined) return undefined;
  return values.map((value) => (truncate ? sanitizeJournalText(value) : value));
}

function sanitizeCounts(
  counts: Readonly<Record<string, number>> | undefined,
): Readonly<Record<string, number>> | undefined {
  if (counts === undefined) return undefined;
  return Object.fromEntries(Object.entries(counts).filter(([, value]) => Number.isFinite(value)));
}

function compactEvent(event: MaintenanceJournalEvent): MaintenanceJournalEvent {
  const compacted: MaintenanceJournalEvent = {
    projectId: event.projectId,
    action: event.action,
    at: event.at,
    entityIds: sanitizeStringArray(event.entityIds),
    entryIds: sanitizeStringArray(event.entryIds),
    sourceIds: sanitizeStringArray(event.sourceIds),
    reasons: sanitizeStringArray(event.reasons),
    counts: sanitizeCounts(event.counts),
    details: event.details === undefined ? undefined : sanitizeJournalText(event.details),
    entrySummaries: sanitizeStringArray(event.entrySummaries, true),
  };

  return Object.fromEntries(
    Object.entries(compacted).filter(([, value]) => value !== undefined),
  ) as MaintenanceJournalEvent;
}

function journalDir(options: MaintenanceJournalOptions = {}): string {
  return options.dir ?? config.projectMemory.maintenanceJournalDir;
}

export function journalPathFor(projectId: string, date?: Date): string {
  void date;
  return join(config.projectMemory.maintenanceJournalDir, `${projectId}.jsonl`);
}

function journalPathForDir(projectId: string, dir: string): string {
  return join(dir, `${projectId}.jsonl`);
}

export async function appendMaintenanceJournal(
  event: MaintenanceJournalEvent,
  options: MaintenanceJournalOptions = {},
): Promise<string> {
  const dir = journalDir(options);
  const filePath = journalPathForDir(event.projectId, dir);
  await mkdir(dir, { recursive: true });
  await appendFile(filePath, `${JSON.stringify(compactEvent(event))}${NEWLINE}`, "utf8");
  return filePath;
}

export async function readMaintenanceJournal(
  projectId: string,
  options: ReadMaintenanceJournalOptions = {},
): Promise<readonly MaintenanceJournalEvent[]> {
  const filePath = journalPathForDir(projectId, journalDir(options));
  if (!existsSync(filePath)) return [];

  const content = await readFile(filePath, "utf8");
  const events = content
    .split(NEWLINE)
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .map((line) => compactEvent(JSON.parse(line) as MaintenanceJournalEvent));

  if (options.limit === undefined) return events;
  return events.slice(-Math.max(0, options.limit));
}
