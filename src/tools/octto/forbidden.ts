const HEADER = "## Forbidden";
const HINT = "Hint: call start_session in this conversation to get a session_id you own.";

export function formatForbidden(octtoSessionId: string): string {
  return `${HEADER}

Session ${octtoSessionId} belongs to a different OpenCode conversation. Each OpenCode conversation owns its own Octto sessions.

${HINT}`;
}
