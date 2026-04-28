const MARKER_REGEX = /<!--\s*micode:lc\s+([^>]*?)\s*-->/;
const FIELD_REGEX = /(\w+)=([^\s]+)/g;
const INTEGER_REGEX = /^\d+$/;
const DECIMAL_RADIX = 10;

export interface ExecutionMarker {
  readonly issueNumber: number;
  readonly batchId: string | null;
  readonly taskId: string | null;
  readonly attempt: number;
  readonly seq: number;
}

export interface ExecutionMarkerInput {
  readonly issueNumber: number;
  readonly batchId?: string | null;
  readonly taskId?: string | null;
  readonly attempt: number;
  readonly seq: number;
}

const renderField = (key: string, value: string | number | null | undefined): string | null => {
  if (value === null || value === undefined) return null;
  return `${key}=${value}`;
};

export function buildExecutionMarker(input: ExecutionMarkerInput): string {
  const fields = [
    renderField("issue", input.issueNumber),
    renderField("batch", input.batchId ?? null),
    renderField("task", input.taskId ?? null),
    renderField("attempt", input.attempt),
    renderField("seq", input.seq),
  ].filter((piece): piece is string => piece !== null);
  return `<!-- micode:lc ${fields.join(" ")} -->`;
}

const parseInteger = (value: string): number | null => {
  if (!INTEGER_REGEX.test(value)) return null;
  const parsed = Number.parseInt(value, DECIMAL_RADIX);
  return Number.isSafeInteger(parsed) ? parsed : null;
};

export function parseExecutionMarker(text: string): ExecutionMarker | null {
  const match = MARKER_REGEX.exec(text);
  if (!match) return null;
  const body = match[1] ?? "";
  const fields = new Map<string, string>();
  for (const fieldMatch of body.matchAll(FIELD_REGEX)) {
    const key = fieldMatch[1];
    const value = fieldMatch[2];
    if (key && value) fields.set(key, value);
  }
  const issueRaw = fields.get("issue");
  const issueNumber = issueRaw ? parseInteger(issueRaw) : null;
  if (issueNumber === null || issueNumber <= 0) return null;
  const attempt = parseInteger(fields.get("attempt") ?? "0") ?? 0;
  const seq = parseInteger(fields.get("seq") ?? "0") ?? 0;
  return {
    issueNumber,
    batchId: fields.get("batch") ?? null,
    taskId: fields.get("task") ?? null,
    attempt,
    seq,
  };
}

export function isExecutionMarker(text: string): boolean {
  return MARKER_REGEX.test(text);
}
