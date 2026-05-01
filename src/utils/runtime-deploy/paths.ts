export interface RuntimeDeployPaths {
  readonly source: string;
  readonly runtime: string;
  readonly runtimeBundle: string;
  readonly minBundleBytes: number;
}

export const RUNTIME_DEPLOY_PATHS: RuntimeDeployPaths = {
  source: "/root/CODE/micode",
  runtime: "/root/.micode",
  runtimeBundle: "/root/.micode/dist/index.js",
  minBundleBytes: 1024,
} as const;

export function isUnderSource(absolutePath: string): boolean {
  if (!absolutePath) return false;
  return absolutePath === RUNTIME_DEPLOY_PATHS.source || absolutePath.startsWith(`${RUNTIME_DEPLOY_PATHS.source}/`);
}

export function isUnderRuntime(absolutePath: string): boolean {
  if (!absolutePath) return false;
  return absolutePath === RUNTIME_DEPLOY_PATHS.runtime || absolutePath.startsWith(`${RUNTIME_DEPLOY_PATHS.runtime}/`);
}
