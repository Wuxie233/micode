import { createHash } from "node:crypto";

export const IDENTITY_SOURCES = {
  EXPLICIT: "explicit",
  INFERRED: "inferred",
} as const;

export type IdentitySource = (typeof IDENTITY_SOURCES)[keyof typeof IDENTITY_SOURCES];

export interface TaskIdentity {
  readonly taskIdentity: string;
  readonly runId: string;
  readonly generation: number;
  readonly source: IdentitySource;
}

export interface DeriveTaskIdentityInput {
  readonly agent: string;
  readonly description: string;
  readonly prompt: string;
  readonly ownerSessionId: string;
}

const META_PATTERN = /<spawn-meta\b([^/>]*?)\/?>/i;
const ATTR_PATTERN = /(\w[\w-]*)="([^"]*)"/g;
const DEFAULT_GENERATION = 1;
const DECIMAL_RADIX = 10;

function parseAttributes(raw: string): Record<string, string> {
  const out: Record<string, string> = {};
  let match: RegExpExecArray | null = ATTR_PATTERN.exec(raw);
  while (match !== null) {
    out[match[1]] = match[2];
    match = ATTR_PATTERN.exec(raw);
  }
  ATTR_PATTERN.lastIndex = 0;
  return out;
}

function tryExplicit(prompt: string): { taskIdentity: string; runId: string; generation: number } | null {
  const meta = META_PATTERN.exec(prompt);
  if (!meta) return null;
  const attrs = parseAttributes(meta[1]);
  const taskIdentity = attrs["task-id"]?.trim() ?? "";
  const runId = attrs["run-id"]?.trim() ?? "";
  if (taskIdentity.length === 0 || runId.length === 0) return null;
  const parsedGen = Number.parseInt(attrs.generation ?? "", DECIMAL_RADIX);
  const generation = Number.isFinite(parsedGen) && parsedGen > 0 ? parsedGen : DEFAULT_GENERATION;
  return { taskIdentity, runId, generation };
}

function hashIdentity(agent: string, description: string): string {
  return createHash("sha256").update(`${agent}:${description}`).digest("hex");
}

export function deriveTaskIdentity(input: DeriveTaskIdentityInput): TaskIdentity {
  const explicit = tryExplicit(input.prompt);
  if (explicit) return { ...explicit, source: IDENTITY_SOURCES.EXPLICIT };
  return {
    taskIdentity: hashIdentity(input.agent, input.description),
    runId: input.ownerSessionId,
    generation: DEFAULT_GENERATION,
    source: IDENTITY_SOURCES.INFERRED,
  };
}
