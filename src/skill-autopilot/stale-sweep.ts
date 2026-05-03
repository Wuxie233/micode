import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "@/utils/config";

import { discoverSkills } from "./loader";
import { atomicWriteSkill } from "./writer/atomic-write";
import { isStale } from "./writer/source-hashes";

const SKILL_FILE = "SKILL.md";

export interface SweepInput {
  readonly cwd: string;
}

export interface SweepResult {
  readonly deprecated: readonly string[];
}

export async function runStaleSweep(input: SweepInput): Promise<SweepResult> {
  const skillsDir = join(input.cwd, config.skillAutopilot.skillsDir);
  if (!existsSync(skillsDir)) return { deprecated: [] };
  const discovered = await discoverSkills(skillsDir);
  const deprecated: string[] = [];
  for (const skill of discovered) {
    if (skill.frontmatter["x-micode-deprecated"] === true) continue;
    const hashes = skill.frontmatter["x-micode-source-file-hashes"] ?? {};
    if (!(await isStale(hashes))) continue;
    const file = join(skillsDir, skill.dirname, SKILL_FILE);
    const text = readFileSync(file, "utf8");
    if (text.includes("x-micode-deprecated:")) continue;
    const next = text.replace(/^---\n/, `---\nx-micode-deprecated: true\n`);
    await atomicWriteSkill({ targetPath: file, content: next, expectedVersion: skill.frontmatter.version });
    deprecated.push(skill.name);
  }
  return { deprecated };
}
