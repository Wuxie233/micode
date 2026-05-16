import { readdir, readFile } from "node:fs/promises";
import { join } from "node:path";
import { parse } from "yaml";
import { createCapsuleToken, hashText } from "./format";
import type { ContextCapsuleFrontmatter, ContextCapsuleRef } from "./types";

export const DEFAULT_CONTEXT_CAPSULE_DIRECTORY = "thoughts/shared/context-capsules";

const FRONTMATTER_OPEN = "---\n";
const FRONTMATTER_CLOSE = "\n---";
const FRONTMATTER_CLOSE_WITH_NEWLINE = "\n---\n";

export interface ParsedContextCapsuleDocument {
  readonly frontmatter: ContextCapsuleFrontmatter;
  readonly body: string;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asStringArray(value: unknown): readonly string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string").sort();
}

function asStringRecord(value: unknown): Readonly<Record<string, string>> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  return Object.fromEntries(
    Object.entries(value)
      .filter((entry): entry is [string, string] => typeof entry[1] === "string")
      .sort(([left], [right]) => left.localeCompare(right)),
  );
}

function normalizeLifecycleIssue(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function normalizeFrontmatter(value: unknown): ContextCapsuleFrontmatter {
  const frontmatter = value && typeof value === "object" && !Array.isArray(value) ? value : {};
  const record = frontmatter as Record<string, unknown>;

  return {
    lifecycle_issue: normalizeLifecycleIssue(record.lifecycle_issue),
    branch: asString(record.branch),
    head_sha: asString(record.head_sha),
    worktree: asString(record.worktree),
    created_at: asString(record.created_at),
    source_files: asStringArray(record.source_files),
    source_hashes: asStringRecord(record.source_hashes),
  };
}

export function parseContextCapsuleDocument(document: string): ParsedContextCapsuleDocument {
  if (!document.startsWith(FRONTMATTER_OPEN)) {
    return { frontmatter: normalizeFrontmatter({}), body: document };
  }

  const end = document.indexOf(FRONTMATTER_CLOSE, FRONTMATTER_OPEN.length);
  if (end === -1) {
    return { frontmatter: normalizeFrontmatter({}), body: document };
  }

  const frontmatterText = document.slice(FRONTMATTER_OPEN.length, end);
  let bodyStart = document.startsWith(FRONTMATTER_CLOSE_WITH_NEWLINE, end)
    ? end + FRONTMATTER_CLOSE_WITH_NEWLINE.length
    : end + FRONTMATTER_CLOSE.length;
  if (document.startsWith("\n", bodyStart)) bodyStart += 1;
  return {
    frontmatter: normalizeFrontmatter(parse(frontmatterText)),
    body: document.slice(bodyStart),
  };
}

async function readCapsuleRef(path: string): Promise<(ContextCapsuleRef & { readonly createdAt: number }) | null> {
  const content = await readFile(path, "utf-8");
  const { frontmatter } = parseContextCapsuleDocument(content);
  const createdAt = Date.parse(frontmatter.created_at);
  if (Number.isNaN(createdAt)) return null;

  return {
    path,
    content,
    sha: hashText(content),
    token: createCapsuleToken(frontmatter),
    createdAt,
  };
}

export async function findLatestContextCapsule(
  directory = DEFAULT_CONTEXT_CAPSULE_DIRECTORY,
): Promise<ContextCapsuleRef | null> {
  let entries: string[];
  try {
    entries = await readdir(directory);
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ENOENT") return null;
    throw error;
  }

  const capsules = await Promise.all(
    entries.filter((entry) => entry.endsWith(".md")).map((entry) => readCapsuleRef(join(directory, entry))),
  );
  const latest = capsules
    .filter((capsule): capsule is ContextCapsuleRef & { readonly createdAt: number } => capsule !== null)
    .sort((left, right) => right.createdAt - left.createdAt || left.path.localeCompare(right.path))[0];

  if (!latest) return null;
  const { createdAt: _createdAt, ...ref } = latest;
  return ref;
}
