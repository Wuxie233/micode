import { describe, expect, it } from "bun:test";

import type { LifecycleHandle } from "@/lifecycle";
import type { ContextSnapshot, ProgressLogger } from "@/lifecycle/progress";
import type { Resolver } from "@/lifecycle/resolver";
import { createLifecycleTools } from "@/tools/lifecycle";

const EXPECTED_TOOL_NAMES = [
  "lifecycle_commit",
  "lifecycle_context",
  "lifecycle_current",
  "lifecycle_finish",
  "lifecycle_log_progress",
  "lifecycle_record_artifact",
  "lifecycle_resume",
  "lifecycle_start_request",
] as const;
const UNEXPECTED_HANDLE_CALL = "test should not execute lifecycle handle methods";

const fail = async (): Promise<never> => {
  throw new Error(UNEXPECTED_HANDLE_CALL);
};

const createHandle = (): LifecycleHandle => ({
  start: fail,
  recordArtifact: fail,
  commit: fail,
  finish: fail,
  load: async () => null,
  setState: fail,
});

const createResolverFake = (): Resolver => ({
  current: async () => ({ kind: "none" }),
  resume: fail,
});

const emptySnapshot: ContextSnapshot = {
  issueNumber: 0,
  body: "",
  recentProgress: [],
};

const createProgressFake = (): ProgressLogger => ({
  log: fail,
  context: async () => emptySnapshot,
});

describe("createLifecycleTools", () => {
  it("returns lifecycle tool definitions by registry key", () => {
    const tools = createLifecycleTools(createHandle(), createResolverFake(), createProgressFake());

    expect(Object.keys(tools).sort()).toEqual([...EXPECTED_TOOL_NAMES].sort());
    for (const name of EXPECTED_TOOL_NAMES) {
      expect(typeof tools[name].execute).toBe("function");
    }
  });
});
