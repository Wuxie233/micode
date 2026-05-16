import { describe, expect, it } from "bun:test";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";

import type { LifecycleHandle } from "@/lifecycle";
import { createLostUpdateAuditPlan } from "@/lifecycle/lost-update-audit";
import type { ContextSnapshot, ProgressLogger } from "@/lifecycle/progress";
import type { Resolver } from "@/lifecycle/resolver";
import { createLifecycleTools } from "@/tools/lifecycle";

const FORBIDDEN_MUTATING_COMMANDS = [
  /\bgit\s+push\b/,
  /--force\b/,
  /\breset\s+--hard\b/,
  /\bgh\s+pr\s+merge\b/,
  /\bgh\s+issue\s+edit\b/,
];
const UNEXPECTED_HANDLE_CALL = "lost update audit should not use lifecycle handle mutation paths";
const ctx = {} as ToolContext;
const stringify = (result: ToolResult): string => (typeof result === "string" ? result : result.output);

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

describe("lost update audit safety", () => {
  it("does not suggest mutating git or GitHub commands", () => {
    const plan = createLostUpdateAuditPlan({ issueNumber: 85, baseBranch: "main", suspectedBranch: "issue/85-x" });
    const commands = plan.steps.map((step) => step.command).join("\n");

    for (const step of plan.steps) {
      expect(step.readOnly).toBe(true);
    }
    for (const forbidden of FORBIDDEN_MUTATING_COMMANDS) {
      expect(commands).not.toMatch(forbidden);
    }
  });

  it("exposes lifecycle_lost_update_audit without using lifecycle handle mutation paths", async () => {
    const tools = createLifecycleTools(createHandle(), createResolverFake(), createProgressFake());

    expect(typeof tools.lifecycle_lost_update_audit.execute).toBe("function");

    const exec = tools.lifecycle_lost_update_audit.execute.bind(tools.lifecycle_lost_update_audit) as unknown as (
      raw: unknown,
      ctx: ToolContext,
    ) => Promise<ToolResult>;
    const md = stringify(await exec({ issue_number: 85, base_branch: "main", suspected_branch: "issue/85-x" }, ctx));

    expect(md).toContain("## Lost update audit plan");
    expect(md).toContain("read-only");
  });
});
