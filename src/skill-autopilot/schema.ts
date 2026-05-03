import * as v from "valibot";

import { config } from "@/utils/config";

interface SkillAutopilotConfig {
  readonly nameMaxChars: number;
  readonly nameRegex: RegExp;
  readonly descriptionMaxBytes: number;
  readonly bodyMaxBytes: number;
}

const SENSITIVITY_VALUES = ["public", "internal", "secret"] as const;
const REQUIRED_SECTIONS = ["When to Use", "Procedure", "Pitfalls", "Verification"] as const;
const FRONTMATTER_DELIM = "---";
const YAML_STRING_ARRAY_FIELDS = ["x-micode-agent-scope"] as const;
const YAML_STRING_RECORD_FIELDS = ["x-micode-source-file-hashes"] as const;
const FALLBACK_SKILL_AUTOPILOT_CONFIG: SkillAutopilotConfig = {
  nameMaxChars: 64,
  nameRegex: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
  descriptionMaxBytes: 1024,
  bodyMaxBytes: 8192,
};

function readSkillAutopilotConfig(): SkillAutopilotConfig {
  const plannedConfig = config as typeof config & { readonly skillAutopilot?: SkillAutopilotConfig };
  return plannedConfig.skillAutopilot ?? FALLBACK_SKILL_AUTOPILOT_CONFIG;
}

const skillAutopilot = readSkillAutopilotConfig();

function byteLength(s: string): number {
  return Buffer.byteLength(s, "utf8");
}

export const SkillFrontmatterSchema = v.pipe(
  v.object({
    name: v.pipe(v.string(), v.maxLength(skillAutopilot.nameMaxChars), v.regex(skillAutopilot.nameRegex)),
    description: v.pipe(
      v.string(),
      v.minLength(1),
      v.check((s) => byteLength(s) <= skillAutopilot.descriptionMaxBytes, "description exceeds byte cap"),
    ),
    version: v.pipe(v.number(), v.integer(), v.minValue(1)),
    scripts: v.optional(v.never("scripts: field is forbidden")),
    "x-micode-managed": v.optional(v.boolean()),
    "x-micode-frozen": v.optional(v.boolean()),
    "x-micode-imported-from": v.optional(v.string()),
    "x-micode-local-overrides": v.optional(v.boolean()),
    "x-micode-project-origin": v.optional(v.string()),
    "x-micode-sensitivity": v.optional(v.picklist(SENSITIVITY_VALUES)),
    "x-micode-agent-scope": v.optional(v.array(v.string())),
    "x-micode-sources": v.optional(v.array(v.object({ kind: v.string(), pointer: v.string() }))),
    "x-micode-rationale": v.optional(v.string()),
    "x-micode-hits": v.optional(v.pipe(v.number(), v.integer(), v.minValue(0))),
    "x-micode-locale": v.optional(v.string()),
    "x-micode-validated-at": v.optional(v.number()),
    "x-micode-source-file-hashes": v.optional(v.record(v.string(), v.string())),
    "x-micode-deprecated": v.optional(v.boolean()),
    "x-micode-supersedes": v.optional(v.string()),
  }),
);

export type SkillFrontmatter = v.InferOutput<typeof SkillFrontmatterSchema>;

export type ParseResult<T> = { readonly ok: true; readonly value: T } | { readonly ok: false; readonly reason: string };

export function parseSkillFrontmatter(raw: unknown): ParseResult<SkillFrontmatter> {
  const r = v.safeParse(SkillFrontmatterSchema, raw);
  if (r.success) return { ok: true, value: r.output };
  return { ok: false, reason: r.issues.map((i) => i.message).join("; ") };
}

export interface SkillFile {
  readonly frontmatter: SkillFrontmatter;
  readonly body: string;
  readonly sections: Readonly<Record<string, string>>;
}

function splitFrontmatter(text: string): { readonly fm: string; readonly body: string } | null {
  if (!text.startsWith(`${FRONTMATTER_DELIM}\n`)) return null;
  const end = text.indexOf(`\n${FRONTMATTER_DELIM}`, FRONTMATTER_DELIM.length + 1);
  if (end === -1) return null;
  const fm = text.slice(FRONTMATTER_DELIM.length + 1, end);
  const body = text.slice(end + FRONTMATTER_DELIM.length + 1).replace(/^\n/, "");
  return { fm, body };
}

function parseYamlScalar(line: string): [string, unknown] | null {
  const m = /^([\w-]+):\s*(.*)$/.exec(line);
  if (!m) return null;
  const key = m[1];
  const raw = m[2].trim();
  if (raw === "true") return [key, true];
  if (raw === "false") return [key, false];
  if (/^-?\d+$/.test(raw)) return [key, Number(raw)];
  return [key, raw.replace(/^["']|["']$/g, "")];
}

function parseYamlListItem(line: string): string | null {
  const m = /^\s+-\s*(.*)$/.exec(line);
  if (!m) return null;
  return m[1].trim().replace(/^["']|["']$/g, "");
}

function isYamlStringArrayField(key: string): boolean {
  return YAML_STRING_ARRAY_FIELDS.includes(key as (typeof YAML_STRING_ARRAY_FIELDS)[number]);
}

function parseYamlRecordItem(line: string): readonly [string, string] | null {
  const m = /^\s+(.+?):\s*(.*)$/.exec(line);
  if (!m) return null;
  return [m[1].trim(), m[2].trim().replace(/^["']|["']$/g, "")];
}

function isYamlStringRecordField(key: string): boolean {
  return YAML_STRING_RECORD_FIELDS.includes(key as (typeof YAML_STRING_RECORD_FIELDS)[number]);
}

function isYamlStringRecord(value: unknown): value is Record<string, string> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function appendYamlListItem(obj: Record<string, unknown>, key: string, item: string): void {
  const values = obj[key];
  if (!Array.isArray(values)) return;
  values.push(item);
}

function appendYamlRecordItem(obj: Record<string, unknown>, key: string, item: readonly [string, string]): void {
  const values = obj[key];
  if (!isYamlStringRecord(values)) return;
  values[item[0]] = item[1];
}

interface YamlParseState {
  readonly obj: Record<string, unknown>;
  arrayKey: string | null;
  recordKey: string | null;
}

function consumeYamlCollectionItem(state: YamlParseState, line: string): boolean {
  const item = parseYamlListItem(line);
  if (state.arrayKey && item !== null) {
    appendYamlListItem(state.obj, state.arrayKey, item);
    return true;
  }

  const recordItem = parseYamlRecordItem(line);
  if (state.recordKey && recordItem !== null) {
    appendYamlRecordItem(state.obj, state.recordKey, recordItem);
    return true;
  }

  return false;
}

function startYamlCollection(state: YamlParseState, key: string, value: unknown): boolean {
  if (value === "" && isYamlStringArrayField(key)) {
    state.arrayKey = key;
    state.obj[key] = [];
    return true;
  }

  if (value === "" && isYamlStringRecordField(key)) {
    state.recordKey = key;
    state.obj[key] = {};
    return true;
  }

  return false;
}

function parseFrontmatterLine(state: YamlParseState, line: string): void {
  if (!line.trim() || line.trim().startsWith("#")) return;
  if (consumeYamlCollectionItem(state, line)) return;
  state.arrayKey = null;
  state.recordKey = null;

  const pair = parseYamlScalar(line);
  if (!pair) return;
  const [key, value] = pair;
  if (startYamlCollection(state, key, value)) return;
  state.obj[key] = value;
}

function parseFrontmatterText(fm: string): unknown {
  const state: YamlParseState = { obj: {}, arrayKey: null, recordKey: null };
  for (const line of fm.split(/\r?\n/)) {
    parseFrontmatterLine(state, line);
  }
  return state.obj;
}

function extractSections(body: string): Readonly<Record<string, string>> {
  const out: Record<string, string> = {};
  const re = /^##\s+(.+)$/gm;
  const heads: { name: string; index: number }[] = [];
  let match = re.exec(body);
  while (match !== null) {
    heads.push({ name: match[1].trim(), index: match.index });
    match = re.exec(body);
  }
  for (let i = 0; i < heads.length; i += 1) {
    const head = heads[i];
    if (!head) continue;
    const next = heads[i + 1];
    const start = head.index + `## ${head.name}`.length;
    const end = next ? next.index : body.length;
    out[head.name] = body.slice(start, end).trim();
  }
  return out;
}

export function parseSkillFile(text: string): ParseResult<SkillFile> {
  const split = splitFrontmatter(text);
  if (!split) return { ok: false, reason: "missing frontmatter" };
  const raw = parseFrontmatterText(split.fm);
  const fm = parseSkillFrontmatter(raw);
  if (!fm.ok) return fm;
  const sections = extractSections(split.body);
  for (const required of REQUIRED_SECTIONS) {
    if (!(required in sections)) return { ok: false, reason: `missing section: ${required}` };
  }
  if (byteLength(split.body) > skillAutopilot.bodyMaxBytes) {
    return { ok: false, reason: "body exceeds byte cap" };
  }
  return { ok: true, value: { frontmatter: fm.value, body: split.body, sections } };
}
