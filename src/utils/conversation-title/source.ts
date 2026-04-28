// src/utils/conversation-title/source.ts

export const TITLE_SOURCE = {
  LIFECYCLE_ISSUE: "lifecycle-issue",
  LIFECYCLE_FINISH: "lifecycle-finish",
  PLAN_PATH: "plan-path",
  DESIGN_PATH: "design-path",
  COMMIT_TITLE: "commit-title",
  USER_MESSAGE: "user-message",
} as const;

export type TitleSource = (typeof TITLE_SOURCE)[keyof typeof TITLE_SOURCE];

export const TITLE_SOURCE_CONFIDENCE = {
  [TITLE_SOURCE.LIFECYCLE_ISSUE]: 100,
  [TITLE_SOURCE.LIFECYCLE_FINISH]: 95,
  [TITLE_SOURCE.PLAN_PATH]: 70,
  [TITLE_SOURCE.DESIGN_PATH]: 65,
  [TITLE_SOURCE.COMMIT_TITLE]: 50,
  [TITLE_SOURCE.USER_MESSAGE]: 30,
} as const satisfies Record<TitleSource, number>;

const EMPTY = "";
const EDGE_START_PATTERN = /^[\p{P}\s]+/u;
const EDGE_END_PATTERN = /[\p{P}\s]+$/u;

const LOW_INFO_MESSAGES = [
  "重启了",
  "什么",
  "继续",
  "接着",
  "ok",
  "okay",
  "好了",
  "好的",
  "收到",
  "嗯",
  "行",
  "done",
  "这是符合预期吗",
  "这是符合预期吗?",
  "这符合预期吗",
  "what did we do so far",
  "what did we do so far?",
  "怎么样",
  "然后呢",
  "next",
  "继续做",
  "继续吧",
] as const;

const normalizeLowInformationMessage = (text: string): string =>
  text.toLowerCase().trim().replace(EDGE_START_PATTERN, EMPTY).replace(EDGE_END_PATTERN, EMPTY);

export const LOW_INFO_PATTERNS: ReadonlySet<string> = new Set(
  LOW_INFO_MESSAGES.map((message) => normalizeLowInformationMessage(message)),
);

export function isLowInformationMessage(text: string): boolean {
  const normalized = normalizeLowInformationMessage(text);
  if (normalized === EMPTY) return true;
  return LOW_INFO_PATTERNS.has(normalized);
}

export function compareConfidence(a: TitleSource, b: TitleSource): number {
  return TITLE_SOURCE_CONFIDENCE[a] - TITLE_SOURCE_CONFIDENCE[b];
}
