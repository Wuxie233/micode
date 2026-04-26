export const TRANSIENT_NETWORK_PATTERNS: readonly RegExp[] = [
  /\bECONNRESET\b/i,
  /\bETIMEDOUT\b/i,
  /\bEAI_AGAIN\b/i,
  /fetch failed/i,
  /socket hang up/i,
  /stream\s+(aborted|reset|closed)/i,
];

export const HTTP_TOO_MANY_REQUESTS = 429;
export const HTTP_BAD_GATEWAY = 502;
export const HTTP_SERVICE_UNAVAILABLE = 503;
export const HTTP_GATEWAY_TIMEOUT = 504;

export const TRANSIENT_HTTP_STATUSES: readonly number[] = [
  HTTP_TOO_MANY_REQUESTS,
  HTTP_BAD_GATEWAY,
  HTTP_SERVICE_UNAVAILABLE,
  HTTP_GATEWAY_TIMEOUT,
];
export const TASK_ERROR_MARKERS: readonly string[] = ["TEST FAILED", "BUILD FAILED", "CHANGES REQUESTED"];
export const BLOCKED_MARKERS: readonly string[] = ["BLOCKED:", "ESCALATE:"];

export function matchesAnyPattern(value: string, patterns: readonly RegExp[]): boolean {
  return patterns.some((p) => p.test(value));
}

export function containsAnyMarker(value: string, markers: readonly string[]): boolean {
  return markers.some((m) => value.includes(m));
}
