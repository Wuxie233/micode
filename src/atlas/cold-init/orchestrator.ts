import { discoverProject, type ProjectMemoryReader } from "@/atlas/cold-init/discover";
import { buildQuestionBatch, type ColdInitQuestion } from "@/atlas/cold-init/questions";
import { createColdInitRunId } from "@/atlas/cold-init/run-id";
import { synthesizeVaultPlan } from "@/atlas/cold-init/synthesize";
import type { ColdInitOptions, ColdInitOutcome, VaultPlan } from "@/atlas/cold-init/types";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

const LOG_SCOPE = "atlas.cold-init";

interface QuestionResult {
  readonly answers: AnswerMap;
  readonly questionsAsked: number;
}

export type AnswerMap = Readonly<Record<string, string>>;

export interface OrchestratorDeps {
  readonly projectMemory: ProjectMemoryReader;
  readonly askQuestions: ((batch: readonly ColdInitQuestion[]) => Promise<AnswerMap | null>) | null;
  readonly writeVault: (input: {
    readonly projectRoot: string;
    readonly runId: string;
    readonly plan: VaultPlan;
    readonly answers: AnswerMap;
  }) => Promise<{ readonly nodesWritten: number; readonly stagingDir: string; readonly logPath: string }>;
}

export interface OrchestratorInput {
  readonly projectRoot: string;
  readonly options: ColdInitOptions;
}

const EMPTY_ANSWERS: AnswerMap = {};

const emptyQuestionResult = (): QuestionResult => ({ answers: EMPTY_ANSWERS, questionsAsked: 0 });

const shouldAskQuestions = (
  input: OrchestratorInput,
  deps: OrchestratorDeps,
  questions: readonly ColdInitQuestion[],
): boolean => input.options.askQuestions && deps.askQuestions !== null && questions.length > 0;

const collectAnswers = async (
  input: OrchestratorInput,
  deps: OrchestratorDeps,
  questions: readonly ColdInitQuestion[],
): Promise<QuestionResult> => {
  if (!shouldAskQuestions(input, deps, questions) || deps.askQuestions === null) {
    return emptyQuestionResult();
  }

  try {
    const answers = await deps.askQuestions(questions);
    if (answers === null) {
      return emptyQuestionResult();
    }

    return { answers, questionsAsked: questions.length };
  } catch (error) {
    log.warn(LOG_SCOPE, `askQuestions failed, continuing with defaults: ${extractErrorMessage(error)}`);
    return emptyQuestionResult();
  }
};

export async function runColdInit(input: OrchestratorInput, deps: OrchestratorDeps): Promise<ColdInitOutcome> {
  const runId = createColdInitRunId();
  log.info(LOG_SCOPE, `cold init starting (runId=${runId}, root=${input.projectRoot})`);

  const discovery = await discoverProject({ projectRoot: input.projectRoot, projectMemory: deps.projectMemory });
  const plan = synthesizeVaultPlan(discovery);
  const batch = buildQuestionBatch(discovery, plan);
  const { answers, questionsAsked } = await collectAnswers(input, deps, batch.questions);

  const written = await deps.writeVault({ projectRoot: input.projectRoot, runId, plan, answers });
  log.info(LOG_SCOPE, `cold init complete (nodesWritten=${written.nodesWritten})`);

  return {
    status: "ok",
    nodesWritten: written.nodesWritten,
    questionsAsked,
    stagingDir: written.stagingDir,
    logPath: written.logPath,
  };
}
