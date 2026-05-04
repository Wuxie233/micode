import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { ATLAS_SCHEMA_VERSION } from "@/atlas/config";
import { createAtlasPaths } from "@/atlas/paths";
import { writeSchemaVersion } from "@/atlas/schema-version";
import { renderIndexPage, renderPhaseRoadmap } from "@/atlas/templates";

export type InitMode = "fresh" | "reconcile" | "force-rebuild";

export interface InitInput {
  readonly projectRoot: string;
  readonly mode: InitMode;
  readonly projectName: string;
  readonly projectType: string;
  readonly gitTag?: string;
}

export type InitOutcome = "ok" | "rejected" | "dry-run";

export interface InitResult {
  readonly outcome: InitOutcome;
  readonly reason?: string;
  readonly report?: string;
  readonly gitTag?: string;
}

const ensureDirs = (paths: ReturnType<typeof createAtlasPaths>): void => {
  for (const dir of [
    paths.root,
    paths.impl,
    paths.behavior,
    paths.decisions,
    paths.risks,
    paths.timeline,
    paths.archive,
    paths.meta,
    paths.challenges,
    paths.log,
    paths.staging,
  ]) {
    if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  }
};

const writeSkeleton = (input: InitInput): void => {
  const paths = createAtlasPaths(input.projectRoot);
  ensureDirs(paths);
  writeFileSync(paths.indexFile, renderIndexPage({ projectName: input.projectName }), "utf8");
  writeFileSync(join(paths.decisions, "atlas-phase-roadmap.md"), renderPhaseRoadmap(), "utf8");
  writeSchemaVersion(paths.schemaVersionFile, ATLAS_SCHEMA_VERSION);
};

export async function runAtlasInit(input: InitInput): Promise<InitResult> {
  const paths = createAtlasPaths(input.projectRoot);
  const exists = existsSync(paths.root);
  if (exists && input.mode === "fresh") {
    return { outcome: "rejected", reason: "atlas/ already exists; pass --reconcile or --force-rebuild" };
  }
  if (input.mode === "reconcile") {
    return { outcome: "dry-run", report: `would refresh ${paths.root}; no writes performed` };
  }
  writeSkeleton(input);
  if (input.mode === "force-rebuild") return { outcome: "ok", gitTag: input.gitTag };
  return { outcome: "ok" };
}
