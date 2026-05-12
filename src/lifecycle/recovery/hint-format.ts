import type { LifecycleCandidateSummary, LifecycleRecoveryHint } from "./hint";

export const RECOVERY_SECTION_HEADER = "### Recovery hint";

const LINE_BREAK = "\n";
const MISSING = "-";

const formatNullable = (value: string | number | null): string => {
  if (value === null) return MISSING;
  return String(value);
};

const formatCode = (value: string | number | null): string => {
  if (value === null) return `\`${MISSING}\``;
  return `\`${String(value)}\``;
};

const formatCandidates = (candidates: readonly LifecycleCandidateSummary[]): readonly string[] => {
  if (candidates.length === 0) return [];
  const header = "| Issue # | Branch | Worktree | State | Stale | Reason |";
  const sep = "| --- | --- | --- | --- | --- | --- |";
  const rows = candidates.map(
    (c) =>
      `| ${c.issueNumber} | ${formatCode(c.branch)} | ${formatCode(c.worktree)} | ${formatCode(c.state)} | ${formatCode(String(c.stale))} | ${formatNullable(c.staleReason)} |`,
  );
  return ["", "**candidates:**", "", header, sep, ...rows];
};

const formatList = (label: string, items: readonly string[]): readonly string[] => {
  if (items.length === 0) return [];
  return ["", `**${label}:**`, "", ...items.map((it) => `- \`${it}\``)];
};

const formatScalar = (label: string, value: string | number | null): string => `**${label}:** ${formatCode(value)}`;

const formatBackup = (backupPath: string | null): readonly string[] => {
  if (backupPath === null) return [];
  return ["", formatScalar("backup_path", backupPath)];
};

export function formatRecoveryHint(hint: LifecycleRecoveryHint): string {
  const lines: string[] = [
    RECOVERY_SECTION_HEADER,
    "",
    formatScalar("failure_kind", hint.failureKind),
    formatScalar("recommended_next_action", hint.recommendedNextAction),
    formatScalar("safe_to_retry", String(hint.safeToRetry)),
    formatScalar("attempt", hint.attempt),
    formatScalar("issue_number", hint.issueNumber),
    formatScalar("branch", hint.branch),
    formatScalar("worktree", hint.worktree),
    "",
    `**summary:** ${hint.summary}`,
  ];
  lines.push(...formatCandidates(hint.candidates));
  lines.push(...formatList("conflict_files", hint.conflictFiles));
  lines.push(...formatBackup(hint.backupPath));
  return lines.join(LINE_BREAK);
}
