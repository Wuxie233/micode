import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

const SRC_DIR = "src";
const INDEX_FILE = "index.ts";
const COMMENT_PATTERN = /^\s*\/\/\s*(.+)$/;
const UNKNOWN = "(unknown responsibility)";

export interface ModuleEntry {
  readonly name: string;
  readonly pointer: string;
  readonly responsibility: string;
  readonly relativePath: string;
}

const readLeadingComment = (path: string): string => {
  const lines = readFileSync(path, "utf8").split("\n");
  for (const line of lines) {
    if (line.trim().length === 0) continue;
    const match = COMMENT_PATTERN.exec(line);
    if (match !== null) return match[1].trim();
    return UNKNOWN;
  }
  return UNKNOWN;
};

export async function collectModuleEntries(projectRoot: string): Promise<readonly ModuleEntry[]> {
  const root = join(projectRoot, SRC_DIR);
  if (!existsSync(root)) return [];
  const out: ModuleEntry[] = [];
  for (const entry of readdirSync(root)) {
    const dir = join(root, entry);
    if (!statSync(dir).isDirectory()) continue;
    const indexPath = join(dir, INDEX_FILE);
    if (!existsSync(indexPath)) continue;
    out.push({
      name: entry,
      pointer: `code:${SRC_DIR}/${entry}`,
      responsibility: readLeadingComment(indexPath),
      relativePath: `${SRC_DIR}/${entry}`,
    });
  }
  return out;
}
