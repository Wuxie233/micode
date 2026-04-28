import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLifecycleStore } from "@/lifecycle";
import { createJournalStore } from "@/lifecycle/journal/store";
import { JOURNAL_EVENT_KINDS } from "@/lifecycle/journal/types";
import { createLeaseStore } from "@/lifecycle/lease/store";
import { RECOVERY_DECISION_KINDS } from "@/lifecycle/recovery/types";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import { ARTIFACT_KINDS, LIFECYCLE_STATES } from "@/lifecycle/types";
import { config } from "@/utils/config";

const ISSUE = 10;
const OWNER = "session-current";
const OTHER_OWNER = "session-other";
const HOST = "host-x";
const ORIGIN = "git@github.com:Wuxie233/micode.git";
const WORKTREE = "/tmp/wt";
const BRANCH = `issue/${ISSUE}-feature`;
const LEASE_TTL_MS = 60_000;
const EXPIRED_HEARTBEAT_AT = 0;
const EXPIRED_TTL_MS = 1;
const COMMIT_MARKER = "<!-- micode:lc issue=10 batch=1 attempt=1 seq=2 -->";

const ok = (stdout = ""): RunResult => ({ stdout, stderr: "", exitCode: 0 });

interface RunnerFlags {
  readonly branch?: string;
  readonly worktree?: string;
  readonly origin?: string;
  readonly commitMarker?: string;
}

const createRunner = (flags: RunnerFlags = {}): LifecycleRunner => ({
  async git(args) {
    if (args[0] === "rev-parse" && args.includes("--abbrev-ref")) return ok(`${flags.branch ?? BRANCH}\n`);
    if (args[0] === "rev-parse" && args.includes("--show-toplevel")) return ok(`${flags.worktree ?? WORKTREE}\n`);
    if (args[0] === "remote" && args[1] === "get-url") return ok(`${flags.origin ?? ORIGIN}\n`);
    if (args[0] === "log") return ok(flags.commitMarker ? `${flags.commitMarker}\n` : "");
    return ok();
  },
  async gh() {
    return ok();
  },
});

const seedRecord = (baseDir: string): void => {
  const record = {
    issueNumber: ISSUE,
    issueUrl: `https://github.com/Wuxie233/micode/issues/${ISSUE}`,
    branch: BRANCH,
    worktree: WORKTREE,
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
  };
  writeFileSync(join(baseDir, `${ISSUE}.json`), JSON.stringify(record));
};

const seedExpiredLease = (baseDir: string): void => {
  const lease = {
    issueNumber: ISSUE,
    owner: OTHER_OWNER,
    host: HOST,
    branch: BRANCH,
    worktree: WORKTREE,
    acquiredAt: EXPIRED_HEARTBEAT_AT,
    heartbeatAt: EXPIRED_HEARTBEAT_AT,
    ttlMs: EXPIRED_TTL_MS,
  };
  writeFileSync(join(baseDir, `${ISSUE}${config.lifecycle.leaseSuffix}`), JSON.stringify(lease));
};

const buildHandle = (baseDir: string, flags: RunnerFlags = {}) => {
  const journal = createJournalStore({ baseDir });
  const lease = createLeaseStore({ baseDir });
  const handle = createLifecycleStore({
    runner: createRunner(flags),
    worktreesRoot: "/tmp",
    cwd: WORKTREE,
    baseDir,
    journal,
    lease,
  });
  return { handle, journal, lease };
};

describe("recovery integration scenarios", () => {
  let baseDir: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), "micode-recovery-int-"));
    seedRecord(baseDir);
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
  });

  it("returns partial_resume when batch was dispatched but never completed and no commit was observed", async () => {
    const { handle } = buildHandle(baseDir);
    await handle.recordExecutorEvent({
      issueNumber: ISSUE,
      kind: JOURNAL_EVENT_KINDS.BATCH_DISPATCHED,
      batchId: "1",
      attempt: 1,
      summary: "batch 1 dispatched",
    });

    const decision = await handle.decideRecovery(ISSUE, OWNER);

    expect(decision.kind).toBe(RECOVERY_DECISION_KINDS.PARTIAL_RESUME);
    if (decision.kind === RECOVERY_DECISION_KINDS.PARTIAL_RESUME) {
      expect(decision.pendingBatchId).toBe("1");
    }
  });

  it("returns reconciled_resume when a commit marker closes a dispatched batch without commit_observed", async () => {
    const { handle, journal } = buildHandle(baseDir, { commitMarker: COMMIT_MARKER });
    await handle.recordExecutorEvent({
      issueNumber: ISSUE,
      kind: JOURNAL_EVENT_KINDS.BATCH_DISPATCHED,
      batchId: "1",
      attempt: 1,
      summary: "batch 1 dispatched",
    });
    expect((await journal.list(ISSUE)).map((event) => event.kind)).toEqual([JOURNAL_EVENT_KINDS.BATCH_DISPATCHED]);

    const decision = await handle.decideRecovery(ISSUE, OWNER);

    expect(decision.kind).toBe(RECOVERY_DECISION_KINDS.RECONCILED_RESUME);
    if (decision.kind === RECOVERY_DECISION_KINDS.RECONCILED_RESUME) {
      expect(decision.backfilledBatches).toEqual(["1"]);
    }
  });

  it("blocks on branch mismatch", async () => {
    const { handle } = buildHandle(baseDir, { branch: "main" });

    const decision = await handle.decideRecovery(ISSUE, OWNER);

    expect(decision).toMatchObject({ kind: RECOVERY_DECISION_KINDS.BLOCKED, reason: "branch_mismatch" });
  });

  it("blocks when an active lease is held by another owner", async () => {
    const { handle, lease } = buildHandle(baseDir);
    await lease.acquire({
      issueNumber: ISSUE,
      owner: OTHER_OWNER,
      host: HOST,
      branch: BRANCH,
      worktree: WORKTREE,
      ttlMs: LEASE_TTL_MS,
    });

    const decision = await handle.decideRecovery(ISSUE, OWNER);

    expect(decision).toMatchObject({ kind: RECOVERY_DECISION_KINDS.BLOCKED, reason: "lease_active" });
  });

  it("returns clean_resume when no journal exists and another owner's lease is expired", async () => {
    const { handle } = buildHandle(baseDir);
    seedExpiredLease(baseDir);

    const decision = await handle.decideRecovery(ISSUE, OWNER);

    expect(decision.kind).toBe(RECOVERY_DECISION_KINDS.CLEAN_RESUME);
  });
});
