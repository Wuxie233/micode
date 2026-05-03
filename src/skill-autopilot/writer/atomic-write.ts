import { existsSync, mkdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";

import { parseSkillFile } from "@/skill-autopilot/schema";

const TMP_SUFFIX = ".tmp";
const VERSION_LINE = /^version:\s*(\d+)\s*$/m;

export interface AtomicWriteInput {
  readonly targetPath: string;
  readonly content: string;
  readonly expectedVersion: number | null;
}

export type AtomicWriteResult = { readonly ok: true } | { readonly ok: false; readonly reason: string };

function parseVersionLine(text: string): number | null {
  const match = VERSION_LINE.exec(text);
  if (!match) return null;
  const version = Number(match[1]);
  if (!Number.isInteger(version)) return null;
  return version;
}

function readCurrentVersion(targetPath: string): number | null {
  if (!existsSync(targetPath)) return null;
  const text = readFileSync(targetPath, "utf8");
  const parsed = parseSkillFile(text);
  if (parsed.ok) return parsed.value.frontmatter.version;
  return parseVersionLine(text);
}

export async function atomicWriteSkill(input: AtomicWriteInput): Promise<AtomicWriteResult> {
  const onDisk = readCurrentVersion(input.targetPath);
  if (onDisk !== null && onDisk !== input.expectedVersion) {
    return { ok: false, reason: `concurrent_edit_skipped (expected v${input.expectedVersion}, on-disk v${onDisk})` };
  }
  mkdirSync(dirname(input.targetPath), { recursive: true });
  const tmp = `${input.targetPath}${TMP_SUFFIX}`;
  writeFileSync(tmp, input.content);
  try {
    renameSync(tmp, input.targetPath);
  } catch (error) {
    try {
      unlinkSync(tmp);
    } catch {
      // intentional: best-effort cleanup
    }
    throw error;
  }
  return { ok: true };
}
