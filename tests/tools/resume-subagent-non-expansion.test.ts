import { promises as fs } from "node:fs";
import { resolve } from "node:path";
import { describe, expect, test } from "vitest";

const RESUME_SUBAGENT_FILE = resolve(__dirname, "..", "..", "src", "tools", "resume-subagent.ts");

describe("resume_subagent semantics unchanged by issue #94", () => {
  test("resume-subagent.ts does NOT import the workflow-retry continuation policy", async () => {
    const text = await fs.readFile(RESUME_SUBAGENT_FILE, "utf8");
    expect(text).not.toContain("workflow-retry/policy");
    expect(text).not.toContain("workflow-retry/upstream-predicate");
    expect(text).not.toContain("WORKFLOW_CONTINUATION_RETRY_POLICY");
    expect(text).not.toContain("isRecoverableUpstreamError");
  });

  test("resume_subagent still requires a preserved spawn_agent session_id", async () => {
    const text = await fs.readFile(RESUME_SUBAGENT_FILE, "utf8");
    // Heuristic: the tool's contract still references the preserved spawn-session registry.
    expect(text).toMatch(/spawn-session-registry|preserved|task_error|blocked/);
  });
});
