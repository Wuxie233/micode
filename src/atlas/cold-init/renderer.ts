import type { PlannedNode } from "@/atlas/cold-init/types";
import { deriveDisplayExtras } from "@/atlas/display-extras";
import { serializeFrontmatter } from "@/atlas/frontmatter";
import { ATLAS_REPO_FALLBACK_BASE } from "@/atlas/repo-url";
import { formatSourceLink } from "@/atlas/source-link";
import { ATLAS_NODE_STATUSES, type AtlasFrontmatter } from "@/atlas/types";
import { formatWikilink } from "@/atlas/wikilink";

const EMPTY_PLACEHOLDER = "_无_";
const SUMMARY_PLACEHOLDER = "_摘要待补全：请在下次 lifecycle 或 /atlas-refresh 时补全_";
const INFERRED_PREAMBLE =
  "本页是基于下方来源推断生成的早期草稿，措辞尚未定稿；请在下一次 lifecycle 或 /atlas-refresh 时再核实。";
const DEFAULT_REF = "main";

export interface RenderInput {
  readonly node: PlannedNode;
  readonly userNote: string | null;
  readonly lastVerifiedCommit: string;
  readonly lastWrittenMtime: number;
  readonly repoBase?: string;
}

const renderSection = (title: string, body: string): string => `## ${title}\n\n${body}\n`;

const renderBullets = (items: readonly string[]): string => {
  if (items.length === 0) return EMPTY_PLACEHOLDER;
  return items.map((item) => `- ${item}`).join("\n");
};

const renderSummary = (node: PlannedNode): string => {
  if (!node.inferred) return node.summary;
  return `${INFERRED_PREAMBLE}\n\n${node.summary}`;
};

const buildExtras = (node: PlannedNode): Readonly<Record<string, string>> => {
  const extras = deriveDisplayExtras({ title: node.title, id: node.id, sources: node.sources });
  const out: Record<string, string> = {};
  if (extras.title !== undefined) out.title = extras.title;
  if (extras.aliases !== undefined) out.aliases = extras.aliases;
  if (extras.source_path !== undefined) out.source_path = extras.source_path;
  return out;
};

const renderSourceBody = (sources: readonly string[], repoBase: string): string => {
  if (sources.length === 0) return EMPTY_PLACEHOLDER;
  const ref = DEFAULT_REF;
  return sources.map((src) => `- ${formatSourceLink(src, { repoBase, ref })}`).join("\n");
};

export function renderColdInitNode(input: RenderInput): string {
  const repoBase = input.repoBase ?? ATLAS_REPO_FALLBACK_BASE;
  const frontmatter: AtlasFrontmatter = {
    id: input.node.id,
    layer: input.node.layer,
    status: ATLAS_NODE_STATUSES.ACTIVE,
    last_verified_commit: input.lastVerifiedCommit,
    last_written_mtime: input.lastWrittenMtime,
    sources: input.node.sources,
    extras: buildExtras(input.node),
  };
  const summary = renderSummary(input.node) || SUMMARY_PLACEHOLDER;
  const sections: string[] = [`# ${input.node.title}\n`, renderSection("Summary", summary)];
  const note = input.userNote?.trim();
  if (note) sections.push(renderSection("User notes", note));
  sections.push(renderSection("Connections", renderBullets(input.node.connections.map(formatWikilink))));
  sections.push(renderSection("Sources", renderSourceBody(input.node.sources, repoBase)));
  sections.push(renderSection("Notes", EMPTY_PLACEHOLDER));
  return serializeFrontmatter(frontmatter, sections.join("\n"));
}
