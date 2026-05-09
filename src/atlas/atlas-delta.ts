/**
 * Atlas delta artifact helpers.
 *
 * Atlas deltas are written by primary agents to thoughts/shared/atlas-deltas/
 * and registered as lifecycle artifacts (kind=delta) so atlas-compiler can
 * later merge them. This module is a pure path/string builder; it does not
 * read or write the filesystem.
 */

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/u;
const TOPIC_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/u;

export type AtlasDeltaLayer = "10-impl" | "20-behavior" | "30-context" | "40-decisions" | "50-risks" | "60-timeline";

export interface AtlasDeltaClaim {
  readonly targetLayer: AtlasDeltaLayer;
  readonly claim: string;
  readonly sources: readonly string[];
}

export interface AtlasDeltaStaleEntry {
  readonly node: string;
  readonly note: string;
  readonly evidence: string;
}

export interface AtlasDeltaInput {
  readonly date: string;
  readonly topic: string;
  readonly sourceIssue: number;
  readonly claims: readonly AtlasDeltaClaim[];
  readonly impact: string;
  readonly staleOrUncertain: readonly AtlasDeltaStaleEntry[];
}

export function buildAtlasDeltaPath(date: string, topic: string): string {
  if (!DATE_RE.test(date)) throw new Error(`invalid date: ${date}`);
  if (/\s/u.test(topic)) throw new Error(`topic contains whitespace: ${topic}`);
  if (!TOPIC_SLUG_RE.test(topic)) throw new Error(`invalid topic slug: ${topic}`);
  return `thoughts/shared/atlas-deltas/${date}-${topic}-delta.md`;
}

const renderClaim = (c: AtlasDeltaClaim): string =>
  [
    `### ${c.targetLayer}`,
    "",
    `**Target:** ${c.targetLayer}`,
    "",
    c.claim,
    "",
    "**Sources:**",
    ...c.sources.map((s) => `- ${s}`),
  ].join("\n");

const renderStaleSection = (entries: readonly AtlasDeltaStaleEntry[]): string => {
  if (entries.length === 0) return "";
  const lines = ["## Stale or Uncertain", ""];
  for (const e of entries) {
    lines.push(`- **${e.node}** — ${e.note}`);
    lines.push(`  - 证据: ${e.evidence}`);
  }
  lines.push("");
  return lines.join("\n");
};

export function renderAtlasDeltaTemplate(input: AtlasDeltaInput): string {
  const frontmatter = [
    "---",
    `date: ${input.date}`,
    `topic: "${input.topic}"`,
    `source-issue: ${input.sourceIssue}`,
    "status: draft",
    "---",
    "",
  ].join("\n");

  const claimsBlock = input.claims.length === 0 ? "_(no claims)_" : input.claims.map(renderClaim).join("\n\n");
  const stale = renderStaleSection(input.staleOrUncertain);

  return [
    frontmatter,
    `# Atlas Delta — ${input.topic}`,
    "",
    `本 delta 由 primary agent 在 issue/${input.sourceIssue} 工作过程中产出，用于通知 atlas-compiler 归并。`,
    "",
    "## Claims",
    "",
    claimsBlock,
    "",
    "## Impact",
    "",
    input.impact,
    "",
    stale,
  ]
    .join("\n")
    .replace(/\n{3,}/gu, "\n\n");
}
