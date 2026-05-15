import { classifyMaintenanceSnapshot } from "@/project-memory/maintenance/classifier";
import { appendMaintenanceJournal } from "@/project-memory/maintenance/journal";
import { acquireMaintenanceLock } from "@/project-memory/maintenance/lock";
import type {
  MaintenanceActionKind,
  MaintenancePlan,
  MaintenancePlanItem,
  MaintenanceRunInput,
  MaintenanceRunOutcome,
} from "@/project-memory/maintenance/types";
import type { ProjectMemoryStore } from "@/project-memory/store";
import type { Status } from "@/project-memory/types";
import { config } from "@/utils/config";
import type { ProjectIdentity } from "@/utils/project-id";

export interface BuildMaintenancePlanInput {
  readonly store: ProjectMemoryStore;
  readonly identity: ProjectIdentity;
  readonly reason?: MaintenanceRunInput["reason"];
  readonly now?: number;
  readonly snapshotLimit?: number;
}

export interface MaintenanceRunOptions {
  readonly now?: number;
  readonly journalDir?: string;
  readonly snapshotLimit?: number;
}

export type MaintenanceRunInputWithDeps = MaintenanceRunInput &
  MaintenanceRunOptions & {
    readonly store: ProjectMemoryStore;
    readonly identity: ProjectIdentity;
  };

export interface MaintenanceRunOutcomeWithPlan extends MaintenanceRunOutcome {
  readonly plan: MaintenancePlan;
}

interface ApplyCounts extends Record<string, number> {
  applied: number;
  skipped: number;
  blocked: number;
}

const STATUS_BY_ACTION: Partial<Record<MaintenanceActionKind, Status>> = {
  archive: "archived",
  tombstone: "tombstoned",
  supersede: "superseded",
  deduplicate: "superseded",
  mark_stale: "stale",
};

function projectIdFor(identity: ProjectIdentity): string {
  return identity.projectId;
}

function snapshotLimit(inputLimit?: number): number {
  return inputLimit ?? config.projectMemory.maintenanceSnapshotLimit;
}

function emptyPlan(
  projectId: string,
  reason: MaintenanceRunInput["reason"],
  warnings?: readonly string[],
): MaintenancePlan {
  return {
    projectId,
    reason,
    items: [],
    warnings: warnings === undefined ? undefined : [...warnings],
  };
}

function warningOutcome(
  projectId: string,
  reason: MaintenanceRunInput["reason"],
  warning: string,
  journalPath: string,
): MaintenanceRunOutcomeWithPlan {
  return {
    applied: 0,
    skipped: 1,
    blocked: 0,
    warnings: [warning],
    journalPath,
    plan: emptyPlan(projectId, reason, [warning]),
  };
}

function failureOutcome(
  projectId: string,
  reason: MaintenanceRunInput["reason"],
  warning: string,
  journalPath: string,
): MaintenanceRunOutcomeWithPlan {
  return {
    applied: 0,
    skipped: 0,
    blocked: 1,
    warnings: [warning],
    journalPath,
    plan: emptyPlan(projectId, reason, [warning]),
  };
}

function errorMessage(error: unknown): string {
  if (error instanceof Error) return error.message;
  return String(error);
}

function isBlockingItem(item: MaintenancePlanItem): boolean {
  return item.action === "needs_review" || item.action === "skip" || !item.safeByDefault;
}

async function appendJournalForItem(
  projectId: string,
  item: MaintenancePlanItem,
  now: number,
  journalDir?: string,
): Promise<string> {
  return appendMaintenanceJournal(
    {
      projectId,
      action: item.action,
      at: now,
      entryIds: [item.entryId],
      reasons: [item.kind],
      details: item.reason,
    },
    { dir: journalDir },
  );
}

async function appendSummaryJournal(
  projectId: string,
  action: MaintenanceActionKind,
  counts: ApplyCounts & { readonly planned: number },
  now: number,
  journalDir?: string,
): Promise<string> {
  return appendMaintenanceJournal(
    {
      projectId,
      action,
      at: now,
      counts,
    },
    { dir: journalDir },
  );
}

async function appendFailureJournal(
  projectId: string,
  warning: string,
  now: number,
  journalDir?: string,
): Promise<string> {
  return appendMaintenanceJournal(
    {
      projectId,
      action: "needs_review",
      at: now,
      counts: { blocked: 1 },
      details: warning,
    },
    { dir: journalDir },
  );
}

async function applyPlanItem(
  store: ProjectMemoryStore,
  projectId: string,
  item: MaintenancePlanItem,
  now: number,
): Promise<"applied" | "skipped" | "blocked"> {
  if (isBlockingItem(item)) return item.action === "skip" ? "skipped" : "blocked";

  if (item.action === "hard_delete_secret") {
    await store.forgetEntry(projectId, item.entryId);
    return "applied";
  }

  const status = STATUS_BY_ACTION[item.action];
  if (!status) return "skipped";

  await store.updateEntryStatus(projectId, item.entryId, status, now);
  return "applied";
}

function increment(counts: ApplyCounts, result: "applied" | "skipped" | "blocked"): void {
  counts[result] += 1;
}

async function skippedLockOutcome(
  projectId: string,
  reason: MaintenanceRunInput["reason"],
  now: number,
  journalDir?: string,
): Promise<MaintenanceRunOutcomeWithPlan> {
  const warning = "project memory maintenance skipped: lock already held";
  const journalPath = await appendSummaryJournal(
    projectId,
    "skip",
    { planned: 0, applied: 0, skipped: 1, blocked: 0 },
    now,
    journalDir,
  );
  return warningOutcome(projectId, reason, warning, journalPath);
}

async function dryRunOutcome(
  projectId: string,
  plan: MaintenancePlan,
  now: number,
  journalDir?: string,
): Promise<MaintenanceRunOutcomeWithPlan> {
  const journalPath = await appendSummaryJournal(
    projectId,
    "skip",
    { planned: plan.items.length, applied: 0, skipped: plan.items.length, blocked: 0 },
    now,
    journalDir,
  );
  return { applied: 0, skipped: plan.items.length, blocked: 0, warnings: plan.warnings ?? [], journalPath, plan };
}

async function applyPlan(
  input: MaintenanceRunInputWithDeps,
  projectId: string,
  plan: MaintenancePlan,
  now: number,
): Promise<MaintenanceRunOutcomeWithPlan> {
  const counts: ApplyCounts = { applied: 0, skipped: 0, blocked: 0 };
  let journalPath = "";

  if (plan.items.length === 0) {
    journalPath = await appendSummaryJournal(projectId, "skip", { planned: 0, ...counts }, now, input.journalDir);
  }

  for (const item of plan.items) {
    const result = await applyPlanItem(input.store, projectId, item, now);
    increment(counts, result);
    journalPath = await appendJournalForItem(projectId, item, now, input.journalDir);
  }

  return { ...counts, warnings: plan.warnings ?? [], journalPath, plan };
}

async function runMaintenanceWithLock(
  input: MaintenanceRunInputWithDeps,
  projectId: string,
  reason: MaintenanceRunInput["reason"],
  now: number,
): Promise<MaintenanceRunOutcomeWithPlan> {
  const plan = await buildMaintenancePlan({
    store: input.store,
    identity: input.identity,
    reason,
    now,
    snapshotLimit: input.snapshotLimit,
  });

  if (input.dryRun) return dryRunOutcome(projectId, plan, now, input.journalDir);
  return applyPlan(input, projectId, plan, now);
}

export async function buildMaintenancePlan(input: BuildMaintenancePlanInput): Promise<MaintenancePlan> {
  const projectId = projectIdFor(input.identity);
  const limit = snapshotLimit(input.snapshotLimit);
  const [entries, sources] = await Promise.all([
    input.store.listEntries(projectId, { limit }),
    input.store.listSources(projectId, { limit }),
    input.store.listEntities(projectId, { limit }),
  ]);

  return classifyMaintenanceSnapshot({
    projectId,
    reason: input.reason ?? "scheduled",
    now: input.now,
    entries,
    sources,
  });
}

export async function runProjectMemoryMaintenance(
  input: MaintenanceRunInputWithDeps,
): Promise<MaintenanceRunOutcomeWithPlan> {
  const projectId = projectIdFor(input.identity);
  const reason = input.reason;
  const now = input.now ?? Date.now();
  const lock = await acquireMaintenanceLock(projectId, { ttlMs: config.projectMemory.maintenanceLockTtlMs });

  if (!lock) return skippedLockOutcome(projectId, reason, now, input.journalDir);

  try {
    return await runMaintenanceWithLock(input, projectId, reason, now);
  } catch (error) {
    const warning = `project memory maintenance failed: ${errorMessage(error)}`;
    const journalPath = await appendFailureJournal(projectId, warning, now, input.journalDir);
    return failureOutcome(projectId, reason, warning, journalPath);
  } finally {
    await lock.release();
  }
}
