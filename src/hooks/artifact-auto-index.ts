// src/hooks/artifact-auto-index.ts
// Auto-indexes artifacts when written to thoughts/ directories

import type { PluginInput } from "@opencode-ai/plugin";
import { readFileSync } from "fs";
import { getArtifactIndex } from "../tools/artifact-index";

const LEDGER_PATH_PATTERN = /thoughts\/ledgers\/CONTINUITY_(.+)\.md$/;
const HANDOFF_PATH_PATTERN = /thoughts\/shared\/handoffs\/(.+)\.md$/;
const PLAN_PATH_PATTERN = /thoughts\/shared\/plans\/(.+)\.md$/;

function parseLedger(content: string, filePath: string, sessionName: string) {
  const goalMatch = content.match(/## Goal\n([^\n]+)/);
  const stateMatch = content.match(/- Now: ([^\n]+)/);
  const decisionsMatch = content.match(/## Key Decisions\n([\s\S]*?)(?=\n## |$)/);

  return {
    id: `ledger-${sessionName}`,
    sessionName,
    filePath,
    goal: goalMatch?.[1] || "",
    stateNow: stateMatch?.[1] || "",
    keyDecisions: decisionsMatch?.[1]?.trim() || "",
  };
}

function parseHandoff(content: string, filePath: string, fileName: string) {
  // Extract session from frontmatter if present
  const sessionMatch = content.match(/^session:\s*(.+)$/m);
  const sessionName = sessionMatch?.[1] || fileName;

  // Extract task summary
  const taskMatch = content.match(/\*\*Working on:\*\*\s*([^\n]+)/);
  const taskSummary = taskMatch?.[1] || "";

  // Extract learnings
  const learningsMatch = content.match(/## Learnings\n\n([\s\S]*?)(?=\n## |$)/);
  const learnings = learningsMatch?.[1]?.trim() || "";

  // Extract what worked
  const workedMatch = content.match(/## What Worked\n\n([\s\S]*?)(?=\n## |$)/);
  const whatWorked = workedMatch?.[1]?.trim() || learnings;

  // Extract what failed
  const failedMatch = content.match(/## What Failed\n\n([\s\S]*?)(?=\n## |$)/);
  const whatFailed = failedMatch?.[1]?.trim() || "";

  return {
    id: `handoff-${fileName}`,
    sessionName,
    filePath,
    taskSummary,
    whatWorked,
    whatFailed,
    learnings,
    outcome: "UNKNOWN" as const,
  };
}

function parsePlan(content: string, filePath: string, fileName: string) {
  // Extract title (first heading)
  const titleMatch = content.match(/^# (.+)$/m);
  const title = titleMatch?.[1] || fileName;

  // Extract overview
  const overviewMatch = content.match(/## Overview\n\n([\s\S]*?)(?=\n## |$)/);
  const overview = overviewMatch?.[1]?.trim() || "";

  // Extract approach
  const approachMatch = content.match(/## Approach\n\n([\s\S]*?)(?=\n## |$)/);
  const approach = approachMatch?.[1]?.trim() || "";

  return {
    id: `plan-${fileName}`,
    title,
    filePath,
    overview,
    approach,
  };
}

export function createArtifactAutoIndexHook(_ctx: PluginInput) {
  return {
    "tool.execute.after": async (
      input: { tool: string; args?: Record<string, unknown> },
      _output: { output?: string }
    ) => {
      // Only process Write tool
      if (input.tool !== "write") return;

      const filePath = input.args?.filePath as string | undefined;
      if (!filePath) return;

      try {
        // Check if it's a ledger
        const ledgerMatch = filePath.match(LEDGER_PATH_PATTERN);
        if (ledgerMatch) {
          const content = readFileSync(filePath, "utf-8");
          const index = await getArtifactIndex();
          const record = parseLedger(content, filePath, ledgerMatch[1]);
          await index.indexLedger(record);
          console.log(`[artifact-auto-index] Indexed ledger: ${filePath}`);
          return;
        }

        // Check if it's a handoff
        const handoffMatch = filePath.match(HANDOFF_PATH_PATTERN);
        if (handoffMatch) {
          const content = readFileSync(filePath, "utf-8");
          const index = await getArtifactIndex();
          const record = parseHandoff(content, filePath, handoffMatch[1]);
          await index.indexHandoff(record);
          console.log(`[artifact-auto-index] Indexed handoff: ${filePath}`);
          return;
        }

        // Check if it's a plan
        const planMatch = filePath.match(PLAN_PATH_PATTERN);
        if (planMatch) {
          const content = readFileSync(filePath, "utf-8");
          const index = await getArtifactIndex();
          const record = parsePlan(content, filePath, planMatch[1]);
          await index.indexPlan(record);
          console.log(`[artifact-auto-index] Indexed plan: ${filePath}`);
          return;
        }
      } catch (e) {
        // Silent failure - don't interrupt user flow
        console.error(`[artifact-auto-index] Error indexing ${filePath}:`, e);
      }
    },
  };
}
