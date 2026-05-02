export const ISSUE_BODY_MARKERS = {
  STATE_BEGIN: "<!-- micode:lifecycle:state:begin -->",
  STATE_END: "<!-- micode:lifecycle:state:end -->",
  ARTIFACTS_BEGIN: "<!-- micode:lifecycle:artifacts:begin -->",
  ARTIFACTS_END: "<!-- micode:lifecycle:artifacts:end -->",
  CHECKLIST_BEGIN: "<!-- micode:lifecycle:checklist:begin -->",
  CHECKLIST_END: "<!-- micode:lifecycle:checklist:end -->",
  AI_REVIEW_BEGIN: "<!-- micode:lifecycle:ai-review:begin -->",
  AI_REVIEW_END: "<!-- micode:lifecycle:ai-review:end -->",
  AI_REVIEW_COMMENT: "<!-- micode:lifecycle:ai-review-comment -->",
} as const;

export function extractBetween(body: string, begin: string, end: string): string | null {
  const startIdx = body.indexOf(begin);
  if (startIdx === -1) return null;
  const endIdx = body.indexOf(end, startIdx + begin.length);
  if (endIdx === -1) return null;
  return body.slice(startIdx + begin.length, endIdx).trim();
}

export function replaceBetween(body: string, begin: string, end: string, replacement: string): string {
  const block = `${begin}\n${replacement}\n${end}`;
  const startIdx = body.indexOf(begin);
  if (startIdx === -1) return `${body.trimEnd()}\n\n${block}\n`;
  const endIdx = body.indexOf(end, startIdx + begin.length);
  if (endIdx === -1) return `${body.trimEnd()}\n\n${block}\n`;
  return `${body.slice(0, startIdx)}${block}${body.slice(endIdx + end.length)}`;
}
