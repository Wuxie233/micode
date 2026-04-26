const SCOPE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;
const NEWLINE_PATTERN = /[\r\n]/;

export interface CommitMessageInput {
  readonly type: "feat" | "fix" | "chore" | "refactor" | "docs" | "test";
  readonly scope: string;
  readonly summary: string;
  readonly issueNumber: number;
}

export function buildLifecycleCommitMessage(input: CommitMessageInput): string {
  if (!SCOPE_PATTERN.test(input.scope)) throw new Error(`Invalid commit scope: ${input.scope}`);
  if (NEWLINE_PATTERN.test(input.summary)) throw new Error("Commit summary must be single-line");
  if (input.issueNumber <= 0) throw new Error(`Invalid issue number: ${input.issueNumber}`);
  return `${input.type}(${input.scope}): ${input.summary} (#${input.issueNumber})`;
}
