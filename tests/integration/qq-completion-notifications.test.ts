import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { ARTIFACT_KINDS, createLifecycleStore, LIFECYCLE_STATES } from "@/lifecycle";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import {
  createCourierSink,
  createDedupeStore,
  createNotifier,
  createPolicy,
  NOTIFICATION_STATUSES,
  type NotificationTarget,
  type PolicyConfig,
} from "@/notifications";

const PREFIX = "micode-qq-notify-int-";
const WORKTREE_PREFIX = `${PREFIX}wt-`;
const OWNER = "Wuxie233";
const REPO = "micode";
const UPSTREAM_OWNER = "vtemian";
const REPO_NAME = `${OWNER}/${REPO}`;
const UPSTREAM_REPO_NAME = `${UPSTREAM_OWNER}/${REPO}`;
const ORIGIN = `git@github.com:${REPO_NAME}.git`;
const ISSUE_NUMBER = 1;
const ISSUE_URL = `https://github.com/${REPO_NAME}/issues/${ISSUE_NUMBER}`;
const SHA = "abc123def";
const DEFAULT_QQ_USER = "445714414";
const SUMMARY = "demo";
const LONG_SUMMARY_SEGMENTS = 80;
const BLOCKED_SUMMARY = `needs${" decision".repeat(LONG_SUMMARY_SEGMENTS)}\tnow`;
const PLAN_POINTER = "thoughts/shared/plans/x.md";
const COMMIT_SCOPE = "demo";
const COMMIT_SUMMARY = "wip";
const COURIER_WARNING = "[notifications] courier delivery failed: autoinfo offline";

interface DeliveryCall {
  readonly target: NotificationTarget;
  readonly message: string;
}

const okRun = (stdout = "", exitCode = 0, stderr = ""): RunResult => ({ stdout, stderr, exitCode });

const createRepoView = (): string =>
  JSON.stringify({
    nameWithOwner: REPO_NAME,
    isFork: true,
    parent: { nameWithOwner: UPSTREAM_REPO_NAME, url: `https://github.com/${UPSTREAM_REPO_NAME}` },
    owner: { login: OWNER },
    viewerPermission: "ADMIN",
    hasIssuesEnabled: true,
  });

const createUpstreamRepoView = (): string =>
  JSON.stringify({
    nameWithOwner: UPSTREAM_REPO_NAME,
    isFork: false,
    parent: null,
    owner: { login: UPSTREAM_OWNER },
    viewerPermission: "READ",
    hasIssuesEnabled: true,
  });

const baseConfig = {
  enabled: true,
  qqUserId: DEFAULT_QQ_USER,
  qqGroupId: null,
  maxSummaryChars: 200,
  dedupeTtlMs: 60_000,
  dedupeMaxEntries: 100,
} satisfies PolicyConfig;

const createRunner = (overrides: Partial<{ repoView: string }> = {}): LifecycleRunner => ({
  git: async (args) => {
    if (args[0] === "remote" && args[1] === "get-url") return okRun(`${ORIGIN}\n`);
    if (args[0] === "symbolic-ref") return okRun("origin/main\n");
    if (args[0] === "rev-parse") return okRun(`${SHA}\n`);
    return okRun();
  },
  gh: async (args) => {
    if (args[0] === "repo" && args[1] === "view") return okRun(overrides.repoView ?? createRepoView());
    if (args[0] === "issue" && args[1] === "create") return okRun(`${ISSUE_URL}\n`);
    if (args[0] === "issue" && args[1] === "view") return okRun(JSON.stringify({ body: "" }));
    return okRun();
  },
});

const createRecordingNotifier = (): {
  readonly calls: DeliveryCall[];
  readonly notifier: ReturnType<typeof createNotifier>;
} => {
  const calls: DeliveryCall[] = [];
  const sink = createCourierSink({
    invoke: async (target, message) => {
      calls.push({ target, message });
    },
  });
  const dedupe = createDedupeStore({ ttlMs: baseConfig.dedupeTtlMs, maxEntries: baseConfig.dedupeMaxEntries });
  const notifier = createNotifier({ config: baseConfig, sink, policy: createPolicy({ config: baseConfig, dedupe }) });
  return { calls, notifier };
};

const getStatus = (message: string): string => {
  if (message.includes(`[${NOTIFICATION_STATUSES.BLOCKED}]`)) return NOTIFICATION_STATUSES.BLOCKED;
  if (message.includes(`[${NOTIFICATION_STATUSES.COMPLETED}]`)) return NOTIFICATION_STATUSES.COMPLETED;
  if (message.includes(`[${NOTIFICATION_STATUSES.FAILED_STOP}]`)) return NOTIFICATION_STATUSES.FAILED_STOP;
  return "unknown";
};

const expectPrivateTarget = (target: NotificationTarget): void => {
  expect(target.kind).toBe("private");
  if (target.kind !== "private") throw new Error(`Expected private notification target, got ${target.kind}`);
  expect(target.userId).toBe(DEFAULT_QQ_USER);
};

describe("QQ completion notifications end-to-end", () => {
  let baseDir: string;
  let worktreesRoot: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), PREFIX));
    worktreesRoot = mkdtempSync(join(tmpdir(), WORKTREE_PREFIX));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    rmSync(worktreesRoot, { recursive: true, force: true });
  });

  it("delivers exactly one completed message via the courier path on successful finish", async () => {
    const { calls, notifier } = createRecordingNotifier();
    const handle = createLifecycleStore({
      runner: createRunner(),
      worktreesRoot,
      cwd: worktreesRoot,
      baseDir,
      notifier,
    });

    const started = await handle.start({ summary: SUMMARY, goals: [], constraints: [] });
    await handle.finish(started.issueNumber, { mergeStrategy: "local-merge", waitForChecks: false });

    expect(calls.length).toBe(1);
    expectPrivateTarget(calls[0].target);
    expect(calls[0].message).toContain(`[${NOTIFICATION_STATUSES.COMPLETED}]`);
    expect(calls[0].message).toContain("Return to OpenCode to review.");
  });

  it("suppresses repeated completed deliveries for the same issue", async () => {
    const { calls, notifier } = createRecordingNotifier();
    const handle = createLifecycleStore({
      runner: createRunner(),
      worktreesRoot,
      cwd: worktreesRoot,
      baseDir,
      notifier,
    });

    const started = await handle.start({ summary: SUMMARY, goals: [], constraints: [] });
    await handle.finish(started.issueNumber, { mergeStrategy: "local-merge", waitForChecks: false });
    await notifier.notify({
      status: NOTIFICATION_STATUSES.COMPLETED,
      issueNumber: started.issueNumber,
      title: started.branch,
      summary: "merged: (local merge)",
      reference: started.issueUrl,
    });

    expect(calls.length).toBe(1);
  });

  it("delivers blocked then completed for the same issue", async () => {
    const { calls, notifier } = createRecordingNotifier();
    const handle = createLifecycleStore({
      runner: createRunner(),
      worktreesRoot,
      cwd: worktreesRoot,
      baseDir,
      notifier,
    });

    const started = await handle.start({ summary: SUMMARY, goals: [], constraints: [] });
    await handle.notifyBlocked(started.issueNumber, BLOCKED_SUMMARY);
    await handle.finish(started.issueNumber, { mergeStrategy: "local-merge", waitForChecks: false });

    expect(calls.map((call) => getStatus(call.message))).toEqual([
      NOTIFICATION_STATUSES.BLOCKED,
      NOTIFICATION_STATUSES.COMPLETED,
    ]);
    expect(calls[0].message.length).toBeLessThan(BLOCKED_SUMMARY.length);
    expect(calls[0].message).toContain("...");
    expect(calls[0].message).not.toContain("\t");
  });

  it("delivers failed_stop when start aborts on upstream pre-flight", async () => {
    const { calls, notifier } = createRecordingNotifier();
    const handle = createLifecycleStore({
      runner: createRunner({ repoView: createUpstreamRepoView() }),
      worktreesRoot,
      cwd: worktreesRoot,
      baseDir,
      notifier,
    });

    const record = await handle.start({ summary: SUMMARY, goals: [], constraints: [] });

    expect(record.state).toBe(LIFECYCLE_STATES.ABORTED);
    expect(calls.some((call) => call.message.includes(`[${NOTIFICATION_STATUSES.FAILED_STOP}]`))).toBe(true);
  });

  it("never propagates courier failure into the lifecycle finish outcome", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const sink = createCourierSink({
        invoke: async () => {
          throw new Error("autoinfo offline");
        },
      });
      const dedupe = createDedupeStore({ ttlMs: baseConfig.dedupeTtlMs, maxEntries: baseConfig.dedupeMaxEntries });
      const notifier = createNotifier({
        config: baseConfig,
        sink,
        policy: createPolicy({ config: baseConfig, dedupe }),
      });
      const handle = createLifecycleStore({
        runner: createRunner(),
        worktreesRoot,
        cwd: worktreesRoot,
        baseDir,
        notifier,
      });

      const started = await handle.start({ summary: SUMMARY, goals: [], constraints: [] });
      const outcome = await handle.finish(started.issueNumber, { mergeStrategy: "local-merge", waitForChecks: false });

      expect(outcome.merged).toBe(true);
      expect(warnSpy).toHaveBeenCalledWith(COURIER_WARNING);
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("does not notify any intermediate phase", async () => {
    const { calls, notifier } = createRecordingNotifier();
    const handle = createLifecycleStore({
      runner: createRunner(),
      worktreesRoot,
      cwd: worktreesRoot,
      baseDir,
      notifier,
    });

    const started = await handle.start({ summary: SUMMARY, goals: [], constraints: [] });
    await handle.recordArtifact(started.issueNumber, ARTIFACT_KINDS.PLAN, PLAN_POINTER);
    await handle.commit(started.issueNumber, { summary: COMMIT_SUMMARY, scope: COMMIT_SCOPE, push: false });

    expect(calls.length).toBe(0);
  });
});
