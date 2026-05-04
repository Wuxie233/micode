import { existsSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

import { COLD_INIT_README_EXCERPT_CHARS } from "@/atlas/cold-init/config";

export interface ProjectSurvey {
  readonly projectName: string;
  readonly readmeSummary: string | null;
  readonly architectureSummary: string | null;
  readonly codeStyleSummary: string | null;
  readonly packageManifest: PackageManifestSummary | null;
}

export interface PackageManifestSummary {
  readonly kind: "node" | "python" | "rust" | "go" | "unknown";
  readonly name: string | null;
  readonly description: string | null;
  readonly scripts: readonly string[];
}

const README_CANDIDATES = ["README.md", "README.MD", "Readme.md", "readme.md"] as const;
const ARCHITECTURE_CANDIDATES = ["ARCHITECTURE.md"] as const;
const CODE_STYLE_CANDIDATES = ["CODE_STYLE.md"] as const;
const NODE_PACKAGE_KIND: PackageManifestSummary["kind"] = "node";
const PACKAGE_CANDIDATES: ReadonlyArray<readonly [string, PackageManifestSummary["kind"]]> = [
  ["package.json", NODE_PACKAGE_KIND],
  ["pyproject.toml", "python"],
  ["Cargo.toml", "rust"],
  ["go.mod", "go"],
];
const EXCERPT_SUFFIX = "...";
const NAME_KEY = "name";
const DESCRIPTION_KEY = "description";
const SCRIPTS_KEY = "scripts";

const truncate = (raw: string): string => {
  if (raw.length <= COLD_INIT_README_EXCERPT_CHARS) return raw;
  return `${raw.slice(0, COLD_INIT_README_EXCERPT_CHARS)}${EXCERPT_SUFFIX}`;
};

const isRecord = (value: unknown): value is Readonly<Record<string, unknown>> => {
  return typeof value === "object" && value !== null && !Array.isArray(value);
};

const stringProperty = (record: Readonly<Record<string, unknown>>, key: string): string | null => {
  const value = record[key];
  if (typeof value !== "string") return null;
  return value;
};

const scriptNames = (record: Readonly<Record<string, unknown>>): readonly string[] => {
  const scripts = record[SCRIPTS_KEY];
  if (!isRecord(scripts)) return [];
  return Object.keys(scripts);
};

const readFirstExisting = (projectRoot: string, names: readonly string[]): string | null => {
  for (const name of names) {
    const full = join(projectRoot, name);
    if (existsSync(full)) return truncate(readFileSync(full, "utf8"));
  }
  return null;
};

const unknownManifest = (kind: PackageManifestSummary["kind"]): PackageManifestSummary => ({
  kind,
  name: null,
  description: null,
  scripts: [],
});

const readNodeManifest = (path: string): PackageManifestSummary => {
  try {
    const parsed: unknown = JSON.parse(readFileSync(path, "utf8"));
    if (!isRecord(parsed)) return unknownManifest(NODE_PACKAGE_KIND);
    return {
      kind: NODE_PACKAGE_KIND,
      name: stringProperty(parsed, NAME_KEY),
      description: stringProperty(parsed, DESCRIPTION_KEY),
      scripts: scriptNames(parsed),
    };
  } catch {
    return unknownManifest(NODE_PACKAGE_KIND);
  }
};

const readPackageManifest = (projectRoot: string): PackageManifestSummary | null => {
  for (const [name, kind] of PACKAGE_CANDIDATES) {
    const full = join(projectRoot, name);
    if (!existsSync(full)) continue;
    if (kind !== NODE_PACKAGE_KIND) return unknownManifest(kind);
    return readNodeManifest(full);
  }
  return null;
};

export async function collectProjectSurvey(projectRoot: string): Promise<ProjectSurvey> {
  return {
    projectName: basename(projectRoot),
    readmeSummary: readFirstExisting(projectRoot, README_CANDIDATES),
    architectureSummary: readFirstExisting(projectRoot, ARCHITECTURE_CANDIDATES),
    codeStyleSummary: readFirstExisting(projectRoot, CODE_STYLE_CANDIDATES),
    packageManifest: readPackageManifest(projectRoot),
  };
}
