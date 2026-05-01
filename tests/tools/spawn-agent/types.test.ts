import { describe, expect, it } from "bun:test";

import {
  type ResumeSubagentInput,
  type ResumeSubagentResult,
  SPAWN_OUTCOMES,
  type SpawnResult,
  type SpawnReviewChanges,
} from "../../../src/tools/spawn-agent/types";

const AGENT = "implementer-general";

const assertNever = (spawn: never): never => {
  throw new Error(`Unexpected spawn result: ${JSON.stringify(spawn)}`);
};

const summarize = (spawn: SpawnResult): string => {
  switch (spawn.outcome) {
    case SPAWN_OUTCOMES.SUCCESS:
      return spawn.output;
    case SPAWN_OUTCOMES.TASK_ERROR:
    case SPAWN_OUTCOMES.BLOCKED:
      return `${spawn.sessionId}:${spawn.resumeCount}`;
    case SPAWN_OUTCOMES.HARD_FAILURE:
      return spawn.error;
    case SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED:
      return spawn.output;
    default:
      return assertNever(spawn);
  }
};

describe("spawn-agent result types", () => {
  it("defines contract outcome literals", () => {
    expect(SPAWN_OUTCOMES.SUCCESS).toBe("success");
    expect(SPAWN_OUTCOMES.TASK_ERROR).toBe("task_error");
    expect(SPAWN_OUTCOMES.BLOCKED).toBe("blocked");
    expect(SPAWN_OUTCOMES.HARD_FAILURE).toBe("hard_failure");
    expect(SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED).toBe("review_changes_requested");
  });

  it("supports exhaustive spawn result handling", () => {
    const samples: readonly SpawnResult[] = [
      {
        outcome: SPAWN_OUTCOMES.SUCCESS,
        description: "Completed task",
        agent: AGENT,
        elapsedMs: 10,
        output: "done",
      },
      {
        outcome: SPAWN_OUTCOMES.TASK_ERROR,
        description: "Failed task",
        agent: AGENT,
        elapsedMs: 20,
        sessionId: "session-task-error",
        output: "TEST FAILED",
        resumeCount: 1,
      },
      {
        outcome: SPAWN_OUTCOMES.BLOCKED,
        description: "Blocked task",
        agent: AGENT,
        elapsedMs: 30,
        sessionId: "session-blocked",
        output: "BLOCKED:",
        resumeCount: 2,
      },
      {
        outcome: SPAWN_OUTCOMES.HARD_FAILURE,
        description: "Hard failed task",
        agent: AGENT,
        elapsedMs: 40,
        error: "session create failed",
      },
    ];

    expect(samples.map(summarize)).toEqual([
      "done",
      "session-task-error:1",
      "session-blocked:2",
      "session create failed",
    ]);
  });

  it("types resume inputs and results by contract", () => {
    const input: ResumeSubagentInput = {
      session_id: "session-resume",
      hint: "continue after answer",
    };
    const resumed: ResumeSubagentResult = {
      outcome: SPAWN_OUTCOMES.TASK_ERROR,
      sessionId: "session-resume",
      resumeCount: 1,
      output: "TEST FAILED",
    };

    expect(input.session_id).toBe(resumed.sessionId);
    expect(resumed.outcome).toBe(SPAWN_OUTCOMES.TASK_ERROR);
  });

  it("narrows review changes under the spawn result union", () => {
    const result: SpawnResult = {
      outcome: SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED,
      description: "Review 2.3",
      agent: "reviewer",
      elapsedMs: 1234,
      output: "CHANGES REQUESTED: rename foo to bar",
    };

    if (result.outcome !== SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED) {
      throw new Error("expected review_changes_requested branch");
    }

    const narrowed: SpawnReviewChanges = result;
    expect(narrowed.output).toContain("CHANGES REQUESTED");
    expect(narrowed.agent).toBe("reviewer");
    expect("sessionId" in narrowed).toBe(false);
  });
});
