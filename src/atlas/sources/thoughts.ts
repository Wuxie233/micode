import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const THOUGHTS_DIRS = [
  ["thoughts", "shared", "designs"],
  ["thoughts", "shared", "plans"],
] as const;

export interface ThoughtsSource {
  readonly pointer: string;
  readonly relativePath: string;
}

const collectFiles = (dir: string, projectRoot: string, out: ThoughtsSource[]): void => {
  if (!existsSync(dir)) return;
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (!statSync(full).isFile()) continue;
    if (!entry.endsWith(".md")) continue;
    const rel = relative(projectRoot, full);
    out.push({ pointer: `thoughts:${rel.split("thoughts/")[1] ?? rel}`, relativePath: rel });
  }
};

export async function collectThoughtsSources(projectRoot: string): Promise<readonly ThoughtsSource[]> {
  const out: ThoughtsSource[] = [];
  for (const segments of THOUGHTS_DIRS) collectFiles(join(projectRoot, ...segments), projectRoot, out);
  return out;
}
