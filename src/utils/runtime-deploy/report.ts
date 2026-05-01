import type { BuildResult, DeployReport, PreflightResult, SyncResult } from "@/utils/runtime-deploy/types";

const RESTART_APPROVAL_LINE = "Runtime ready. Restart of OpenCode requires explicit user approval.";
const DRY_RUN_LINE = "DRY-RUN: no changes were applied to /root/.micode";
const NOT_READY_LINE = "NOT READY: see failures above; do not restart OpenCode";
const MINIMUM_SHORT_SHA_LENGTH = 7;

export function formatReport(report: DeployReport): string {
  const lines: string[] = [];
  lines.push(`MODE: ${report.mode}`);
  lines.push(formatPreflight(report.preflight));
  if (report.sync) lines.push(formatSync(report.sync));
  if (report.build) lines.push(formatBuild(report.build));
  if (report.mode === "dry-run") lines.push(DRY_RUN_LINE);
  if (report.ready) lines.push(RESTART_APPROVAL_LINE);
  else lines.push(NOT_READY_LINE);
  return `${lines.join("\n")}\n`;
}

function formatPreflight(preflight: PreflightResult): string {
  if (preflight.kind === "ok") {
    return `PREFLIGHT: ok source=${shortSha(preflight.sourceCommit)} runtime=${shortSha(preflight.runtimeCommit)}`;
  }

  return `PREFLIGHT: failed reason=${preflight.reason} detail=${preflight.detail}`;
}

function formatSync(sync: SyncResult): string {
  if (sync.kind === "ok") return `SYNC: ok files=${sync.filesChanged} bytes=${sync.bytesTransferred}`;

  return `SYNC: failed detail=${sync.detail}`;
}

function formatBuild(build: BuildResult): string {
  if (build.kind === "ok") return `BUILD: ok bundle=${build.bundleBytes} bytes installRan=${build.installRan}`;

  return `BUILD: failed stage=${build.stage} detail=${build.detail}`;
}

function shortSha(sha: string | null): string {
  if (!sha) return "none";
  if (sha.length < MINIMUM_SHORT_SHA_LENGTH) return sha;

  return sha.slice(0, MINIMUM_SHORT_SHA_LENGTH);
}
