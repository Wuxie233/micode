import { parseSkillFile } from "@/skill-autopilot/schema";
import { detectSecret } from "@/utils/secret-detect";

const SKILL_PATH = /^\.opencode\/skills\/[^/]+\/SKILL\.md$/;
const BLOCKED_SENSITIVITIES = new Set(["internal", "secret"]);

export interface PushGuardInput {
  readonly changedPaths: readonly string[];
  readonly readFile: (path: string) => string;
}

export interface PushGuardDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly blockedPaths: readonly string[];
}

function readSkillText(input: PushGuardInput, path: string): string | null {
  try {
    return input.readFile(path);
  } catch {
    // intentional: unreadable file is treated as blocked, fail closed
    return null;
  }
}

function isBlockedSkill(text: string | null): boolean {
  if (text === null) return true;
  if (detectSecret(text)) return true;
  const parsed = parseSkillFile(text);
  if (!parsed.ok) return true;
  const sensitivity = parsed.value.frontmatter["x-micode-sensitivity"] ?? "internal";
  return BLOCKED_SENSITIVITIES.has(sensitivity);
}

export function evaluatePushGuard(input: PushGuardInput): PushGuardDecision {
  const blocked: string[] = [];
  for (const path of input.changedPaths) {
    if (!SKILL_PATH.test(path)) continue;
    if (isBlockedSkill(readSkillText(input, path))) blocked.push(path);
  }
  if (blocked.length === 0) return { allowed: true, blockedPaths: [] };
  return {
    allowed: false,
    reason: `push blocked: ${blocked.length} skill(s) classified internal/secret. Downgrade to public, freeze, or remove before push.`,
    blockedPaths: blocked,
  };
}
