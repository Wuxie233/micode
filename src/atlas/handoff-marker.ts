/**
 * USER-TRIGGERED ONLY. These markers describe atlas-compiler spawn receipts /
 * lifecycle handoffs. They are NOT written or read by lifecycle_finish or any
 * lifecycle-owned event. Valid callers: /atlas-refresh, manual atlas-compiler
 * runs. See plan thoughts/shared/plans/2026-05-10-atlas-shared-mental-model.md
 * Batch 1.5 / 3.4 and the lifecycle boundary test in Batch 4.2.
 */
import { extractBetween, replaceBetween } from "@/lifecycle/issue-body-markers";
import { ATLAS_HANDOFF_MARKER_BEGIN, ATLAS_HANDOFF_MARKER_END } from "./config";
import type { AtlasHandoff } from "./types";

const JSON_INDENT = 2;

export function renderHandoffBlock(handoff: AtlasHandoff): string {
  const inner = JSON.stringify(handoff, null, JSON_INDENT);
  return `${ATLAS_HANDOFF_MARKER_BEGIN}\n\n\`\`\`json\n${inner}\n\`\`\`\n\n${ATLAS_HANDOFF_MARKER_END}`;
}

const JSON_FENCE_PATTERN = /```json\n([\s\S]+?)\n```/;

export function extractHandoff(body: string): AtlasHandoff | null {
  const inner = extractBetween(body, ATLAS_HANDOFF_MARKER_BEGIN, ATLAS_HANDOFF_MARKER_END);
  if (inner === null) return null;
  const fence = JSON_FENCE_PATTERN.exec(inner);
  if (fence === null) return null;
  try {
    return JSON.parse(fence[1]) as AtlasHandoff;
  } catch {
    return null;
  }
}

export function upsertHandoffMarker(body: string, handoff: AtlasHandoff): string {
  const inner = `\n\`\`\`json\n${JSON.stringify(handoff, null, JSON_INDENT)}\n\`\`\`\n`;
  return replaceBetween(body, ATLAS_HANDOFF_MARKER_BEGIN, ATLAS_HANDOFF_MARKER_END, inner);
}
