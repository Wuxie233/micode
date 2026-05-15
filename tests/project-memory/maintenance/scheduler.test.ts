import { describe, expect, it, mock } from "bun:test";
import type { ProjectMemoryIdentityResolution } from "@/project-memory/identity";
import {
  createProjectMemoryMaintenanceScheduler,
  type ScheduleMaintenanceDeps,
} from "@/project-memory/maintenance/scheduler";
import type { MaintenanceRunOutcome } from "@/project-memory/maintenance/types";

const PROJECT_ID = "project-scheduler";
const ORIGIN_IDENTITY = { projectId: PROJECT_ID, kind: "origin" as const, source: "github.com/wuxie233/micode" };
const RUN_OUTCOME: MaintenanceRunOutcome = {
  applied: 1,
  skipped: 2,
  blocked: 0,
  warnings: ["review skipped unsafe item"],
  journalPath: "/tmp/project-scheduler.jsonl",
};

function resolvedIdentity(): ProjectMemoryIdentityResolution {
  return { status: "resolved", source: "explicit", identity: ORIGIN_IDENTITY };
}

function createDeps(overrides: Partial<ScheduleMaintenanceDeps> = {}): ScheduleMaintenanceDeps {
  return {
    resolveIdentity: mock(async () => resolvedIdentity()),
    runWorker: mock(async () => RUN_OUTCOME),
    appendJournal: mock(async () => "/tmp/project-scheduler.jsonl"),
    defer: mock((work) => work()),
    cwd: () => "/repo/worktree",
    ...overrides,
  };
}

async function flushPromises(): Promise<void> {
  await Promise.resolve();
  await Promise.resolve();
}

describe("project-memory maintenance scheduler", () => {
  it("returns from a terminal schedule before the worker promise resolves", async () => {
    const deferred: Array<() => void> = [];
    let resolveWorker: (outcome: MaintenanceRunOutcome) => void = () => undefined;
    const workerPromise = new Promise<MaintenanceRunOutcome>((resolve) => {
      resolveWorker = resolve;
    });
    const deps = createDeps({
      defer: mock((work) => deferred.push(work)),
      runWorker: mock(async () => workerPromise),
    });
    const scheduler = createProjectMemoryMaintenanceScheduler(deps);

    const result = await scheduler({ reason: "terminal", triggeredBy: "terminal-hook" });

    expect(result).toEqual({ scheduled: true, reason: "scheduled", projectId: PROJECT_ID, warnings: [] });
    expect(deferred).toHaveLength(1);
    expect(deps.runWorker).not.toHaveBeenCalled();

    deferred[0]?.();
    await flushPromises();

    expect(deps.runWorker).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      reason: "terminal",
      dryRun: false,
      triggeredBy: "terminal-hook",
      sourcePointers: undefined,
    });

    resolveWorker(RUN_OUTCOME);
    await flushPromises();
  });

  it("captures detached worker rejection in the maintenance journal without rejecting schedule", async () => {
    const deferred: Array<() => void> = [];
    const deps = createDeps({
      defer: mock((work) => deferred.push(work)),
      runWorker: mock(async () => {
        throw new Error("worker exploded");
      }),
    });
    const scheduler = createProjectMemoryMaintenanceScheduler(deps);

    await expect(scheduler({ reason: "terminal", triggeredBy: "terminal-hook" })).resolves.toMatchObject({
      scheduled: true,
      reason: "scheduled",
    });

    deferred[0]?.();
    await flushPromises();

    expect(deps.appendJournal).toHaveBeenCalledWith(
      expect.objectContaining({
        projectId: PROJECT_ID,
        action: "scheduler_error",
        details: "worker exploded",
        counts: { warnings: 1 },
      }),
    );
  });

  it("blocks ambiguous and degraded identities before queueing maintenance", async () => {
    const ambiguousDeps = createDeps({
      resolveIdentity: mock(async () => ({
        status: "ambiguous" as const,
        source: "registry" as const,
        reason: "project identity is ambiguous",
        candidates: [{ projectId: "one" }, { projectId: "two" }],
      })),
    });
    const ambiguous = createProjectMemoryMaintenanceScheduler(ambiguousDeps);

    await expect(ambiguous({ reason: "terminal" })).resolves.toMatchObject({
      scheduled: false,
      reason: "blocked: project identity is ambiguous",
    });
    expect(ambiguousDeps.runWorker).not.toHaveBeenCalled();

    const degradedDeps = createDeps({
      resolveIdentity: mock(async () => ({
        status: "degraded" as const,
        source: "degraded" as const,
        reason: "project identity resolved from path only; origin not resolved",
        identity: { projectId: "path-only", kind: "path" as const, source: "/repo/worktree" },
      })),
    });
    const degraded = createProjectMemoryMaintenanceScheduler(degradedDeps);

    await expect(degraded({ reason: "scheduled" })).resolves.toMatchObject({
      scheduled: false,
      reason: "blocked: project identity resolved from path only; origin not resolved",
    });
    expect(degradedDeps.runWorker).not.toHaveBeenCalled();
  });

  it("executes dry-run maintenance immediately and returns the worker outcome", async () => {
    const deps = createDeps();
    const scheduler = createProjectMemoryMaintenanceScheduler(deps);

    const result = await scheduler({ reason: "manual", dryRun: true, triggeredBy: "manual-tool" });

    expect(result).toEqual({
      scheduled: false,
      reason: "dry-run-executed",
      projectId: PROJECT_ID,
      warnings: RUN_OUTCOME.warnings,
      workerOutcome: RUN_OUTCOME,
    });
    expect(deps.defer).not.toHaveBeenCalled();
    expect(deps.runWorker).toHaveBeenCalledWith({
      projectId: PROJECT_ID,
      reason: "manual",
      dryRun: true,
      triggeredBy: "manual-tool",
      sourcePointers: undefined,
    });
  });
});
