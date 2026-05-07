import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, sep } from "node:path";

import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { ATLAS_INDEX_FILE, ATLAS_ROOT_DIRNAME } from "@/atlas/config";
import { resolveRepoBase } from "@/atlas/repo-url";
import { formatSourceLink } from "@/atlas/source-link";

const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 20;
const SUMMARY_EXCERPT_BYTES = 400;
const FRONTMATTER_DELIMITER = "---";
const SKIP_DIRS = new Set(["_meta", "_archive"]);

const LAYER_BY_DIR: Readonly<Record<string, string>> = {
  "10-impl": "impl",
  "20-behavior": "behavior",
  "30-context": "context",
  "40-decisions": "decision",
  "50-risks": "risk",
  "60-timeline": "timeline",
};

interface ParsedNode {
  readonly absPath: string;
  readonly relPath: string;
  readonly layer: string | null;
  readonly title: string;
  readonly id: string;
  readonly summary: string;
  readonly sources: readonly string[];
  readonly raw: string;
}

const stripFrontmatter = (raw: string): { readonly head: string; readonly body: string } => {
  if (!raw.startsWith(`${FRONTMATTER_DELIMITER}\n`)) return { head: "", body: raw };
  const close = raw.indexOf(`\n${FRONTMATTER_DELIMITER}`, FRONTMATTER_DELIMITER.length + 1);
  if (close === -1) return { head: "", body: raw };
  const head = raw.slice(FRONTMATTER_DELIMITER.length + 1, close);
  const body = raw.slice(close + FRONTMATTER_DELIMITER.length + 2).replace(/^\n/, "");
  return { head, body };
};

const layerFromRelPath = (rel: string): string | null => {
  const top = rel.split(sep)[0] ?? rel.split("/")[0];
  return LAYER_BY_DIR[top] ?? null;
};

const extractH1 = (body: string): string => {
  for (const line of body.split("\n")) {
    if (line.startsWith("# ")) return line.slice(2).trim();
  }
  return "";
};

const linesAfterFirstH1 = (body: string): readonly string[] => {
  const lines = body.split("\n");
  const firstH1 = lines.findIndex((line) => line.startsWith("# "));
  return firstH1 === -1 ? [] : lines.slice(firstH1 + 1);
};

const shouldSkipLeadingSummaryLine = (trimmed: string, out: readonly string[]): boolean =>
  out.length === 0 && trimmed.length === 0;

const shouldStopSummary = (trimmed: string, out: readonly string[]): boolean =>
  trimmed.startsWith("##") || (trimmed.length === 0 && out.length > 0);

const extractSummary = (body: string): string => {
  const out: string[] = [];
  for (const line of linesAfterFirstH1(body)) {
    const trimmed = line.trim();
    if (shouldStopSummary(trimmed, out)) break;
    if (shouldSkipLeadingSummaryLine(trimmed, out)) continue;
    out.push(line);
  }
  return out.join("\n").trim();
};

const extractBodyBullets = (body: string, sectionName: string): readonly string[] => {
  const lines = body.split("\n");
  const out: string[] = [];
  let inSection = false;
  for (const line of lines) {
    if (line.startsWith(`## ${sectionName}`)) {
      inSection = true;
      continue;
    }
    if (inSection && line.startsWith("## ")) break;
    if (inSection && line.startsWith("- ")) out.push(line.slice(2).trim());
  }
  return out;
};

const truncateBytes = (text: string, maxBytes: number): string => {
  const buf = Buffer.from(text, "utf8");
  if (buf.length <= maxBytes) return text;
  return `${buf.subarray(0, maxBytes).toString("utf8")}…`;
};

const walk = (dir: string, vaultRoot: string, out: string[]): void => {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name.startsWith(".")) continue;
    if (SKIP_DIRS.has(entry.name)) continue;
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      walk(full, vaultRoot, out);
      continue;
    }
    if (!entry.isFile() || !entry.name.endsWith(".md")) continue;
    out.push(full);
  }
};

const parseNode = (absPath: string, vaultRoot: string): ParsedNode | null => {
  let raw: string;
  try {
    raw = readFileSync(absPath, "utf8");
  } catch {
    return null;
  }
  const { body } = stripFrontmatter(raw);
  const relPath = relative(vaultRoot, absPath);
  const id = relPath.replace(/\.md$/u, "").split(sep).join("/");
  const title = extractH1(body) || id;
  return {
    absPath,
    relPath,
    layer: layerFromRelPath(relPath),
    title,
    id,
    summary: extractSummary(body),
    sources: extractBodyBullets(body, "Sources"),
    raw,
  };
};

const matches = (node: ParsedNode, queryLower: string): boolean => {
  if (queryLower.length === 0) return true;
  const haystacks = [node.title, node.id, node.summary, ...node.sources];
  for (const hay of haystacks) {
    if (hay.toLowerCase().includes(queryLower)) return true;
  }
  return false;
};

const renderHit = (node: ParsedNode, repoBase: string): string => {
  const lines = [
    `### ${node.title}`,
    "",
    `- **Path:** \`atlas/${node.relPath}\``,
    `- **Layer:** ${node.layer ?? "unknown"}`,
    `- **Id:** ${node.id}`,
    "",
    "**Summary:**",
    "",
    truncateBytes(node.summary || "_(no summary)_", SUMMARY_EXCERPT_BYTES),
  ];
  if (node.sources.length > 0) {
    lines.push("", "**Sources:**", "");
    for (const src of node.sources) {
      lines.push(`- ${formatSourceLink(src, { repoBase, ref: "main" })}`);
    }
  }
  return lines.join("\n");
};

const renderHits = (hits: readonly ParsedNode[], repoBase: string): string =>
  hits.map((hit) => renderHit(hit, repoBase)).join("\n\n");

interface LookupArgs {
  readonly query: string;
  readonly layer?: string;
  readonly limit?: number;
}

const renderMissingVault = (): string =>
  [
    "## Atlas not initialized",
    "",
    "There is no `atlas/` directory in this project. Run `/atlas-init` to bootstrap the vault.",
  ].join("\n");

const lookupCandidate = (
  file: string,
  vault: string,
  indexPath: string,
  layer: string | null,
  queryLower: string,
): ParsedNode | null => {
  if (file === indexPath) return null;
  const parsed = parseNode(file, vault);
  if (parsed === null) return null;
  if (layer !== null && parsed.layer !== layer) return null;
  return matches(parsed, queryLower) ? parsed : null;
};

const collectLookupNodes = (
  files: readonly string[],
  vault: string,
  indexPath: string,
  layer: string | null,
  queryLower: string,
): ParsedNode[] =>
  files
    .map((file) => lookupCandidate(file, vault, indexPath, layer, queryLower))
    .filter((node): node is ParsedNode => node !== null)
    .sort((a, b) => a.relPath.localeCompare(b.relPath));

const renderNoHits = (indexPath: string): string => {
  const indexHint = existsSync(indexPath)
    ? "Read `atlas/00-index.md` for a high-level project map, or widen your query / drop the layer filter."
    : "Vault has no `00-index.md` — run `/atlas-init` first.";
  return ["## No atlas nodes matched", "", indexHint].join("\n");
};

const runLookup = (projectRoot: string, args: LookupArgs): string => {
  const vault = join(projectRoot, ATLAS_ROOT_DIRNAME);
  if (!existsSync(vault)) return renderMissingVault();
  const indexPath = join(vault, ATLAS_INDEX_FILE);
  const limit = Math.max(1, Math.min(args.limit ?? DEFAULT_LIMIT, MAX_LIMIT));
  const queryLower = args.query.trim().toLowerCase();
  const layer = args.layer?.trim().toLowerCase() ?? null;

  const files: string[] = [];
  walk(vault, vault, files);
  const hits = collectLookupNodes(files, vault, indexPath, layer, queryLower).slice(0, limit);
  const repoBase = resolveRepoBase(projectRoot);

  if (hits.length === 0) return renderNoHits(indexPath);

  const header = `## Atlas lookup: ${args.query}${layer === null ? "" : ` (layer=${layer})`}`;
  return `${header}\n\n${renderHits(hits, repoBase)}`;
};

export function createAtlasLookupTool(ctx: PluginInput): { atlas_lookup: ToolDefinition } {
  // Touch statSync so dead-import lints don't strip it; vault walk uses readdir withFileTypes.
  void statSync;
  const atlas_lookup = tool({
    description: `Search the project's atlas/ Obsidian vault for nodes matching a query.
Use this BEFORE running broad codebase searches: atlas summarizes modules, behaviors, decisions, and risks
with stable paths and source links. Returns a markdown summary including title, layer, summary excerpt, and clickable GitHub source links.`,
    args: {
      query: tool.schema.string().describe("Free-text query matched against title, id, summary, sources, connections."),
      layer: tool.schema
        .string()
        .optional()
        .describe("Optional layer filter: impl | behavior | context | decision | risk | timeline."),
      limit: tool.schema
        .number()
        .int()
        .min(1)
        .max(MAX_LIMIT)
        .optional()
        .describe(`Max nodes returned (default ${DEFAULT_LIMIT}, max ${MAX_LIMIT}).`),
    },
    execute: async ({ query, layer, limit }) => runLookup(ctx.directory, { query, layer, limit }),
  });
  return { atlas_lookup };
}
