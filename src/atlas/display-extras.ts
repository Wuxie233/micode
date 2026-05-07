import { POINTER_KINDS, tryParsePointer } from "./pointer";

const LINE_ANCHOR = /#L\d+(?:-L?\d+)?$/u;

export interface DisplayExtrasInput {
  readonly title: string;
  readonly id: string;
  readonly sources: readonly string[];
}

export interface DisplayExtras {
  readonly title?: string;
  readonly aliases?: string;
  readonly source_path?: string;
}

const stripLineAnchor = (path: string): string => path.replace(LINE_ANCHOR, "");

const firstCodeSourcePath = (sources: readonly string[]): string | undefined => {
  for (const raw of sources) {
    const pointer = tryParsePointer(raw);
    if (pointer && pointer.kind === POINTER_KINDS.CODE) return stripLineAnchor(pointer.value);
  }
  return undefined;
};

/**
 * Derive frontmatter `extras` for display:
 *
 * - `title`: human-readable display name (Chinese after translator, English on cold-init).
 * - `aliases`: stable machine id, kept so wikilinks can still resolve when the
 *   `obsidian-front-matter-title` plugin renames the visible label.
 * - `source_path`: relative repo path of the FIRST `code:` pointer; used by
 *   future tooling to map nodes to files in IDEs.
 *
 * Empty or redundant fields are omitted so we never emit `extras: { title: "" }`.
 */
export function deriveDisplayExtras(input: DisplayExtrasInput): DisplayExtras {
  const trimmedTitle = input.title.trim();
  const out: { -readonly [K in keyof DisplayExtras]: DisplayExtras[K] } = {};
  if (trimmedTitle.length > 0) out.title = trimmedTitle;
  if (input.id.length > 0 && input.id !== trimmedTitle) out.aliases = input.id;
  const codePath = firstCodeSourcePath(input.sources);
  if (codePath !== undefined) out.source_path = codePath;
  return out;
}
