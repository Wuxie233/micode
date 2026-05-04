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
];

const RECONCILE = "--reconcile";
const FORCE_REBUILD = "--force-rebuild";
const KNOWN_FLAGS = new Set<string>([RECONCILE, FORCE_REBUILD]);

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
