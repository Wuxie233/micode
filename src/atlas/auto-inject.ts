import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { ATLAS_INDEX_FILE, ATLAS_ROOT_DIRNAME } from "./config";

const DEFAULT_MAX_BYTES = 6000;

/**
 * Files appended (in order) after the index, when present.
 * Each entry is read, the H1+first prose paragraph extracted, and joined.
 * Allowlist is intentionally short to keep the summary auto-inject-budget friendly.
 */
const KEY_NODES: readonly string[] = [
  "10-impl/plugin-composition.md",
  "10-impl/lifecycle-state-machine.md",
  "10-impl/agent-registry.md",
  "10-impl/octto-session-system.md",
  "20-behavior/issue-driven-lifecycle.md",
];

export interface AtlasSummaryOptions {
  readonly maxBytes?: number;
}

const FRONTMATTER_DELIMITER = "---";

const stripFrontmatter = (raw: string): string => {
  if (!raw.startsWith(`${FRONTMATTER_DELIMITER}\n`)) return raw;
  const close = raw.indexOf(`\n${FRONTMATTER_DELIMITER}`, FRONTMATTER_DELIMITER.length + 1);
  if (close === -1) return raw;
  return raw.slice(close + FRONTMATTER_DELIMITER.length + 2).replace(/^\n/, "");
};

const findFirstProseAfterH1 = (lines: readonly string[], h1Index: number): string | null => {
  for (const line of lines.slice(h1Index + 1)) {
    const trimmed = line.trim();
    if (trimmed.length === 0) continue;
    if (trimmed.startsWith("#")) return null;
    return line;
  }
  return null;
};

const extractH1AndFirstProse = (body: string): string => {
  const lines = body.split("\n");
  const h1Index = lines.findIndex((line) => line.startsWith("# "));
  if (h1Index === -1) return "";

  const firstProse = findFirstProseAfterH1(lines, h1Index);
  return [lines[h1Index], firstProse].filter((line): line is string => line !== null).join("\n");
};

const truncateToBytes = (text: string, maxBytes: number): string => {
  if (Buffer.byteLength(text, "utf8") <= maxBytes) return text;
  const buf = Buffer.from(text, "utf8");
  return buf.subarray(0, maxBytes).toString("utf8");
};

const readNodeExcerpt = (vaultRoot: string, rel: string): string | null => {
  const full = join(vaultRoot, rel);
  if (!existsSync(full)) return null;
  const raw = readFileSync(full, "utf8");
  const body = stripFrontmatter(raw);
  const excerpt = extractH1AndFirstProse(body).trim();
  if (excerpt.length === 0) return null;
  return excerpt;
};

/**
 * Build a small atlas summary for prompt auto-inject.
 *
 * Returns null when the vault is not initialized so callers can fall back
 * to "no atlas" behavior. B-final issue wires this into brainstormer/planner
 * prompts; this issue only provides the helper.
 */
export async function getAtlasSummary(projectRoot: string, options?: AtlasSummaryOptions): Promise<string | null> {
  const vault = join(projectRoot, ATLAS_ROOT_DIRNAME);
  const index = join(vault, ATLAS_INDEX_FILE);
  if (!existsSync(vault) || !existsSync(index)) return null;
  const raw = readFileSync(index, "utf8");
  const indexBody = stripFrontmatter(raw).trim();

  const sections: string[] = [indexBody];
  for (const rel of KEY_NODES) {
    const excerpt = readNodeExcerpt(vault, rel);
    if (excerpt !== null) sections.push(excerpt);
  }
  const joined = sections.join("\n\n---\n\n");
  return truncateToBytes(joined, options?.maxBytes ?? DEFAULT_MAX_BYTES);
}
