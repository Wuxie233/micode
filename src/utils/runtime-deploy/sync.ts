import { $ } from "bun";

import { RUNTIME_LOCAL_EXCLUSIONS, toRsyncExcludeArgs } from "@/utils/runtime-deploy/exclusions";
import type { SyncResult } from "@/utils/runtime-deploy/types";

export interface SyncInput {
  readonly source: string;
  readonly runtime: string;
  readonly dryRun: boolean;
  readonly exclusions?: readonly string[];
}

export async function runSync(input: SyncInput): Promise<SyncResult> {
  const exclusions = input.exclusions ?? RUNTIME_LOCAL_EXCLUSIONS;
  const sourceWithSlash = input.source.endsWith("/") ? input.source : `${input.source}/`;
  const flags = input.dryRun ? ["-a", "--delete", "--dry-run", "--stats"] : ["-a", "--delete", "--stats"];
  const args = [...flags, ...toRsyncExcludeArgs(exclusions), sourceWithSlash, input.runtime];
  const result = await $`rsync ${args}`.nothrow().quiet();

  if (result.exitCode !== 0) {
    return { kind: "failed", detail: result.stderr.toString().trim() || `rsync exit ${result.exitCode}` };
  }

  const stats = parseStats(result.stdout.toString());
  return { kind: "ok", filesChanged: stats.filesChanged, bytesTransferred: stats.bytesTransferred };
}

interface ParsedStats {
  readonly filesChanged: number;
  readonly bytesTransferred: number;
}

function parseStats(output: string): ParsedStats {
  const filesMatch = output.match(/Number of regular files transferred:\s+([\d,]+)/);
  const bytesMatch = output.match(/Total transferred file size:\s+([\d,]+)/);

  return {
    filesChanged: filesMatch ? Number(filesMatch[1].replace(/,/g, "")) : 0,
    bytesTransferred: bytesMatch ? Number(bytesMatch[1].replace(/,/g, "")) : 0,
  };
}
