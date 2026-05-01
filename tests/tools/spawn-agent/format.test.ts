import { describe, expect, it } from "bun:test";

import { formatSpawnResults } from "../../../src/tools/spawn-agent/format";
import { SPAWN_OUTCOMES, type SpawnResult } from "../../../src/tools/spawn-agent/types";

const AGENT = "implementer-general";

describe("formatSpawnResults", () => {
  it("keeps the current section format for a single success", () => {
    const output = formatSpawnResults([
      {
        outcome: SPAWN_OUTCOMES.SUCCESS,
        description: "Write formatter",
        agent: AGENT,
        elapsedMs: 1234,
        output: "DONE\nAll checks passed.",
      },
    ]);

    expect(output).toBe(`## Write formatter (1.2s)

**Agent**: implementer-general

### Result

DONE
All checks passed.`);
  });

  it("includes resume details for a single task error", () => {
    const output = formatSpawnResults([
      {
        outcome: SPAWN_OUTCOMES.TASK_ERROR,
        description: "Stabilize tests",
        agent: AGENT,
        elapsedMs: 2500,
        sessionId: "session-task-error",
        output: "TEST FAILED: expected pass.",
        resumeCount: 2,
      },
    ]);

    expect(output).toBe(`## Stabilize tests (2.5s)

**Agent**: implementer-general
**Outcome**: task_error
**SessionID**: session-task-error
**Resume count**: 2

### Result

TEST FAILED: expected pass.`);
  });

  it("formats a multi-agent table and expanded sections for all outcomes", () => {
    const results: readonly SpawnResult[] = [
      {
        outcome: SPAWN_OUTCOMES.SUCCESS,
        description: "Successful task",
        agent: AGENT,
        elapsedMs: 1000,
        output: "Completed successfully.",
      },
      {
        outcome: SPAWN_OUTCOMES.TASK_ERROR,
        description: "Task error task",
        agent: "implementer-backend",
        elapsedMs: 2345,
        sessionId: "session-task",
        output: "TEST FAILED: unit test rejected the change.",
        resumeCount: 1,
      },
      {
        outcome: SPAWN_OUTCOMES.BLOCKED,
        description: "Blocked task",
        agent: "implementer-frontend",
        elapsedMs: 3456,
        sessionId: "session-blocked",
        output: "BLOCKED: contract mismatch.",
        resumeCount: 0,
      },
      {
        outcome: SPAWN_OUTCOMES.HARD_FAILURE,
        description: "Hard failure task",
        agent: "general",
        elapsedMs: 4567,
        error: "Failed to create session",
      },
    ];

    const output = formatSpawnResults(results);

    expect(output).toStartWith(
      "| Description | Agent | Outcome | Elapsed | SessionID | Output snippet |\n| --- | --- | --- | --- | --- | --- |",
    );
    expect(output).toContain(
      "| Successful task | implementer-general | success | 1.0s | - | Completed successfully. |",
    );
    expect(output).toContain(
      "| Task error task | implementer-backend | task_error | 2.3s | session-task | TEST FAILED: unit test rejected the change. |",
    );
    expect(output).toContain(
      "| Blocked task | implementer-frontend | blocked | 3.5s | session-blocked | BLOCKED: contract mismatch. |",
    );
    expect(output).toContain("| Hard failure task | general | hard_failure | 4.6s | - | Failed to create session |");
    expect(output).toContain("## Successful task (1.0s)");
    expect(output).toContain("## Task error task (2.3s)");
    expect(output).toContain("**SessionID**: session-task");
    expect(output).toContain("## Blocked task (3.5s)");
    expect(output).toContain("**SessionID**: session-blocked");
    expect(output).toContain("## Hard failure task (4.6s)");
    expect(output).toContain("### Error\n\nFailed to create session");
  });
});

describe("formatSpawnResults review_changes_requested", () => {
  const reviewResult: SpawnResult = {
    outcome: SPAWN_OUTCOMES.REVIEW_CHANGES_REQUESTED,
    description: "Review task",
    agent: "reviewer",
    elapsedMs: 1200,
    output: "CHANGES REQUESTED: rename foo to bar",
  };

  it("renders a single review_changes_requested result as a non-failure section", () => {
    const output = formatSpawnResults([reviewResult]);

    expect(output).toContain("review_changes_requested");
    expect(output).toContain("CHANGES REQUESTED: rename foo to bar");
    expect(output).toContain("Review task");
    expect(output).not.toContain("**Outcome**: task_error");
    expect(output).not.toContain("**Outcome**: hard_failure");
  });

  it("emits missing session ids for duplicate review_changes_requested table rows", () => {
    const output = formatSpawnResults([reviewResult, reviewResult]);
    const rows = output.split("\n").filter((line) => line.startsWith("| Review task"));

    expect(rows).toHaveLength(2);
    for (const row of rows) {
      expect(row.split("|")[5].trim()).toBe("-");
    }
  });

  it("includes review_changes_requested in table rows", () => {
    const output = formatSpawnResults([reviewResult, reviewResult]);
    const row = output.split("\n").find((line) => line.startsWith("| Review task"));

    expect(row).toBeDefined();
    expect(row).toContain("review_changes_requested");
  });
});
