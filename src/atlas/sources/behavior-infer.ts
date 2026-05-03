import type { LifecycleSource } from "./lifecycle";

const USER_PERSPECTIVE_HEADING = /^##\s+User Perspective\s*$/m;
const NEXT_HEADING = /^##\s+/m;

interface InferInput {
  readonly lifecycle: readonly LifecycleSource[];
  readonly designContents: Readonly<Record<string, string>>;
}

export interface BehaviorDraft {
  readonly id: string;
  readonly title: string;
  readonly userPerspective: string;
  readonly sources: readonly string[];
}

const extractUserPerspective = (raw: string): string | null => {
  const match = USER_PERSPECTIVE_HEADING.exec(raw);
  if (match === null) return null;
  const start = match.index + match[0].length;
  const rest = raw.slice(start);
  const next = NEXT_HEADING.exec(rest);
  return (next === null ? rest : rest.slice(0, next.index)).trim();
};

const createBehaviorDraft = (
  lifecycle: LifecycleSource,
  designPointer: string,
  content: string,
): BehaviorDraft | null => {
  const userPerspective = extractUserPerspective(content);
  if (userPerspective === null || userPerspective.length === 0) return null;
  return {
    id: `behavior/lifecycle-${lifecycle.issueNumber}`,
    title: `Behavior from lifecycle ${lifecycle.issueNumber}`,
    userPerspective,
    sources: [lifecycle.pointer, `thoughts:${designPointer.replace(/^thoughts\//, "")}`],
  };
};

const inferLifecycleDrafts = (
  lifecycle: LifecycleSource,
  designContents: Readonly<Record<string, string>>,
): readonly BehaviorDraft[] => {
  if (lifecycle.state !== "terminal") return [];
  const drafts: BehaviorDraft[] = [];
  for (const designPointer of lifecycle.designPointers) {
    const content = designContents[designPointer];
    if (content === undefined) continue;
    const draft = createBehaviorDraft(lifecycle, designPointer, content);
    if (draft !== null) drafts.push(draft);
  }
  return drafts;
};

export function inferBehaviorDrafts(input: InferInput): readonly BehaviorDraft[] {
  const drafts: BehaviorDraft[] = [];
  for (const lifecycle of input.lifecycle) {
    drafts.push(...inferLifecycleDrafts(lifecycle, input.designContents));
  }
  return drafts;
}
