import { describe, expect, it } from "bun:test";
import { tool } from "@opencode-ai/plugin/tool";

import { DISPATCH_KINDS, GENERATOR_AGENTS } from "@/agents/context-capsule/types";
import { buildContextCapsuleArgs } from "@/tools/context-capsule/build/args";

type ArgsShape = Parameters<typeof tool>[0]["args"];

const schema = tool.schema.object(buildContextCapsuleArgs as ArgsShape);

const validArgs = {
  topic: "Working Context Capsule v3",
  lifecycle_issue: 99,
  dispatch_kind: "parallel-fanout",
  generated_by: "executor",
  source_files: [{ path: "src/file.ts", content: "export {};" }],
};

describe("buildContextCapsuleArgs runtime schema", () => {
  it("requires a non-empty topic", () => {
    expect(schema.safeParse(validArgs).success).toBe(true);
    expect(schema.safeParse({ ...validArgs, topic: "" }).success).toBe(false);

    const { topic: _topic, ...withoutTopic } = validArgs;
    expect(schema.safeParse(withoutTopic).success).toBe(false);
  });

  it("allows omitted or null lifecycle_issue and rejects non-integers", () => {
    const { lifecycle_issue: _lifecycleIssue, ...withoutLifecycleIssue } = validArgs;

    expect(schema.safeParse(withoutLifecycleIssue).success).toBe(true);
    expect(schema.safeParse({ ...validArgs, lifecycle_issue: null }).success).toBe(true);
    expect(schema.safeParse({ ...validArgs, lifecycle_issue: 1.5 }).success).toBe(false);
  });

  it("accepts only supported dispatch_kind values", () => {
    for (const dispatchKind of DISPATCH_KINDS) {
      expect(schema.safeParse({ ...validArgs, dispatch_kind: dispatchKind }).success).toBe(true);
    }

    expect(schema.safeParse({ ...validArgs, dispatch_kind: "serial" }).success).toBe(false);
  });

  it("accepts only supported generated_by values", () => {
    for (const generatorAgent of GENERATOR_AGENTS) {
      expect(schema.safeParse({ ...validArgs, generated_by: generatorAgent }).success).toBe(true);
    }

    expect(schema.safeParse({ ...validArgs, generated_by: "planner" }).success).toBe(false);
  });

  it("requires source_files entries to include path and content", () => {
    expect(
      schema.safeParse({ ...validArgs, source_files: [{ path: "src/file.ts", content: "content" }] }).success,
    ).toBe(true);
    expect(schema.safeParse({ ...validArgs, source_files: [{ path: "src/file.ts" }] }).success).toBe(false);
    expect(schema.safeParse({ ...validArgs, source_files: [{ content: "content" }] }).success).toBe(false);
  });
});
