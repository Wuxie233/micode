import { createHash } from "node:crypto";

import { dedupeKeyFor } from "@/skill-autopilot/security/secret-gate";

const ID_PREFIX = "cand_";
const ID_HASH_CHARS = 12;

export function candidateIdFor(projectId: string, trigger: string, steps: readonly string[]): string {
  const key = dedupeKeyFor({ trigger, steps });
  const payload = `${projectId}\u0000${key}`;
  return `${ID_PREFIX}${createHash("sha1").update(payload).digest("hex").slice(0, ID_HASH_CHARS)}`;
}
