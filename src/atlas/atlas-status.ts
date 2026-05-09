import type { AtlasStatus } from "@/agents/atlas-mental-model";

export function renderAtlasStatusLine(status: AtlasStatus, detail?: string): string {
  const trimmed = detail?.trim() ?? "";
  if (trimmed.length === 0) return `Atlas status: ${status}`;
  return `Atlas status: ${status} — ${trimmed}`;
}
