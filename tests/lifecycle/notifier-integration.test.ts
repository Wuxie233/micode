import { afterEach, beforeEach, describe, expect, it, spyOn } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLifecycleStore, LIFECYCLE_STATES } from "@/lifecycle";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import type { CompletionNotifier, NotifyInput } from "@/notifications";
import { NOTIFICATION_STATUSES } from "@/notifications";

const PREFIX = "micode-notify-";
const ORIGIN = "git@github.com:Wuxie233/micode.git";
const ISSUE_URL = "https://github.com/Wuxie233/micode/issues/1";
const SHA = "abc123";

const okRun = (stdout = "", exitCode = 0, stderr = ""): RunResult => ({ stdout, stderr, exitCode });

const createRunner = (overrides: Partial<{ repoView: string }> = {}): LifecycleRunner => ({
  git: async (args) => {
    if (args[0] === "remote" && args[1] === "get-url") return okRun(`${ORIGIN}\n`);
    if (args[0] === "symbolic-ref") return okRun("origin/main\n");
    if (args[0] === "rev-parse") return okRun(`${SHA}\n`);
    return okRun();
  },
  gh: async (args) => {
    if (args[0] === "repo" && args[1] === "view") {
      return okRun(
        overrides.repoView ??
          JSON.stringify({
            nameWithOwner: "Wuxie233/micode",
            isFork: true,
            parent: { nameWithOwner: "vtemian/micode", url: "https://example.com" },
            owner: { login: "Wuxie233" },
            viewerPermission: "ADMIN",
            hasIssuesEnabled: true,
          }),
      );
    }
    if (args[0] === "issue" && args[1] === "create") return okRun(`${ISSUE_URL}\n`);
    if (args[0] === "issue" && args[1] === "view") return okRun(JSON.stringify({ body: "" }));
    return okRun();
  },
});

const createRecordingNotifier = (): { notifier: CompletionNotifier; events: NotifyInput[] } => {
  const events: NotifyInput[] = [];
  return {
    events,
    notifier: { notify: async (event) => void events.push(event) },
  };
};

describe("lifecycle notifier integration", () => {
  let baseDir: string;
  let worktreesRoot: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), PREFIX));
    worktreesRoot = mkdtempSync(join(tmpdir(), `${PREFIX}wt-`));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    rmSync(worktreesRoot, { recursive: true, force: true });
  });

  it("emits completed exactly once after a successful finish", async () => {
    const { notifier, events } = createRecordingNotifier();
    const handle = createLifecycleStore({
      runner: createRunner(),
      worktreesRoot,
      cwd: worktreesRoot,
      baseDir,
      notifier,
    });
    const started = await handle.start({ summary: "demo", goals: [], constraints: [] });
    await handle.finish(started.issueNumber, { mergeStrategy: "local-merge", waitForChecks: false });

    const completed = events.filter((event) => event.status === NOTIFICATION_STATUSES.COMPLETED);
    expect(completed.length).toBe(1);
    expect(completed[0].issueNumber).toBe(started.issueNumber);
  });

  it("emits failed_stop when start is aborted", async () => {
    const upstream = JSON.stringify({
      nameWithOwner: "vtemian/micode",
      isFork: false,
      parent: null,
      owner: { login: "vtemian" },
      viewerPermission: "READ",
      hasIssuesEnabled: true,
    });
    const { notifier, events } = createRecordingNotifier();
    const handle = createLifecycleStore({
      runner: createRunner({ repoView: upstream }),
      worktreesRoot,
      cwd: worktreesRoot,
      baseDir,
      notifier,
    });
    const record = await handle.start({ summary: "demo", goals: [], constraints: [] });
    expect(record.state).toBe(LIFECYCLE_STATES.ABORTED);
    expect(events.some((event) => event.status === NOTIFICATION_STATUSES.FAILED_STOP)).toBe(true);
  });

  it("emits blocked when notifyBlocked is invoked", async () => {
    const { notifier, events } = createRecordingNotifier();
    const handle = createLifecycleStore({
      runner: createRunner(),
      worktreesRoot,
      cwd: worktreesRoot,
      baseDir,
      notifier,
    });
    const started = await handle.start({ summary: "demo", goals: [], constraints: [] });
    await handle.notifyBlocked(started.issueNumber, "needs decision");

    const blocked = events.filter((event) => event.status === NOTIFICATION_STATUSES.BLOCKED);
    expect(blocked.length).toBe(1);
    expect(blocked[0].summary).toBe("needs decision");
  });

  it("never throws when the notifier itself throws", async () => {
    const warnSpy = spyOn(console, "warn").mockImplementation(() => {});
    try {
      const handle = createLifecycleStore({
        runner: createRunner(),
        worktreesRoot,
        cwd: worktreesRoot,
        baseDir,
        notifier: {
          notify: async () => {
            throw new Error("boom");
          },
        },
      });
      const started = await handle.start({ summary: "demo", goals: [], constraints: [] });
      await expect(
        handle.finish(started.issueNumber, { mergeStrategy: "local-merge", waitForChecks: false }),
      ).resolves.toMatchObject({ merged: true });
      expect(warnSpy).toHaveBeenCalledWith("[lifecycle.notify] notify failed: boom");
    } finally {
      warnSpy.mockRestore();
    }
  });

  it("works without a notifier (backward compatible)", async () => {
    const handle = createLifecycleStore({
      runner: createRunner(),
      worktreesRoot,
      cwd: worktreesRoot,
      baseDir,
    });
    const started = await handle.start({ summary: "demo", goals: [], constraints: [] });
    await expect(
      handle.finish(started.issueNumber, { mergeStrategy: "local-merge", waitForChecks: false }),
    ).resolves.toMatchObject({ merged: true });
  });
});
