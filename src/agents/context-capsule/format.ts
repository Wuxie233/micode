import { createHash } from "node:crypto";
import type { ContextCapsuleFrontmatter } from "./types";

const FALLBACK_TOPIC = "context-capsule";
const MAX_SLUG_LENGTH = 80;
const CAPSULE_TOKEN_LENGTH = 16;

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function slugifyCapsuleTopic(topic: string): string {
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, MAX_SLUG_LENGTH);
  return slug.length > 0 ? slug : FALLBACK_TOPIC;
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

function renderStringArray(values: readonly string[]): string {
  if (values.length === 0) return "[]";
  return `\n${[...values]
    .sort()
    .map((value) => `  - ${quoteYaml(value)}`)
    .join("\n")}`;
}

function renderStringRecord(values: Readonly<Record<string, string>>): string {
  const entries = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "{}";
  return `\n${entries.map(([key, value]) => `  ${quoteYaml(key)}: ${quoteYaml(value)}`).join("\n")}`;
}

function renderYamlField(key: string, renderedValue: string): string {
  return `${key}:${renderedValue.startsWith("\n") ? renderedValue : ` ${renderedValue}`}`;
}

function renderNullableString(value: string | null | undefined): string {
  return value == null ? "null" : quoteYaml(value);
}

export function renderCapsuleDocument(frontmatter: ContextCapsuleFrontmatter, body: string): string {
  const normalized: ContextCapsuleFrontmatter = {
    ...frontmatter,
    source_files: [...frontmatter.source_files].sort(),
    source_hashes: Object.fromEntries(
      Object.entries(frontmatter.source_hashes).sort(([left], [right]) => left.localeCompare(right)),
    ),
    conversation_anchor: frontmatter.conversation_anchor ?? null,
    generated_by: frontmatter.generated_by ?? null,
    dispatch_kind: frontmatter.dispatch_kind ?? null,
    parent_capsule: frontmatter.parent_capsule ?? null,
  };

  return [
    "---",
    `lifecycle_issue: ${normalized.lifecycle_issue ?? "null"}`,
    `branch: ${quoteYaml(normalized.branch)}`,
    `head_sha: ${quoteYaml(normalized.head_sha)}`,
    `worktree: ${quoteYaml(normalized.worktree)}`,
    `created_at: ${quoteYaml(normalized.created_at)}`,
    renderYamlField("source_files", renderStringArray(normalized.source_files)),
    renderYamlField("source_hashes", renderStringRecord(normalized.source_hashes)),
    `conversation_anchor: ${renderNullableString(normalized.conversation_anchor)}`,
    `generated_by: ${renderNullableString(normalized.generated_by)}`,
    `dispatch_kind: ${renderNullableString(normalized.dispatch_kind)}`,
    `parent_capsule: ${renderNullableString(normalized.parent_capsule)}`,
    "---",
    "",
    body.trimEnd(),
    "",
  ].join("\n");
}

export function createCapsuleToken(frontmatter: ContextCapsuleFrontmatter): string {
  return hashText(
    JSON.stringify({
      lifecycle_issue: frontmatter.lifecycle_issue,
      branch: frontmatter.branch,
      head_sha: frontmatter.head_sha,
      worktree: frontmatter.worktree,
      source_hashes: Object.fromEntries(
        Object.entries(frontmatter.source_hashes).sort(([a], [b]) => a.localeCompare(b)),
      ),
      conversation_anchor: frontmatter.conversation_anchor ?? null,
      dispatch_kind: frontmatter.dispatch_kind ?? null,
    }),
  ).slice(0, CAPSULE_TOKEN_LENGTH);
}
