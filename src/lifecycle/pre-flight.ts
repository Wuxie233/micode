import * as v from "valibot";

import type { LifecycleRunner, RunResult } from "./runner";

export const REPO_KIND = {
  FORK: "fork",
  OWN: "own",
  UPSTREAM: "upstream",
  UNKNOWN: "unknown",
} as const;

export type RepoKind = (typeof REPO_KIND)[keyof typeof REPO_KIND];

export interface PreFlightResult {
  readonly kind: RepoKind;
  readonly origin: string;
  readonly nameWithOwner: string;
  readonly viewerLogin: string | null;
  readonly issuesEnabled: boolean;
  readonly upstreamUrl: string | null;
}

const OK_EXIT_CODE = 0;
const EMPTY_OUTPUT = "";
const GITHUB_REPO_BASE_URL = "https://github.com";
const GIT_ORIGIN_ARGS = ["remote", "get-url", "origin"] as const;
const GH_FIELDS = "nameWithOwner,isFork,parent,owner,viewerPermission,hasIssuesEnabled";
const OWNER_PERMISSIONS: readonly string[] = ["ADMIN", "MAINTAIN", "WRITE"];

// Patterns for common GitHub remote URL forms.
// Group 1: owner, Group 2: repo (without .git suffix).
const HTTPS_ORIGIN_PATTERN = /^https:\/\/github\.com\/([^/]+)\/([^/.]+?)(?:\.git)?$/;
const SSH_ORIGIN_PATTERN = /^(?:ssh:\/\/)?git@github\.com[:/]([^/]+)\/([^/.]+?)(?:\.git)?$/;

interface RepoParent {
  readonly nameWithOwner: string;
  readonly url?: string;
}

interface RepoViewInput {
  readonly nameWithOwner: string;
  readonly isFork: boolean;
  readonly parent: unknown;
  readonly owner: {
    readonly login: string;
  };
  readonly viewerPermission: string;
  readonly hasIssuesEnabled: boolean;
}

interface RepoView {
  readonly nameWithOwner: string;
  readonly isFork: boolean;
  readonly parent: RepoParent | null;
  readonly owner: {
    readonly login: string;
  };
  readonly viewerPermission: string;
  readonly hasIssuesEnabled: boolean;
}

const LegacyRepoParentSchema = v.object({
  nameWithOwner: v.string(),
  url: v.optional(v.string()),
});

const GhRepoParentSchema = v.object({
  name: v.string(),
  owner: v.object({ login: v.string() }),
  url: v.optional(v.string()),
});

const RepoParentSchema = v.union([LegacyRepoParentSchema, GhRepoParentSchema]);

const RepoViewSchema: v.GenericSchema<unknown, RepoViewInput> = v.object({
  nameWithOwner: v.string(),
  isFork: v.boolean(),
  parent: v.nullable(v.unknown()),
  owner: v.object({ login: v.string() }),
  viewerPermission: v.string(),
  hasIssuesEnabled: v.boolean(),
});

type LegacyRepoParent = v.InferOutput<typeof LegacyRepoParentSchema>;
type ParsedRepoParent = v.InferOutput<typeof RepoParentSchema>;

const createUnknown = (origin = EMPTY_OUTPUT): PreFlightResult => ({
  kind: REPO_KIND.UNKNOWN,
  origin,
  nameWithOwner: EMPTY_OUTPUT,
  viewerLogin: null,
  issuesEnabled: false,
  upstreamUrl: null,
});

const completed = (run: RunResult): boolean => run.exitCode === OK_EXIT_CODE;

const createParent = (nameWithOwner: string, url?: string): RepoParent => {
  if (url === undefined) return { nameWithOwner };
  return { nameWithOwner, url };
};

const isLegacyParent = (parent: ParsedRepoParent): parent is LegacyRepoParent => "nameWithOwner" in parent;

const normalizeParent = (parent: unknown): RepoParent | null => {
  if (parent === null) return null;

  const parsed = v.safeParse(RepoParentSchema, parent);
  if (!parsed.success) return null;
  if (isLegacyParent(parsed.output)) return createParent(parsed.output.nameWithOwner, parsed.output.url);

  return createParent(`${parsed.output.owner.login}/${parsed.output.name}`, parsed.output.url);
};

const normalizeView = (view: RepoViewInput): RepoView => ({
  nameWithOwner: view.nameWithOwner,
  isFork: view.isFork,
  parent: normalizeParent(view.parent),
  owner: view.owner,
  viewerPermission: view.viewerPermission,
  hasIssuesEnabled: view.hasIssuesEnabled,
});

const parseRepoView = (stdout: string): RepoView | null => {
  try {
    const raw: unknown = JSON.parse(stdout);
    const parsed = v.safeParse(RepoViewSchema, raw);
    if (parsed.success) return normalizeView(parsed.output);
    return null;
  } catch {
    // Invalid JSON means pre-flight cannot trust ownership metadata.
    return null;
  }
};

const isOwned = (permission: string): boolean => OWNER_PERMISSIONS.includes(permission);

const classifyView = (view: RepoView): RepoKind => {
  if (view.isFork) return REPO_KIND.FORK;
  if (isOwned(view.viewerPermission)) return REPO_KIND.OWN;
  return REPO_KIND.UPSTREAM;
};

const getParentUrl = (parent: RepoParent | null): string | null => {
  if (!parent) return null;
  if (parent.url) return parent.url;
  return `${GITHUB_REPO_BASE_URL}/${parent.nameWithOwner}`;
};

const createResult = (origin: string, view: RepoView): PreFlightResult => {
  const kind = classifyView(view);

  return {
    kind,
    origin,
    nameWithOwner: view.nameWithOwner,
    viewerLogin: kind === REPO_KIND.UPSTREAM ? null : view.owner.login,
    issuesEnabled: view.hasIssuesEnabled,
    upstreamUrl: getParentUrl(view.parent),
  };
};

/**
 * Parses a GitHub remote URL into "owner/repo" form.
 * Returns null when the URL does not match any known GitHub remote format,
 * so callers can fall back to UNKNOWN rather than guessing the target.
 */
export const parseOriginTarget = (url: string): string | null => {
  const https = HTTPS_ORIGIN_PATTERN.exec(url);
  if (https) return `${https[1]}/${https[2]}`;

  const ssh = SSH_ORIGIN_PATTERN.exec(url);
  if (ssh) return `${ssh[1]}/${ssh[2]}`;

  return null;
};

const viewMatchesOrigin = (nameWithOwner: string, target: string): boolean =>
  nameWithOwner.toLowerCase() === target.toLowerCase();

export async function classifyRepo(runner: LifecycleRunner, cwd: string): Promise<PreFlightResult> {
  const remote = await runner.git(GIT_ORIGIN_ARGS, { cwd });
  if (!completed(remote)) return createUnknown();

  const origin = remote.stdout.trim();
  const target = parseOriginTarget(origin);
  // If we cannot parse the origin into owner/repo, we cannot safely target gh.
  if (!target) return createUnknown(origin);

  const inspected = await runner.gh(["repo", "view", target, "--json", GH_FIELDS], { cwd });
  if (!completed(inspected)) return createUnknown(origin);

  const view = parseRepoView(inspected.stdout);
  if (!view) return createUnknown(origin);

  // Reject silently if gh returned metadata for a different repo (e.g. inferred upstream).
  if (!viewMatchesOrigin(view.nameWithOwner, target)) return createUnknown(origin);

  return createResult(origin, view);
}
