import { describe, expect, it } from "bun:test";

import { ISSUE_BODY_MARKERS } from "@/lifecycle/issue-body-markers";
import { postOnceSummaryComment, upsertPullRequest, writeReviewSummaryToPrBody } from "@/lifecycle/pr";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";

const OK_EXIT_CODE = 0;
const FAILURE_EXIT_CODE = 1;
const EMPTY_OUTPUT = "";
const CWD = "/cwd";
const BRANCH = "issue/21-x";
const BASE_BRANCH = "main";
const PR_NUMBER = 7;
const CREATED_PR_NUMBER = 8;
const EXISTING_PR_URL = "https://github.com/o/r/pull/7";
const CREATED_PR_URL = "https://github.com/o/r/pull/8";
const SUMMARY_SECTION = "## AI Review Summary";

interface Call {
  readonly bin: "git" | "gh";
  readonly args: readonly string[];
  readonly cwd?: string;
}

interface FakeRunner {
  readonly runner: LifecycleRunner;
  readonly calls: readonly Call[];
}

const ok = (stdout = EMPTY_OUTPUT): RunResult => ({
  stdout,
  stderr: EMPTY_OUTPUT,
  exitCode: OK_EXIT_CODE,
});

const fail = (stderr = "boom", stdout = EMPTY_OUTPUT): RunResult => ({
  stdout,
  stderr,
  exitCode: FAILURE_EXIT_CODE,
});

const fakeRunner = (gh: readonly RunResult[]): FakeRunner => {
  const calls: Call[] = [];
  let index = 0;
  const runner: LifecycleRunner = {
    git: async (args, options) => {
      calls.push({ bin: "git", args, cwd: options?.cwd });
      return ok();
    },
    gh: async (args, options) => {
      calls.push({ bin: "gh", args, cwd: options?.cwd });
      const completed = gh[index] ?? ok();
      index += 1;
      return completed;
    },
  };
  return { runner, calls };
};

describe("upsertPullRequest", () => {
  it("returns the existing PR when gh pr view succeeds", async () => {
    const view = ok(JSON.stringify({ number: PR_NUMBER, url: EXISTING_PR_URL, body: "old" }));
    const { runner, calls } = fakeRunner([view]);

    const outcome = await upsertPullRequest(runner, {
      cwd: CWD,
      branch: BRANCH,
      baseBranch: BASE_BRANCH,
    });

    expect(outcome.kind).toBe("reused");
    expect(outcome.prNumber).toBe(PR_NUMBER);
    expect(outcome.body).toBe("old");
    expect(calls[0]?.args).toEqual(["pr", "view", BRANCH, "--json", "number,url,body"]);
    expect(calls.some((call) => call.args[0] === "pr" && call.args[1] === "create")).toBe(false);
  });

  it("creates a PR when gh pr view fails", async () => {
    const view = fail("no pull requests found");
    const create = ok(`${CREATED_PR_URL}\n`);
    const reread = ok(JSON.stringify({ number: CREATED_PR_NUMBER, url: CREATED_PR_URL, body: "" }));
    const { runner, calls } = fakeRunner([view, create, reread]);

    const outcome = await upsertPullRequest(runner, {
      cwd: CWD,
      branch: BRANCH,
      baseBranch: BASE_BRANCH,
    });

    expect(outcome.kind).toBe("created");
    expect(outcome.prNumber).toBe(CREATED_PR_NUMBER);
    expect(outcome.url).toBe(CREATED_PR_URL);
    expect(calls[1]?.args).toEqual(["pr", "create", "--fill", "--base", BASE_BRANCH, "--head", BRANCH]);
  });

  it("returns failure when pr create fails", async () => {
    const { runner } = fakeRunner([fail(), fail("network")]);

    const outcome = await upsertPullRequest(runner, {
      cwd: CWD,
      branch: BRANCH,
      baseBranch: BASE_BRANCH,
    });

    expect(outcome.kind).toBe("failed");
    expect(outcome.note).toContain("gh_pr_create");
  });
});

describe("writeReviewSummaryToPrBody", () => {
  it("inserts the AI review block and updates PR body through gh api REST PATCH", async () => {
    const view = ok(JSON.stringify({ number: PR_NUMBER, url: "u", body: "Original." }));
    const { runner, calls } = fakeRunner([view, ok()]);

    const outcome = await writeReviewSummaryToPrBody(runner, {
      cwd: CWD,
      branch: BRANCH,
      section: `${SUMMARY_SECTION}\nVerdict: approved`,
    });

    expect(outcome.kind).toBe("updated");
    expect(calls[1]?.args.slice(0, 5)).toEqual([
      "api",
      "--method",
      "PATCH",
      "repos/{owner}/{repo}/pulls/7",
      "--raw-field",
    ]);
    expect(calls[1]?.args.at(-1)).toContain("body=");
    const bodyField = calls[1]?.args.at(-1) ?? EMPTY_OUTPUT;
    expect(bodyField).toContain("Original.");
    expect(bodyField).toContain(ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN);
    expect(bodyField).toContain("Verdict: approved");
    expect(bodyField).toContain(ISSUE_BODY_MARKERS.AI_REVIEW_END);
    expect(calls.some((call) => call.args.join(" ").includes("projectCards"))).toBe(false);
    expect(calls.some((call) => call.args[0] === "pr" && call.args[1] === "edit")).toBe(false);
  });

  it("updates the existing AI review block in place", async () => {
    const initial = [
      "Body.",
      "",
      ISSUE_BODY_MARKERS.AI_REVIEW_BEGIN,
      `${SUMMARY_SECTION}\nold`,
      ISSUE_BODY_MARKERS.AI_REVIEW_END,
      "",
    ].join("\n");
    const view = ok(JSON.stringify({ number: PR_NUMBER, url: "u", body: initial }));
    const { runner, calls } = fakeRunner([view, ok()]);

    await writeReviewSummaryToPrBody(runner, {
      cwd: CWD,
      branch: BRANCH,
      section: `${SUMMARY_SECTION}\nnew`,
    });

    const bodyField = calls[1]?.args.at(-1) ?? EMPTY_OUTPUT;
    expect(bodyField.match(/AI Review Summary/g)?.length ?? 0).toBe(1);
    expect(bodyField).toContain("new");
    expect(bodyField).not.toContain("old");
  });

  it("returns failed when REST PR body update fails without attempting merge-like recovery", async () => {
    const view = ok(JSON.stringify({ number: PR_NUMBER, url: "u", body: "" }));
    const { runner, calls } = fakeRunner([view, fail("permission", "stdout details")]);

    const outcome = await writeReviewSummaryToPrBody(runner, {
      cwd: CWD,
      branch: BRANCH,
      section: SUMMARY_SECTION,
    });

    expect(outcome.kind).toBe("failed");
    expect(outcome.note).toContain("pr_body_update_failed");
    expect(outcome.note).toContain("permission");
    expect(outcome.note).toContain("stdout details");
    expect(calls.some((call) => call.args[0] === "pr" && call.args[1] === "edit")).toBe(false);
    expect(calls.some((call) => call.args[0] === "pr" && call.args[1] === "merge")).toBe(false);
    expect(calls.some((call) => call.args[0] === "pr" && call.args[1] === "create")).toBe(false);
    expect(calls.some((call) => call.args.join(" ").includes("projectCards"))).toBe(false);
  });

  it("returns no_pr when gh pr view fails", async () => {
    const { runner } = fakeRunner([fail()]);

    const outcome = await writeReviewSummaryToPrBody(runner, {
      cwd: CWD,
      branch: BRANCH,
      section: SUMMARY_SECTION,
    });

    expect(outcome.kind).toBe("no_pr");
  });
});

describe("postOnceSummaryComment", () => {
  it("posts a single comment with the marker when the marker is absent", async () => {
    const { runner, calls } = fakeRunner([ok(JSON.stringify([{ body: "unrelated" }])), ok()]);

    const outcome = await postOnceSummaryComment(runner, {
      cwd: CWD,
      branch: BRANCH,
      section: SUMMARY_SECTION,
    });

    expect(outcome.kind).toBe("posted");
    const commentBody = calls[1]?.args[calls[1].args.length - 1] ?? EMPTY_OUTPUT;
    expect(commentBody).toContain(ISSUE_BODY_MARKERS.AI_REVIEW_COMMENT);
    expect(commentBody).toContain(SUMMARY_SECTION);
  });

  it("skips when an AI-review-marked comment already exists", async () => {
    const markerBody = `${ISSUE_BODY_MARKERS.AI_REVIEW_COMMENT}\nold`;
    const { runner, calls } = fakeRunner([ok(JSON.stringify([{ body: markerBody }]))]);

    const outcome = await postOnceSummaryComment(runner, {
      cwd: CWD,
      branch: BRANCH,
      section: SUMMARY_SECTION,
    });

    expect(outcome.kind).toBe("skipped");
    expect(calls.some((call) => call.args[0] === "pr" && call.args[1] === "comment")).toBe(false);
  });

  it("skips when a wrapped comments response contains the marker", async () => {
    const response = { comments: [{ body: `${ISSUE_BODY_MARKERS.AI_REVIEW_COMMENT}\nold` }] };
    const { runner } = fakeRunner([ok(JSON.stringify(response))]);

    const outcome = await postOnceSummaryComment(runner, {
      cwd: CWD,
      branch: BRANCH,
      section: SUMMARY_SECTION,
    });

    expect(outcome.kind).toBe("skipped");
  });

  it("returns failed when comment post fails", async () => {
    const { runner } = fakeRunner([ok("[]"), fail("rate-limit")]);

    const outcome = await postOnceSummaryComment(runner, {
      cwd: CWD,
      branch: BRANCH,
      section: SUMMARY_SECTION,
    });

    expect(outcome.kind).toBe("failed");
    expect(outcome.note).toContain("pr_comment_failed");
  });
});
