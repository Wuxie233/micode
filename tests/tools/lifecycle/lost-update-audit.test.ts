import { describe, expect, it } from "bun:test";
import type { ToolContext, ToolResult } from "@opencode-ai/plugin/tool";

import { createLifecycleLostUpdateAuditTool } from "@/tools/lifecycle/lost-update-audit";

const ctx = {} as ToolContext;
const stringify = (result: ToolResult): string => (typeof result === "string" ? result : result.output);

describe("lifecycle_lost_update_audit tool", () => {
  it("renders only read-only audit commands and limitations", async () => {
    const tool = createLifecycleLostUpdateAuditTool();
    const exec = tool.execute.bind(tool) as unknown as (raw: unknown, ctx: ToolContext) => Promise<ToolResult>;
    const md = stringify(await exec({ issue_number: 85, base_branch: "main", suspected_branch: "issue/85-x" }, ctx));

    expect(md).toContain("## Lost update audit plan");
    expect(md).toContain("read-only");
    expect(md).toContain("git reflog show --date=iso origin/main");
    expect(md).toContain("gh issue view 85 --comments");
    expect(md).not.toContain("push --force");
    expect(md).not.toContain("reset --hard");
    expect(md).not.toContain("--no-verify");
  });
});
