/**
 * USER-TRIGGERED ONLY. These markers describe atlas-compiler spawn receipts /
 * lifecycle handoffs. They are NOT written or read by lifecycle_finish or any
 * lifecycle-owned event. Valid callers: /atlas-refresh, manual atlas-compiler
 * runs. See plan thoughts/shared/plans/2026-05-10-atlas-shared-mental-model.md
 * Batch 1.5 / 3.4 and the lifecycle boundary test in Batch 4.2.
 */
import { extractBetween, replaceBetween } from "@/lifecycle/issue-body-markers";
import { ATLAS_SPAWN_MARKER_BEGIN, ATLAS_SPAWN_MARKER_END } from "./config";
import type { AtlasSpawnReceipt } from "./types";

const JSON_INDENT = 2;
const JSON_FENCE_PATTERN = /```json\n([\s\S]+?)\n```/;

export function renderSpawnReceiptBlock(receipt: AtlasSpawnReceipt): string {
  const inner = JSON.stringify(receipt, null, JSON_INDENT);
  return `${ATLAS_SPAWN_MARKER_BEGIN}\n\n\`\`\`json\n${inner}\n\`\`\`\n\n${ATLAS_SPAWN_MARKER_END}`;
}

export function extractSpawnReceipt(body: string): AtlasSpawnReceipt | null {
  const inner = extractBetween(body, ATLAS_SPAWN_MARKER_BEGIN, ATLAS_SPAWN_MARKER_END);
  if (inner === null) return null;
  const fence = JSON_FENCE_PATTERN.exec(inner);
  if (fence === null) return null;
  try {
    return JSON.parse(fence[1]) as AtlasSpawnReceipt;
  } catch {
    return null;
  }
}

export function upsertSpawnReceiptMarker(body: string, receipt: AtlasSpawnReceipt): string {
  const inner = `\n\`\`\`json\n${JSON.stringify(receipt, null, JSON_INDENT)}\n\`\`\`\n`;
  return replaceBetween(body, ATLAS_SPAWN_MARKER_BEGIN, ATLAS_SPAWN_MARKER_END, inner);
}
