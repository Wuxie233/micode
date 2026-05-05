import type { InitMode } from "@/tools/atlas/init";

export interface AtlasCommandDefinition {
  readonly name: string;
  readonly description: string;
}

const ATLAS_INIT_DESCRIPTION = [
  "Cold-start the project atlas vault: discover, plan, optionally ask Octto questions,",
  "and write a usable Obsidian vault (use --reconcile or --force-rebuild on existing vaults)",
].join(" ");

export const atlasCommandDefinitions: readonly AtlasCommandDefinition[] = [
  {
    name: "/atlas-init",
    description: ATLAS_INIT_DESCRIPTION,
  },
  {
    name: "/atlas-status",
    description: "Report atlas vault health: open challenges, broken wikilinks, orphan staging, last run",
  },
  {
    name: "/atlas-refresh",
    description: "Manually refresh a single atlas node or area without waiting for lifecycle finish",
  },
  {
    name: "/atlas-translate",
    description: "Translate atlas nodes or the full vault into Chinese while preserving atlas structure",
  },
];

const RECONCILE = "--reconcile";
const FORCE_REBUILD = "--force-rebuild";
const KNOWN_FLAGS = new Set<string>([RECONCILE, FORCE_REBUILD]);
const FLAG_PREFIX = "--";
const DEFAULT_TRANSLATE_TARGET = "all";
const MAX_TRANSLATE_POSITIONALS = 1;

export function parseAtlasInitArgs(argv: readonly string[]): { readonly mode: InitMode } {
  for (const arg of argv) {
    if (!KNOWN_FLAGS.has(arg)) throw new Error(`unknown flag: ${arg}`);
  }

  const reconcile = argv.includes(RECONCILE);
  const forceRebuild = argv.includes(FORCE_REBUILD);
  if (reconcile && forceRebuild) throw new Error("cannot pass both --reconcile and --force-rebuild");
  if (reconcile) return { mode: "reconcile" };
  if (forceRebuild) return { mode: "force-rebuild" };
  return { mode: "fresh" };
}

export function parseAtlasTranslateArgs(argv: readonly string[]): { readonly targetPath: string } {
  const unknownFlag = argv.find((arg) => arg.startsWith(FLAG_PREFIX));
  if (unknownFlag) throw new Error(`unknown flag: ${unknownFlag}`);

  if (argv.length > MAX_TRANSLATE_POSITIONALS) throw new Error("expected at most one target path");

  return { targetPath: argv[0] ?? DEFAULT_TRANSLATE_TARGET };
}
