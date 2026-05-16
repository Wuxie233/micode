import { describe, expect, it } from "bun:test";

import { COMMANDER_PROMPT } from "@/agents/commander";

const recoveryActions = COMMANDER_PROMPT.match(/<action-map>[\s\S]*?<\/action-map>/)?.[0] ?? "";

describe("commander conflict recovery UX", () => {
  it("auto-routes merge_conflict to a bounded conflict resolver instead of halting", () => {
    expect(recoveryActions).toContain("merge_conflict");
    expect(recoveryActions).toContain("conflict resolver flow");
    expect(recoveryActions.includes("Do NOT auto-resolve. Halt")).toBe(false);
  });

  it("uses built-in question for semantic ambiguity and keeps output decision-minimal", () => {
    expect(COMMANDER_PROMPT).toContain("QUESTION_FIRST_DECISION_PROTOCOL");
    expect(COMMANDER_PROMPT).toContain("DECISION_MINIMAL_RESPONSE_PROTOCOL");
    expect(COMMANDER_PROMPT).toContain("built-in question");
    expect(COMMANDER_PROMPT).toContain("raw recovery hint");
  });

  it("mentions lost update audit as read-only", () => {
    expect(COMMANDER_PROMPT).toContain("lifecycle_lost_update_audit");
    expect(COMMANDER_PROMPT).toContain("read-only");
  });
});
