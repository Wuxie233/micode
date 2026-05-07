import { deriveDisplayExtras } from "./display-extras";
import { serializeFrontmatter } from "./frontmatter";
import { ATLAS_REPO_FALLBACK_BASE } from "./repo-url";
import { formatSourceLink } from "./source-link";
import { ATLAS_NODE_STATUSES, type AtlasFrontmatter, type AtlasLayer, type AtlasNodeStatus } from "./types";

const DEFAULT_REF = "main";

interface EmptyNodeInput {
  readonly id: string;
  readonly layer: AtlasLayer;
  readonly status: AtlasNodeStatus;
  readonly title?: string;
  readonly summary: string;
  readonly sources: readonly string[];
  readonly lastVerifiedCommit: string;
  readonly lastWrittenMtime: number;
  readonly connections?: readonly string[];
  readonly repoBase?: string;
}

const renderH2 = (title: string, body: string): string => `## ${title}\n\n${body}\n`;
const bullet = (items: readonly string[]): string =>
  items.length === 0 ? "_none_" : items.map((s) => `- ${s}`).join("\n");

const renderSourcesBody = (sources: readonly string[], repoBase: string): string => {
  if (sources.length === 0) return "_none_";
  const ref = DEFAULT_REF;
  return sources.map((src) => `- ${formatSourceLink(src, { repoBase, ref })}`).join("\n");
};

const buildExtras = (input: EmptyNodeInput): Readonly<Record<string, string>> => {
  const titleForExtras = input.title ?? "";
  const extras = deriveDisplayExtras({ title: titleForExtras, id: input.id, sources: input.sources });
  const out: Record<string, string> = {};
  if (extras.title !== undefined) out.title = extras.title;
  if (extras.aliases !== undefined) out.aliases = extras.aliases;
  if (extras.source_path !== undefined) out.source_path = extras.source_path;
  return out;
};

export function renderEmptyNode(input: EmptyNodeInput): string {
  const repoBase = input.repoBase ?? ATLAS_REPO_FALLBACK_BASE;
  const fm: AtlasFrontmatter = {
    id: input.id,
    layer: input.layer,
    status: input.status,
    last_verified_commit: input.lastVerifiedCommit,
    last_written_mtime: input.lastWrittenMtime,
    sources: input.sources,
    extras: buildExtras(input),
  };
  const heading = input.title ? `# ${input.title}\n\n` : "";
  const body = [
    heading + renderH2("Summary", input.summary),
    renderH2("Connections", bullet(input.connections ?? [])),
    renderH2("Sources", renderSourcesBody(input.sources, repoBase)),
    renderH2("Notes", "_none_"),
  ].join("\n");
  return serializeFrontmatter(fm, body);
}

export function renderIndexPage(input: { readonly projectName: string }): string {
  const fm: AtlasFrontmatter = {
    id: "index",
    layer: "decision",
    status: ATLAS_NODE_STATUSES.ACTIVE,
    last_verified_commit: "",
    last_written_mtime: 0,
    sources: [],
    extras: {},
  };
  const body = [
    `# ${input.projectName}\n`,
    "Project Atlas is a curated map maintained by humans and agents together.\n",
    "agent2 refreshes the impl, decision, risk, and timeline layers after lifecycle finish.\n",
    "Open `_meta/challenges/` to review proposed changes that touch your edits.\n",
    renderH2("Summary", "_human-authored intro goes here_"),
    renderH2("Reading guide", "Build layer at `10-impl/`. Behavior layer at `20-behavior/`."),
  ].join("\n");
  return serializeFrontmatter(fm, body);
}

export function renderPhaseRoadmap(): string {
  const fm: AtlasFrontmatter = {
    id: "decision/atlas-phase-roadmap",
    layer: "decision",
    status: ATLAS_NODE_STATUSES.ACTIVE,
    last_verified_commit: "",
    last_written_mtime: 0,
    sources: ["thoughts:shared/designs/2026-05-04-project-atlas-design.md"],
    extras: {},
  };
  const body = [
    "## Summary\n\nCanonical record of what is in scope for Phase 2 and what is deferred to Phase 3.\n",
    "## Connections\n\n_none_\n",
    "## Sources\n\n- thoughts:shared/designs/2026-05-04-project-atlas-design.md\n",
    "## Notes\n",
    "### Phase 2: Closed-loop integration (delivered)\n",
    "Lifecycle finish auto-spawn of agent2; structured handoff; spawn receipt; worker fan-out;",
    "atomic write protocol; mtime-based edit detection; challenge flow with dedup and cooldown;",
    "wikilink rewiring constraint; soft delete to `_archive/`; first-person maintenance log;",
    "`/atlas-status`; `/atlas-init --reconcile` and `--force-rebuild`; `atlas:` commit prefix;",
    "`/atlas-init` is a comprehensive cold-start orchestrator independent of lifecycle handoff;",
    "User Perspective lifecycle enforcement; schema version file at `_meta/schema-version`.\n",
    "### Phase 3: Hardening and operational maturity (deferred)\n",
    "Independent lint and GC pass; project type profile system; agent2 failure escalation;",
    "cross-project schema migration tools; independent git isolation; madge/dep-cruiser SVG;",
    "Behavior layer round-trip verification.",
  ].join("\n");
  return serializeFrontmatter(fm, body);
}
