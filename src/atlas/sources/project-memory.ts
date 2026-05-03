export interface ProjectMemoryEntry {
  readonly id: string;
  readonly type: string;
  readonly title: string;
  readonly body: string;
  readonly status: string;
}

export interface ProjectMemoryProjection {
  readonly pointer: string;
  readonly entry: ProjectMemoryEntry;
}

export interface ProjectMemorySources {
  readonly decisions: readonly ProjectMemoryProjection[];
  readonly risks: readonly ProjectMemoryProjection[];
  readonly openQuestions: readonly ProjectMemoryProjection[];
}

interface ProjectMemoryStore {
  readonly list: () => Promise<readonly ProjectMemoryEntry[]>;
}

const ENTRY_TYPES = {
  DECISION: "decision",
  RISK: "risk",
  OPEN_QUESTION: "open_question",
} as const;

const project = (entry: ProjectMemoryEntry): ProjectMemoryProjection => ({ pointer: `pm:${entry.id}`, entry });

export async function collectProjectMemorySources(store: ProjectMemoryStore): Promise<ProjectMemorySources> {
  const entries = await store.list();
  return {
    decisions: entries.filter((entry) => entry.type === ENTRY_TYPES.DECISION).map(project),
    risks: entries.filter((entry) => entry.type === ENTRY_TYPES.RISK).map(project),
    openQuestions: entries.filter((entry) => entry.type === ENTRY_TYPES.OPEN_QUESTION).map(project),
  };
}
