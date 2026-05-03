import {
  ATLAS_LAYERS,
  ATLAS_NODE_STATUSES,
  type AtlasFrontmatter,
  type AtlasLayer,
  type AtlasNodeStatus,
} from "./types";

const FRONTMATTER_DELIMITER = "---";
const FRONTMATTER_LIST_ITEM_PREFIX = "  - ";
const REQUIRED_KEYS = ["id", "layer", "status", "last_verified_commit", "last_written_mtime"] as const;
const LAYER_VALUES = Object.values(ATLAS_LAYERS) as readonly string[];
const STATUS_VALUES = Object.values(ATLAS_NODE_STATUSES) as readonly string[];

interface ParseResult {
  readonly frontmatter: AtlasFrontmatter;
  readonly body: string;
}

const splitDocument = (raw: string): { readonly head: string; readonly body: string } => {
  if (!raw.startsWith(`${FRONTMATTER_DELIMITER}\n`)) throw new Error("missing frontmatter delimiter");
  const closeIdx = raw.indexOf(`\n${FRONTMATTER_DELIMITER}`, FRONTMATTER_DELIMITER.length + 1);
  if (closeIdx === -1) throw new Error("missing frontmatter close delimiter");
  const head = raw.slice(FRONTMATTER_DELIMITER.length + 1, closeIdx);
  const body = raw.slice(closeIdx + FRONTMATTER_DELIMITER.length + 2).replace(/^\n/, "");
  return { head, body };
};

const parseScalarLine = (line: string): readonly [string, string] | null => {
  const idx = line.indexOf(":");
  if (idx === -1) return null;
  return [line.slice(0, idx).trim(), line.slice(idx + 1).trim()];
};

const collectListItems = (lines: readonly string[], startIdx: number): readonly [readonly string[], number] => {
  const items: string[] = [];
  let i = startIdx;
  while (i < lines.length && lines[i].startsWith(FRONTMATTER_LIST_ITEM_PREFIX)) {
    items.push(lines[i].slice(FRONTMATTER_LIST_ITEM_PREFIX.length).trim());
    i += 1;
  }
  return [items, i];
};

const parseLayer = (raw: string): AtlasLayer => {
  if (!LAYER_VALUES.includes(raw)) throw new Error(`unknown layer: ${raw}`);
  return raw as AtlasLayer;
};

const parseStatus = (raw: string): AtlasNodeStatus => {
  if (!STATUS_VALUES.includes(raw)) throw new Error(`unknown status: ${raw}`);
  return raw as AtlasNodeStatus;
};

const ensureRequired = (record: Record<string, unknown>): void => {
  for (const key of REQUIRED_KEYS) {
    if (record[key] === undefined) throw new Error(`missing required frontmatter key: ${key}`);
  }
};

export function parseFrontmatter(raw: string): ParseResult {
  const { head, body } = splitDocument(raw);
  const lines = head.split("\n");
  const record: Record<string, unknown> = {};
  const extras: Record<string, string> = {};
  let sources: readonly string[] = [];
  let i = 0;
  while (i < lines.length) {
    const line = lines[i];
    if (line.trim().length === 0) {
      i += 1;
      continue;
    }
    const parsed = parseScalarLine(line);
    if (parsed === null) throw new Error(`malformed frontmatter line: ${line}`);
    const [key, value] = parsed;
    if (key === "sources") {
      const [items, next] = collectListItems(lines, i + 1);
      sources = items;
      i = next;
      continue;
    }
    record[key] = value;
    if (!REQUIRED_KEYS.includes(key as (typeof REQUIRED_KEYS)[number])) extras[key] = value;
    i += 1;
  }
  ensureRequired(record);
  const frontmatter: AtlasFrontmatter = {
    id: String(record.id),
    layer: parseLayer(String(record.layer)),
    status: parseStatus(String(record.status)),
    last_verified_commit: String(record.last_verified_commit),
    last_written_mtime: Number.parseInt(String(record.last_written_mtime), 10),
    sources,
    extras,
  };
  return { frontmatter, body };
}

export function serializeFrontmatter(fm: AtlasFrontmatter, body: string): string {
  const lines: string[] = [FRONTMATTER_DELIMITER];
  lines.push(`id: ${fm.id}`);
  lines.push(`layer: ${fm.layer}`);
  lines.push(`status: ${fm.status}`);
  lines.push(`last_verified_commit: ${fm.last_verified_commit}`);
  lines.push(`last_written_mtime: ${fm.last_written_mtime}`);
  for (const [key, value] of Object.entries(fm.extras)) lines.push(`${key}: ${value}`);
  lines.push("sources:");
  for (const source of fm.sources) lines.push(`${FRONTMATTER_LIST_ITEM_PREFIX}${source}`);
  lines.push(FRONTMATTER_DELIMITER);
  lines.push("");
  return `${lines.join("\n")}\n${body}`;
}
