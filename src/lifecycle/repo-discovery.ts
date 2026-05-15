import { readdir } from "node:fs/promises";
import { join, resolve } from "node:path";

import type { LifecycleRunner, RunResult } from "./runner";

export const REPO_DISCOVERY_KIND = {
  REPO: "repo",
  UNINITIALIZED: "uninitialized",
  AMBIGUOUS: "ambiguous",
  BLOCKED: "blocked",
} as const;

export type RepoDiscoveryResult =
  | {
      readonly kind: "repo";
      readonly root: string;
      readonly source: "current" | "parent" | "unique-child";
      readonly candidates: readonly string[];
      readonly note: string | null;
    }
  | {
      readonly kind: "uninitialized";
      readonly root: string;
      readonly source: "uninitialized";
      readonly candidates: readonly string[];
      readonly note: string;
    }
  | {
      readonly kind: "ambiguous";
      readonly root: string;
      readonly source: "ambiguous";
      readonly candidates: readonly string[];
      readonly note: string;
    }
  | {
      readonly kind: "blocked";
      readonly root: string;
      readonly source: "blocked";
      readonly candidates: readonly string[];
      readonly note: string;
    };

export interface ResolveEffectiveProjectRootInput {
  readonly cwd: string;
  readonly readDir?: (path: string) => readonly string[] | Promise<readonly string[]>;
  readonly pathExists?: (path: string) => boolean | Promise<boolean>;
}

const OK_EXIT_CODE = 0;
const TOPLEVEL_ARGS = ["rev-parse", "--show-toplevel"] as const;
const MULTIPLE_REPOS_NOTE = "Multiple child git repositories were discovered; choose one explicitly.";
const UNINITIALIZED_NOTE =
  "No git repository was discovered; repository initialization is required before lifecycle work.";
const GIT_PROBE_BLOCKED_NOTE = "Unable to probe git repository root.";
const READ_DIR_BLOCKED_NOTE = "Unable to scan direct child directories.";
const PATH_EXISTS_BLOCKED_NOTE = "Unable to inspect direct child path.";

const trim = (value: string): string => value.trim();

const normalizePath = (path: string): string => resolve(path);

const completed = (run: RunResult): boolean => run.exitCode === OK_EXIT_CODE;

const blocked = (cwd: string, note: string): RepoDiscoveryResult => ({
  kind: REPO_DISCOVERY_KIND.BLOCKED,
  root: normalizePath(cwd),
  source: "blocked",
  candidates: [],
  note,
});

const readDirectory = async (input: ResolveEffectiveProjectRootInput): Promise<readonly string[]> => {
  if (input.readDir) return input.readDir(input.cwd);
  return readdir(input.cwd);
};

const probeRoot = async (runner: LifecycleRunner, cwd: string): Promise<string | null> => {
  const run = await runner.git(TOPLEVEL_ARGS, { cwd });
  const root = trim(run.stdout);
  if (!completed(run) || root.length === 0) return null;
  return normalizePath(root);
};

const childPathExists = async (input: ResolveEffectiveProjectRootInput, child: string): Promise<boolean> => {
  if (!input.pathExists) return true;
  return input.pathExists(child);
};

const uniqueSorted = (values: readonly string[]): readonly string[] => [...new Set(values)].sort();

const repo = (
  root: string,
  source: "current" | "parent" | "unique-child",
  candidates: readonly string[],
): RepoDiscoveryResult => ({
  kind: REPO_DISCOVERY_KIND.REPO,
  root,
  source,
  candidates,
  note: null,
});

const noRepo = (cwd: string): RepoDiscoveryResult => ({
  kind: REPO_DISCOVERY_KIND.UNINITIALIZED,
  root: cwd,
  source: "uninitialized",
  candidates: [],
  note: UNINITIALIZED_NOTE,
});

const ambiguous = (cwd: string, candidates: readonly string[]): RepoDiscoveryResult => ({
  kind: REPO_DISCOVERY_KIND.AMBIGUOUS,
  root: cwd,
  source: "ambiguous",
  candidates,
  note: MULTIPLE_REPOS_NOTE,
});

const resolveCurrentRepository = async (runner: LifecycleRunner, cwd: string): Promise<RepoDiscoveryResult | null> => {
  try {
    const currentRoot = await probeRoot(runner, cwd);
    if (currentRoot === null) return null;
    return repo(currentRoot, currentRoot === cwd ? "current" : "parent", [currentRoot]);
  } catch {
    return blocked(cwd, GIT_PROBE_BLOCKED_NOTE);
  }
};

type ChildProbeResult =
  | { readonly kind: "blocked"; readonly result: RepoDiscoveryResult }
  | { readonly kind: "none" }
  | { readonly kind: "root"; readonly root: string };

const probeChildRepository = async (
  runner: LifecycleRunner,
  input: ResolveEffectiveProjectRootInput,
  cwd: string,
  child: string,
): Promise<ChildProbeResult> => {
  const childPath = join(cwd, child);

  try {
    if (!(await childPathExists(input, childPath))) return { kind: "none" };
  } catch {
    return { kind: "blocked", result: blocked(cwd, PATH_EXISTS_BLOCKED_NOTE) };
  }

  try {
    const childRoot = await probeRoot(runner, childPath);
    if (childRoot === null) return { kind: "none" };
    return { kind: "root", root: childRoot };
  } catch {
    return { kind: "blocked", result: blocked(cwd, GIT_PROBE_BLOCKED_NOTE) };
  }
};

type ChildRootDiscovery =
  | { readonly kind: "blocked"; readonly result: RepoDiscoveryResult }
  | { readonly kind: "roots"; readonly roots: readonly string[] };

const discoverChildRoots = async (
  runner: LifecycleRunner,
  input: ResolveEffectiveProjectRootInput,
  cwd: string,
): Promise<ChildRootDiscovery> => {
  let children: readonly string[];
  try {
    children = await readDirectory({ ...input, cwd });
  } catch {
    return { kind: "blocked", result: blocked(cwd, READ_DIR_BLOCKED_NOTE) };
  }

  const candidates: string[] = [];
  for (const child of children) {
    const childResult = await probeChildRepository(runner, input, cwd, child);
    if (childResult.kind === "blocked") return childResult;
    if (childResult.kind === "root") candidates.push(childResult.root);
  }

  return { kind: "roots", roots: uniqueSorted(candidates) };
};

const resolveChildDiscovery = (cwd: string, roots: readonly string[]): RepoDiscoveryResult => {
  if (roots.length === 1) return repo(roots[0] ?? cwd, "unique-child", roots);
  if (roots.length > 1) return ambiguous(cwd, roots);
  return noRepo(cwd);
};

export async function resolveEffectiveProjectRoot(
  runner: LifecycleRunner,
  input: ResolveEffectiveProjectRootInput,
): Promise<RepoDiscoveryResult> {
  const cwd = normalizePath(input.cwd);

  const currentResult = await resolveCurrentRepository(runner, cwd);
  if (currentResult !== null) return currentResult;

  const childDiscovery = await discoverChildRoots(runner, input, cwd);
  if (childDiscovery.kind === "blocked") return childDiscovery.result;

  return resolveChildDiscovery(cwd, childDiscovery.roots);
}
