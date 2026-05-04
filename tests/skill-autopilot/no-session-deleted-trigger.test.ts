import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const INDEX_PATH = join(process.cwd(), "src/index.ts");
const SESSION_DELETED_BRANCH = 'event.type === "session.deleted"';
const SESSION_DELETED_SEARCH_WINDOW_CHARS = 1500;
const AUTOPILOT_CALL_PATTERN = /runAutopilot|runSkillAutopilot/u;
const indexSource = readFileSync(INDEX_PATH, "utf8");

describe("no session.deleted skill autopilot trigger", () => {
  it("does not declare or call triggerAutopilotOnDeletedSession", () => {
    expect(indexSource).not.toContain("triggerAutopilotOnDeletedSession");
  });

  it("does not declare or call triggerAutopilotForCurrentLifecycle", () => {
    expect(indexSource).not.toContain("triggerAutopilotForCurrentLifecycle");
  });

  it("does not call autopilot from the session.deleted branch", () => {
    const branchIndex = indexSource.indexOf(SESSION_DELETED_BRANCH);
    expect(branchIndex).toBeGreaterThan(-1);

    const branchWindow = indexSource.slice(branchIndex, branchIndex + SESSION_DELETED_SEARCH_WINDOW_CHARS);
    expect(branchWindow).not.toMatch(AUTOPILOT_CALL_PATTERN);
  });
});
