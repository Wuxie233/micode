import { resolveProjectId as defaultResolve, type ProjectIdentity } from "@/utils/project-id";

export interface StrictResolveOptions {
  readonly resolveProjectId?: (cwd: string) => Promise<ProjectIdentity>;
}

export type StrictResolveResult =
  | { readonly ok: true; readonly identity: ProjectIdentity }
  | { readonly ok: false; readonly reason: string };

export async function resolveStrictProjectId(
  cwd: string,
  options: StrictResolveOptions = {},
): Promise<StrictResolveResult> {
  const resolver = options.resolveProjectId ?? defaultResolve;
  const identity = await resolver(cwd);
  if (identity.kind === "path") {
    return {
      ok: false,
      reason: `projectId degraded (source=${identity.source}); skill autopilot refuses to write`,
    };
  }
  return { ok: true, identity };
}
