import type { GateInput, GateResult } from "./types";

const PATTERNS: ReadonlyArray<{ readonly reason: string; readonly regex: RegExp }> = [
  { reason: "absolute filesystem path", regex: /(?:^|\s)\/(?:home|root|Users|var|etc|opt|srv)\/[\w./-]+/ },
  { reason: "internal hostname", regex: /\b[\w-]+\.(?:internal|corp|lan|local)\b/i },
  {
    reason: "private IPv4",
    regex:
      /\b(?:10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(?:1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})\b/,
  },
  { reason: "internal Slack URL", regex: /https?:\/\/[\w-]+\.slack\.com\b/ },
  { reason: "internal JIRA URL", regex: /https?:\/\/[\w-]+\.atlassian\.net\b/ },
  { reason: "internal Confluence URL", regex: /https?:\/\/[\w-]+\.atlassian\.net\/wiki\b/ },
];

function check(text: string): string | null {
  for (const { reason, regex } of PATTERNS) if (regex.test(text)) return reason;
  return null;
}

export function piiGate(input: GateInput): GateResult {
  for (const field of [input.description, input.trigger, input.body, ...input.steps]) {
    const hit = check(field);
    if (hit) return { ok: false, reason: `pii: ${hit}` };
  }
  return { ok: true };
}
