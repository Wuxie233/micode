import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import type { ProjectIdentity } from "@/utils/project-id";
import { isWriteAllowedForDirectory } from "./boundary";
import { byteLength } from "./byte-budget";
import { createAsyncMutex } from "./concurrency/async-mutex";
import { acquireRenameLock, releaseRenameLock } from "./concurrency/rename-lock";
import { type DiscoveredSkill, discoverSkills } from "./loader";
import { extractRawCandidates, type RawCandidate } from "./miner";
import { decidePolicy, type ExistingSkillSummary, type PolicyAction } from "./policy";
import { resolveStrictProjectId } from "./project-id";
import { parseSkillFile } from "./schema";
import { hasRejection, recordRejection, runSecurityPipeline } from "./security/pipeline";
import { dedupeKeyFor } from "./security/secret-gate";
import { slugifySkillName } from "./slugify";
import { readJournalEvents, readLedgerTexts, readLifecycleRecord } from "./sources";
import { atomicWriteSkill } from "./writer/atomic-write";
import { renderIndexMd } from "./writer/index-md";
import { detectTriggerOverlap } from "./writer/overlap";
import { computeSourceHashes } from "./writer/source-hashes";
import { type CurrentSnapshot, decideSovereignty } from "./writer/sovereignty";

const LOG_SCOPE = "skill-autopilot.runner";
const STATE_FILE = ".opencode/skills/.state.json";
const SKILLS_DIR = ".opencode/skills";
const SKILL_FILE = "SKILL.md";
const DESCRIPTION_LIMIT = 240;
const VERSION = 1;
const DEFAULT_HITS = 1;
const BODY_MULTIPLIER = 2;
const JSON_INDENT = 2;
const EMPTY_INDEX_HITS = 0;
const ISO_DATE_END = 10;

const mutex = createAsyncMutex();

interface State {
  readonly hits: Record<string, number>;
  readonly distinctIssues: Record<string, number[]>;
}

interface RenderInput {
  readonly candidate: RawCandidate;
  readonly name: string;
  readonly hashes: Readonly<Record<string, string>>;
  readonly hits: number;
}

interface ProcessInput {
  readonly run: RunInput;
  readonly candidate: RawCandidate;
  readonly state: State;
  readonly existing: readonly ExistingSkillSummary[];
  readonly writesSoFar: number;
}

export interface RunInput {
  readonly cwd: string;
  readonly projectId: string;
  readonly issueNumber: number;
  readonly now: number;
  readonly resolveProjectId?: (cwd: string) => Promise<ProjectIdentity>;
  readonly seedCandidates?: readonly RawCandidate[];
}

export interface WriteRecord {
  readonly skillName: string;
  readonly action: PolicyAction;
  readonly relPath: string;
  readonly reason: string;
}

export interface RunResult {
  readonly skipped: boolean;
  readonly skippedReason?: string;
  readonly writes: readonly WriteRecord[];
  readonly rejected: number;
}

function emptyState(): State {
  return { hits: {}, distinctIssues: {} };
}

function loadState(cwd: string): State {
  const file = join(cwd, STATE_FILE);
  if (!existsSync(file)) return emptyState();

  try {
    return JSON.parse(readFileSync(file, "utf8")) as State;
  } catch {
    // intentional: corrupt state must not block lifecycle commits
    return emptyState();
  }
}

function saveState(cwd: string, state: State): void {
  const file = join(cwd, STATE_FILE);
  mkdirSync(join(cwd, SKILLS_DIR), { recursive: true });
  writeFileSync(file, `${JSON.stringify(state, null, JSON_INDENT)}\n`);
}

function bumpState(state: State, key: string, issue: number): void {
  state.hits[key] = (state.hits[key] ?? 0) + 1;
  const issues = state.distinctIssues[key] ?? [];
  if (!issues.includes(issue)) issues.push(issue);
  state.distinctIssues[key] = issues;
}

function distinctSets(state: State): Record<string, ReadonlySet<number>> {
  const sets: Record<string, ReadonlySet<number>> = {};
  for (const [key, issues] of Object.entries(state.distinctIssues)) sets[key] = new Set(issues);
  return sets;
}

function renderProcedure(candidate: RawCandidate): string {
  return candidate.steps.map((step) => `- ${step}`).join("\n");
}

function renderHashMetadata(hashes: Readonly<Record<string, string>>): string {
  const entries = Object.entries(hashes);
  if (entries.length === 0) return "";
  const lines = entries.map(([path, hash]) => `  ${path}: ${hash}`).join("\n");
  return `x-micode-source-file-hashes:\n${lines}\n`;
}

function renderSkillFile(input: RenderInput): string {
  const procedure = renderProcedure(input.candidate);
  const hashes = renderHashMetadata(input.hashes);
  const sensitivity = config.skillAutopilot.defaultSensitivity;
  return `---
name: ${input.name}
description: ${input.candidate.trigger}
version: ${VERSION}
x-micode-managed: true
x-micode-sensitivity: ${sensitivity}
x-micode-project-origin: ${input.candidate.projectId}
x-micode-hits: ${input.hits}
x-micode-rationale: derived from project evidence (lifecycle ${input.candidate.lifecycleIssueNumber ?? "-"})
${hashes}---
## When to Use
${input.candidate.trigger}

## Procedure
${procedure}

## Pitfalls
- review the surrounding context before applying this procedure verbatim

## Verification
- bun run check passes after applying this procedure
`;
}

async function loadExistingSummaries(skillsDir: string): Promise<readonly ExistingSkillSummary[]> {
  const discovered = await discoverSkills(skillsDir);
  return discovered.map((skill) => ({
    name: skill.name,
    trigger: skill.description,
    dedupeKey: dedupeKeyFor({ trigger: skill.description, steps: [] }),
  }));
}

async function loadCandidates(input: RunInput): Promise<readonly RawCandidate[]> {
  if (input.seedCandidates) return input.seedCandidates;

  const [journalEvents, lifecycleRecord, ledgers] = await Promise.all([
    readJournalEvents({ cwd: input.cwd, issueNumber: input.issueNumber }),
    readLifecycleRecord({ cwd: input.cwd, issueNumber: input.issueNumber }),
    readLedgerTexts({ cwd: input.cwd }),
  ]);
  return extractRawCandidates({
    projectId: input.projectId,
    lifecycleIssueNumber: input.issueNumber,
    lifecycleRecord,
    journalEvents,
    ledgers,
  }).candidates;
}

function recordSkip(rejectionsFile: string, candidate: RawCandidate, reason: string, now: number): null {
  recordRejection(rejectionsFile, { dedupeKey: candidate.dedupeKey, reason, at: now });
  return null;
}

function existingSkillNames(existing: readonly ExistingSkillSummary[]): ReadonlySet<string> {
  return new Set(existing.map((skill) => skill.name));
}

function selectSkillName(
  candidate: RawCandidate,
  existing: readonly ExistingSkillSummary[],
  action: PolicyAction,
): string {
  const current = existing.find((skill) => skill.dedupeKey === candidate.dedupeKey);
  if (action === "patch" && current) return current.name;
  return slugifySkillName({ trigger: candidate.trigger, existing: existingSkillNames(existing) });
}

function readCurrentSnapshot(targetPath: string): CurrentSnapshot | null {
  if (!existsSync(targetPath)) return null;
  try {
    const text = readFileSync(targetPath, "utf8");
    const parsed = parseSkillFile(text);
    if (!parsed.ok) return null;
    return { frontmatter: parsed.value.frontmatter as Record<string, unknown> };
  } catch {
    // intentional: unreadable existing file MUST block writes; signal via empty frontmatter
    // marker so sovereignty rejects "missing x-micode-managed marker" -> safe default.
    return { frontmatter: {} };
  }
}

function runSecurity(name: string, candidate: RawCandidate, content: string): string | null {
  const result = runSecurityPipeline(
    {
      name,
      description: candidate.trigger.slice(0, DESCRIPTION_LIMIT),
      trigger: candidate.trigger,
      steps: candidate.steps,
      // Full rendered SKILL.md content reaches the security pipeline so that
      // injection patterns hidden in trailing frontmatter (e.g. rationale,
      // source-file-hashes) and any future appended sections are scanned.
      body: content,
      frontmatter: { name, description: candidate.trigger, version: VERSION },
    },
    { dirname: name },
  );
  return result.ok ? null : result.reason;
}

async function writeSkill(
  input: ProcessInput,
  name: string,
  content: string,
  action: PolicyAction,
): Promise<WriteRecord | null> {
  const targetDir = join(input.run.cwd, SKILLS_DIR, name);
  const targetPath = join(targetDir, SKILL_FILE);
  const lock = await acquireRenameLock(targetDir);
  if (!lock.ok) return null;

  try {
    const sovereignty = decideSovereignty({
      tombstone: null,
      current: readCurrentSnapshot(targetPath),
      candidateHash: input.candidate.dedupeKey,
    });
    if (!sovereignty.proceed) return null;
    const result = await atomicWriteSkill({ targetPath, content, expectedVersion: null });
    if (!result.ok) return null;
    return { skillName: name, action, relPath: `${SKILLS_DIR}/${name}/${SKILL_FILE}`, reason: `policy:${action}` };
  } finally {
    releaseRenameLock(lock.lockPath);
  }
}

function shouldRejectOverlap(input: ProcessInput, action: PolicyAction): string | null {
  if (action !== "create") return null;
  return detectTriggerOverlap({
    candidateTrigger: input.candidate.trigger,
    existing: input.existing.map((skill) => ({ name: skill.name, trigger: skill.trigger })),
    threshold: config.skillAutopilot.triggerOverlapThreshold,
    supersedes: null,
  });
}

async function processOne(input: ProcessInput): Promise<WriteRecord | null> {
  const rejectionsFile = join(input.run.cwd, config.skillAutopilot.rejectionsJournal);
  if (hasRejection(rejectionsFile, input.candidate.dedupeKey)) return null;

  bumpState(input.state, input.candidate.dedupeKey, input.run.issueNumber);
  const policy = decidePolicy({
    candidate: input.candidate,
    hitsByKey: input.state.hits,
    distinctIssuesByKey: distinctSets(input.state),
    existingSkills: input.existing,
    writesThisLifecycle: input.writesSoFar,
  });
  if (policy.action === "skip") return null;

  const overlap = shouldRejectOverlap(input, policy.action);
  if (overlap) return recordSkip(rejectionsFile, input.candidate, `trigger overlap with ${overlap}`, input.run.now);

  const name = selectSkillName(input.candidate, input.existing, policy.action);
  const hashes = await computeSourceHashes(
    input.candidate.sources.map((source) => join(input.run.cwd, source.pointer)),
  );
  const content = renderSkillFile({
    candidate: input.candidate,
    name,
    hashes,
    hits: input.state.hits[input.candidate.dedupeKey] ?? DEFAULT_HITS,
  });
  const reason = runSecurity(name, input.candidate, content);
  if (reason) return recordSkip(rejectionsFile, input.candidate, reason, input.run.now);
  if (byteLength(content) > config.skillAutopilot.bodyMaxBytes * BODY_MULTIPLIER) {
    return recordSkip(rejectionsFile, input.candidate, "rendered file too large", input.run.now);
  }
  return writeSkill(input, name, content, policy.action);
}

function toIndexEntry(skill: DiscoveredSkill, now: number): Parameters<typeof renderIndexMd>[0][number] {
  return {
    name: skill.name,
    description: skill.description,
    hits: skill.frontmatter["x-micode-hits"] ?? EMPTY_INDEX_HITS,
    lastUpdated: new Date(now).toISOString().slice(0, ISO_DATE_END),
    deprecated: skill.frontmatter["x-micode-deprecated"] === true,
  };
}

async function writeIndex(cwd: string, now: number): Promise<void> {
  const skillsDir = join(cwd, SKILLS_DIR);
  const skills = await discoverSkills(skillsDir);
  const index = renderIndexMd(skills.map((skill) => toIndexEntry(skill, now)));
  writeFileSync(join(cwd, config.skillAutopilot.indexFile), index);
}

async function processCandidate(input: ProcessInput, writes: WriteRecord[]): Promise<boolean> {
  try {
    const write = await processOne(input);
    if (!write) return false;
    writes.push(write);
    return true;
  } catch (error) {
    log.warn(LOG_SCOPE, `processOne failed: ${extractErrorMessage(error)}`);
    return false;
  }
}

async function runInsideMutex(input: RunInput): Promise<RunResult> {
  mkdirSync(join(input.cwd, SKILLS_DIR), { recursive: true });
  const state = loadState(input.cwd);
  const existing = await loadExistingSummaries(join(input.cwd, SKILLS_DIR));
  const candidates = await loadCandidates(input);
  const writes: WriteRecord[] = [];
  let rejected = 0;

  for (const candidate of candidates) {
    const wrote = await processCandidate(
      { run: input, candidate, state, existing, writesSoFar: writes.length },
      writes,
    );
    if (!wrote) rejected += 1;
  }

  saveState(input.cwd, state);
  if (writes.length > 0) await writeIndex(input.cwd, input.now);
  return { skipped: false, writes, rejected };
}

export async function runAutopilot(input: RunInput): Promise<RunResult> {
  const boundary = isWriteAllowedForDirectory(input.cwd);
  if (!boundary.allowed) return { skipped: true, skippedReason: boundary.reason, writes: [], rejected: 0 };

  const identity = await resolveStrictProjectId(input.cwd, { resolveProjectId: input.resolveProjectId });
  if (!identity.ok) return { skipped: true, skippedReason: identity.reason, writes: [], rejected: 0 };

  const run = { ...input, projectId: identity.identity.projectId };
  return mutex.run(identity.identity.projectId, async () => runInsideMutex(run));
}
