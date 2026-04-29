import { log as defaultLogger } from "@/utils/logger";
import type { LifecycleRunner, RunResult } from "./runner";

export const SOURCES = {
  OVERRIDE: "override",
  ORIGIN_HEAD: "origin-head",
  GITHUB: "github",
  LOCAL_FALLBACK: "local-fallback",
  LAST_RESORT: "last-resort",
} as const;

export type DefaultBranchSource = (typeof SOURCES)[keyof typeof SOURCES];

export interface DefaultBranchResult {
  readonly branch: string;
  readonly source: DefaultBranchSource;
}

export interface ResolveDefaultBranchInput {
  readonly cwd: string;
  readonly override?: string;
  readonly log?: Pick<typeof defaultLogger, "warn">;
}

const OK_EXIT_CODE = 0;
const ORIGIN_PREFIX = "origin/";
const LOG_MODULE = "lifecycle.branch";
const FALLBACK_CANDIDATES = ["main", "master"] as const;
const EMPTY_TEXT = "";
const JSON_OBJECT_PREFIX = "{";
const JSON_ARRAY_PREFIX = "[";
const LINE_FEED = "\n";
const CARRIAGE_RETURN = "\r";
const GIT_SYMBOLIC_REF_ARGS = ["symbolic-ref", "--short", "refs/remotes/origin/HEAD"] as const;
const GH_DEFAULT_BRANCH_ARGS = ["repo", "view", "--json", "defaultBranchRef", "-q", ".defaultBranchRef.name"] as const;
const GIT_REV_PARSE_PREFIX_ARGS = ["rev-parse", "--verify"] as const;
const WARNING_MESSAGE = "Unable to resolve default branch via origin-head, github, or local-fallback; using main";

const completed = (run: RunResult): boolean => run.exitCode === OK_EXIT_CODE;

const trim = (value: string): string => value.trim();

const looksLikeJson = (value: string): boolean => {
  return value.startsWith(JSON_OBJECT_PREFIX) || value.startsWith(JSON_ARRAY_PREFIX);
};

const isBranchOutput = (branch: string): boolean => {
  if (branch.length === 0) return false;
  if (looksLikeJson(branch)) return false;
  return !branch.includes(LINE_FEED) && !branch.includes(CARRIAGE_RETURN);
};

const stripOrigin = (branch: string): string => {
  if (!branch.startsWith(ORIGIN_PREFIX)) return branch;
  return branch.slice(ORIGIN_PREFIX.length);
};

const tryOriginHead = async (runner: LifecycleRunner, cwd: string): Promise<DefaultBranchResult | null> => {
  const run = await runner.git(GIT_SYMBOLIC_REF_ARGS, { cwd });
  const branch = stripOrigin(trim(run.stdout));
  if (!completed(run) || !isBranchOutput(branch)) return null;
  return { branch, source: SOURCES.ORIGIN_HEAD };
};

const tryGithub = async (runner: LifecycleRunner, cwd: string): Promise<DefaultBranchResult | null> => {
  const run = await runner.gh(GH_DEFAULT_BRANCH_ARGS, { cwd });
  const branch = trim(run.stdout);
  if (!completed(run) || !isBranchOutput(branch)) return null;
  return { branch, source: SOURCES.GITHUB };
};

const tryLocalFallback = async (runner: LifecycleRunner, cwd: string): Promise<DefaultBranchResult | null> => {
  for (const branch of FALLBACK_CANDIDATES) {
    const run = await runner.git([...GIT_REV_PARSE_PREFIX_ARGS, branch], { cwd });
    if (completed(run)) return { branch, source: SOURCES.LOCAL_FALLBACK };
  }
  return null;
};

export async function resolveDefaultBranch(
  runner: LifecycleRunner,
  input: ResolveDefaultBranchInput,
): Promise<DefaultBranchResult> {
  const override = trim(input.override ?? EMPTY_TEXT);
  if (override.length > 0) return { branch: override, source: SOURCES.OVERRIDE };

  const origin = await tryOriginHead(runner, input.cwd);
  if (origin) return origin;

  const github = await tryGithub(runner, input.cwd);
  if (github) return github;

  const local = await tryLocalFallback(runner, input.cwd);
  if (local) return local;

  const logger = input.log ?? defaultLogger;
  logger.warn(LOG_MODULE, WARNING_MESSAGE);
  return { branch: FALLBACK_CANDIDATES[0], source: SOURCES.LAST_RESORT };
}
