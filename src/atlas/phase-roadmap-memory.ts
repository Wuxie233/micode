export interface PhaseItem {
  readonly title: string;
  readonly trigger: string;
}

export interface MemoryEntryShape {
  readonly type: "open_question";
  readonly status: "tentative";
  readonly title: string;
  readonly body: string;
}

export const ATLAS_PHASE_3_OPEN_QUESTIONS: readonly PhaseItem[] = [
  { title: "Independent lint and GC pass", trigger: "vault > 200 nodes OR _archive > 50 OR broken wikilinks > 10" },
  { title: "Project type profile system", trigger: "more than one project type using atlas" },
  { title: "agent2 failure escalation", trigger: "failure rate above threshold or repeated silent stop" },
  { title: "Cross-project schema migration tools", trigger: "schema version increment" },
  { title: "Independent git isolation for atlas", trigger: "atlas commits exceed signal-to-noise threshold" },
  {
    title: "madge or dependency-cruiser SVG cross-reference",
    trigger: "user wants compiler-grounded cross-check on Build layer",
  },
  { title: "Behavior layer round-trip verification", trigger: "behavior drift incident or repeated user disagreement" },
];

const PREFIX = "atlas phase 3:";

export function buildAtlasPhaseMemoryEntries(): readonly MemoryEntryShape[] {
  return ATLAS_PHASE_3_OPEN_QUESTIONS.map((item) => ({
    type: "open_question" as const,
    status: "tentative" as const,
    title: `${PREFIX} ${item.title}`,
    body: `Trigger: ${item.trigger}. Source: thoughts/shared/designs/2026-05-04-project-atlas-design.md (Phase Roadmap section).`,
  }));
}
