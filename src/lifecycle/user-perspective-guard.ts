const HEADING_PATTERN = /^##\s+User Perspective\s*$/m;
const NEXT_HEADING_PATTERN = /^##\s+/m;

export interface GuardResult {
  readonly ok: boolean;
  readonly reason?: string;
}

const findUserPerspectiveBody = (raw: string): string | null => {
  const heading = HEADING_PATTERN.exec(raw);
  if (heading === null) return null;
  const start = heading.index + heading[0].length;
  const rest = raw.slice(start);
  const next = NEXT_HEADING_PATTERN.exec(rest);
  return next === null ? rest : rest.slice(0, next.index);
};

export function validateUserPerspective(raw: string): GuardResult {
  const body = findUserPerspectiveBody(raw);
  if (body === null) return { ok: false, reason: "missing '## User Perspective' section" };
  if (body.trim().length === 0) return { ok: false, reason: "User Perspective section must have non-empty body" };
  return { ok: true };
}
