import type { FilePresence, KnowledgeState, LayerState } from "./types";

// AtlasStatusResult mirrors the public shape of runAtlasStatus's StatusReport.
// Declared here as a structural type to avoid a cross-import cycle with src/tools/atlas/.
export interface AtlasStatusResult {
  readonly openChallenges: number;
  readonly brokenWikilinks: number;
  readonly orphanStagingDirs: number;
  readonly staleNodes: number;
  readonly lastSuccessfulRun: string | null;
  readonly spawnReceiptDiff: number;
}

const HEADER = "# Knowledge Bootstrap Status";
const LAYER_HEADER = "## Layer presence";
const ATLAS_HEADER = "## Atlas health";
const MEMORY_HEADER = "## Project Memory";
const RECOMMENDATION_HEADER = "## Recommendation";
const SEPARATOR = "\n\n";
const ISO_DATE_LENGTH = 10;

function formatLayerState(state: LayerState): string {
  switch (state) {
    case "present":
      return "✔ present";
    case "missing":
      return "✗ missing";
    case "unknown":
      return "? unknown (read failed)";
  }
}

function formatMtime(presence: FilePresence): string {
  if (!presence.exists || !presence.mtime) return "";
  return ` (mtime: ${presence.mtime.toISOString().slice(0, ISO_DATE_LENGTH)})`;
}

function renderLayerSection(state: KnowledgeState): string {
  const lines: string[] = [LAYER_HEADER];
  lines.push(
    `- /init layer: ${formatLayerState(state.init)}` +
      `\n  - ARCHITECTURE.md: ${state.files.architectureMd.exists ? "exists" : "missing"}${formatMtime(state.files.architectureMd)}` +
      `\n  - CODE_STYLE.md: ${state.files.codeStyleMd.exists ? "exists" : "missing"}${formatMtime(state.files.codeStyleMd)}`,
  );
  lines.push(
    `- .mindmodel/ layer: ${formatLayerState(state.mindmodel)}` +
      `\n  - .mindmodel/manifest.yaml: ${state.files.mindmodelManifest.exists ? "exists" : "missing"}${formatMtime(state.files.mindmodelManifest)}`,
  );
  lines.push(
    `- atlas/ layer: ${formatLayerState(state.atlas)}` +
      `\n  - atlas/00-index.md: ${state.files.atlasIndex.exists ? "exists" : "missing"}${formatMtime(state.files.atlasIndex)}`,
  );
  return lines.join("\n");
}

function renderAtlasSection(atlas: AtlasStatusResult): string {
  return [
    ATLAS_HEADER,
    `- open challenges: ${atlas.openChallenges}`,
    `- broken wikilinks: ${atlas.brokenWikilinks}`,
    `- orphan staging dirs: ${atlas.orphanStagingDirs}`,
    `- last successful run: ${atlas.lastSuccessfulRun ?? "n/a"}`,
  ].join("\n");
}

function renderMemorySection(state: KnowledgeState): string {
  return [
    MEMORY_HEADER,
    `- entries: ${state.projectMemory.entries}`,
    `- healthy: ${state.projectMemory.healthy ? "yes" : "no"}`,
  ].join("\n");
}

function renderRecommendation(state: KnowledgeState): string {
  const allPresent = state.init === "present" && state.mindmodel === "present" && state.atlas === "present";
  const allMissing = state.init === "missing" && state.mindmodel === "missing" && state.atlas === "missing";
  const anyUnknown = state.init === "unknown" || state.mindmodel === "unknown" || state.atlas === "unknown";

  if (anyUnknown) {
    return [
      RECOMMENDATION_HEADER,
      "- Some layers could not be read (permissions / IO failure). Inspect the project root and re-run.",
    ].join("\n");
  }
  if (allPresent) {
    return [
      RECOMMENDATION_HEADER,
      "- All three layers are present. To refresh after major changes, run `/all-rebuild` (overwrites in place).",
    ].join("\n");
  }
  if (allMissing) {
    return [RECOMMENDATION_HEADER, "- All three layers are missing. Run `/all-init` to bootstrap them in order."].join(
      "\n",
    );
  }
  return [
    RECOMMENDATION_HEADER,
    "- Some layers are missing. Run `/all-init` to fill the gaps without overwriting existing layers.",
  ].join("\n");
}

// renderBootstrapStatus returns a plain markdown report safe to print in chat.
// It does NOT write any files; /all-status is read-only.
export function renderBootstrapStatus(state: KnowledgeState, atlas: AtlasStatusResult): string {
  return [
    HEADER,
    renderLayerSection(state),
    renderAtlasSection(atlas),
    renderMemorySection(state),
    renderRecommendation(state),
  ].join(SEPARATOR);
}
