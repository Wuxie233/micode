// Discriminated unions describing each phase's outcome. Keeping these in one
// file lets the CLI layer pattern-match without importing every helper module.

export const DEPLOY_STATUS = {
  Ok: "ok",
  Failed: "failed",
  Skipped: "skipped",
} as const;

export type DeployStatus = (typeof DEPLOY_STATUS)[keyof typeof DEPLOY_STATUS];

export interface PreflightOk {
  readonly kind: "ok";
  readonly sourceCommit: string;
  readonly runtimeCommit: string | null;
}

export interface PreflightFailed {
  readonly kind: "failed";
  readonly reason:
    | "source-missing"
    | "runtime-missing"
    | "source-dirty"
    | "runtime-dirty"
    | "rsync-missing"
    | "bun-missing";
  readonly detail: string;
}

export type PreflightResult = PreflightOk | PreflightFailed;

export interface SyncOk {
  readonly kind: "ok";
  readonly filesChanged: number;
  readonly bytesTransferred: number;
}

export interface SyncFailed {
  readonly kind: "failed";
  readonly detail: string;
}

export type SyncResult = SyncOk | SyncFailed;

export interface BuildOk {
  readonly kind: "ok";
  readonly bundleBytes: number;
  readonly installRan: boolean;
}

export interface BuildFailed {
  readonly kind: "failed";
  readonly stage: "install" | "build" | "verify";
  readonly detail: string;
}

export type BuildResult = BuildOk | BuildFailed;

export interface DeployReport {
  readonly preflight: PreflightResult;
  readonly sync: SyncResult | null;
  readonly build: BuildResult | null;
  readonly mode: "dry-run" | "apply";
  readonly ready: boolean;
}
