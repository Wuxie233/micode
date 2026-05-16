import {
  assertMaintenanceProjectIdentity,
  type ProjectMemoryIdentityContext,
  type ProjectMemoryIdentityResolution,
  type ProjectMemoryTarget,
  resolveProjectMemoryIdentity,
} from "@/project-memory/identity";
import { appendMaintenanceJournal } from "@/project-memory/maintenance/journal";
import type { MaintenanceRunInput, MaintenanceRunOutcome } from "@/project-memory/maintenance/types";
import { config } from "@/utils/config";

type MaintenanceWorker = (input: MaintenanceRunInput) => Promise<MaintenanceRunOutcome>;
type DeferredWork = () => void;

const DEFAULT_TRIGGER = "project-memory-maintenance-scheduler";
const SCHEDULER_ERROR_ACTION = "scheduler_error";

export interface ScheduleMaintenanceInput {
  readonly reason: MaintenanceRunInput["reason"];
  readonly dryRun?: boolean;
  readonly triggeredBy?: string;
  readonly sourcePointers?: readonly string[];
  readonly directory?: string;
  readonly explicitTarget?: ProjectMemoryTarget;
  readonly sessionTarget?: ProjectMemoryTarget;
  readonly lifecycleTarget?: ProjectMemoryTarget;
}

export interface ScheduleMaintenanceOutcome {
  readonly scheduled: boolean;
  readonly reason: string;
  readonly projectId?: string;
  readonly warnings: readonly string[];
  readonly workerOutcome?: MaintenanceRunOutcome;
}

export interface ScheduleMaintenanceDeps {
  readonly resolveIdentity?: (context: ProjectMemoryIdentityContext) => Promise<ProjectMemoryIdentityResolution>;
  readonly runWorker?: MaintenanceWorker;
  readonly appendJournal?: typeof appendMaintenanceJournal;
  readonly defer?: (work: DeferredWork) => void;
  readonly cwd?: () => string;
  readonly maintenanceEnabled?: () => boolean;
  readonly terminalTriggerEnabled?: () => boolean;
}

interface SchedulerDeps {
  readonly resolveIdentity: (context: ProjectMemoryIdentityContext) => Promise<ProjectMemoryIdentityResolution>;
  readonly runWorker: MaintenanceWorker;
  readonly appendJournal: typeof appendMaintenanceJournal;
  readonly defer: (work: DeferredWork) => void;
  readonly cwd: () => string;
  readonly maintenanceEnabled: () => boolean;
  readonly terminalTriggerEnabled: () => boolean;
}

function defaultCwd(): string {
  return process.cwd();
}

function defaultDefer(work: DeferredWork): void {
  setTimeout(work, 0);
}

async function defaultRunWorker(input: MaintenanceRunInput): Promise<MaintenanceRunOutcome> {
  const workerModule = (await import(`./${"worker"}`)) as {
    readonly runProjectMemoryMaintenance?: MaintenanceWorker;
    readonly executeProjectMemoryMaintenance?: MaintenanceWorker;
  };
  const worker = workerModule.runProjectMemoryMaintenance ?? workerModule.executeProjectMemoryMaintenance;
  if (!worker) throw new Error("Project memory maintenance worker is unavailable");
  return worker(input);
}

function warningForError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function blocked(reason: string, projectId?: string): ScheduleMaintenanceOutcome {
  return { scheduled: false, reason: `blocked: ${reason}`, projectId, warnings: [reason] };
}

function identityBlockReason(resolution: ProjectMemoryIdentityResolution, error: unknown): string {
  if (resolution.status === "ambiguous" || resolution.status === "blocked" || resolution.status === "degraded") {
    return resolution.reason ?? `project identity is ${resolution.status}`;
  }
  return warningForError(error);
}

function workerInput(input: ScheduleMaintenanceInput, projectId: string): MaintenanceRunInput {
  return {
    projectId,
    reason: input.reason,
    dryRun: input.dryRun === true,
    triggeredBy: input.triggeredBy ?? DEFAULT_TRIGGER,
    sourcePointers: input.sourcePointers ? [...input.sourcePointers] : undefined,
  };
}

function schedulerDeps(deps: ScheduleMaintenanceDeps): SchedulerDeps {
  return {
    resolveIdentity: deps.resolveIdentity ?? resolveProjectMemoryIdentity,
    runWorker: deps.runWorker ?? defaultRunWorker,
    appendJournal: deps.appendJournal ?? appendMaintenanceJournal,
    defer: deps.defer ?? defaultDefer,
    cwd: deps.cwd ?? defaultCwd,
    maintenanceEnabled: deps.maintenanceEnabled ?? (() => config.projectMemory.maintenanceEnabled),
    terminalTriggerEnabled:
      deps.terminalTriggerEnabled ?? (() => config.projectMemory.maintenanceTerminalTriggerEnabled),
  };
}

async function recordDetachedWorkerError(
  projectId: string,
  error: unknown,
  appendJournal: typeof appendMaintenanceJournal,
): Promise<void> {
  await appendJournal({
    projectId,
    action: SCHEDULER_ERROR_ACTION,
    details: warningForError(error),
    counts: { warnings: 1 },
  });
}

export function createProjectMemoryMaintenanceScheduler(deps: ScheduleMaintenanceDeps = {}) {
  const runtime = schedulerDeps(deps);

  return async function schedule(input: ScheduleMaintenanceInput): Promise<ScheduleMaintenanceOutcome> {
    if (!runtime.maintenanceEnabled()) return { scheduled: false, reason: "disabled", warnings: [] };
    if (input.reason === "terminal" && !runtime.terminalTriggerEnabled()) {
      return { scheduled: false, reason: "terminal-trigger-disabled", warnings: [] };
    }

    const resolution = await runtime.resolveIdentity({
      directory: input.directory ?? runtime.cwd(),
      explicitTarget: input.explicitTarget,
      sessionTarget: input.sessionTarget,
      lifecycleTarget: input.lifecycleTarget,
    });

    let projectId: string;
    try {
      projectId = assertMaintenanceProjectIdentity(resolution).projectId;
    } catch (error) {
      return blocked(identityBlockReason(resolution, error), resolution.identity?.projectId);
    }

    const runInput = workerInput(input, projectId);
    if (input.dryRun === true) {
      const workerOutcome = await runtime.runWorker(runInput);
      return {
        scheduled: false,
        reason: "dry-run-executed",
        projectId,
        warnings: workerOutcome.warnings,
        workerOutcome,
      };
    }

    runtime.defer(() => {
      void runtime.runWorker(runInput).catch((error: unknown) => {
        void recordDetachedWorkerError(projectId, error, runtime.appendJournal).catch(() => undefined);
      });
    });

    return { scheduled: true, reason: "scheduled", projectId, warnings: [] };
  };
}

export const scheduleProjectMemoryMaintenance = createProjectMemoryMaintenanceScheduler();
