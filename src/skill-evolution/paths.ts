import { homedir } from "node:os";
import { join } from "node:path";

const CANDIDATE_DIR_NAME = "project-skill-candidates";
const CANDIDATE_FILE_SUFFIX = ".json";
const FORBIDDEN_SEGMENTS = /[\\/]|\.\.|^\s*$/;

function assertSafeSegment(segment: string, label: string): void {
  if (segment.length === 0) throw new Error(`${label} must be non-empty`);
  if (FORBIDDEN_SEGMENTS.test(segment)) throw new Error(`${label} must not contain path separators or '..'`);
}

function root(rootDir?: string): string {
  if (rootDir) return rootDir;
  return join(homedir(), ".config", "opencode", CANDIDATE_DIR_NAME);
}

export function candidateRootDir(projectId: string, rootDir?: string): string {
  assertSafeSegment(projectId, "projectId");
  return join(root(rootDir), projectId);
}

export function candidateFilePath(projectId: string, candidateId: string, rootDir?: string): string {
  assertSafeSegment(candidateId, "candidateId");
  return join(candidateRootDir(projectId, rootDir), `${candidateId}${CANDIDATE_FILE_SUFFIX}`);
}
