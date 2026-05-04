const ABORTED_ISSUE_NUMBER = Number.MAX_SAFE_INTEGER;

export const isRealIssueNumber = (issueNumber: number): boolean => {
  if (!Number.isSafeInteger(issueNumber)) return false;
  if (issueNumber <= 0) return false;
  return issueNumber !== ABORTED_ISSUE_NUMBER;
};
