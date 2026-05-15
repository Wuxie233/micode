import type { ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { createLostUpdateAuditPlan } from "@/lifecycle/lost-update-audit";

const LINE_BREAK = "\n";

export function createLifecycleLostUpdateAuditTool(): ToolDefinition {
  return tool({
    description:
      "Create a lightweight read-only audit plan for suspected historical lost updates / force-push confusion. Does not mutate git or GitHub state.",
    args: {
      issue_number: tool.schema.number().describe("Lifecycle issue number to audit"),
      base_branch: tool.schema.string().optional().describe("Base branch to inspect, defaults to main"),
      suspected_branch: tool.schema.string().optional().describe("Optional issue branch suspected of losing updates"),
    },
    execute: async (args) => {
      const plan = createLostUpdateAuditPlan({
        issueNumber: args.issue_number,
        baseBranch: args.base_branch ?? "main",
        suspectedBranch: args.suspected_branch ?? "",
      });

      return [
        "## Lost update audit plan",
        "",
        `Issue: #${plan.issueNumber}`,
        `Base branch: ${plan.baseBranch}`,
        `Suspected branch: ${plan.suspectedBranch || "-"}`,
        "",
        "All steps are read-only. Do not run recovery or rewrite history from this audit output.",
        "",
        ...plan.steps.flatMap((step, index) => [
          `${index + 1}. **${step.title}**`,
          `   - Command: \`${step.command}\``,
          `   - Read-only: ${step.readOnly ? "yes" : "no"}`,
        ]),
        "",
        `Limitation: ${plan.limitation}`,
      ].join(LINE_BREAK);
    },
  });
}
