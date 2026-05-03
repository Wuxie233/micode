import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { byteLength } from "@/skill-autopilot/byte-budget";
import { parseSkillFile, type SkillFile } from "@/skill-autopilot/schema";
import { hasConflictMarkers } from "@/skill-autopilot/security/conflict-marker-gate";
import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

const LOG_SCOPE = "skill-autopilot.loader";
const SKILL_FILE = "SKILL.md";

export interface DiscoveredSkill {
  readonly name: string;
  readonly description: string;
  readonly dirname: string;
  readonly frontmatter: SkillFile["frontmatter"];
}

interface DiscoveryCandidate {
  readonly skill: DiscoveredSkill;
  readonly bytes: number;
}

function readSkillSafe(path: string): SkillFile | null {
  try {
    const text = readFileSync(path, "utf8");
    if (hasConflictMarkers(text)) {
      log.warn(LOG_SCOPE, `conflict markers in ${path}; excluded`);
      return null;
    }
    const parsed = parseSkillFile(text);
    if (!parsed.ok) {
      log.warn(LOG_SCOPE, `parse failed ${path}: ${parsed.reason}`);
      return null;
    }
    return parsed.value;
  } catch (error) {
    log.warn(LOG_SCOPE, `read failed ${path}: ${extractErrorMessage(error)}`);
    return null;
  }
}

function skillFilePath(skillsDir: string, entry: string): string | null {
  const dir = join(skillsDir, entry);
  if (!statSync(dir).isDirectory()) return null;

  const file = join(dir, SKILL_FILE);
  if (!existsSync(file)) return null;

  return file;
}

function toDiscoveryCandidate(dirname: string, parsed: SkillFile): DiscoveryCandidate | null {
  if (parsed.frontmatter["x-micode-deprecated"] === true) return null;

  const bytes = byteLength(parsed.frontmatter.name) + byteLength(parsed.frontmatter.description);
  return {
    bytes,
    skill: {
      name: parsed.frontmatter.name,
      description: parsed.frontmatter.description,
      dirname,
      frontmatter: parsed.frontmatter,
    },
  };
}

function readDiscoveryCandidate(skillsDir: string, entry: string): DiscoveryCandidate | null {
  const file = skillFilePath(skillsDir, entry);
  if (!file) return null;

  const parsed = readSkillSafe(file);
  if (!parsed) return null;

  return toDiscoveryCandidate(entry, parsed);
}

function exceedsIndexBudget(totalBytes: number, candidate: DiscoveryCandidate): boolean {
  return totalBytes + candidate.bytes > config.skillAutopilot.maxIndexBytes;
}

export async function discoverSkills(skillsDir: string): Promise<readonly DiscoveredSkill[]> {
  if (!existsSync(skillsDir)) return [];
  const entries = readdirSync(skillsDir);
  const out: DiscoveredSkill[] = [];
  let totalBytes = 0;
  for (const entry of entries) {
    const candidate = readDiscoveryCandidate(skillsDir, entry);
    if (!candidate) continue;

    if (exceedsIndexBudget(totalBytes, candidate)) {
      log.warn(LOG_SCOPE, `index byte ceiling reached at ${entry}; remaining skills excluded from discovery`);
      break;
    }

    totalBytes += candidate.bytes;
    out.push(candidate.skill);
  }
  return out;
}

export async function activateSkill(skillsDir: string, name: string): Promise<SkillFile | null> {
  const file = join(skillsDir, name, SKILL_FILE);
  if (!existsSync(file)) return null;
  return readSkillSafe(file);
}
