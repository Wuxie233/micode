import { POINTER_KINDS, tryParsePointer } from "./pointer";

export interface SourceLinkContext {
  readonly repoBase: string;
  readonly ref: string;
}

const TRAILING_SLASH = /\/+$/u;

const stripTrailingSlash = (raw: string): string => raw.replace(TRAILING_SLASH, "");

/**
 * Render a source bullet for the body Sources section.
 *
 * - `code:src/foo.ts` becomes a markdown link to the GitHub permalink.
 * - All other pointer kinds (lifecycle, thoughts, pm, mindmodel) and
 *   unparseable bullets are returned verbatim so the renderer never
 *   produces a broken link.
 */
export function formatSourceLink(raw: string, ctx: SourceLinkContext): string {
  const pointer = tryParsePointer(raw);
  if (pointer === null || pointer.kind !== POINTER_KINDS.CODE) return raw;
  const base = stripTrailingSlash(ctx.repoBase);
  const url = `${base}/blob/${ctx.ref}/${pointer.value}`;
  return `[查看源码 ${pointer.value}](${url})`;
}
