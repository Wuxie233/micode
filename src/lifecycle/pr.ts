import * as v from "valibot";

import { ISSUE_BODY_MARKERS, replaceBetween } from "./issue-body-markers";
import type { LifecycleRunner, RunResult } from "./runner";

const OK_EXIT_CODE = 0;
const PR_URL_PATTERN = /https:\/\/github\.com\/\S+\/pull\/(\d+)/;
const DETAIL_SEPARATOR = ": ";
const OUTPUT_SEPARATOR = " ";
const PR_BODY_UPDATE_FAILED = "pr_body_update_failed";
const PR_COMMENT_FAILED = "pr_comment_failed";
const GH_PR_CREATE_FAILED = "gh_pr_create";
const PR_VIEW_FIELDS = "number,url,body";
const COMMENT_FIELDS = "comments";

const PR_VIEW = ["pr", "view"] as const;
const PR_CREATE = ["pr", "create"] as const;
const PR_EDIT = ["pr", "edit"] as const;
const PR_COMMENT = ["pr", "comment"] as const;
const FILL_FLAG = "--fill";
const BASE_FLAG = "--base";
const HEAD_FLAG = "--head";
const JSON_FLAG = "--json";
const BODY_FLAG = "--body";

const PrViewSchema = v.object({
  number: v.number(),
  url: v.string(),
  body: v.optional(v.nullable(v.string())),
});

const CommentSchema = v.object({
  body: v.optional(v.nullable(v.string())),
});

const CommentsSchema = v.array(CommentSchema);
const CommentsWrapperSchema = v.object({
  comments: v.optional(CommentsSchema),
});

interface PrIdentity {
  readonly prNumber: number;
  readonly url: string;
  readonly body: string;
}

export interface UpsertInput {
  readonly cwd: string;
  readonly branch: string;
  readonly baseBranch: string;
}

export type UpsertOutcome =
  | { readonly kind: "reused"; readonly prNumber: number; readonly url: string; readonly body: string }
  | { readonly kind: "created"; readonly prNumber: number; readonly url: string; readonly body: string }
  | { readonly kind: "failed"; readonly note: string };

export interface BodyInjectInput {
  readonly cwd: string;
  readonly branch: string;
  readonly section: string;
}

export type BodyInjectOutcome =
  | { readonly kind: "updated"; readonly prNumber: number }
  | { readonly kind: "no_pr" }
  | { readonly kind: "failed"; readonly note: string };

export interface CommentInput {
  readonly cwd: string;
  readonly branch: string;
  readonly section: string;
}

export type CommentOutcome =
  | { readonly kind: "posted" }
  | { readonly kind: "skipped" }
  | { readonly kind: "no_pr" }
  | { readonly kind: "failed"; readonly note: string };

const succeeded = (run: RunResult): boolean => run.exitCode === OK_EXIT_CODE;

const formatFailure = (label: string, run: RunResult): string => {
  const pieces = [run.stderr.trim(), run.stdout.trim()].filter((piece) => piece.length > 0);
  if (pieces.length > 0) return `${label}${DETAIL_SEPARATOR}${pieces.join(OUTPUT_SEPARATOR)}`;
  return `${label}${DETAIL_SEPARATOR}exit code ${run.exitCode}`;
};

const parseUrl = (stdout: string): PrIdentity | null => {
  const match = PR_URL_PATTERN.exec(stdout);
  if (!match) return null;
  const prNumber = Number.parseInt(match[1] ?? "", 10);
  if (!Number.isSafeInteger(prNumber) || prNumber <= 0) return null;
  return { prNumber, url: match[0], body: "" };
};

const parsePrView = (stdout: string): PrIdentity | null => {
  try {
    const raw: unknown = JSON.parse(stdout);
    const parsed = v.safeParse(PrViewSchema, raw);
    if (!parsed.success) return null;
    return { prNumber: parsed.output.number, url: parsed.output.url, body: parsed.output.body ?? "" };
  } catch {
    return parseUrl(stdout);
  }
};

const ghPrView = async (runner: LifecycleRunner, cwd: string, branch: string): Promise<PrIdentity | null> => {
  const run = await runner.gh([...PR_VIEW, branch, JSON_FLAG, PR_VIEW_FIELDS], { cwd });
  if (!succeeded(run)) return null;
  return parsePrView(run.stdout);
};

const hasCommentMarker = (comments: readonly v.InferOutput<typeof CommentSchema>[]): boolean =>
  comments.some((comment) => (comment.body ?? "").includes(ISSUE_BODY_MARKERS.AI_REVIEW_COMMENT));

const commentAlreadyPosted = (stdout: string): boolean => {
  try {
    const raw: unknown = JSON.parse(stdout);
    const parsed = Array.isArray(raw) ? v.safeParse(CommentsSchema, raw) : v.safeParse(CommentsWrapperSchema, raw);
    if (!parsed.success) return false;
    const comments = Array.isArray(parsed.output) ? parsed.output : (parsed.output.comments ?? []);
    return hasCommentMarker(comments);
  } catch {
    return false;
  }
};

export async function upsertPullRequest(runner: LifecycleRunner, input: UpsertInput): Promise<UpsertOutcome> {
  const existing = await ghPrView(runner, input.cwd, input.branch);
  if (existing) return { kind: "reused", ...existing };

  const created = await runner.gh([...PR_CREATE, FILL_FLAG, BASE_FLAG, input.baseBranch, HEAD_FLAG, input.branch], {
    cwd: input.cwd,
  });
  if (!succeeded(created)) return { kind: "failed", note: formatFailure(GH_PR_CREATE_FAILED, created) };

  const fresh = await ghPrView(runner, input.cwd, input.branch);
  if (fresh) return { kind: "created", ...fresh };
  return { kind: "failed", note: formatFailure(GH_PR_CREATE_FAILED, created) };
}

export async function writeReviewSummaryToPrBody(
  runner: LifecycleRunner,
  input: BodyInjectInput,
): Promise<BodyInjectOutcome> {
  const pr = await ghPrView(runner, input.cwd, input.branch);
  if (!pr) return { kind: "no_pr" };

  const nextBody = replaceBetween(
    pr.body,
    ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN,
    ISSUE_BODY_MARKERS.AI_REVIEW_END,
    input.section,
  );
  const edited = await runner.gh([...PR_EDIT, String(pr.prNumber), BODY_FLAG, nextBody], { cwd: input.cwd });
  if (!succeeded(edited)) return { kind: "failed", note: formatFailure(PR_BODY_UPDATE_FAILED, edited) };
  return { kind: "updated", prNumber: pr.prNumber };
}

export async function postOnceSummaryComment(runner: LifecycleRunner, input: CommentInput): Promise<CommentOutcome> {
  const list = await runner.gh([...PR_VIEW, input.branch, JSON_FLAG, COMMENT_FIELDS], { cwd: input.cwd });
  if (!succeeded(list)) return { kind: "no_pr" };
  if (commentAlreadyPosted(list.stdout)) return { kind: "skipped" };

  const body = `${ISSUE_BODY_MARKERS.AI_REVIEW_COMMENT}\n${input.section}`;
  const posted = await runner.gh([...PR_COMMENT, input.branch, BODY_FLAG, body], { cwd: input.cwd });
  if (!succeeded(posted)) return { kind: "failed", note: formatFailure(PR_COMMENT_FAILED, posted) };
  return { kind: "posted" };
}
