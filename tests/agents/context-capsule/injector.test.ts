import { describe, expect, it } from "bun:test";
import {
  applyContextCapsulePrefix,
  renderContextCapsulePrefix,
  stripCapsuleFrontmatter,
} from "@/agents/context-capsule/injector";
import type { ContextCapsuleRef } from "@/agents/context-capsule/types";

function capsule(overrides: Partial<ContextCapsuleRef> = {}): ContextCapsuleRef {
  return {
    path: "thoughts/context-capsules/issue-91.md",
    sha: "abc123def456",
    token: "fresh-token-001",
    content: `---
lifecycle_issue: 91
branch: "issue-91-working-context-capsule"
---

## Confirmed Facts

- Batch 1 approved.
`,
    ...overrides,
  };
}

describe("context capsule injector", () => {
  it("strips a leading YAML frontmatter block from capsule content", () => {
    expect(stripCapsuleFrontmatter(capsule().content)).toBe(`## Confirmed Facts

- Batch 1 approved.
`);
  });

  it("leaves content without frontmatter unchanged", () => {
    expect(stripCapsuleFrontmatter("## Body\n\nNo frontmatter.\n")).toBe("## Body\n\nNo frontmatter.\n");
  });

  it("renders the byte-stable context-capsule prefix with body and blank line", () => {
    expect(
      renderContextCapsulePrefix(capsule()),
    ).toBe(`<context-capsule sha="abc123def456" fresh-token="fresh-token-001" path="thoughts/context-capsules/issue-91.md">
## Confirmed Facts

- Batch 1 approved.
</context-capsule>

`);
  });

  it("escapes XML-sensitive attribute values without changing body text", () => {
    const prefix = renderContextCapsulePrefix(
      capsule({ path: `capsules/issue-"91"-&-workers.md`, sha: `sha"&`, token: `tok<&>` }),
    );

    expect(prefix).toStartWith(
      `<context-capsule sha="sha&quot;&amp;" fresh-token="tok&lt;&amp;&gt;" path="capsules/issue-&quot;91&quot;-&amp;-workers.md">`,
    );
  });

  it("injects the capsule at the very top of the user prompt", () => {
    const prompt = `<spawn-meta task-id="2.4" />\n<context-brief>facts</context-brief>\nImplement task.`;

    expect(applyContextCapsulePrefix(prompt, capsule())).toBe(`${renderContextCapsulePrefix(capsule())}${prompt}`);
  });

  it("returns the original prompt when no capsule is available", () => {
    const prompt = "Implement task.";

    expect(applyContextCapsulePrefix(prompt, null)).toBe(prompt);
    expect(applyContextCapsulePrefix(prompt, undefined)).toBe(prompt);
  });
});
