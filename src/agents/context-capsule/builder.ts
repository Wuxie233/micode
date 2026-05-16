import { existsSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCapsuleToken, hashText, renderCapsuleDocument, slugifyCapsuleTopic } from "./format";
import { assertCapsuleSafe } from "./redact";
import type {
  BuildContextCapsuleResult,
  BuiltContextCapsule,
  ContextCapsuleBuildInput,
  ContextCapsuleFrontmatter,
} from "./types";

const DEFAULT_OUTPUT_DIR = join("thoughts", "shared", "context-capsules");
const SOFT_WINDOW_WARNING_THRESHOLD = 1;

function getOutputDir(input: ContextCapsuleBuildInput): string {
  return input.outputDir ?? join(input.worktree, DEFAULT_OUTPUT_DIR);
}

function buildSourceHashes(input: ContextCapsuleBuildInput): Readonly<Record<string, string>> {
  return Object.fromEntries(input.sourceFiles.map((source) => [source.path, hashText(source.content)]));
}

function buildFrontmatter(input: ContextCapsuleBuildInput): ContextCapsuleFrontmatter {
  return {
    lifecycle_issue: input.lifecycleIssue,
    branch: input.branch,
    head_sha: input.headSha,
    worktree: input.worktree,
    created_at: (input.createdAt ?? new Date()).toISOString(),
    source_files: input.sourceFiles.map((source) => source.path).sort(),
    source_hashes: buildSourceHashes(input),
  };
}

function renderBullets(values: readonly string[], emptyText: string): string {
  if (values.length === 0) return `- ${emptyText}`;
  return values.map((value) => `- ${value}`).join("\n");
}

function renderSourceFiles(frontmatter: ContextCapsuleFrontmatter): string {
  if (frontmatter.source_files.length === 0) return "- none";
  return frontmatter.source_files
    .map((path) => `- \`${path}\` — sha256: ${frontmatter.source_hashes[path] ?? "missing"}`)
    .join("\n");
}

function renderCapsuleBody(input: ContextCapsuleBuildInput, frontmatter: ContextCapsuleFrontmatter): string {
  return [
    "## Confirmed Facts",
    "",
    renderBullets(input.confirmedFacts, "none"),
    "",
    "## Source Files",
    "",
    renderSourceFiles(frontmatter),
  ].join("\n");
}

function findUnsafeInput(input: ContextCapsuleBuildInput): { readonly scope: string; readonly reason: string } | null {
  for (const fact of input.confirmedFacts) {
    const result = assertCapsuleSafe(fact);
    if (!result.ok) return { scope: "confirmedFacts", reason: result.match.reason };
  }

  for (const source of input.sourceFiles) {
    const result = assertCapsuleSafe(source.content);
    if (!result.ok) return { scope: `sourceFiles:${source.path}`, reason: result.match.reason };
  }

  return null;
}

function buildWarnings(input: ContextCapsuleBuildInput): readonly string[] {
  if (input.softWindowRatio === undefined || input.softWindowRatio <= SOFT_WINDOW_WARNING_THRESHOLD) return [];
  return [`soft_window_ratio: ${input.softWindowRatio}`];
}

function makeCapsulePath(outputDir: string, input: ContextCapsuleBuildInput, token: string): string {
  const issuePrefix = input.lifecycleIssue === null ? "no-issue" : `issue-${input.lifecycleIssue}`;
  const topicSlug = slugifyCapsuleTopic(input.topic);
  return join(outputDir, `${issuePrefix}-${topicSlug}-${token}.md`);
}

function writeImmutableFile(path: string, document: string): void {
  if (existsSync(path)) return;
  mkdirSync(join(path, ".."), { recursive: true });
  writeFileSync(path, document, "utf8");
}

export function buildContextCapsule(input: ContextCapsuleBuildInput): BuildContextCapsuleResult {
  const unsafeInput = findUnsafeInput(input);
  if (unsafeInput) {
    return {
      status: "blocked",
      reason: "secret_detected",
      detail: `${unsafeInput.scope}: ${unsafeInput.reason}`,
    };
  }

  const frontmatter = buildFrontmatter(input);
  const body = renderCapsuleBody(input, frontmatter);
  const document = renderCapsuleDocument(frontmatter, body);
  const safety = assertCapsuleSafe(document);
  if (!safety.ok) {
    return {
      status: "blocked",
      reason: "secret_detected",
      detail: `document: ${safety.match.reason}`,
    };
  }

  const token = createCapsuleToken(frontmatter);
  const path = makeCapsulePath(getOutputDir(input), input, token);
  writeImmutableFile(path, document);

  const result: BuiltContextCapsule = {
    status: "fresh",
    path,
    sha: hashText(document),
    token,
    frontmatter,
    body,
    document,
    warnings: buildWarnings(input),
  };
  return result;
}
