import { describe, expect, it } from "bun:test";

import { CONTEXT_CAPSULE_PROTOCOL } from "@/agents/context-capsule-protocol";

describe("Context Capsule protocol prompt fragment", () => {
  it("exports the canonical immutable context capsule protocol", () => {
    expect(
      CONTEXT_CAPSULE_PROTOCOL,
    ).toBe(`<context-capsule-protocol priority="critical" description="Immutable hot-path context prefix for subagent prompt cache reuse">
<purpose>
The Context Capsule is an immutable, short-lived hot-path artifact that carries already-read and already-confirmed facts into subagent user prompts. It is not durable knowledge, not Project Memory, not Atlas, not a replacement for context-brief, and not a live subagent session fork.
</purpose>

<injection-contract>
- Inject the capsule into the user prompt TOP, before spawn-meta, before context-brief, before task-specific instructions.
- Never inject capsule content into a system prompt or agent definition.
- The exact <context-capsule>...</context-capsule> block for one fan-out MUST be byte-identical across every parallel worker so provider prompt cache can hit.
- Task-specific deltas stay after the capsule. Existing <context-brief> remains the per-task executor/reviewer contract and must not be replaced by the capsule.
</injection-contract>

<dispatch-trigger>
- Capsule lookup and generation are required on v2 dispatch paths: 派遣前查找+复用、派遣后生成.
- Covered dispatch triggers are parallel-fanout, single-subagent, and executor-direct.
- Before dispatch, call findReusableContextCapsule to locate a fresh capsule that can be reused for the current trigger.
- After dispatch, call buildContextCapsule to create an immutable new capsule file for future workers instead of mutating an existing capsule.
</dispatch-trigger>

<reuse-boundary>
- Tier-1 reuse key is conversation_anchor.
- Tier-2 fallback matching key is (conversation_anchor, branch, worktree).
- The reusable identity anchor is conversation_anchor; fallback matching key is (conversation_anchor, branch, worktree).
- A→B reuse is allowed only for the same lifecycle issue, same branch, and same worktree.
- Freshness preflight checks lifecycle issue, branch, HEAD SHA, worktree, and source file hashes before reuse.
- After an OpenCode restart, degrade safely: if no-conversation-anchor is available, skip reuse and create a fresh capsule after dispatch.
- Freshness result must be surfaced as Capsule status: <none|fresh|partially-stale|discarded|skipped:<reason>|blocked:<reason>>.
</reuse-boundary>

<safety-boundary>
- Secret filtering is mandatory before writing any capsule file.
- Do not write Authorization headers, tokens, private URLs, .env style values, raw logs, or credentials into a capsule.
- Capsule is not durable knowledge: do not promote it to Project Memory, do not write it into Atlas, and do not treat it as a long-term source of truth.
- The worker still must read its own target files before editing or reviewing. Capsule facts are a warm start, not the final evidence source.
- Do not extend resume_subagent, do not fork live sessions, and do not change lifecycle recovery semantics for capsule reuse.
</safety-boundary>
</context-capsule-protocol>`);
  });

  it("contains all required contract concepts", () => {
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("Context Capsule");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("immutable");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("user prompt TOP");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("Never inject capsule content into a system prompt");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("byte-identical");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("cache can hit");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("worker still must read its own target files");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("not durable knowledge");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("Project Memory");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("Atlas");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("context-brief");
  });

  it("contains v2 dispatch trigger and anchor fallback clauses", () => {
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("<dispatch-trigger>");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("派遣前查找+复用、派遣后生成");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("parallel-fanout");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("single-subagent");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("executor-direct");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("findReusableContextCapsule");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("buildContextCapsule");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("immutable new capsule file");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("Tier-1 reuse key");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("Tier-2 fallback matching key");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("conversation_anchor");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("(conversation_anchor, branch, worktree)");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("OpenCode restart");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("no-conversation-anchor");
  });
});
