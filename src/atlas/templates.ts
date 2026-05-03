import { serializeFrontmatter } from "./frontmatter";
import { ATLAS_NODE_STATUSES, type AtlasFrontmatter, type AtlasLayer, type AtlasNodeStatus } from "./types";

interface EmptyNodeInput {
  readonly id: string;
  readonly layer: AtlasLayer;
  readonly status: AtlasNodeStatus;
  readonly summary: string;
  readonly sources: readonly string[];
  readonly lastVerifiedCommit: string;
  readonly lastWrittenMtime: number;
  readonly connections?: readonly string[];
}

const renderH2 = (title: string, body: string): string => `## ${title}\n\n${body}\n`;
const bullet = (items: readonly string[]): string =>
  items.length === 0 ? "_none_" : items.map((s) => `- ${s}`).join("\n");

export function renderEmptyNode(input: EmptyNodeInput): string {
  const fm: AtlasFrontmatter = {
    id: input.id,
    layer: input.layer,
    status: input.status,
    last_verified_commit: input.lastVerifiedCommit,
    last_written_mtime: input.lastWrittenMtime,
    sources: input.sources,
    extras: {},
  };
  const body = [
    renderH2("Summary", input.summary),
    renderH2("Connections", bullet(input.connections ?? [])),
    renderH2("Sources", bullet(input.sources)),
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
    "User Perspective lifecycle enforcement; schema version file at `_meta/schema-version`.\n",
    "### Phase 3: Hardening and operational maturity (deferred)\n",
    "Independent lint and GC pass; project type profile system; agent2 failure escalation;",
    "cross-project schema migration tools; independent git isolation; madge/dep-cruiser SVG;",
    "Behavior layer round-trip verification.",
  ].join("\n");
  return serializeFrontmatter(fm, body);
}
