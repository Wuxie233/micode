import { existsSync, mkdirSync, renameSync } from "node:fs";
import { dirname, join, relative, sep } from "node:path";

import { createAtlasPaths } from "./paths";

export function archiveNode(projectRoot: string, sourcePath: string): string {
  const paths = createAtlasPaths(projectRoot);
  if (!sourcePath.startsWith(`${paths.root}${sep}`)) {
    throw new Error(`refuse to archive outside vault: ${sourcePath}`);
  }
  if (!existsSync(sourcePath)) throw new Error(`source not found: ${sourcePath}`);
  const rel = relative(paths.root, sourcePath);
  const target = join(paths.archive, rel);
  mkdirSync(dirname(target), { recursive: true });
  renameSync(sourcePath, target);
  return target;
}
