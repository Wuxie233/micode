const WIKILINK_PATTERN = /\[\[([^\]]+)\]\]/g;
const WIKILINK_PREFIX = "[[";
const WIKILINK_SUFFIX = "]]";
const WIKILINK_PREFIX_LENGTH = WIKILINK_PREFIX.length;
const WIKILINK_SUFFIX_OFFSET = -WIKILINK_SUFFIX.length;

export function parseWikilink(raw: string): string | null {
  const trimmed = raw.trim();
  if (!trimmed.startsWith(WIKILINK_PREFIX) || !trimmed.endsWith(WIKILINK_SUFFIX)) return null;
  const inner = trimmed.slice(WIKILINK_PREFIX_LENGTH, WIKILINK_SUFFIX_OFFSET).trim();
  if (inner.length === 0) return null;
  return inner;
}

export function formatWikilink(target: string): string {
  return `${WIKILINK_PREFIX}${target}${WIKILINK_SUFFIX}`;
}

export function extractWikilinks(text: string): readonly string[] {
  const matches: string[] = [];
  for (const match of text.matchAll(WIKILINK_PATTERN)) {
    const inner = match[1].trim();
    if (inner.length > 0) matches.push(inner);
  }
  return matches;
}

export function rewriteWikilinks(text: string, mapping: Readonly<Record<string, string>>): string {
  return text.replace(WIKILINK_PATTERN, (whole, inner: string) => {
    const trimmed = inner.trim();
    const replacement = mapping[trimmed];
    return replacement ? formatWikilink(replacement) : whole;
  });
}
