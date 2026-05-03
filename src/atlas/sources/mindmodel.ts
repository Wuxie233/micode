import { existsSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const MINDMODEL_DIR = ".mindmodel";

export interface MindmodelSource {
  readonly pointer: string;
  readonly relativePath: string;
}

const walk = (dir: string, projectRoot: string, out: MindmodelSource[]): void => {
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      walk(full, projectRoot, out);
      continue;
    }
    if (!entry.endsWith(".md")) continue;
    const rel = relative(projectRoot, full);
    const inner = rel.replace(`${MINDMODEL_DIR}/`, "").replace(/\.md$/u, "");
    out.push({ pointer: `mindmodel:${inner}`, relativePath: rel });
  }
};

export async function collectMindmodelSources(projectRoot: string): Promise<readonly MindmodelSource[]> {
  const dir = join(projectRoot, MINDMODEL_DIR);
  if (!existsSync(dir)) return [];
  const out: MindmodelSource[] = [];
  walk(dir, projectRoot, out);
  return out;
}
