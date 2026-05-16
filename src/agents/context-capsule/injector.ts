import type { ContextCapsuleRef } from "./types";

const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n?/;

function escapeAttribute(value: string): string {
  return value.replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
}

export function stripCapsuleFrontmatter(content: string): string {
  return content.replace(FRONTMATTER_PATTERN, "").trimStart();
}

function capsuleBody(content: string): string {
  return stripCapsuleFrontmatter(content).trimEnd();
}

export function renderContextCapsulePrefix(capsule: ContextCapsuleRef): string {
  return [
    `<context-capsule sha="${escapeAttribute(capsule.sha)}" fresh-token="${escapeAttribute(capsule.token)}" path="${escapeAttribute(capsule.path)}">`,
    capsuleBody(capsule.content),
    "</context-capsule>",
    "",
    "",
  ].join("\n");
}

export function applyContextCapsulePrefix(prompt: string, capsule: ContextCapsuleRef | null | undefined): string {
  if (!capsule) return prompt;
  return `${renderContextCapsulePrefix(capsule)}${prompt}`;
}
