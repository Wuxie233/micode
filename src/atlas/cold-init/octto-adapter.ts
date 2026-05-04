import type { ColdInitQuestion } from "@/atlas/cold-init/questions";

export interface OcttoQuestionPayload {
  readonly type: "ask_text" | "pick_one" | "confirm";
  readonly config: {
    readonly question: string;
    readonly context?: string;
    readonly options?: ReadonlyArray<{ readonly id: string; readonly label: string }>;
    readonly allowCancel?: boolean;
  };
  readonly questionKey: string;
}

export interface OcttoQuestionAsker {
  readonly askQuestions: (questions: readonly ColdInitQuestion[]) => Promise<Readonly<Record<string, string>> | null>;
}

const GROUP_LABELS = {
  intent: "[Project intent] ",
  behavior: "[Behavior anchor] ",
  risk: "[Risk / open question] ",
} as const satisfies Record<ColdInitQuestion["group"], string>;

const groupHeader = (group: ColdInitQuestion["group"]): string => GROUP_LABELS[group];

export function toOcttoPayloads(questions: readonly ColdInitQuestion[]): readonly OcttoQuestionPayload[] {
  return questions.map((question) => ({
    type: question.type,
    config: {
      question: `${groupHeader(question.group)}${question.question}`,
      context: question.context,
      options: question.options,
      allowCancel: question.skippable,
    },
    questionKey: question.id,
  }));
}
