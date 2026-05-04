import { COLD_INIT_QUESTION_GROUP_MAX } from "@/atlas/cold-init/config";
import type { ColdInitDiscovery, VaultPlan } from "@/atlas/cold-init/types";

export const COLD_INIT_QUESTION_GROUPS = {
  INTENT: "intent",
  BEHAVIOR: "behavior",
  RISK: "risk",
} as const;

export type ColdInitQuestionGroup = (typeof COLD_INIT_QUESTION_GROUPS)[keyof typeof COLD_INIT_QUESTION_GROUPS];
export type ColdInitQuestionType = "ask_text" | "pick_one" | "confirm";

export interface ColdInitQuestionOption {
  readonly id: string;
  readonly label: string;
}

export interface ColdInitQuestion {
  readonly id: string;
  readonly group: ColdInitQuestionGroup;
  readonly type: ColdInitQuestionType;
  readonly question: string;
  readonly context?: string;
  readonly options?: readonly ColdInitQuestionOption[];
  readonly skippable: boolean;
  readonly defaultAnswer: string | null;
}

export interface QuestionBatch {
  readonly questions: readonly ColdInitQuestion[];
  readonly truncated: boolean;
}

interface LimitedQuestions {
  readonly questions: readonly ColdInitQuestion[];
  readonly truncated: boolean;
}

const DEPLOYMENT_OPTIONS: readonly ColdInitQuestionOption[] = [
  { id: "lib", label: "library or SDK" },
  { id: "cli", label: "CLI tool" },
  { id: "service", label: "long-running service" },
  { id: "plugin", label: "plugin/extension to another runtime" },
  { id: "other", label: "other / mixed" },
];

const DEFAULT_DEPLOYMENT_SHAPE = "other";

const contextFromDiscovery = (discovery: ColdInitDiscovery): string | undefined => {
  return discovery.readmeSummary ?? discovery.architectureSummary ?? undefined;
};

const intentQuestions = (discovery: ColdInitDiscovery): readonly ColdInitQuestion[] => [
  {
    id: "intent.pitch",
    group: COLD_INIT_QUESTION_GROUPS.INTENT,
    type: "ask_text",
    question: `In one sentence, what is ${discovery.projectName} for?`,
    context: contextFromDiscovery(discovery),
    skippable: true,
    defaultAnswer: null,
  },
  {
    id: "intent.user",
    group: COLD_INIT_QUESTION_GROUPS.INTENT,
    type: "ask_text",
    question: "Who is the primary user, human role, or other agent?",
    skippable: true,
    defaultAnswer: null,
  },
  {
    id: "intent.shape",
    group: COLD_INIT_QUESTION_GROUPS.INTENT,
    type: "pick_one",
    question: "Which deployment shape is closest?",
    options: DEPLOYMENT_OPTIONS,
    skippable: true,
    defaultAnswer: DEFAULT_DEPLOYMENT_SHAPE,
  },
];

const behaviorQuestions = (plan: VaultPlan): readonly ColdInitQuestion[] => {
  return plan.behaviorNodes
    .filter((node) => node.inferred)
    .map<ColdInitQuestion>((node) => ({
      id: `behavior.${node.id}`,
      group: COLD_INIT_QUESTION_GROUPS.BEHAVIOR,
      type: "ask_text",
      question: `What user-visible behavior does "${node.title}" represent? Skip to keep the inferred draft.`,
      context: node.summary,
      skippable: true,
      defaultAnswer: null,
    }));
};

const riskQuestions = (discovery: ColdInitDiscovery): readonly ColdInitQuestion[] => {
  return discovery.projectMemoryOpenQuestions.map<ColdInitQuestion>((entry) => ({
    id: `risk.${entry.id}`,
    group: COLD_INIT_QUESTION_GROUPS.RISK,
    type: "ask_text",
    question:
      `Open question from project memory: "${entry.title}". ` +
      "Anything to record before atlas-init writes the risk page?",
    context: entry.body,
    skippable: true,
    defaultAnswer: null,
  }));
};

const limitQuestionGroup = (questions: readonly ColdInitQuestion[]): LimitedQuestions => {
  if (questions.length <= COLD_INIT_QUESTION_GROUP_MAX) {
    return { questions, truncated: false };
  }
  return { questions: questions.slice(0, COLD_INIT_QUESTION_GROUP_MAX), truncated: true };
};

export function buildQuestionBatch(discovery: ColdInitDiscovery, plan: VaultPlan): QuestionBatch {
  const intent = intentQuestions(discovery);
  const behavior = limitQuestionGroup(behaviorQuestions(plan));
  const risk = limitQuestionGroup(riskQuestions(discovery));
  return {
    questions: [...intent, ...behavior.questions, ...risk.questions],
    truncated: behavior.truncated || risk.truncated,
  };
}
