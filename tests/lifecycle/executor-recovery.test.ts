import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLifecycleStore, type ProgressEmitter } from "@/lifecycle";
import { createJournalStore } from "@/lifecycle/journal/store";
import { JOURNAL_EVENT_KINDS } from "@/lifecycle/journal/types";
import { createLeaseStore } from "@/lifecycle/lease/store";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import { ARTIFACT_KINDS, LIFECYCLE_STATES } from "@/lifecycle/types";

const ISSUE = 10;
const ORIGIN = "git@github.com:Wuxie233/micode.git";
const SHA = "abc123";
const BATCH_ID = "1";
const TASK_ID = "4.1";
const ATTEMPT = 2;
const COMMIT_MARKER = "<!-- micode:lc issue=10 batch=1 task=4.1 attempt=2 seq=1 -->";
const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });

interface RunnerCall {
  readonly args: readonly string[];
  readonly cwd?: string;
}

interface ProgressLog {
  readonly issueNumber: number;
  readonly kind: "status";
  readonly summary: string;
  readonly marker?: string;
}

const repoView = JSON.stringify({
  nameWithOwner: "Wuxie233/micode",
  isFork: true,
  parent: { nameWithOwner: "vtemian/micode", url: "https://github.com/vtemian/micode" },
  owner: { login: "Wuxie233" },
  viewerPermission: "ADMIN",
  hasIssuesEnabled: true,
});

const createRunner = (calls: RunnerCall[] = []): LifecycleRunner => ({
  async git(args) {
    calls.push({ args });
    if (args[0] === "remote" && args[1] === "get-url") return ok(`${ORIGIN}\n`);
    if (args[0] === "rev-parse" && args.includes("--abbrev-ref")) return ok(`issue/${ISSUE}-feature\n`);
    if (args[0] === "rev-parse" && args.includes("--show-toplevel")) return ok("/tmp/wt\n");
    if (args[0] === "rev-parse" && args[1] === "HEAD") return ok(`${SHA}\n`);
    return ok();
  },
  async gh(args) {
    if (args[0] === "repo" && args[1] === "view") return ok(repoView);
    if (args[0] === "issue" && args[1] === "view") return ok(JSON.stringify({ body: "" }));
    return ok();
  },
});

const seedRecord = async (baseDir: string): Promise<void> => {
  const recordPath = join(baseDir, `${ISSUE}.json`);
  await Bun.write(
    recordPath,
    JSON.stringify({
      issueNumber: ISSUE,
      issueUrl: `https://github.com/Wuxie233/micode/issues/${ISSUE}`,
      branch: `issue/${ISSUE}-feature`,
      worktree: "/tmp/wt",
      state: LIFECYCLE_STATES.IN_PROGRESS,
      artifacts: {
        [ARTIFACT_KINDS.DESIGN]: [],
        [ARTIFACT_KINDS.PLAN]: [],
        [ARTIFACT_KINDS.LEDGER]: [],
        [ARTIFACT_KINDS.COMMIT]: [],
        [ARTIFACT_KINDS.PR]: [],
        [ARTIFACT_KINDS.WORKTREE]: [],
      },
      notes: [],
      updatedAt: 0,
    }),
  );
};

describe("executor recovery integration", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "micode-exec-recovery-"));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("recordExecutorEvent appends to the journal with monotonic seq", async () => {
    const journal = createJournalStore({ baseDir });
    const lease = createLeaseStore({ baseDir });
    const handle = createLifecycleStore({
      runner: createRunner(),
      worktreesRoot: "/tmp",
      cwd: "/tmp/wt",
      baseDir,
      journal,
      lease,
    });
    await handle.recordExecutorEvent({
      issueNumber: ISSUE,
      kind: JOURNAL_EVENT_KINDS.BATCH_DISPATCHED,
      batchId: "1",
      attempt: 1,
      summary: "batch 1 dispatched",
    });
    const events = await journal.list(ISSUE);
    expect(events.map((event) => event.kind)).toEqual([JOURNAL_EVENT_KINDS.BATCH_DISPATCHED]);
    expect(events[0]?.seq).toBe(1);
  });

  it("decideRecovery returns clean_resume on a fresh lifecycle", async () => {
    const journal = createJournalStore({ baseDir });
    const lease = createLeaseStore({ baseDir });
    const handle = createLifecycleStore({
      runner: createRunner(),
      worktreesRoot: "/tmp",
      cwd: "/tmp/wt",
      baseDir,
      journal,
      lease,
    });
    await seedRecord(baseDir);
    const decision = await handle.decideRecovery(ISSUE, "session-a");
    expect(decision.kind).toBe("clean_resume");
  });

  it("propagates execution marker through commit message, journal, and progress", async () => {
    await seedRecord(baseDir);
    const journal = createJournalStore({ baseDir });
    const lease = createLeaseStore({ baseDir });
    const calls: RunnerCall[] = [];
    const logs: ProgressLog[] = [];
    const progress: ProgressEmitter = {
      log: async (input) => {
        logs.push(input);
      },
    };
    const handle = createLifecycleStore({
      runner: createRunner(calls),
      worktreesRoot: "/tmp",
      cwd: "/tmp/wt",
      baseDir,
      journal,
      lease,
      progress,
    });

    await handle.commit(ISSUE, {
      summary: "add marker coverage",
      scope: "lifecycle",
      push: false,
      batchId: BATCH_ID,
      taskId: TASK_ID,
      attempt: ATTEMPT,
    });

    const commitCall = calls.find((call) => call.args[0] === "commit");
    const events = await journal.list(ISSUE);
    const observed = events.find((event) => event.kind === JOURNAL_EVENT_KINDS.COMMIT_OBSERVED);

    expect(commitCall?.args.join("\n")).toContain(COMMIT_MARKER);
    expect(observed?.commitMarker).toBe(COMMIT_MARKER);
    expect(logs.at(-1)?.marker).toBe(COMMIT_MARKER);
  });
});
