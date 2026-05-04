import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";
import { readPage } from "./page-reader";
import { createAtlasPaths } from "./paths";
import { extractWikilinks, parseWikilink } from "./wikilink";

export interface BrokenLink {
  readonly source: string;
  readonly target: string;
}

const MD_EXTENSION = ".md";
const WIKILINK_PREFIX = "[[";

const collectMarkdown = (dir: string, root: string, out: string[]): void => {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (full.includes("/_meta/")) continue;
    if (full.includes("/_archive/")) continue;
    const stat = statSync(full);
    if (stat.isDirectory()) {
      collectMarkdown(full, root, out);
      continue;
    }
    if (full.endsWith(MD_EXTENSION)) out.push(relative(root, full).replace(/\.md$/, ""));
  }
};

const collectNodeIds = (root: string): readonly string[] => {
  const ids: string[] = [];
  collectMarkdown(root, root, ids);
  return ids;
};

const collectTargets = (linkSource: string): readonly string[] => {
  if (!linkSource.startsWith(WIKILINK_PREFIX)) return extractWikilinks(linkSource);
  const target = parseWikilink(linkSource);
  if (target === null) return [];
  return [target];
};

const createBrokenLinks = (
  source: string,
  linkSources: readonly string[],
  ids: ReadonlySet<string>,
): readonly BrokenLink[] =>
  linkSources
    .flatMap((linkSource) => collectTargets(linkSource))
    .filter((target) => !ids.has(target))
    .map((target) => ({ source, target }));

const scanNodeLinks = async (root: string, id: string, ids: ReadonlySet<string>): Promise<readonly BrokenLink[]> => {
  const node = await readPage(join(root, `${id}.md`));
  if (node === null) return [];
  return createBrokenLinks(id, [...node.connections, node.notes], ids);
};

export async function scanBrokenWikilinks(projectRoot: string): Promise<readonly BrokenLink[]> {
  const paths = createAtlasPaths(projectRoot);
  if (!existsSync(paths.root)) return [];
  const ids = collectNodeIds(paths.root);
  const idSet = new Set(ids);
  const broken: BrokenLink[] = [];
  for (const id of ids) {
    broken.push(...(await scanNodeLinks(paths.root, id, idSet)));
  }
  return broken;
}
