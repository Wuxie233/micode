import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

import { byteLength, truncateToByteBudget } from "./byte-budget";
import { runSecurityPipeline } from "./security/pipeline";
import { slugifySkillName } from "./slugify";
import { atomicWriteSkill } from "./writer/atomic-write";

const LOG_SCOPE = "skill-autopilot.migration";
const MARKER = ".opencode/skills/.migrated";
const SKILL_FILE = "SKILL.md";
const INITIAL_VERSION = 1;
const SIZE_MULTIPLIER = 2;

export interface MigrationStore {
  readonly listProcedures: (projectId: string) => Promise<readonly ProcedureEntry[]>;
}

export interface ProcedureEntry {
  readonly entryId: string;
  readonly title: string;
  readonly summary: string;
  readonly sources: ReadonlyArray<{ readonly kind: string; readonly pointer: string }>;
}

export interface MigrationInput {
  readonly cwd: string;
  readonly projectId: string;
  readonly now: number;
  readonly store: MigrationStore;
}

export interface MigrationResult {
  readonly skipped: boolean;
  readonly migrated: readonly string[];
  readonly failed: readonly { readonly entryId: string; readonly reason: string }[];
}

type EntryMigrationResult =
  | { readonly ok: true; readonly name: string }
  | { readonly ok: false; readonly entryId: string; readonly reason: string };

function marker(cwd: string): string {
  return join(cwd, MARKER);
}

function renderSources(entry: ProcedureEntry): string {
  return entry.sources.map((source) => `  - {kind: ${source.kind}, pointer: ${source.pointer}}`).join("\n");
}

function buildContent(entry: ProcedureEntry, name: string): string {
  const description = truncateToByteBudget(entry.title, config.skillAutopilot.descriptionMaxBytes);
  return `---
name: ${name}
description: ${description}
version: ${INITIAL_VERSION}
x-micode-managed: true
x-micode-sensitivity: internal
x-micode-imported-from: project-memory:${entry.entryId}
x-micode-sources:
${renderSources(entry)}
---
## When to Use
${description}

## Procedure
- ${entry.summary}

## Pitfalls
- migrated from project memory; review before relying on it

## Verification
- bun run check passes
`;
}

function validateContent(entry: ProcedureEntry, name: string, content: string): string | null {
  if (byteLength(content) > config.skillAutopilot.bodyMaxBytes * SIZE_MULTIPLIER) return "rendered too large";
  const security = runSecurityPipeline(
    {
      name,
      description: entry.title,
      trigger: entry.title,
      steps: [entry.summary],
      body: content.split("---\n").slice(2).join("---\n"),
      frontmatter: { name, description: entry.title, version: INITIAL_VERSION },
    },
    { dirname: name },
  );
  return security.ok ? null : security.reason;
}

async function writeMigratedSkill(skillsRoot: string, entry: ProcedureEntry, name: string): Promise<string | null> {
  const content = buildContent(entry, name);
  const invalid = validateContent(entry, name, content);
  if (invalid !== null) return invalid;
  const written = await atomicWriteSkill({
    targetPath: join(skillsRoot, name, SKILL_FILE),
    content,
    expectedVersion: null,
  });
  return written.ok ? null : written.reason;
}

async function migrateEntry(
  skillsRoot: string,
  entry: ProcedureEntry,
  existing: Set<string>,
): Promise<EntryMigrationResult> {
  if (entry.sources.length === 0) return { ok: false, entryId: entry.entryId, reason: "no sources" };
  const name = slugifySkillName({ trigger: entry.title, existing });
  existing.add(name);
  try {
    const reason = await writeMigratedSkill(skillsRoot, entry, name);
    if (reason === null) return { ok: true, name };
    return { ok: false, entryId: entry.entryId, reason };
  } catch (error) {
    log.warn(LOG_SCOPE, `migration write failed: ${extractErrorMessage(error)}`);
    return { ok: false, entryId: entry.entryId, reason: extractErrorMessage(error) };
  }
}

export async function runMigration(input: MigrationInput): Promise<MigrationResult> {
  if (existsSync(marker(input.cwd))) return { skipped: true, migrated: [], failed: [] };

  const skillsRoot = join(input.cwd, config.skillAutopilot.skillsDir);
  mkdirSync(skillsRoot, { recursive: true });

  const procedures = await input.store.listProcedures(input.projectId);
  const migrated: string[] = [];
  const failed: { entryId: string; reason: string }[] = [];
  const existing = new Set<string>();

  for (const entry of procedures) {
    const result = await migrateEntry(skillsRoot, entry, existing);
    if (result.ok) migrated.push(result.name);
    else failed.push({ entryId: result.entryId, reason: result.reason });
  }

  writeFileSync(marker(input.cwd), JSON.stringify({ at: input.now, migrated, failed }, null, 2));
  return { skipped: false, migrated, failed };
}
