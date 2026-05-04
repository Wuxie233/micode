import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { computeClaimHash } from "./claim-hash";
import { createAtlasPaths } from "./paths";

export interface NewChallenge {
  readonly target: string;
  readonly reason: string;
  readonly proposedChange: string;
  readonly sources: readonly string[];
  readonly runId: string;
}

const SLUG_PATTERN = /[^a-z0-9]+/g;

const slug = (raw: string): string =>
  raw
    .toLowerCase()
    .replace(SLUG_PATTERN, "-")
    .replace(/^-+|-+$/g, "");

const renderBody = (input: NewChallenge, claimHash: string, createdAt: string): string => {
  const sources = input.sources.length === 0 ? "_none_" : input.sources.map((s) => `- ${s}`).join("\n");
  return `---
target: ${input.target}
status: open
claim_hash: ${claimHash}
run_id: ${input.runId}
created_at: ${createdAt}
---

## Reason

${input.reason}

## Proposed change

${input.proposedChange}

## Sources

${sources}
`;
};

export async function writeChallenge(projectRoot: string, input: NewChallenge): Promise<string> {
  const paths = createAtlasPaths(projectRoot);
  mkdirSync(paths.challenges, { recursive: true });
  const claimHash = computeClaimHash(input.target, input.reason);
  const createdAt = new Date().toISOString();
  const fileName = `${input.runId}-${slug(input.target)}-${claimHash}.md`;
  const file = join(paths.challenges, fileName);
  writeFileSync(file, renderBody(input, claimHash, createdAt), "utf8");
  return file;
}
