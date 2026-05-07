import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const ATLAS_REPO_FALLBACK_BASE = "https://github.com/Wuxie233/micode";

const SSH_PATTERN = /^git@([^:]+):(.+?)(?:\.git)?$/u;
const GIT_PLUS_PREFIX = /^git\+/u;
const TRAILING_DOT_GIT = /\.git$/u;

const normalizeUrl = (raw: string): string | null => {
  const trimmed = raw.trim();
  if (trimmed.length === 0) return null;
  const sshMatch = SSH_PATTERN.exec(trimmed);
  if (sshMatch) return `https://${sshMatch[1]}/${sshMatch[2].replace(TRAILING_DOT_GIT, "")}`;
  const stripped = trimmed.replace(GIT_PLUS_PREFIX, "").replace(TRAILING_DOT_GIT, "");
  if (!stripped.startsWith("https://") && !stripped.startsWith("http://")) return null;
  return stripped;
};

interface PackageRepository {
  readonly repository?: string | { readonly url?: string };
}

const readRepository = (root: string): string | null => {
  const pkgPath = join(root, "package.json");
  if (!existsSync(pkgPath)) return null;
  let parsed: PackageRepository;
  try {
    parsed = JSON.parse(readFileSync(pkgPath, "utf8")) as PackageRepository;
  } catch {
    return null;
  }
  const repo = parsed.repository;
  if (typeof repo === "string") return repo;
  if (repo && typeof repo === "object" && typeof repo.url === "string") return repo.url;
  return null;
};

/**
 * Resolve the repo base URL for source permalinks.
 *
 * Priority:
 * 1. `package.json#repository.url` (or string form)
 * 2. Hardcoded fallback `ATLAS_REPO_FALLBACK_BASE`
 *
 * Returned URL has no trailing `.git` and no trailing slash.
 */
export function resolveRepoBase(projectRoot: string): string {
  const fromPkg = readRepository(projectRoot);
  if (fromPkg !== null) {
    const normalized = normalizeUrl(fromPkg);
    if (normalized !== null) return normalized;
  }
  return ATLAS_REPO_FALLBACK_BASE;
}
