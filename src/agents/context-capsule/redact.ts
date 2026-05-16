import { detectSecret, type SecretMatch } from "@/utils/secret-detect";

export interface CapsuleSecretMatch extends SecretMatch {
  readonly reason: string;
}

export type CapsuleSafetyResult = { readonly ok: true } | { readonly ok: false; readonly match: CapsuleSecretMatch };

const EXTRA_PATTERNS: ReadonlyArray<{ readonly reason: string; readonly regex: RegExp }> = [
  { reason: "authorization_header", regex: /^\s*Authorization\s*:\s*\S+/im },
  {
    reason: "env_secret_assignment",
    regex: /^\s*[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_URL)[A-Z0-9_]*\s*=\s*\S+/im,
  },
  { reason: "credential_url", regex: /https?:\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/i },
  { reason: "raw_log_dump", regex: /BEGIN RAW LOG|END RAW LOG|^\[[0-9:. -]+\]\s+(?:DEBUG|TRACE|ERROR)/im },
];

export function findCapsuleSecret(text: string): CapsuleSecretMatch | null {
  for (const { reason, regex } of EXTRA_PATTERNS) {
    const match = regex.exec(text);
    if (match) return { reason, index: match.index };
  }
  const generic = detectSecret(text);
  return generic ? { reason: generic.reason, index: generic.index } : null;
}

export function assertCapsuleSafe(text: string): CapsuleSafetyResult {
  const match = findCapsuleSecret(text);
  return match ? { ok: false, match } : { ok: true };
}
