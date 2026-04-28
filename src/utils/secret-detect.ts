const PATTERNS: ReadonlyArray<{ readonly reason: string; readonly regex: RegExp }> = [
  { reason: "aws_access_key", regex: /\bAKIA[0-9A-Z]{16}\b/ },
  { reason: "github_token", regex: /\b(ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{20,}\b|\bgithub_pat_[A-Za-z0-9_]{20,}\b/ },
  { reason: "stripe_secret_key", regex: /\bsk_(?:live|test)_[A-Za-z0-9]{16,}\b/ },
  { reason: "pem_block", regex: /-----BEGIN [A-Z ]+PRIVATE KEY-----/ },
  { reason: "jwt", regex: /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/ },
  { reason: "generic_secret", regex: /(?:api[_-]?key|secret|token|password)\s*[:=]\s*["']?[A-Za-z0-9_-]{16,}["']?/i },
];

export interface SecretMatch {
  readonly reason: string;
  readonly index: number;
}

export function detectSecret(text: string): SecretMatch | null {
  for (const { reason, regex } of PATTERNS) {
    const match = regex.exec(text);
    if (match) return { reason, index: match.index };
  }
  return null;
}
