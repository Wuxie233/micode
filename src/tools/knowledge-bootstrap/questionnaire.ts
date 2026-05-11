// Centralised question keys for the knowledge bootstrap flow.
// The orchestrator agent collects these once at entry and pre-seeds them into
// the atlas-initializer prompt; atlas-initializer therefore does not need to
// re-ask intent.* questions when invoked by the orchestrator.
//
// The actual question wording lives in src/atlas/cold-init/questions.ts; this
// module is the contract surface the orchestrator agent prompt refers to.

export const BOOTSTRAP_QUESTION_KEYS = ["intent.pitch", "intent.user", "intent.shape"] as const;

export type BootstrapQuestionKey = (typeof BOOTSTRAP_QUESTION_KEYS)[number];

export type BootstrapAnswers = Readonly<Record<BootstrapQuestionKey, string>>;

// Defaults applied when the user skips octto or octto is unavailable. These
// keep atlas-initializer unblocked while still producing a usable vault draft.
export const DEFAULT_BOOTSTRAP_ANSWERS: BootstrapAnswers = {
  "intent.pitch": "Project purpose not yet specified; inferred from code.",
  "intent.user": "Primary user not yet specified; inferred from code.",
  "intent.shape": "other",
};

const PROMPT_HEADER = "<bootstrap-questionnaire>";
const PROMPT_FOOTER = "</bootstrap-questionnaire>";

// buildBootstrapQuestionPrompt returns the canonical prompt fragment that the
// orchestrator agent embeds verbatim. It instructs the agent on how to collect
// answers via octto and what to do when octto is unavailable.
export function buildBootstrapQuestionPrompt(): string {
  return [
    PROMPT_HEADER,
    "When the user invokes /all-init (on an empty project) or /all-rebuild, collect the",
    "following three atlas cold-init intent answers up front in ONE octto session, then",
    "pre-seed them into the atlas-initializer spawn prompt so atlas-initializer does NOT",
    "re-ask them. Question ids and meaning:",
    "- intent.pitch: one sentence describing what this project is for",
    "- intent.user: who is the primary user, human role, or other agent",
    "- intent.shape: deployment shape (lib | cli | service | plugin | other)",
    "",
    "Fallback: if octto is unavailable, or the user dismisses the session, or any answer",
    "is empty, substitute the matching DEFAULT_BOOTSTRAP_ANSWERS value and warn the user",
    "in the final report. Do NOT block the run on missing answers.",
    PROMPT_FOOTER,
  ].join("\n");
}
