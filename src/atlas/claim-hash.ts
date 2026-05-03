import { createHash } from "node:crypto";

import { ATLAS_CLAIM_HASH_HEX_LENGTH } from "./config";

const TRAILING_PUNCTUATION = /[\s.,;:!?]+$/;
const COLLAPSE_WHITESPACE = /\s+/g;

const normalize = (claim: string): string => {
  return claim.toLowerCase().replace(COLLAPSE_WHITESPACE, " ").replace(TRAILING_PUNCTUATION, "").trim();
};

export function computeClaimHash(target: string, claim: string): string {
  const hash = createHash("sha256");
  hash.update(`${target}\n${normalize(claim)}`);
  return hash.digest("hex").slice(0, ATLAS_CLAIM_HASH_HEX_LENGTH);
}
