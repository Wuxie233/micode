export interface QuarantineProbe {
  readonly untrackedPath: string;
  readonly artifactPointers: readonly string[];
}

export type QuarantineKind = "quarantine" | "block";

export interface QuarantineClassification {
  readonly kind: QuarantineKind;
  readonly reason: string;
}

const LIFECYCLE_OWNED_PREFIXES: readonly string[] = [
  "thoughts/shared/designs/",
  "thoughts/shared/plans/",
  "thoughts/shared/atlas-deltas/",
  "thoughts/lifecycle/",
];

const SECRET_NAME_PATTERN = /(^|\/)(\.env(\..+)?|.*credentials.*|.*secret.*|.*\.key|.*\.pem)$/i;

const block = (reason: string): QuarantineClassification => ({ kind: "block", reason });
const quarantine = (reason: string): QuarantineClassification => ({ kind: "quarantine", reason });

export function classifyQuarantine(probe: QuarantineProbe): QuarantineClassification {
  const path = probe.untrackedPath;

  if (path.split("/").some((seg) => seg === "..")) return block(`path_escape: ${path}`);
  if (SECRET_NAME_PATTERN.test(path)) return block(`looks_like_secret: ${path}`);

  if (probe.artifactPointers.includes(path)) return quarantine(`matches_artifact_pointer: ${path}`);

  for (const prefix of LIFECYCLE_OWNED_PREFIXES) {
    if (path.startsWith(prefix)) return quarantine(`lifecycle_owned_prefix(${prefix}): ${path}`);
  }

  return block(`unknown_untracked: ${path}`);
}
