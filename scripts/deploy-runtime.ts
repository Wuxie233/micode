#!/usr/bin/env bun
// scripts/deploy-runtime.ts
// CLI entry: parses --dry-run / --force, runs the orchestrator, prints the
// formatted report, exits 0 on ready and 1 otherwise. NEVER restarts OpenCode.

import { formatReport, runRuntimeDeploy } from "@/utils/runtime-deploy";

interface Flags {
  readonly mode: "dry-run" | "apply";
  readonly force: boolean;
}

function parseFlags(argv: readonly string[]): Flags {
  const args = new Set(argv.slice(2));
  return {
    mode: args.has("--dry-run") ? "dry-run" : "apply",
    force: args.has("--force"),
  };
}

async function main(): Promise<void> {
  const flags = parseFlags(process.argv);
  const report = await runRuntimeDeploy({ mode: flags.mode, force: flags.force });
  process.stdout.write(formatReport(report));
  process.exit(report.ready || flags.mode === "dry-run" ? 0 : 1);
}

await main();
