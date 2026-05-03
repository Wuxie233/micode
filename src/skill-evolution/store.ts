import { existsSync, mkdirSync, readdirSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import { type Candidate, parseCandidate } from "./candidate-schema";
import { candidateFilePath, candidateRootDir } from "./paths";
import { dedupeKeyFor, type RawCandidateInput, sanitizeCandidateInput } from "./sanitize";

const LOG_SCOPE = "skill-evolution.store";
const TMP_SUFFIX = ".tmp";
const JSON_SUFFIX = ".json";
const SORT_SAME_POSITION = 0;

export interface CandidateStore {
  readonly upsertCandidate: (candidate: Candidate) => Promise<void>;
  readonly loadCandidate: (projectId: string, id: string) => Promise<Candidate | null>;
  readonly listCandidates: (projectId: string) => Promise<readonly Candidate[]>;
  readonly deleteCandidate: (projectId: string, id: string) => Promise<void>;
  readonly purgeExpired: (projectId: string, now: number) => Promise<number>;
  readonly findByDedupeKey: (projectId: string, input: RawCandidateInput) => Promise<Candidate | null>;
}

function ensureDir(dir: string): void {
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
}

function compareCandidates(left: Candidate, right: Candidate): number {
  const timeDelta = left.createdAt - right.createdAt;
  if (timeDelta !== SORT_SAME_POSITION) return timeDelta;
  return left.id.localeCompare(right.id);
}

function validateForWrite(candidate: Candidate): Candidate {
  const sanitized = sanitizeCandidateInput({ trigger: candidate.trigger, steps: candidate.steps });
  if (!sanitized.ok) throw new Error(`candidate rejected: ${sanitized.reason}`);
  const parsed = parseCandidate({ ...candidate, trigger: sanitized.value.trigger, steps: sanitized.value.steps });
  if (parsed.ok) return parsed.candidate;
  throw new Error(`candidate invalid: ${parsed.issues.join("; ")}`);
}

function writeAtomic(path: string, payload: string): void {
  const tmp = `${path}${TMP_SUFFIX}`;
  writeFileSync(tmp, payload);
  renameSync(tmp, path);
}

function readJson(file: string): unknown {
  try {
    return JSON.parse(readFileSync(file, "utf-8"));
  } catch (error) {
    log.warn(LOG_SCOPE, `read/parse failed ${file}: ${extractErrorMessage(error)}`);
    return null;
  }
}

function readCandidateFile(file: string): Candidate | null {
  const raw = readJson(file);
  if (raw === null) return null;
  const result = parseCandidate(raw);
  if (result.ok) return result.candidate;
  log.warn(LOG_SCOPE, `schema invalid ${file}: ${result.issues.join("; ")}`);
  return null;
}

function listFiles(root: string): readonly string[] {
  if (!existsSync(root)) return [];
  try {
    return readdirSync(root).filter((name) => name.endsWith(JSON_SUFFIX));
  } catch (error) {
    log.warn(LOG_SCOPE, `list failed ${root}: ${extractErrorMessage(error)}`);
    return [];
  }
}

async function loadCandidate(projectId: string, id: string, rootDir?: string): Promise<Candidate | null> {
  const file = candidateFilePath(projectId, id, rootDir);
  if (!existsSync(file)) return null;
  return readCandidateFile(file);
}

async function listCandidates(projectId: string, rootDir?: string): Promise<readonly Candidate[]> {
  const root = candidateRootDir(projectId, rootDir);
  const candidates: Candidate[] = [];
  for (const name of listFiles(root)) {
    const candidate = readCandidateFile(join(root, name));
    if (candidate) candidates.push(candidate);
  }
  return candidates.sort(compareCandidates);
}

async function deleteCandidate(projectId: string, id: string, rootDir?: string): Promise<void> {
  const file = candidateFilePath(projectId, id, rootDir);
  if (!existsSync(file)) return;
  try {
    unlinkSync(file);
  } catch (error) {
    log.warn(LOG_SCOPE, `delete failed ${file}: ${extractErrorMessage(error)}`);
  }
}

async function enforceProjectCap(projectId: string, rootDir?: string): Promise<void> {
  const candidates = await listCandidates(projectId, rootDir);
  const excess = candidates.length - config.skillEvolution.maxCandidatesPerProject;
  if (excess <= 0) return;
  const evicted = candidates.slice(0, excess);
  for (const candidate of evicted) await deleteCandidate(projectId, candidate.id, rootDir);
}

async function upsertCandidate(candidate: Candidate, rootDir?: string): Promise<void> {
  const parsed = validateForWrite(candidate);
  const root = candidateRootDir(parsed.projectId, rootDir);
  ensureDir(root);
  const file = candidateFilePath(parsed.projectId, parsed.id, rootDir);
  writeAtomic(file, `${JSON.stringify(parsed, null, 2)}\n`);
  await enforceProjectCap(parsed.projectId, rootDir);
}

async function purgeExpired(projectId: string, now: number, rootDir?: string): Promise<number> {
  const candidates = await listCandidates(projectId, rootDir);
  let purged = 0;
  for (const candidate of candidates) {
    if (candidate.expiresAt > now) continue;
    await deleteCandidate(projectId, candidate.id, rootDir);
    purged += 1;
  }
  return purged;
}

async function findByDedupeKey(
  projectId: string,
  input: RawCandidateInput,
  rootDir?: string,
): Promise<Candidate | null> {
  const target = dedupeKeyFor(input);
  const candidates = await listCandidates(projectId, rootDir);
  for (const candidate of candidates) {
    const key = dedupeKeyFor({ trigger: candidate.trigger, steps: candidate.steps });
    if (key === target) return candidate;
  }
  return null;
}

export function createCandidateStore(rootDir?: string): CandidateStore {
  return {
    upsertCandidate: (candidate) => upsertCandidate(candidate, rootDir),
    loadCandidate: (projectId, id) => loadCandidate(projectId, id, rootDir),
    listCandidates: (projectId) => listCandidates(projectId, rootDir),
    deleteCandidate: (projectId, id) => deleteCandidate(projectId, id, rootDir),
    purgeExpired: (projectId, now) => purgeExpired(projectId, now, rootDir),
    findByDedupeKey: (projectId, input) => findByDedupeKey(projectId, input, rootDir),
  };
}
