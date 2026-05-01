export const RUNTIME_LOCAL_EXCLUSIONS: readonly string[] = [
  "node_modules",
  "dist",
  ".git",
  "thoughts",
  "coverage",
  ".turbo",
  ".cache",
  "*.log",
  ".env",
  ".env.*",
] as const;

const PATH_SEPARATOR = "/";
const WILDCARD = "*";
const REGEXP_SPECIAL_CHARACTERS = /[.*+?^${}()|[\]\\]/g;

export function toRsyncExcludeArgs(patterns: readonly string[]): string[] {
  const args: string[] = [];

  for (const pattern of patterns) {
    args.push("--exclude", pattern);
  }

  return args;
}

export function isExcluded(relativePath: string, patterns: readonly string[] = RUNTIME_LOCAL_EXCLUSIONS): boolean {
  if (!relativePath) return false;

  for (const pattern of patterns) {
    if (matchesPattern(relativePath, pattern)) return true;
  }

  return false;
}

function matchesPattern(relativePath: string, pattern: string): boolean {
  if (!pattern.includes(WILDCARD)) return matchesLiteralPattern(relativePath, pattern);
  if (pattern.includes(PATH_SEPARATOR)) return matchesWildcard(relativePath, pattern);

  return relativePath.split(PATH_SEPARATOR).some((segment) => matchesWildcard(segment, pattern));
}

function matchesLiteralPattern(relativePath: string, pattern: string): boolean {
  return relativePath === pattern || relativePath.startsWith(`${pattern}${PATH_SEPARATOR}`);
}

function matchesWildcard(value: string, pattern: string): boolean {
  const source = pattern.split(WILDCARD).map(escapeRegExp).join(".*");
  const matcher = new RegExp(`^${source}$`);

  return matcher.test(value);
}

function escapeRegExp(value: string): string {
  return value.replace(REGEXP_SPECIAL_CHARACTERS, "\\$&");
}
