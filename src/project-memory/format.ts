import type { LookupHit } from "./types";

const HEADER = "## Project Memory";
const NO_RESULTS = "No project memory entries match this query. Falling back to raw artifact search may help.";
const ACTIVE_STATUS = "active";
const NO_SOURCES = "(no source pointers)";
const DOUBLE_LINE_BREAK = "\n\n";

function formatSources(hit: LookupHit): string {
  if (hit.sources.length === 0) return NO_SOURCES;
  return hit.sources.map((source) => `\`${source.kind}\` -> \`${source.pointer}\``).join(", ");
}

function formatFlags(hit: LookupHit): readonly string[] {
  const flags: string[] = [];
  if (hit.degraded) flags.push("degraded");
  if (hit.entry.status !== ACTIVE_STATUS) flags.push(hit.entry.status);
  return flags;
}

function formatFlagText(hit: LookupHit): string {
  const flags = formatFlags(hit);
  if (flags.length === 0) return "";
  return ` _(${flags.join(", ")})_`;
}

function formatHit(hit: LookupHit): string {
  return [
    `### ${hit.entry.title}${formatFlagText(hit)}`,
    `- **Entity:** ${hit.entity.name} (${hit.entity.kind})`,
    `- **Type:** ${hit.entry.type}`,
    `- **Sources:** ${formatSources(hit)}`,
    `- **Snippet:** ${hit.snippet}`,
  ].join("\n");
}

export function formatLookupResults(query: string, hits: readonly LookupHit[]): string {
  if (hits.length === 0) return `${HEADER}${DOUBLE_LINE_BREAK}${NO_RESULTS}`;

  const body = hits.map(formatHit).join(DOUBLE_LINE_BREAK);
  return `${HEADER}${DOUBLE_LINE_BREAK}Query: \`${query}\`, ${hits.length} result(s)${DOUBLE_LINE_BREAK}${body}`;
}
