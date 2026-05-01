import { detectSecret } from "@/utils/secret-detect";

export const MAX_REASON_CHARS = 200;

export interface DiagnosticFields {
  readonly classifier?: string;
  readonly verifier?: string;
  readonly cleanup?: string;
  readonly fence?: string;
}

const ELLIPSIS = "...";
const FIELD_KEYS: readonly (keyof DiagnosticFields)[] = ["classifier", "verifier", "cleanup", "fence"];
const FIELD_SEPARATOR = "; ";
const FIELD_KV = "=";
const REDACTED_VALUE = "[redacted]";

function compact(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function truncate(value: string): string {
  const compacted = compact(value);
  if (compacted.length <= MAX_REASON_CHARS) return compacted;
  return `${compacted.slice(0, MAX_REASON_CHARS)}${ELLIPSIS}`;
}

function formatValue(value: string): string {
  const compacted = compact(value);
  if (detectSecret(compacted)) return REDACTED_VALUE;
  return truncate(compacted);
}

export function buildDiagnosticLine(fields: DiagnosticFields): string {
  const parts: string[] = [];
  for (const key of FIELD_KEYS) {
    const value = fields[key];
    if (typeof value !== "string" || value.length === 0) continue;
    parts.push(`${key}${FIELD_KV}${formatValue(value)}`);
  }
  return parts.join(FIELD_SEPARATOR);
}

export function formatDiagnostics(fields: DiagnosticFields): string {
  const line = buildDiagnosticLine(fields);
  if (line.length === 0) return "";
  return `**Diagnostics**: ${line}`;
}
