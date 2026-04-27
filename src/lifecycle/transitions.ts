import type { ArtifactKind, LifecycleRecord, LifecycleState } from "./types";
import { LIFECYCLE_STATES } from "./types";

const SUCCESSORS: Readonly<Record<LifecycleState, readonly LifecycleState[]>> = {
  [LIFECYCLE_STATES.PROPOSED]: [LIFECYCLE_STATES.ISSUE_OPEN],
  [LIFECYCLE_STATES.ISSUE_OPEN]: [LIFECYCLE_STATES.BRANCH_READY],
  [LIFECYCLE_STATES.BRANCH_READY]: [LIFECYCLE_STATES.IN_DESIGN],
  [LIFECYCLE_STATES.IN_DESIGN]: [LIFECYCLE_STATES.IN_PLAN],
  [LIFECYCLE_STATES.IN_PLAN]: [LIFECYCLE_STATES.IN_PROGRESS],
  [LIFECYCLE_STATES.IN_PROGRESS]: [LIFECYCLE_STATES.TESTED],
  [LIFECYCLE_STATES.TESTED]: [LIFECYCLE_STATES.MERGING],
  [LIFECYCLE_STATES.MERGING]: [LIFECYCLE_STATES.CLOSED],
  [LIFECYCLE_STATES.CLOSED]: [LIFECYCLE_STATES.CLEANED],
  [LIFECYCLE_STATES.CLEANED]: [],
  [LIFECYCLE_STATES.ABORTED]: [],
};

export function recordArtifact(record: LifecycleRecord, kind: ArtifactKind, pointer: string): LifecycleRecord {
  const pointers = record.artifacts[kind] ?? [];
  const next = pointers.includes(pointer) ? [...pointers] : [...pointers, pointer];

  return {
    ...record,
    artifacts: {
      ...record.artifacts,
      [kind]: next,
    },
  };
}

export function transitionTo(record: LifecycleRecord, next: LifecycleState): LifecycleRecord {
  if (!isValidTransition(record.state, next)) {
    throw new Error(`Invalid lifecycle transition: ${record.state} -> ${next}`);
  }

  return {
    ...record,
    state: next,
    updatedAt: Date.now(),
  };
}

export function isValidTransition(current: LifecycleState, next: LifecycleState): boolean {
  if (current === next) return true;
  return SUCCESSORS[current].includes(next);
}

export function appendNote(record: LifecycleRecord, note: string): LifecycleRecord {
  return {
    ...record,
    notes: [...record.notes, note],
  };
}
