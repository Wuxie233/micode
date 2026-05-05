import type { PlannedNode } from "@/atlas/cold-init/types";
import { serializeFrontmatter } from "@/atlas/frontmatter";
import { ATLAS_NODE_STATUSES, type AtlasFrontmatter } from "@/atlas/types";
import { formatWikilink } from "@/atlas/wikilink";

const EMPTY_PLACEHOLDER = "_无_";
const SUMMARY_PLACEHOLDER = "_摘要待补全：请在下次 lifecycle 或 /atlas-refresh 时补全_";
const INFERRED_PREAMBLE =
  "本页是基于下方来源推断生成的早期草稿，措辞尚未定稿；请在下一次 lifecycle 或 /atlas-refresh 时再核实。";

export interface RenderInput {
  readonly node: PlannedNode;
  readonly userNote: string | null;
  readonly lastVerifiedCommit: string;
  readonly lastWrittenMtime: number;
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

export function renderColdInitNode(input: RenderInput): string {
  const frontmatter: AtlasFrontmatter = {
    id: input.node.id,
    layer: input.node.layer,
    status: ATLAS_NODE_STATUSES.ACTIVE,
    last_verified_commit: input.lastVerifiedCommit,
    last_written_mtime: input.lastWrittenMtime,
    sources: input.node.sources,
    extras: {},
  };
  const summary = renderSummary(input.node) || SUMMARY_PLACEHOLDER;
  const sections: string[] = [`# ${input.node.title}\n`, renderSection("Summary", summary)];
  const note = input.userNote?.trim();
  if (note) sections.push(renderSection("User notes", note));
  sections.push(renderSection("Connections", renderBullets(input.node.connections.map(formatWikilink))));
  sections.push(renderSection("Sources", renderBullets(input.node.sources)));
  sections.push(renderSection("Notes", EMPTY_PLACEHOLDER));
  return serializeFrontmatter(frontmatter, sections.join("\n"));
}
