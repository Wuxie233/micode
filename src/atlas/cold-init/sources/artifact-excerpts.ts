import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative } from "node:path";

import { COLD_INIT_DESIGN_EXCERPT_CHARS } from "@/atlas/cold-init/config";

const H1_PATTERN = /^#\s+(.+)$/m;
const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n/;
const MARKDOWN_SUFFIX = ".md";

export type ArtifactKind = "design" | "plan" | "ledger";

export interface ArtifactExcerpt {
  readonly pointer: string;
  readonly relativePath: string;
  readonly kind: ArtifactKind;
  readonly title: string;
  readonly excerpt: string;
}

const stripFrontmatter = (raw: string): string => raw.replace(FRONTMATTER_PATTERN, "");

const extractTitle = (raw: string, fallback: string): string => {
  const match = H1_PATTERN.exec(stripFrontmatter(raw));
  return match !== null ? match[1].trim() : fallback;
};

const extractExcerpt = (raw: string): string => {
  const stripped = stripFrontmatter(raw).trim();
  if (stripped.length <= COLD_INIT_DESIGN_EXCERPT_CHARS) return stripped;
  return `${stripped.slice(0, COLD_INIT_DESIGN_EXCERPT_CHARS)}...`;
};

const collectKind = (
  projectRoot: string,
  segments: readonly string[],
  kind: ArtifactKind,
  out: ArtifactExcerpt[],
): void => {
  const dir = join(projectRoot, ...segments);
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    if (!entry.endsWith(MARKDOWN_SUFFIX)) continue;
    const full = join(dir, entry);
    if (!statSync(full).isFile()) continue;
    const rel = relative(projectRoot, full);
    const raw = readFileSync(full, "utf8");
    out.push({
      pointer: `thoughts:${rel.split("thoughts/")[1] ?? rel}`,
      relativePath: rel,
      kind,
      title: extractTitle(raw, entry.replace(MARKDOWN_SUFFIX, "")),
      excerpt: extractExcerpt(raw),
    });
  }
};

export async function collectArtifactExcerpts(projectRoot: string): Promise<readonly ArtifactExcerpt[]> {
  const out: ArtifactExcerpt[] = [];
  collectKind(projectRoot, ["thoughts", "shared", "designs"], "design", out);
  collectKind(projectRoot, ["thoughts", "shared", "plans"], "plan", out);
  collectKind(projectRoot, ["thoughts", "ledgers"], "ledger", out);
  return out;
}
