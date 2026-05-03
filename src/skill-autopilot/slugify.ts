import { createHash } from "node:crypto";

import { config } from "@/utils/config";

const NON_ALPHANUM = /[^a-z0-9]+/g;
const HASH_PREFIX = "skill-";
const HASH_LENGTH = 8;
const RADIX_BASE = 36;
const ASCII_SHIFT = 96;
const ASCII_LIMIT = 128;
const FIRST_COLLISION_INDEX = 2;
const COLLISION_SUFFIX_SEPARATOR = "-";
const SLUG_EDGE = /^-+|-+$/g;
const TRAILING_HYPHENS = /-+$/g;

export interface SlugInput {
  readonly trigger: string;
  readonly existing: ReadonlySet<string>;
}

function transliterate(s: string): string {
  return [...s.toLowerCase()]
    .map((ch) => {
      const code = ch.charCodeAt(0);
      if (code < ASCII_LIMIT) return ch;
      return ((code % RADIX_BASE) + ASCII_SHIFT).toString(RADIX_BASE);
    })
    .join("");
}

function baseSlug(trigger: string): string {
  const ascii = transliterate(trigger);
  const slug = ascii.replace(NON_ALPHANUM, COLLISION_SUFFIX_SEPARATOR).replace(SLUG_EDGE, "");
  if (slug.length > 0) return slug.slice(0, config.skillAutopilot.nameMaxChars);
  const hash = createHash("sha1").update(trigger).digest("hex").slice(0, HASH_LENGTH);
  return `${HASH_PREFIX}${hash}`;
}

function collisionCandidate(base: string, index: number): string {
  const suffix = `${COLLISION_SUFFIX_SEPARATOR}${index}`;
  const stemLimit = config.skillAutopilot.nameMaxChars - suffix.length;
  const stem = base.slice(0, stemLimit).replace(TRAILING_HYPHENS, "");
  return `${stem}${suffix}`;
}

function withCollisionSuffix(base: string, existing: ReadonlySet<string>): string {
  if (!existing.has(base)) return base;
  let index = FIRST_COLLISION_INDEX;
  let candidate = collisionCandidate(base, index);
  while (existing.has(candidate)) {
    index += 1;
    candidate = collisionCandidate(base, index);
  }
  return candidate;
}

export function slugifySkillName(input: SlugInput): string {
  const base = baseSlug(input.trigger);
  if (!config.skillAutopilot.nameRegex.test(base)) {
    const hash = createHash("sha1").update(input.trigger).digest("hex").slice(0, HASH_LENGTH);
    return withCollisionSuffix(`${HASH_PREFIX}${hash}`, input.existing);
  }
  return withCollisionSuffix(base, input.existing);
}
