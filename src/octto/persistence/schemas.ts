import * as v from "valibot";
import type { Answer, BaseConfig, QuestionType } from "@/octto/session";
import { QUESTIONS, STATUSES } from "@/octto/session";

export const PERSISTED_QUESTION_STATUSES = [
  STATUSES.PENDING,
  STATUSES.ANSWERED,
  STATUSES.CANCELLED,
  STATUSES.TIMEOUT,
] as const;

export type PersistedQuestionStatus = (typeof PERSISTED_QUESTION_STATUSES)[number];

export interface PersistedQuestion {
  readonly id: string;
  readonly type: QuestionType;
  readonly status: PersistedQuestionStatus;
  readonly created_at: number;
  readonly answered_at: number | null;
  readonly config: BaseConfig;
  readonly response: Answer | null;
}

export interface PersistedSession {
  readonly session_id: string;
  readonly title: string | null;
  readonly url: string;
  readonly owner_session_id: string;
  readonly created_at: number;
  readonly updated_at: number;
  readonly questions: readonly PersistedQuestion[];
  readonly auto_resume_owner_session_id: string | null;
}

const PERSISTED_QUESTION_TYPES = [
  QUESTIONS.PICK_ONE,
  QUESTIONS.PICK_MANY,
  QUESTIONS.CONFIRM,
  QUESTIONS.RANK,
  QUESTIONS.RATE,
  QUESTIONS.ASK_TEXT,
  QUESTIONS.ASK_IMAGE,
  QUESTIONS.ASK_FILE,
  QUESTIONS.ASK_CODE,
  QUESTIONS.SHOW_DIFF,
  QUESTIONS.SHOW_PLAN,
  QUESTIONS.SHOW_OPTIONS,
  QUESTIONS.REVIEW_SECTION,
  QUESTIONS.THUMBS,
  QUESTIONS.EMOJI_REACT,
  QUESTIONS.SLIDER,
] as const satisfies readonly QuestionType[];

const BaseConfigSchema = v.unknown() as v.GenericSchema<unknown, BaseConfig>;
const AnswerSchema = v.unknown() as v.GenericSchema<unknown, Answer>;

export const PersistedQuestionSchema: v.GenericSchema<unknown, PersistedQuestion> = v.object({
  id: v.string(),
  type: v.picklist(PERSISTED_QUESTION_TYPES),
  status: v.picklist(PERSISTED_QUESTION_STATUSES),
  created_at: v.number(),
  answered_at: v.nullable(v.number()),
  config: BaseConfigSchema,
  response: v.nullable(AnswerSchema),
});

export const PersistedSessionSchema: v.GenericSchema<unknown, PersistedSession> = v.object({
  session_id: v.string(),
  title: v.nullable(v.string()),
  url: v.string(),
  owner_session_id: v.string(),
  created_at: v.number(),
  updated_at: v.number(),
  questions: v.array(PersistedQuestionSchema),
  auto_resume_owner_session_id: v.nullable(v.string()),
});

export type PersistedSessionParseResult =
  | { readonly ok: true; readonly session: PersistedSession }
  | { readonly ok: false; readonly issues: readonly v.InferIssue<typeof PersistedSessionSchema>[] };

export function parsePersistedSession(input: unknown): PersistedSessionParseResult {
  const parsed = v.safeParse(PersistedSessionSchema, input);
  if (!parsed.success) {
    return { ok: false, issues: parsed.issues };
  }

  return { ok: true, session: parsed.output };
}
