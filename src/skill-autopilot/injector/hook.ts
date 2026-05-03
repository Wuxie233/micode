import { byteLength } from "@/skill-autopilot/byte-budget";
import { discoverSkills } from "@/skill-autopilot/loader";
import { config } from "@/utils/config";

const BLOCK_OPEN = "<skill-context>";
const BLOCK_CLOSE = "</skill-context>";

export interface InjectInput {
  readonly cwd: string;
  readonly agent: string;
}

const SENSITIVITY_RANK: Readonly<Record<string, number>> = { public: 0, internal: 1, secret: 2 };

function escapeHtml(s: string): string {
  return s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

function inScope(scope: readonly string[] | undefined, agent: string): boolean {
  const list = scope ?? config.skillAutopilot.defaultAgentScope;
  return list.includes(agent);
}

function withinSensitivity(skillSens: string | undefined): boolean {
  const ceiling = SENSITIVITY_RANK[config.skillAutopilot.injectionSensitivityCeiling] ?? 1;
  const value = SENSITIVITY_RANK[skillSens ?? "internal"] ?? 1;
  return value <= ceiling;
}

export async function buildInjectionBlock(input: InjectInput): Promise<string | null> {
  const dir = `${input.cwd}/${config.skillAutopilot.skillsDir}`;
  const skills = await discoverSkills(dir);
  const matches = skills.filter(
    (s) =>
      withinSensitivity(s.frontmatter["x-micode-sensitivity"] as string | undefined) &&
      inScope(s.frontmatter["x-micode-agent-scope"] as readonly string[] | undefined, input.agent),
  );
  if (matches.length === 0) return null;
  const sorted = [...matches].sort(
    (a, b) => ((b.frontmatter["x-micode-hits"] as number) ?? 0) - ((a.frontmatter["x-micode-hits"] as number) ?? 0),
  );
  const lines: string[] = [];
  let bytes = byteLength(`${BLOCK_OPEN}\n${BLOCK_CLOSE}\n`);
  for (const s of sorted) {
    const line = `- [${escapeHtml(s.name)}] ${escapeHtml(s.description)}`;
    const lineBytes = byteLength(`${line}\n`);
    if (bytes + lineBytes > config.skillAutopilot.injectionCharBudget) break;
    bytes += lineBytes;
    lines.push(line);
  }
  if (lines.length === 0) return null;
  return `\n${BLOCK_OPEN}\n${lines.join("\n")}\n${BLOCK_CLOSE}\n`;
}
