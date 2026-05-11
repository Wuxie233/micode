import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import type { FilePresence, KnowledgeState, LayerState } from "./types";

const ARCHITECTURE_MD = "ARCHITECTURE.md";
const CODE_STYLE_MD = "CODE_STYLE.md";
const MINDMODEL_MANIFEST = join(".mindmodel", "manifest.yaml");
const ATLAS_INDEX = join("atlas", "00-index.md");

function readPresence(absolutePath: string): FilePresence {
  try {
    if (!existsSync(absolutePath)) return { exists: false };
    const stat = statSync(absolutePath);
    return { exists: stat.isFile(), mtime: stat.mtime };
  } catch {
    // Permission / IO error: surface as "exists: false" with no mtime so the
    // caller can downgrade the layer to "unknown".
    return { exists: false };
  }
}

function deriveInitState(arch: FilePresence, style: FilePresence): LayerState {
  if (arch.exists && style.exists) return "present";
  return "missing";
}

function deriveMindmodelState(manifest: FilePresence): LayerState {
  return manifest.exists ? "present" : "missing";
}

function deriveAtlasState(index: FilePresence): LayerState {
  return index.exists ? "present" : "missing";
}

// detectKnowledgeState reads file presence on disk and returns a synchronous,
// dependency-free snapshot. Project Memory entries default to {0, false}; the
// orchestrator augments this with project_memory_health output when available.
export function detectKnowledgeState(projectRoot: string): KnowledgeState {
  const architectureMd = readPresence(join(projectRoot, ARCHITECTURE_MD));
  const codeStyleMd = readPresence(join(projectRoot, CODE_STYLE_MD));
  const mindmodelManifest = readPresence(join(projectRoot, MINDMODEL_MANIFEST));
  const atlasIndex = readPresence(join(projectRoot, ATLAS_INDEX));

  return {
    init: deriveInitState(architectureMd, codeStyleMd),
    mindmodel: deriveMindmodelState(mindmodelManifest),
    atlas: deriveAtlasState(atlasIndex),
    projectMemory: { entries: 0, healthy: false },
    files: { architectureMd, codeStyleMd, mindmodelManifest, atlasIndex },
  };
}
