import { existsSync, rmSync } from "node:fs";

import { type OrchestratorDeps, runColdInit } from "@/atlas/cold-init/orchestrator";
import { writeVault } from "@/atlas/cold-init/vault-writer";
import { createAtlasPaths } from "@/atlas/paths";

export type InitMode = "fresh" | "reconcile" | "force-rebuild";

export interface InitInput {
  readonly projectRoot: string;
  readonly mode: InitMode;
  readonly projectName: string;
  readonly projectType: string;
  readonly gitTag?: string;
  readonly deps?: Partial<OrchestratorDeps>;
}

export type InitOutcome = "ok" | "rejected" | "dry-run";

export interface InitResult {
  readonly outcome: InitOutcome;
  readonly reason?: string;
  readonly report?: string;
  readonly gitTag?: string;
  readonly nodesWritten?: number;
  readonly questionsAsked?: number;
  readonly logPath?: string;
}

const QUESTION_TIMEOUT_MS = 0;
const EXISTING_ATLAS_REASON = "atlas/ already exists; pass --reconcile or --force-rebuild";
const RECONCILE_OWNER = "lifecycle-finish atlas-compiler owns reconcile";

const defaultDeps: OrchestratorDeps = {
  projectMemory: { list: () => Promise.resolve([]) },
  askQuestions: null,
  writeVault,
};

const createOrchestratorDeps = (deps: Partial<OrchestratorDeps> = {}): OrchestratorDeps => ({
  projectMemory: deps.projectMemory ?? defaultDeps.projectMemory,
  askQuestions: deps.askQuestions ?? defaultDeps.askQuestions,
  writeVault: deps.writeVault ?? defaultDeps.writeVault,
});

export async function runAtlasInit(input: InitInput): Promise<InitResult> {
  const paths = createAtlasPaths(input.projectRoot);
  const exists = existsSync(paths.root);
  if (exists && input.mode === "fresh") {
    return { outcome: "rejected", reason: EXISTING_ATLAS_REASON };
  }
  if (input.mode === "reconcile") {
    return { outcome: "dry-run", report: `would refresh ${paths.root}; ${RECONCILE_OWNER}` };
  }
  if (input.mode === "force-rebuild" && exists) {
    rmSync(paths.root, { recursive: true, force: true });
  }
  const deps = createOrchestratorDeps(input.deps);
  const outcome = await runColdInit(
    {
      projectRoot: input.projectRoot,
      options: { askQuestions: deps.askQuestions !== null, questionTimeoutMs: QUESTION_TIMEOUT_MS },
    },
    deps,
  );
  return {
    outcome: "ok",
    gitTag: input.gitTag,
    nodesWritten: outcome.nodesWritten,
    questionsAsked: outcome.questionsAsked,
    logPath: outcome.logPath ?? undefined,
  };
}
