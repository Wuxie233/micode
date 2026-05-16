---
date: 2026-05-17
topic: "working-context-capsule"
issue: 91
scope: agents
contract: none
---

# Working Context Capsule Implementation Plan

**Goal:** Build an immutable, byte-identical Context Capsule user-prompt prefix for parallel subagents and same-lifecycle A→B reuse without changing system prompts, `resume_subagent`, planner contracts, reviewer policy, Atlas, or Project Memory boundaries.

**Architecture:** Implement a small `src/agents/context-capsule/` runtime module for deterministic capsule input, secret blocking, frontmatter/hash generation, disk storage, and freshness preflight. Extend `spawn_agent` prompt assembly with an optional `contextCapsule` task field that writes/reuses the capsule once per fan-out and prefixes every worker user prompt with exactly the same bytes before existing per-task prompt content. Agent prompt changes use one shared `CONTEXT_CAPSULE_PROTOCOL` source so brainstormer / commander / executor stay drift-guarded while `context-brief` remains the task-specific delta after the capsule.

**Design:** `thoughts/shared/designs/2026-05-17-working-context-capsule-design.md`

**Contract:** none

**按默认决定:** design 要求 no hard size limit 但 Error Handling 又提到 context-window awareness。实现默认采用 `softWindowRatio: 0.3` 只返回 warning，不阻断写入；理由是最不破坏用户确认的“无硬上限”，且可回滚为更严格策略。

---

## 行为承诺映射

design.md `## Behavior` / `## 承诺清单 / Commitments` 段列出 17 条行为承诺：

- 不做 live subagent session fork / 不扩展 `resume_subagent` → Batch 3 Task 3.2 只增强 `spawn_agent` prompt assembly；Batch 4 Task 4.7 测试 `resume_subagent` 路径无 capsule 参数和语义变化。
- 不动 system prompt / capsule 注入 user prompt 顶部 → Batch 3 Task 3.2 在 `buildPromptBody` 前缀化 `task.prompt`；Batch 4 Task 4.2 用 5 worker 集成测试验证 prompt `startsWith("<context-capsule")`。
- byte-identical capsule 出现在每个并行 worker 的 user prompt 顶部 → Batch 2 Task 2.4 的 injector helper 保证同一 `renderedPrefix` 复用；Batch 4 Task 4.2 验证 5 scout prompt capsule 段字节一致。
- A→B 复用仅在同 lifecycle issue + same branch + same worktree 内生效 → Batch 2 Task 2.2 `freshness.ts` 与 Batch 2 Task 2.3 `store.ts` 实现边界；Batch 4 Task 4.3 覆盖 fresh / partially-stale / discarded 三档。
- Freshness 失效不静默丢弃，终态可见复用状态 → Batch 2 Task 2.2 返回结构化状态；Batch 3 Task 3.3 在知识上下文单源增加 `Capsule status:`；Batch 4 Task 4.4 做 drift guard。
- worker 仍必须读取自己的目标文件 → Batch 1 Task 1.5 `CONTEXT_CAPSULE_PROTOCOL` 明确 capsule 是共享已确认事实、不能替代 worker target-file read；Batch 4 Task 4.1 drift guard 检查该关键句。
- 不破坏 context-brief / planner contract / reviewer policy / Atlas / PM → Batch 3 Task 3.6 只在 executor prompt 中规定 capsule 在 `<context-brief>` 前且 brief 保持 per-task delta；Batch 4 Task 4.5/4.6 回归 existing leaf/context-brief and knowledge-boundary tests。
- secrets / raw logs / 凭据不得写入 capsule → Batch 1 Task 1.3 `redact.ts` 复用 `detectSecret` 并新增 Authorization/private URL/env 规则；Batch 2 Task 2.1 builder 遇 secret 返回 `blocked:secret` 不写盘；Batch 4 Task 4.3 覆盖 blocked。
- 首版至少覆盖 Lens Swarm + executor batch + A→B → Batch 3 Task 3.4/3.5/3.6 primary prompts；Batch 3 Task 3.7/3.8 mm/atlas coordinator forwarding；Batch 4 Task 4.2/4.3 集成测试。
- capsule 文件可在 `thoughts/shared/context-capsules/` 看到、git diff、人工 review → Batch 2 Task 2.1 builder 写入 frontmatter + body；Batch 2 Task 2.3 store 负责路径与 latest lookup。
- 切 branch / worktree / lifecycle 后自动失效 → Batch 2 Task 2.2 freshness policy；Batch 4 Task 4.3 integration 覆盖 branch/worktree/issue mismatch discarded。
- 不改变 lifecycle 失败恢复路径 → Batch 3 Task 3.2 不改 classifier / preserved registry / resume registry；Batch 4 Task 4.7 保持 allSettled/resume 回归。

**未对应任何 task 的行为**：无。

---

## Review Policy

- **Reviewer mandatory:** all tasks. Reasons: workflow-sensitive runtime prompt injection, `src/agents/**` prompt contracts, `src/tools/spawn-agent/**` runtime dispatch, secret filtering, cache/freshness behavior, context-brief preservation, and Behavior / Commitments coverage.
- **Reviewer-skip eligible:** none. This feature has cache/retry/freshness/security/prompt-contract risk; no task meets the low-risk whitelist.
- **Risk observations:** cache hit depends on byte-identical prefix (Tasks 2.4, 3.2, 4.2); stale capsule must not cross issue/branch/worktree (Tasks 2.2, 2.3, 4.3); capsule must not become durable knowledge or replace worker file reads (Tasks 1.5, 3.6, 4.1, 4.5).

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2, 1.3, 1.4, 1.5 [foundation - no deps]
Batch 2 (parallel): 2.1, 2.2, 2.3, 2.4 [core modules - depend on batch 1]
Batch 3 (parallel): 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8 [runtime and prompt wiring - depend on batch 2 where imported]
Batch 4 (parallel): 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7 [integration and drift guards - depend on batch 3]
```

---

## Batch 1: Foundation (parallel - 5 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4, 1.5

### Task 1.1: Context Capsule Shared Types
**File:** `src/agents/context-capsule/types.ts`
**Test:** `tests/agents/context-capsule/types.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Defines the immutable metadata/status contract used to report fresh / partially-stale / discarded / skipped / blocked states.
**Review policy:** mandatory — shared runtime contract and status enum.

```typescript
import { describe, expect, it } from "bun:test";
import {
  CAPSULE_STATUSES,
  type CapsuleFreshnessStatus,
  type ContextCapsuleFrontmatter,
  isCapsuleStatus,
} from "@/agents/context-capsule/types";

describe("context capsule types", () => {
  it("enumerates all user-visible capsule statuses", () => {
    expect(CAPSULE_STATUSES).toEqual(["none", "fresh", "partially-stale", "discarded", "skipped", "blocked"]);
    expect(isCapsuleStatus("fresh")).toBe(true);
    expect(isCapsuleStatus("partially-stale")).toBe(true);
    expect(isCapsuleStatus("blocked:secret")).toBe(false);
    expect(isCapsuleStatus("unknown")).toBe(false);
  });

  it("allows the required frontmatter shape", () => {
    const frontmatter: ContextCapsuleFrontmatter = {
      lifecycle_issue: 91,
      branch: "issue-91-working-context-capsule",
      head_sha: "abc123",
      worktree: "/root/CODE/issue-91-working-context-capsule",
      created_at: "2026-05-17T00:00:00.000Z",
      source_files: ["src/agents/executor.ts"],
      source_hashes: { "src/agents/executor.ts": "hash" },
    };

    expect(frontmatter.lifecycle_issue).toBe(91);
    const status: CapsuleFreshnessStatus = "fresh";
    expect(status).toBe("fresh");
  });
});
```

```typescript
export const CAPSULE_STATUSES = ["none", "fresh", "partially-stale", "discarded", "skipped", "blocked"] as const;

export type CapsuleStatus = (typeof CAPSULE_STATUSES)[number];
export type CapsuleFreshnessStatus = "fresh" | "partially-stale" | "discarded";

export interface ContextCapsuleFrontmatter {
  readonly lifecycle_issue: number | null;
  readonly branch: string;
  readonly head_sha: string;
  readonly worktree: string;
  readonly created_at: string;
  readonly source_files: readonly string[];
  readonly source_hashes: Readonly<Record<string, string>>;
}

export interface ContextCapsuleSource {
  readonly path: string;
  readonly content: string;
}

export interface ContextCapsuleBuildInput {
  readonly topic: string;
  readonly lifecycleIssue: number | null;
  readonly branch: string;
  readonly headSha: string;
  readonly worktree: string;
  readonly sourceFiles: readonly ContextCapsuleSource[];
  readonly confirmedFacts: readonly string[];
  readonly createdAt?: Date;
  readonly outputDir?: string;
  readonly softWindowRatio?: number;
}

export interface BuiltContextCapsule {
  readonly status: "fresh";
  readonly path: string;
  readonly sha: string;
  readonly token: string;
  readonly frontmatter: ContextCapsuleFrontmatter;
  readonly body: string;
  readonly document: string;
  readonly warnings: readonly string[];
}

export interface BlockedContextCapsule {
  readonly status: "blocked";
  readonly reason: string;
  readonly detail?: string;
}

export type BuildContextCapsuleResult = BuiltContextCapsule | BlockedContextCapsule;

export interface ContextCapsuleRef {
  readonly path: string;
  readonly sha: string;
  readonly token: string;
  readonly content: string;
}

export interface ContextCapsuleFreshnessInput {
  readonly expectedLifecycleIssue: number | null;
  readonly branch: string;
  readonly headSha: string;
  readonly worktree: string;
  readonly sourceHashes: Readonly<Record<string, string>>;
  readonly frontmatter: ContextCapsuleFrontmatter;
}

export interface ContextCapsuleFreshnessResult {
  readonly status: CapsuleFreshnessStatus;
  readonly reasons: readonly string[];
  readonly staleSourceFiles: readonly string[];
}

export function isCapsuleStatus(value: string): value is CapsuleStatus {
  return (CAPSULE_STATUSES as readonly string[]).includes(value);
}
```

**Verify:** `bun test tests/agents/context-capsule/types.test.ts`
**Commit:** `feat(agents): add context capsule shared types`

### Task 1.2: Context Capsule Hashing and Formatting Helpers
**File:** `src/agents/context-capsule/format.ts`
**Test:** `tests/agents/context-capsule/format.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Makes capsule markdown deterministic so parallel worker prefixes can be byte-identical.
**Review policy:** mandatory — byte-identical cache hit depends on deterministic formatting.

```typescript
import { describe, expect, it } from "bun:test";
import { createCapsuleToken, hashText, renderCapsuleDocument, slugifyCapsuleTopic } from "@/agents/context-capsule/format";
import type { ContextCapsuleFrontmatter } from "@/agents/context-capsule/types";

const frontmatter: ContextCapsuleFrontmatter = {
  lifecycle_issue: 91,
  branch: "issue-91-working-context-capsule",
  head_sha: "abc123",
  worktree: "/root/CODE/issue-91",
  created_at: "2026-05-17T00:00:00.000Z",
  source_files: ["b.ts", "a.ts"],
  source_hashes: { "b.ts": "hash-b", "a.ts": "hash-a" },
};

describe("context capsule format", () => {
  it("slugifies topics for stable file names", () => {
    expect(slugifyCapsuleTopic("Working Context Capsule for Subagent Prompt Cache Reuse")).toBe(
      "working-context-capsule-for-subagent-prompt-cache-reuse",
    );
    expect(slugifyCapsuleTopic("---")).toBe("context-capsule");
  });

  it("hashes text with sha256", () => {
    expect(hashText("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
  });

  it("renders deterministic frontmatter and body", () => {
    const first = renderCapsuleDocument(frontmatter, "body");
    const second = renderCapsuleDocument(frontmatter, "body");
    expect(first).toBe(second);
    expect(first).toContain("source_files:\n  - a.ts\n  - b.ts");
    expect(first).toContain("source_hashes:\n  a.ts: hash-a\n  b.ts: hash-b");
    expect(first.endsWith("body\n")).toBe(true);
  });

  it("creates stable freshness tokens", () => {
    expect(createCapsuleToken(frontmatter)).toBe(createCapsuleToken(frontmatter));
  });
});
```

```typescript
import { createHash } from "node:crypto";
import type { ContextCapsuleFrontmatter } from "./types";

const FALLBACK_TOPIC = "context-capsule";

export function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function slugifyCapsuleTopic(topic: string): string {
  const slug = topic
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug.length > 0 ? slug : FALLBACK_TOPIC;
}

function quoteYaml(value: string): string {
  return JSON.stringify(value);
}

function renderStringArray(values: readonly string[]): string {
  if (values.length === 0) return "[]";
  return `\n${[...values].sort().map((value) => `  - ${quoteYaml(value)}`).join("\n")}`;
}

function renderStringRecord(values: Readonly<Record<string, string>>): string {
  const entries = Object.entries(values).sort(([left], [right]) => left.localeCompare(right));
  if (entries.length === 0) return "{}";
  return `\n${entries.map(([key, value]) => `  ${quoteYaml(key)}: ${quoteYaml(value)}`).join("\n")}`;
}

export function renderCapsuleDocument(frontmatter: ContextCapsuleFrontmatter, body: string): string {
  const normalized: ContextCapsuleFrontmatter = {
    ...frontmatter,
    source_files: [...frontmatter.source_files].sort(),
    source_hashes: Object.fromEntries(Object.entries(frontmatter.source_hashes).sort(([left], [right]) => left.localeCompare(right))),
  };

  return [
    "---",
    `lifecycle_issue: ${normalized.lifecycle_issue ?? "null"}`,
    `branch: ${quoteYaml(normalized.branch)}`,
    `head_sha: ${quoteYaml(normalized.head_sha)}`,
    `worktree: ${quoteYaml(normalized.worktree)}`,
    `created_at: ${quoteYaml(normalized.created_at)}`,
    `source_files:${renderStringArray(normalized.source_files)}`,
    `source_hashes:${renderStringRecord(normalized.source_hashes)}`,
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
      source_hashes: Object.fromEntries(Object.entries(frontmatter.source_hashes).sort(([a], [b]) => a.localeCompare(b))),
    }),
  ).slice(0, 16);
}
```

**Verify:** `bun test tests/agents/context-capsule/format.test.ts`
**Commit:** `feat(agents): add context capsule formatting helpers`

### Task 1.3: Context Capsule Secret Redaction Gate
**File:** `src/agents/context-capsule/redact.ts`
**Test:** `tests/agents/context-capsule/redact.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Blocks token, Authorization, private URL, raw logs, and `.env` style content before capsule write.
**Review policy:** mandatory — secrets/safety/security surface.

```typescript
import { describe, expect, it } from "bun:test";
import { assertCapsuleSafe, findCapsuleSecret } from "@/agents/context-capsule/redact";

describe("context capsule redact gate", () => {
  it("allows clean capsule text", () => {
    expect(findCapsuleSecret("- Read src/agents/executor.ts and confirmed context-brief remains per-task.")).toBeNull();
    expect(assertCapsuleSafe("clean")).toEqual({ ok: true });
  });

  it("blocks Authorization headers", () => {
    expect(findCapsuleSecret("Authorization: Bearer abc")?.reason).toBe("authorization_header");
  });

  it("blocks .env style assignments", () => {
    expect(findCapsuleSecret("OPENAI_API_KEY=sk-proj-abcdefghijklmnopqrstuvwxyz")?.reason).toBe("env_secret_assignment");
  });

  it("blocks private URLs with embedded credentials", () => {
    expect(findCapsuleSecret("https://user:password@example.com/private")?.reason).toBe("credential_url");
  });

  it("blocks raw log dumps", () => {
    expect(findCapsuleSecret("BEGIN RAW LOG\nAuthorization: Bearer abc\nEND RAW LOG")?.reason).toBe("raw_log_dump");
  });

  it("reuses generic secret detection", () => {
    expect(findCapsuleSecret('token: "abcdefghijklmnopqrstuvwxyz012345"')?.reason).toBe("generic_secret");
  });
});
```

```typescript
import { detectSecret, type SecretMatch } from "@/utils/secret-detect";

export interface CapsuleSecretMatch extends SecretMatch {
  readonly reason: string;
}

export type CapsuleSafetyResult = { readonly ok: true } | { readonly ok: false; readonly match: CapsuleSecretMatch };

const EXTRA_PATTERNS: ReadonlyArray<{ readonly reason: string; readonly regex: RegExp }> = [
  { reason: "authorization_header", regex: /^\s*Authorization\s*:\s*\S+/im },
  { reason: "env_secret_assignment", regex: /^\s*[A-Z0-9_]*(?:API_KEY|TOKEN|SECRET|PASSWORD|PRIVATE_URL)[A-Z0-9_]*\s*=\s*\S+/im },
  { reason: "credential_url", regex: /https?:\/\/[^\s/@:]+:[^\s/@]+@[^\s]+/i },
  { reason: "raw_log_dump", regex: /BEGIN RAW LOG|END RAW LOG|^\[[0-9:. -]+\]\s+(?:DEBUG|TRACE|ERROR)/im },
];

export function findCapsuleSecret(text: string): CapsuleSecretMatch | null {
  for (const { reason, regex } of EXTRA_PATTERNS) {
    const match = regex.exec(text);
    if (match) return { reason, index: match.index };
  }
  const generic = detectSecret(text);
  return generic ? { reason: generic.reason, index: generic.index } : null;
}

export function assertCapsuleSafe(text: string): CapsuleSafetyResult {
  const match = findCapsuleSecret(text);
  return match ? { ok: false, match } : { ok: true };
}
```

**Verify:** `bun test tests/agents/context-capsule/redact.test.ts`
**Commit:** `feat(agents): block secrets in context capsules`

### Task 1.4: Context Capsule Module Index
**File:** `src/agents/context-capsule/index.ts`
**Test:** `tests/agents/context-capsule/index.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Provides one import surface for builder, freshness, store, injector, and prompt protocol without coupling callers to internal files.
**Review policy:** mandatory — runtime module export contract.

```typescript
import { describe, expect, it } from "bun:test";
import * as capsule from "@/agents/context-capsule";

describe("context capsule module index", () => {
  it("exports the stable public API surface", () => {
    expect(typeof capsule.CAPSULE_STATUSES).toBe("object");
    expect(typeof capsule.slugifyCapsuleTopic).toBe("function");
    expect(typeof capsule.assertCapsuleSafe).toBe("function");
  });
});
```

```typescript
export * from "./types";
export * from "./format";
export * from "./redact";
```

**Verify:** `bun test tests/agents/context-capsule/index.test.ts`
**Commit:** `feat(agents): expose context capsule module API`

### Task 1.5: Context Capsule Prompt Protocol Source
**File:** `src/agents/context-capsule-protocol.ts`
**Test:** `tests/agents/context-capsule-protocol.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** layer-update
**Behavior-impact:** Establishes the single source prompt block requiring user-prompt top injection, byte identity, worker target-file reads, and Atlas/PM boundary preservation.
**Review policy:** mandatory — agent prompt contract and Behavior / Commitments surface.

```typescript
import { describe, expect, it } from "bun:test";
import { CONTEXT_CAPSULE_PROTOCOL } from "@/agents/context-capsule-protocol";

describe("CONTEXT_CAPSULE_PROTOCOL", () => {
  it("defines immutable user-prompt top injection", () => {
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("immutable Context Capsule");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("user prompt TOP");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("never system prompt");
  });

  it("requires byte-identical parallel worker prefixes", () => {
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("byte-identical");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("cache hit");
  });

  it("preserves worker verification and knowledge boundaries", () => {
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("worker still must read its own target files");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("not durable knowledge");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("Project Memory");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("Atlas");
    expect(CONTEXT_CAPSULE_PROTOCOL).toContain("context-brief");
  });
});
```

```typescript
export const CONTEXT_CAPSULE_PROTOCOL = `<context-capsule-protocol priority="critical" description="Immutable hot-path context prefix for subagent prompt cache reuse">
<purpose>
The Context Capsule is an immutable, short-lived hot-path artifact that carries already-read and already-confirmed facts into subagent user prompts. It is not durable knowledge, not Project Memory, not Atlas, not a replacement for context-brief, and not a live subagent session fork.
</purpose>

<injection-contract>
- Inject the capsule into the user prompt TOP, before spawn-meta, before context-brief, before task-specific instructions.
- Never inject capsule content into a system prompt or agent definition.
- The exact <context-capsule>...</context-capsule> block for one fan-out MUST be byte-identical across every parallel worker so provider prompt cache can hit.
- Task-specific deltas stay after the capsule. Existing <context-brief> remains the per-task executor/reviewer contract and must not be replaced by the capsule.
</injection-contract>

<reuse-boundary>
- A→B reuse is allowed only for the same lifecycle issue, same branch, and same worktree.
- Freshness preflight checks lifecycle issue, branch, HEAD SHA, worktree, and source file hashes before reuse.
- Freshness result must be surfaced as Capsule status: <none|fresh|partially-stale|discarded|skipped:<reason>|blocked:<reason>>.
</reuse-boundary>

<safety-boundary>
- Secret filtering is mandatory before writing any capsule file.
- Do not write Authorization headers, tokens, private URLs, .env style values, raw logs, or credentials into a capsule.
- Capsule is not durable knowledge: do not promote it to Project Memory, do not write it into Atlas, and do not treat it as a long-term source of truth.
- The worker still must read its own target files before editing or reviewing. Capsule facts are a warm start, not the final evidence source.
- Do not extend resume_subagent, do not fork live sessions, and do not change lifecycle recovery semantics for capsule reuse.
</safety-boundary>
</context-capsule-protocol>`;
```

**Verify:** `bun test tests/agents/context-capsule-protocol.test.ts`
**Commit:** `feat(agents): add context capsule prompt protocol`

---

## Batch 2: Core Modules (parallel - 4 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2, 2.3, 2.4

### Task 2.1: Context Capsule Builder
**File:** `src/agents/context-capsule/builder.ts`
**Test:** `tests/agents/context-capsule/builder.test.ts`
**Depends:** 1.1, 1.2, 1.3
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Writes immutable capsule files under `thoughts/shared/context-capsules/` with required frontmatter and blocks writes when secrets are detected.
**Review policy:** mandatory — file write, secret gate, deterministic cache artifact.

```typescript
import { describe, expect, it } from "bun:test";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContextCapsule } from "@/agents/context-capsule/builder";

const baseInput = {
  topic: "Working Context Capsule",
  lifecycleIssue: 91,
  branch: "issue-91-working-context-capsule",
  headSha: "abc123",
  worktree: "/root/CODE/issue-91-working-context-capsule",
  sourceFiles: [{ path: "src/agents/executor.ts", content: "executor prompt context" }],
  confirmedFacts: ["context-brief remains task specific", "capsule injects into user prompt top"],
  createdAt: new Date("2026-05-17T00:00:00.000Z"),
};

describe("buildContextCapsule", () => {
  it("writes deterministic frontmatter and body", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "capsule-builder-"));
    const result = await buildContextCapsule({ ...baseInput, outputDir });

    expect(result.status).toBe("fresh");
    if (result.status !== "fresh") throw new Error("expected fresh capsule");
    expect(result.path).toContain("2026-05-17-working-context-capsule.md");
    expect(result.frontmatter.lifecycle_issue).toBe(91);
    expect(result.frontmatter.source_files).toEqual(["src/agents/executor.ts"]);
    expect(result.body).toContain("context-brief remains task specific");
    expect(result.document).toBe(readFileSync(result.path, "utf-8"));
    expect(result.sha).toHaveLength(64);
  });

  it("blocks secret-bearing capsule content before write", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "capsule-builder-secret-"));
    const result = await buildContextCapsule({
      ...baseInput,
      outputDir,
      confirmedFacts: ["Authorization: Bearer abc"],
    });

    expect(result.status).toBe("blocked");
    if (result.status !== "blocked") throw new Error("expected blocked capsule");
    expect(result.reason).toBe("secret");
  });

  it("returns warnings instead of enforcing a hard size limit", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "capsule-builder-large-"));
    const result = await buildContextCapsule({
      ...baseInput,
      outputDir,
      confirmedFacts: ["x".repeat(4000)],
      softWindowRatio: 0.0001,
    });

    expect(result.status).toBe("fresh");
    if (result.status !== "fresh") throw new Error("expected fresh capsule");
    expect(result.warnings.join("\n")).toContain("soft window ratio");
  });
});
```

```typescript
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { createCapsuleToken, hashText, renderCapsuleDocument, slugifyCapsuleTopic } from "./format";
import { assertCapsuleSafe } from "./redact";
import type { BuildContextCapsuleResult, ContextCapsuleBuildInput, ContextCapsuleFrontmatter } from "./types";

const DEFAULT_CONTEXT_CAPSULE_DIR = join("thoughts", "shared", "context-capsules");
const DEFAULT_SOFT_WINDOW_RATIO = 0.3;
const SOFT_WINDOW_REFERENCE_CHARS = 120_000;

function formatDate(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function buildBody(input: ContextCapsuleBuildInput): string {
  const facts = input.confirmedFacts.map((fact) => `- ${fact.trim()}`).join("\n");
  const sources = input.sourceFiles.map((source) => `- ${source.path}`).sort().join("\n");
  return [
    `<context-capsule-source topic="${input.topic}">`,
    "## Confirmed Facts",
    facts || "- No confirmed facts provided.",
    "",
    "## Source Files",
    sources || "- No source files provided.",
    "</context-capsule-source>",
  ].join("\n");
}

function buildFrontmatter(input: ContextCapsuleBuildInput, createdAt: Date): ContextCapsuleFrontmatter {
  const source_hashes = Object.fromEntries(
    input.sourceFiles.map((source) => [source.path, hashText(source.content)]).sort(([left], [right]) => left.localeCompare(right)),
  );
  return {
    lifecycle_issue: input.lifecycleIssue,
    branch: input.branch,
    head_sha: input.headSha,
    worktree: input.worktree,
    created_at: createdAt.toISOString(),
    source_files: Object.keys(source_hashes),
    source_hashes,
  };
}

function sizeWarnings(document: string, softWindowRatio: number): readonly string[] {
  const ratio = document.length / SOFT_WINDOW_REFERENCE_CHARS;
  if (ratio <= softWindowRatio) return [];
  return [`capsule exceeds soft window ratio ${softWindowRatio}; no hard size limit enforced`];
}

export async function buildContextCapsule(input: ContextCapsuleBuildInput): Promise<BuildContextCapsuleResult> {
  const createdAt = input.createdAt ?? new Date();
  const frontmatter = buildFrontmatter(input, createdAt);
  const body = buildBody(input);
  const document = renderCapsuleDocument(frontmatter, body);
  const safety = assertCapsuleSafe(document);
  if (!safety.ok) {
    return { status: "blocked", reason: "secret", detail: safety.match.reason };
  }

  const outputDir = input.outputDir ?? DEFAULT_CONTEXT_CAPSULE_DIR;
  mkdirSync(outputDir, { recursive: true });
  const fileName = `${formatDate(createdAt)}-${slugifyCapsuleTopic(input.topic)}.md`;
  const path = join(outputDir, fileName);
  writeFileSync(path, document, "utf-8");

  return {
    status: "fresh",
    path,
    sha: hashText(document),
    token: createCapsuleToken(frontmatter),
    frontmatter,
    body,
    document,
    warnings: sizeWarnings(document, input.softWindowRatio ?? DEFAULT_SOFT_WINDOW_RATIO),
  };
}
```

**Verify:** `bun test tests/agents/context-capsule/builder.test.ts`
**Commit:** `feat(agents): build immutable context capsules`

### Task 2.2: Context Capsule Freshness Preflight
**File:** `src/agents/context-capsule/freshness.ts`
**Test:** `tests/agents/context-capsule/freshness.test.ts`
**Depends:** 1.1
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Enforces same lifecycle issue + branch + worktree boundary and returns fresh / partially-stale / discarded without silent reuse.
**Review policy:** mandatory — freshness/invalidation and A→B reuse boundary.

```typescript
import { describe, expect, it } from "bun:test";
import { checkContextCapsuleFreshness } from "@/agents/context-capsule/freshness";
import type { ContextCapsuleFrontmatter } from "@/agents/context-capsule/types";

const frontmatter: ContextCapsuleFrontmatter = {
  lifecycle_issue: 91,
  branch: "issue-91",
  head_sha: "abc",
  worktree: "/root/CODE/issue-91",
  created_at: "2026-05-17T00:00:00.000Z",
  source_files: ["a.ts", "b.ts"],
  source_hashes: { "a.ts": "ha", "b.ts": "hb" },
};

const base = {
  expectedLifecycleIssue: 91,
  branch: "issue-91",
  headSha: "abc",
  worktree: "/root/CODE/issue-91",
  sourceHashes: { "a.ts": "ha", "b.ts": "hb" },
  frontmatter,
};

describe("checkContextCapsuleFreshness", () => {
  it("returns fresh when all hard boundaries and hashes match", () => {
    expect(checkContextCapsuleFreshness(base)).toEqual({ status: "fresh", reasons: [], staleSourceFiles: [] });
  });

  it("returns partially-stale for same issue branch worktree with HEAD or file drift", () => {
    const result = checkContextCapsuleFreshness({ ...base, headSha: "def", sourceHashes: { "a.ts": "changed", "b.ts": "hb" } });
    expect(result.status).toBe("partially-stale");
    expect(result.reasons).toContain("head_sha_mismatch");
    expect(result.staleSourceFiles).toEqual(["a.ts"]);
  });

  it("discards on lifecycle mismatch", () => {
    expect(checkContextCapsuleFreshness({ ...base, expectedLifecycleIssue: 92 }).status).toBe("discarded");
  });

  it("discards on branch mismatch", () => {
    expect(checkContextCapsuleFreshness({ ...base, branch: "main" }).status).toBe("discarded");
  });

  it("discards on worktree mismatch", () => {
    expect(checkContextCapsuleFreshness({ ...base, worktree: "/root/CODE/main" }).status).toBe("discarded");
  });
});
```

```typescript
import type { ContextCapsuleFreshnessInput, ContextCapsuleFreshnessResult } from "./types";

const HARD_DISCARD_REASONS = new Set(["lifecycle_issue_mismatch", "branch_mismatch", "worktree_mismatch"]);

function findStaleSourceFiles(
  expected: Readonly<Record<string, string>>,
  actual: Readonly<Record<string, string>>,
): readonly string[] {
  return Object.entries(expected)
    .filter(([path, expectedHash]) => actual[path] !== expectedHash)
    .map(([path]) => path)
    .sort();
}

export function checkContextCapsuleFreshness(input: ContextCapsuleFreshnessInput): ContextCapsuleFreshnessResult {
  const reasons: string[] = [];
  if (input.frontmatter.lifecycle_issue !== input.expectedLifecycleIssue) reasons.push("lifecycle_issue_mismatch");
  if (input.frontmatter.branch !== input.branch) reasons.push("branch_mismatch");
  if (input.frontmatter.worktree !== input.worktree) reasons.push("worktree_mismatch");

  const staleSourceFiles = findStaleSourceFiles(input.frontmatter.source_hashes, input.sourceHashes);
  if (input.frontmatter.head_sha !== input.headSha) reasons.push("head_sha_mismatch");
  if (staleSourceFiles.length > 0) reasons.push("source_hash_mismatch");

  if (reasons.some((reason) => HARD_DISCARD_REASONS.has(reason))) {
    return { status: "discarded", reasons, staleSourceFiles };
  }
  if (reasons.length > 0) {
    return { status: "partially-stale", reasons, staleSourceFiles };
  }
  return { status: "fresh", reasons: [], staleSourceFiles: [] };
}
```

**Verify:** `bun test tests/agents/context-capsule/freshness.test.ts`
**Commit:** `feat(agents): add context capsule freshness preflight`

### Task 2.3: Context Capsule Store Reader
**File:** `src/agents/context-capsule/store.ts`
**Test:** `tests/agents/context-capsule/store.test.ts`
**Depends:** 1.1, 1.2
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Enables same-issue A→B reuse by locating and parsing the latest capsule file in `thoughts/shared/context-capsules/`.
**Review policy:** mandatory — storage contract and A→B reuse.

```typescript
import { describe, expect, it } from "bun:test";
import { mkdirSync, writeFileSync } from "node:fs";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { findLatestContextCapsule, parseContextCapsuleDocument } from "@/agents/context-capsule/store";
import { renderCapsuleDocument } from "@/agents/context-capsule/format";

const doc = renderCapsuleDocument(
  {
    lifecycle_issue: 91,
    branch: "issue-91",
    head_sha: "abc",
    worktree: "/root/CODE/issue-91",
    created_at: "2026-05-17T00:00:00.000Z",
    source_files: ["a.ts"],
    source_hashes: { "a.ts": "ha" },
  },
  "body",
);

describe("context capsule store", () => {
  it("parses frontmatter and body", () => {
    const parsed = parseContextCapsuleDocument(doc);
    expect(parsed.frontmatter.lifecycle_issue).toBe(91);
    expect(parsed.frontmatter.source_hashes["a.ts"]).toBe("ha");
    expect(parsed.body.trim()).toBe("body");
  });

  it("finds the latest capsule file by created_at", () => {
    const dir = mkdtempSync(join(tmpdir(), "capsule-store-"));
    mkdirSync(dir, { recursive: true });
    writeFileSync(join(dir, "2026-05-16-old.md"), doc.replace("2026-05-17T00:00:00.000Z", "2026-05-16T00:00:00.000Z"));
    writeFileSync(join(dir, "2026-05-17-new.md"), doc);

    const latest = findLatestContextCapsule(dir);
    expect(latest?.path.endsWith("2026-05-17-new.md")).toBe(true);
    expect(latest?.sha).toHaveLength(64);
  });

  it("returns null when no capsule directory exists", () => {
    expect(findLatestContextCapsule(join(tmpdir(), "missing-capsules"))).toBeNull();
  });
});
```

```typescript
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parse as parseYaml } from "yaml";
import { createCapsuleToken, hashText } from "./format";
import type { ContextCapsuleFrontmatter, ContextCapsuleRef } from "./types";

interface ParsedContextCapsule {
  readonly frontmatter: ContextCapsuleFrontmatter;
  readonly body: string;
}

const FRONTMATTER_PATTERN = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/;

function normalizeFrontmatter(value: unknown): ContextCapsuleFrontmatter {
  const record = value as Partial<ContextCapsuleFrontmatter>;
  return {
    lifecycle_issue: typeof record.lifecycle_issue === "number" ? record.lifecycle_issue : null,
    branch: String(record.branch ?? ""),
    head_sha: String(record.head_sha ?? ""),
    worktree: String(record.worktree ?? ""),
    created_at: String(record.created_at ?? ""),
    source_files: Array.isArray(record.source_files) ? record.source_files.map(String) : [],
    source_hashes:
      typeof record.source_hashes === "object" && record.source_hashes !== null
        ? Object.fromEntries(Object.entries(record.source_hashes as Record<string, unknown>).map(([key, hash]) => [key, String(hash)]))
        : {},
  };
}

export function parseContextCapsuleDocument(document: string): ParsedContextCapsule {
  const match = FRONTMATTER_PATTERN.exec(document);
  if (!match) throw new Error("Invalid context capsule document: missing frontmatter");
  const frontmatter = normalizeFrontmatter(parseYaml(match[1]) as unknown);
  return { frontmatter, body: match[2] ?? "" };
}

export function findLatestContextCapsule(directory = join("thoughts", "shared", "context-capsules")): ContextCapsuleRef | null {
  if (!existsSync(directory)) return null;
  const candidates = readdirSync(directory)
    .filter((file) => file.endsWith(".md"))
    .map((file) => {
      const path = join(directory, file);
      const content = readFileSync(path, "utf-8");
      const parsed = parseContextCapsuleDocument(content);
      return { path, content, frontmatter: parsed.frontmatter };
    })
    .sort((left, right) => right.frontmatter.created_at.localeCompare(left.frontmatter.created_at));

  const latest = candidates[0];
  if (!latest) return null;
  return {
    path: latest.path,
    content: latest.content,
    sha: hashText(latest.content),
    token: createCapsuleToken(latest.frontmatter),
  };
}
```

**Verify:** `bun test tests/agents/context-capsule/store.test.ts`
**Commit:** `feat(agents): add context capsule store reader`

### Task 2.4: Context Capsule Prompt Injector Helper
**File:** `src/agents/context-capsule/injector.ts`
**Test:** `tests/agents/context-capsule/injector.test.ts`
**Depends:** 1.1
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Provides the byte-identical `<context-capsule>` prefix rendered once and reused across parallel workers.
**Review policy:** mandatory — cache hit and user-prompt injection behavior.

```typescript
import { describe, expect, it } from "bun:test";
import { applyContextCapsulePrefix, renderContextCapsulePrefix } from "@/agents/context-capsule/injector";

const ref = {
  path: "thoughts/shared/context-capsules/2026-05-17-working-context-capsule.md",
  sha: "a".repeat(64),
  token: "token123",
  content: "---\nlifecycle_issue: 91\n---\n\nCapsule body\n",
};

describe("context capsule injector", () => {
  it("renders a stable context-capsule block", () => {
    const first = renderContextCapsulePrefix(ref);
    const second = renderContextCapsulePrefix(ref);
    expect(first).toBe(second);
    expect(first).toStartWith(`<context-capsule sha="${"a".repeat(64)}" fresh-token="token123"`);
    expect(first).toContain("Capsule body");
    expect(first).not.toContain("lifecycle_issue: 91");
  });

  it("prefixes task prompt at the top", () => {
    const prompt = applyContextCapsulePrefix("<spawn-meta />\nTask", ref);
    expect(prompt.startsWith("<context-capsule")).toBe(true);
    expect(prompt).toContain("</context-capsule>\n\n<spawn-meta />");
  });

  it("returns original prompt when capsule is absent", () => {
    expect(applyContextCapsulePrefix("Task", null)).toBe("Task");
  });
});
```

```typescript
import type { ContextCapsuleRef } from "./types";

const FRONTMATTER_PATTERN = /^---\n[\s\S]*?\n---\n?/;

function capsuleBody(content: string): string {
  return content.replace(FRONTMATTER_PATTERN, "").trimEnd();
}

export function renderContextCapsulePrefix(capsule: ContextCapsuleRef): string {
  return [
    `<context-capsule sha="${capsule.sha}" fresh-token="${capsule.token}" path="${capsule.path}">`,
    capsuleBody(capsule.content),
    "</context-capsule>",
    "",
  ].join("\n");
}

export function applyContextCapsulePrefix(prompt: string, capsule: ContextCapsuleRef | null | undefined): string {
  if (!capsule) return prompt;
  return `${renderContextCapsulePrefix(capsule)}${prompt}`;
}
```

**Verify:** `bun test tests/agents/context-capsule/injector.test.ts`
**Commit:** `feat(agents): add context capsule prompt injector`

---

## Batch 3: Runtime and Prompt Wiring (parallel - 8 implementers)

Tasks in this batch depend on Batch 2 only where they import the new helpers. Prompt-only tasks can run after Task 1.5 but stay in this batch to keep review together.
Tasks: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7, 3.8

### Task 3.1: Spawn Agent Args Accept Optional Capsule Ref
**File:** `src/tools/spawn-agent-args.ts`
**Test:** `tests/tools/spawn-agent-args.test.ts`
**Depends:** 1.1
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Lets coordinators pass a capsule reference into `spawn_agent` without introducing a new tool or changing required task fields.
**Review policy:** mandatory — spawn-agent input schema / runtime dispatch contract.

```typescript
import { describe, expect, it } from "bun:test";
import { normalizeSpawnAgentArgs } from "@/tools/spawn-agent-args";

const capsule = {
  path: "thoughts/shared/context-capsules/2026-05-17-working-context-capsule.md",
  sha: "a".repeat(64),
  token: "token",
  content: "---\n---\n\nCapsule body\n",
};

describe("spawn-agent args contextCapsule", () => {
  it("preserves optional contextCapsule on tasks", () => {
    const normalized = normalizeSpawnAgentArgs({
      agents: [{ agent: "codebase-locator", prompt: "Find files", description: "Find", contextCapsule: capsule }],
    });
    expect(normalized.ok).toBe(true);
    if (!normalized.ok) throw new Error(normalized.message);
    expect(normalized.tasks[0].contextCapsule).toEqual(capsule);
  });

  it("rejects malformed contextCapsule", () => {
    const normalized = normalizeSpawnAgentArgs({
      agents: [{ agent: "codebase-locator", prompt: "Find files", description: "Find", contextCapsule: { path: 1 } }],
    });
    expect(normalized.ok).toBe(false);
  });
});
```

```typescript
// src/tools/spawn-agent-args.ts
import * as v from "valibot";

import { normalizeSequence } from "@/tools/sequence";

const ContextCapsuleRefSchema = v.object({
  path: v.string(),
  sha: v.string(),
  token: v.string(),
  content: v.string(),
});

export const AgentTaskSchema = v.object({
  agent: v.string(),
  prompt: v.string(),
  description: v.string(),
  model: v.optional(v.string()),
  contextCapsule: v.optional(ContextCapsuleRefSchema),
});

export type AgentTask = v.InferOutput<typeof AgentTaskSchema>;

export type NormalizeSpawnAgentResult =
  | { readonly ok: true; readonly tasks: readonly AgentTask[] }
  | { readonly ok: false; readonly message: string };

export const NO_AGENTS_MESSAGE = "No agents specified.";
export const INVALID_ARGS_MESSAGE =
  "Invalid spawn_agent arguments: each task must provide string agent, prompt, and description fields.";

const AGENTS_KEY = "agents";
const JSON_OBJECT_PREFIX = "{";
const JSON_ARRAY_PREFIX = "[";

const failure = (message: string): NormalizeSpawnAgentResult => ({ ok: false, message });
const success = (tasks: readonly AgentTask[]): NormalizeSpawnAgentResult => ({ ok: true, tasks });

const INDEX_KEY_PATTERN = /^(?:0|[1-9]\d*)$/u;

const isPlainRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

const isIndexedRecord = (value: unknown): value is Record<string, unknown> => {
  if (!isPlainRecord(value)) return false;
  const keys = Object.keys(value);
  return keys.length > 0 && keys.every((key) => INDEX_KEY_PATTERN.test(key));
};

const tryParseStringifiedJson = (value: unknown): unknown => {
  if (typeof value !== "string") return value;
  const text = value.trim();
  if (!text.startsWith(JSON_OBJECT_PREFIX) && !text.startsWith(JSON_ARRAY_PREFIX)) return value;
  try {
    return JSON.parse(text) as unknown;
  } catch {
    return value;
  }
};

const parseSingleTask = (candidate: unknown): AgentTask | null => {
  const parsed = v.safeParse(AgentTaskSchema, candidate);
  return parsed.success ? parsed.output : null;
};

const parseTaskArray = (candidates: readonly unknown[]): readonly AgentTask[] | null => {
  const tasks: AgentTask[] = [];
  for (const candidate of candidates) {
    const task = parseSingleTask(candidate);
    if (task === null) return null;
    tasks.push(task);
  }
  return tasks;
};

const normalizeArrayInput = (candidates: readonly unknown[]): NormalizeSpawnAgentResult => {
  if (candidates.length === 0) return failure(NO_AGENTS_MESSAGE);
  const tasks = parseTaskArray(candidates);
  return tasks === null ? failure(INVALID_ARGS_MESSAGE) : success(tasks);
};

const normalizeAgentsKey = (value: unknown): NormalizeSpawnAgentResult => {
  const decoded = tryParseStringifiedJson(value);
  if (Array.isArray(decoded)) return normalizeArrayInput(decoded);
  const single = parseSingleTask(decoded);
  if (single !== null) return success([single]);
  if (isIndexedRecord(decoded)) return normalizeArrayInput(normalizeSequence(decoded));
  return failure(INVALID_ARGS_MESSAGE);
};

export function normalizeSpawnAgentArgs(input: unknown): NormalizeSpawnAgentResult {
  const decoded = tryParseStringifiedJson(input);
  if (Array.isArray(decoded)) return normalizeArrayInput(decoded);
  if (!isPlainRecord(decoded)) return failure(INVALID_ARGS_MESSAGE);
  if (Object.hasOwn(decoded, AGENTS_KEY)) return normalizeAgentsKey(decoded[AGENTS_KEY]);
  const single = parseSingleTask(decoded);
  if (single !== null) return success([single]);
  if (isIndexedRecord(decoded)) return normalizeArrayInput(normalizeSequence(decoded));
  return failure(INVALID_ARGS_MESSAGE);
}
```

**Verify:** `bun test tests/tools/spawn-agent-args.test.ts`
**Commit:** `feat(tools): accept context capsule refs in spawn agent args`

### Task 3.2: Spawn Agent User Prompt Capsule Injection
**File:** `src/tools/spawn-agent/tool.ts`
**Test:** `tests/tools/spawn-agent.test.ts`
**Depends:** 2.4, 3.1
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Injects capsule into spawned user prompt TOP, preserves system prompt untouched, and keeps parallel prompts byte-identical for the capsule segment.
**Review policy:** mandatory — runtime prompt assembly / cache behavior / no system prompt changes.

```typescript
// Add these tests to tests/tools/spawn-agent.test.ts

describe("spawn_agent context capsule injection", () => {
  it("prefixes every spawned user prompt with the same capsule bytes", async () => {
    const fake = createFakeCtx();
    const toolDef = createSpawnAgentTool(fake.ctx);
    const contextCapsule = {
      path: "thoughts/shared/context-capsules/2026-05-17-working-context-capsule.md",
      sha: "a".repeat(64),
      token: "token123",
      content: "---\nlifecycle_issue: 91\n---\n\nCapsule body\n",
    };

    await callExecute(toolDef, {
      agents: [
        { ...taskA, prompt: "task delta A", contextCapsule },
        { ...taskB, prompt: "task delta B", contextCapsule },
      ],
    });

    const [first, second] = fake.recorder.promptCalls.map((call) => call.text);
    expect(first.startsWith("<context-capsule")).toBe(true);
    expect(second.startsWith("<context-capsule")).toBe(true);
    const firstCapsule = first.slice(0, first.indexOf("task delta A"));
    const secondCapsule = second.slice(0, second.indexOf("task delta B"));
    expect(firstCapsule).toBe(secondCapsule);
    expect(firstCapsule).toContain("Capsule body");
    expect(firstCapsule).not.toContain("lifecycle_issue: 91");
  });
});
```

```typescript
// In src/tools/spawn-agent/tool.ts:
// 1. Add import near other imports:
import { applyContextCapsulePrefix } from "@/agents/context-capsule/injector";

// 2. Replace buildPromptBody implementation with:
function buildPromptBody(
  task: AgentTask,
  model: ModelReference | null,
): { parts: { type: "text"; text: string }[]; agent: string; model?: ModelReference } {
  const prompt = applyContextCapsulePrefix(task.prompt, task.contextCapsule);
  const base = { parts: [{ type: "text" as const, text: prompt }], agent: task.agent };
  return model ? { ...base, model } : base;
}
```

**Verify:** `bun test tests/tools/spawn-agent.test.ts`
**Commit:** `feat(tools): inject context capsules into spawned prompts`

### Task 3.3: Knowledge Context Section Capsule Status Line
**File:** `src/agents/knowledge-context-section.ts`
**Test:** `tests/agents/knowledge-context-section.test.ts`
**Depends:** 1.1
**Domain:** general
**Atlas-impact:** layer-update
**Behavior-impact:** Adds `Capsule status: <none|fresh|partially-stale|discarded|skipped:<reason>|blocked:<reason>>` to every terminal knowledge-context section.
**Review policy:** mandatory — user-visible response-UX and shared prompt single source.

```typescript
// Add to tests/agents/knowledge-context-section.test.ts

it("declares the Capsule status terminal line", () => {
  expect(KNOWLEDGE_CONTEXT_SECTION).toContain("Capsule status:");
  expect(KNOWLEDGE_CONTEXT_SECTION).toContain("none|fresh|partially-stale|discarded|skipped:<reason>|blocked:<reason>");
});
```

```typescript
// In src/agents/knowledge-context-section.ts, replace the status tail inside KNOWLEDGE_CONTEXT_SECTION with:
本段结尾固定附三行状态：
\`Atlas status: <value>\`
\`Project Memory status: <value>\`
\`Capsule status: <none|fresh|partially-stale|discarded|skipped:<reason>|blocked:<reason>>\`
取值参见各自协议块的 status enum；Capsule status 表示本轮是否生成 / 复用 / 丢弃 / 跳过 / 阻断 Working Context Capsule。
```

**Verify:** `bun test tests/agents/knowledge-context-section.test.ts tests/agents/effect-first-reporting.test.ts`
**Commit:** `feat(agents): report context capsule status in knowledge context`

### Task 3.4: Brainstormer Context Capsule Protocol Injection
**File:** `src/agents/brainstormer.ts`
**Test:** `tests/agents/context-capsule-drift-guard.test.ts`
**Depends:** 1.5
**Domain:** general
**Atlas-impact:** layer-update
**Behavior-impact:** Makes brainstormer generate/use capsules before Lens Swarm, critic/adversarial fan-out, codebase exploration fan-out, and same-lifecycle A→B reuse.
**Review policy:** mandatory — primary agent prompt and workflow contract.

```typescript
import { describe, expect, it } from "bun:test";
import { brainstormerAgent } from "@/agents/brainstormer";
import { CONTEXT_CAPSULE_PROTOCOL } from "@/agents/context-capsule-protocol";

describe("context capsule drift guard", () => {
  it("injects the shared protocol into brainstormer", () => {
    expect(brainstormerAgent.prompt).toContain(CONTEXT_CAPSULE_PROTOCOL);
    expect(brainstormerAgent.prompt).toContain("Lens Swarm");
    expect(brainstormerAgent.prompt).toContain("A→B");
  });
});
```

```typescript
// In src/agents/brainstormer.ts:
// 1. Add import:
import { CONTEXT_CAPSULE_PROTOCOL } from "./context-capsule-protocol";

// 2. Inject after LENS_SWARM_PROTOCOL or near project-memory/atlas protocols:
${CONTEXT_CAPSULE_PROTOCOL}

// 3. Add a brainstormer-specific operational note after the shared block:
<context-capsule-brainstormer-usage priority="high">
Before Lens Swarm, Adversarial Swarm, critic fan-out, or parallel codebase exploration, build or reuse a Context Capsule from already-read design / Atlas / Project Memory / code facts, then pass the same contextCapsule object to every parallel worker. For same lifecycle A→B requests, run freshness preflight before reuse and surface Capsule status in the terminal knowledge context.
</context-capsule-brainstormer-usage>
```

**Verify:** `bun test tests/agents/context-capsule-drift-guard.test.ts`
**Commit:** `feat(agents): add capsule protocol to brainstormer`

### Task 3.5: Commander Context Capsule Protocol Injection
**File:** `src/agents/commander.ts`
**Test:** `tests/agents/context-capsule-drift-guard.test.ts`
**Depends:** 1.5
**Domain:** general
**Atlas-impact:** layer-update
**Behavior-impact:** Makes commander preserve the same capsule semantics for codebase exploration fan-out and same-lifecycle sequential work while keeping primary-user reports decision-minimal.
**Review policy:** mandatory — primary agent prompt and workflow contract.

```typescript
// Extend tests/agents/context-capsule-drift-guard.test.ts
import { primaryAgent as commanderAgent } from "@/agents/commander";

it("injects the shared protocol into commander", () => {
  expect(commanderAgent.prompt).toContain(CONTEXT_CAPSULE_PROTOCOL);
  expect(commanderAgent.prompt).toContain("A→B");
  expect(commanderAgent.prompt).toContain("Capsule status");
});
```

```typescript
// In src/agents/commander.ts:
// 1. Add import:
import { CONTEXT_CAPSULE_PROTOCOL } from "./context-capsule-protocol";

// 2. Inject the same shared protocol block:
${CONTEXT_CAPSULE_PROTOCOL}

// 3. Add commander-specific operational note:
<context-capsule-commander-usage priority="high">
When commander coordinates parallel codebase exploration or continues A→B within the same lifecycle issue, use Context Capsule as a user-prompt top prefix only. Keep user-facing recovery and terminal reports decision-minimal; expose only Capsule status, capsule path when relevant, and acceptance-oriented verification.
</context-capsule-commander-usage>
```

**Verify:** `bun test tests/agents/context-capsule-drift-guard.test.ts`
**Commit:** `feat(agents): add capsule protocol to commander`

### Task 3.6: Executor Context Capsule Protocol Injection
**File:** `src/agents/executor.ts`
**Test:** `tests/agents/context-capsule-drift-guard.test.ts`
**Depends:** 1.5
**Domain:** general
**Atlas-impact:** layer-update
**Behavior-impact:** Makes executor build a batch capsule before implementer/reviewer fan-out while preserving `<context-brief>` as the mandatory per-task delta.
**Review policy:** mandatory — executor/reviewer contract and context-brief schema boundary.

```typescript
// Extend tests/agents/context-capsule-drift-guard.test.ts
import { executorAgent } from "@/agents/executor";

it("injects the shared protocol into executor and preserves context-brief ordering", () => {
  const prompt = executorAgent.prompt ?? "";
  expect(prompt).toContain(CONTEXT_CAPSULE_PROTOCOL);
  expect(prompt).toContain("capsule in front, context-brief after");
  expect(prompt).toContain("<context-brief");
});
```

```typescript
// In src/agents/executor.ts:
// 1. Add import:
import { CONTEXT_CAPSULE_PROTOCOL } from "./context-capsule-protocol";

// 2. Inject shared protocol near context-brief protocol:
${CONTEXT_CAPSULE_PROTOCOL}

// 3. Add executor-specific note:
<context-capsule-executor-usage priority="critical">
Before every implementer/reviewer batch fan-out, build or reuse one batch Context Capsule from the plan, frozen contract (if any), Behavior commitments, already-read Atlas / Project Memory summaries, and batch-wide confirmed facts. Pass the exact same contextCapsule object to every worker in that batch. The user prompt order is capsule in front, context-brief after, task-specific instructions last. The <context-brief> remains mandatory and per-task; capsule never replaces review policy, Behavior mapping, or must-still-verify target-file reads.
</context-capsule-executor-usage>
```

**Verify:** `bun test tests/agents/context-capsule-drift-guard.test.ts tests/agents/leaf-no-knowledge-write.test.ts`
**Commit:** `feat(agents): add capsule protocol to executor`

### Task 3.7: Mindmodel Orchestrator Capsule Protocol Note
**File:** `src/agents/mindmodel/orchestrator.ts`
**Test:** `tests/agents/mindmodel/orchestrator.test.ts`
**Depends:** 1.5
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Covers S-tier `mm-orchestrator` parallel analysis fan-out by forwarding one capsule to all Phase 1 workers.
**Review policy:** mandatory — agent prompt contract / S-tier coverage.

```typescript
// Add to tests/agents/mindmodel/orchestrator.test.ts

it("requires context capsule reuse for parallel Phase 1 fan-out", () => {
  expect(mindmodelOrchestratorAgent.prompt).toContain("Context Capsule");
  expect(mindmodelOrchestratorAgent.prompt).toContain("same contextCapsule object");
  expect(mindmodelOrchestratorAgent.prompt).toContain("Phase 1");
});
```

```typescript
// In src/agents/mindmodel/orchestrator.ts, add import if PROMPT becomes template literal with shared protocol:
import { CONTEXT_CAPSULE_PROTOCOL } from "../context-capsule-protocol";

// Add inside PROMPT after <spawn_agent-api>:
${CONTEXT_CAPSULE_PROTOCOL}

<context-capsule-mm-orchestrator-usage priority="high">
For Phase 1 parallel analysis, create or reuse one Context Capsule from project entry/config/test discovery already known to this orchestrator and pass the same contextCapsule object to every Phase 1 worker. Phase 2 receives Phase 1 outputs as normal task-specific prompt content.
</context-capsule-mm-orchestrator-usage>
```

**Verify:** `bun test tests/agents/mindmodel/orchestrator.test.ts`
**Commit:** `feat(agents): cover mindmodel fanout with context capsule protocol`

### Task 3.8: Atlas Initializer Capsule Protocol Note
**File:** `src/agents/atlas-initializer.ts`
**Test:** `tests/agents/atlas-initializer-context-capsule.test.ts`
**Depends:** 1.5
**Domain:** general
**Atlas-impact:** layer-update
**Behavior-impact:** Covers S-tier `atlas-initializer` worker fan-out while preserving Atlas as durable vault and capsule as hot-path prompt prefix only.
**Review policy:** mandatory — Atlas workflow boundary and agent prompt contract.

```typescript
import { describe, expect, it } from "bun:test";
import { atlasInitializerAgent } from "@/agents/atlas-initializer";
import { CONTEXT_CAPSULE_PROTOCOL } from "@/agents/context-capsule-protocol";

describe("atlas initializer context capsule prompt", () => {
  it("injects the shared context capsule protocol", () => {
    const prompt = atlasInitializerAgent.prompt ?? "";
    expect(prompt).toContain(CONTEXT_CAPSULE_PROTOCOL);
    expect(prompt).toContain("capsule is not an atlas node");
    expect(prompt).toContain("same contextCapsule object");
  });
});
```

```typescript
// In src/agents/atlas-initializer.ts:
// 1. Add import:
import { CONTEXT_CAPSULE_PROTOCOL } from "./context-capsule-protocol";

// 2. Inject into PROMPT before <phase-plan>:
${CONTEXT_CAPSULE_PROTOCOL}

<context-capsule-atlas-initializer-usage priority="high">
For discovery and worker fan-out phases, pass the same contextCapsule object to parallel workers when shared project facts have already been read. The capsule is not an atlas node, not a vault update, and not Project Memory; it is only a hot-path user-prompt prefix. Atlas durable writes still happen only through the normal atlas initializer write/reconcile flow.
</context-capsule-atlas-initializer-usage>
```

**Verify:** `bun test tests/agents/atlas-initializer-context-capsule.test.ts`
**Commit:** `feat(agents): cover atlas initializer fanout with context capsule protocol`

---

## Batch 4: Integration and Drift Guards (parallel - 7 implementers)

All tasks in this batch depend on Batch 3 completing.
Tasks: 4.1, 4.2, 4.3, 4.4, 4.5, 4.6, 4.7

### Task 4.1: Agent Capsule Protocol Drift Guard
**File:** `tests/agents/context-capsule-drift-guard.test.ts`
**Test:** `tests/agents/context-capsule-drift-guard.test.ts`
**Depends:** 3.4, 3.5, 3.6
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Ensures brainstormer / commander / executor all reference the same protocol source and preserve key Behavior commitments.
**Review policy:** mandatory — drift guard for prompt contract.

```typescript
import { describe, expect, it } from "bun:test";
import { brainstormerAgent } from "@/agents/brainstormer";
import { primaryAgent as commanderAgent } from "@/agents/commander";
import { CONTEXT_CAPSULE_PROTOCOL } from "@/agents/context-capsule-protocol";
import { executorAgent } from "@/agents/executor";

const COORDINATOR_PROMPTS = [
  ["brainstormer", brainstormerAgent.prompt ?? ""],
  ["commander", commanderAgent.prompt ?? ""],
  ["executor", executorAgent.prompt ?? ""],
] as const;

describe("context capsule prompt drift guard", () => {
  it("injects the same shared protocol source into all coordinators", () => {
    for (const [name, prompt] of COORDINATOR_PROMPTS) {
      expect(prompt, name).toContain(CONTEXT_CAPSULE_PROTOCOL);
    }
  });

  it("keeps critical behavior commitments present", () => {
    for (const [name, prompt] of COORDINATOR_PROMPTS) {
      expect(prompt, name).toContain("user prompt TOP");
      expect(prompt, name).toContain("never system prompt");
      expect(prompt, name).toContain("byte-identical");
      expect(prompt, name).toContain("worker still must read its own target files");
      expect(prompt, name).toContain("Capsule status");
    }
  });

  it("keeps executor context-brief contract intact", () => {
    const prompt = executorAgent.prompt ?? "";
    expect(prompt).toContain("<context-brief");
    expect(prompt).toContain("capsule in front, context-brief after");
    expect(prompt).toContain("capsule never replaces review policy");
  });
});
```

```typescript
// Test-only drift guard. No production implementation block.
```

**Verify:** `bun test tests/agents/context-capsule-drift-guard.test.ts`
**Commit:** `test(agents): guard context capsule prompt protocol drift`

### Task 4.2: Lens Swarm Byte-Identical Capsule Integration Test
**File:** `tests/integration/context-capsule-lens-swarm.test.ts`
**Test:** `tests/integration/context-capsule-lens-swarm.test.ts`
**Depends:** 2.4, 3.2
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Verifies 5 parallel scout prompts receive the same capsule bytes at user prompt top.
**Review policy:** mandatory — integration coverage for S-tier Lens Swarm and byte-identical cache hit.

```typescript
import { describe, expect, it } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";
import { createSpawnAgentTool } from "@/tools/spawn-agent";

type ExecuteSignature = (raw: unknown, ctx: unknown) => Promise<string>;

function createCtx(promptTexts: string[]): PluginInput {
  let index = 0;
  return {
    directory: "/tmp/context-capsule-lens-swarm-test",
    client: {
      session: {
        create: async () => ({ data: { id: `sess-${++index}` } }),
        prompt: async (input: { body: { parts: { text: string }[] } }) => {
          promptTexts.push(input.body.parts[0].text);
        },
        messages: async () => ({ data: [{ info: { role: "assistant" }, parts: [{ type: "text", text: "ok" }] }] }),
        delete: async () => undefined,
      },
    },
  } as unknown as PluginInput;
}

describe("context capsule Lens Swarm integration", () => {
  it("injects byte-identical capsule blocks into five scout prompts", async () => {
    const promptTexts: string[] = [];
    const tool = createSpawnAgentTool(createCtx(promptTexts));
    const execute = tool.execute.bind(tool) as unknown as ExecuteSignature;
    const contextCapsule = {
      path: "thoughts/shared/context-capsules/2026-05-17-working-context-capsule.md",
      sha: "a".repeat(64),
      token: "token123",
      content: "---\nlifecycle_issue: 91\n---\n\nShared proposal context\n",
    };

    await execute(
      {
        agents: Array.from({ length: 5 }, (_, i) => ({
          agent: "brainstorm-scout",
          description: `Scout ${i}`,
          prompt: `<spawn-meta id="${i}" />\nLens ${i}`,
          contextCapsule,
        })),
      },
      {},
    );

    expect(promptTexts).toHaveLength(5);
    const capsuleBlocks = promptTexts.map((text) => text.slice(0, text.indexOf("<spawn-meta")));
    expect(new Set(capsuleBlocks).size).toBe(1);
    expect(capsuleBlocks[0]).toStartWith("<context-capsule");
    expect(capsuleBlocks[0]).toContain("Shared proposal context");
  });
});
```

```typescript
// Test-only integration coverage. No production implementation block.
```

**Verify:** `bun test tests/integration/context-capsule-lens-swarm.test.ts`
**Commit:** `test(integration): verify lens swarm capsule byte identity`

### Task 4.3: A-to-B Freshness State Integration Test
**File:** `tests/integration/context-capsule-ab-reuse.test.ts`
**Test:** `tests/integration/context-capsule-ab-reuse.test.ts`
**Depends:** 2.1, 2.2, 2.3
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Verifies same-lifecycle A→B fresh, partially-stale, discarded, and blocked secret paths.
**Review policy:** mandatory — A→B reuse boundary, freshness, and secret blocking.

```typescript
import { describe, expect, it } from "bun:test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { buildContextCapsule } from "@/agents/context-capsule/builder";
import { checkContextCapsuleFreshness } from "@/agents/context-capsule/freshness";

const sourceFiles = [{ path: "src/agents/executor.ts", content: "executor context" }];

describe("context capsule A→B reuse integration", () => {
  it("covers fresh, partially-stale, and discarded freshness states", async () => {
    const outputDir = mkdtempSync(join(tmpdir(), "capsule-ab-"));
    const built = await buildContextCapsule({
      topic: "Working Context Capsule",
      lifecycleIssue: 91,
      branch: "issue-91",
      headSha: "abc",
      worktree: "/root/CODE/issue-91",
      sourceFiles,
      confirmedFacts: ["A completed with executor context"],
      createdAt: new Date("2026-05-17T00:00:00.000Z"),
      outputDir,
    });
    if (built.status !== "fresh") throw new Error("expected built capsule");

    expect(
      checkContextCapsuleFreshness({
        expectedLifecycleIssue: 91,
        branch: "issue-91",
        headSha: "abc",
        worktree: "/root/CODE/issue-91",
        sourceHashes: built.frontmatter.source_hashes,
        frontmatter: built.frontmatter,
      }).status,
    ).toBe("fresh");

    expect(
      checkContextCapsuleFreshness({
        expectedLifecycleIssue: 91,
        branch: "issue-91",
        headSha: "changed",
        worktree: "/root/CODE/issue-91",
        sourceHashes: { "src/agents/executor.ts": "changed" },
        frontmatter: built.frontmatter,
      }).status,
    ).toBe("partially-stale");

    expect(
      checkContextCapsuleFreshness({
        expectedLifecycleIssue: 91,
        branch: "main",
        headSha: "abc",
        worktree: "/root/CODE/issue-91",
        sourceHashes: built.frontmatter.source_hashes,
        frontmatter: built.frontmatter,
      }).status,
    ).toBe("discarded");
  });

  it("blocks secret-bearing A→B capsule writes", async () => {
    const built = await buildContextCapsule({
      topic: "Secret Capsule",
      lifecycleIssue: 91,
      branch: "issue-91",
      headSha: "abc",
      worktree: "/root/CODE/issue-91",
      sourceFiles,
      confirmedFacts: ["Authorization: Bearer abc"],
      outputDir: mkdtempSync(join(tmpdir(), "capsule-ab-secret-")),
    });
    expect(built.status).toBe("blocked");
  });
});
```

```typescript
// Test-only integration coverage. No production implementation block.
```

**Verify:** `bun test tests/integration/context-capsule-ab-reuse.test.ts`
**Commit:** `test(integration): verify context capsule ab reuse states`

### Task 4.4: Effect-First Capsule Status Drift Guard
**File:** `tests/agents/effect-first-reporting.test.ts`
**Test:** `tests/agents/effect-first-reporting.test.ts`
**Depends:** 3.3
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Ensures all effect-first primaries expose `Capsule status:` alongside Atlas and Project Memory status.
**Review policy:** mandatory — user-visible response-UX commitment.

```typescript
// Add inside describe("knowledge-context subsection placement") in tests/agents/effect-first-reporting.test.ts

it(`${agent.name} knowledge-context subsection mentions Capsule status line`, () => {
  const block = expandedEffectFirstBlock(agent.source);
  expect(block).not.toBeNull();
  const body = block ?? "";
  expect(body).toContain("Capsule status:");
  expect(body).toContain("none|fresh|partially-stale|discarded|skipped:<reason>|blocked:<reason>");
});

// Add in AGENTS.md mirror tests only if AGENTS.md is updated in this lifecycle:
// expect(AGENTS_MD).toMatch(/Capsule status/);
```

```typescript
// Test-only drift guard extension. No production implementation block.
```

**Verify:** `bun test tests/agents/effect-first-reporting.test.ts`
**Commit:** `test(agents): guard capsule status in effect first reporting`

### Task 4.5: Context Brief Preservation Regression Test
**File:** `tests/agents/leaf-no-knowledge-write.test.ts`
**Test:** `tests/agents/leaf-no-knowledge-write.test.ts`
**Depends:** 3.6
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Confirms executor still requires `<context-brief>` after adding capsule protocol.
**Review policy:** mandatory — planner/executor/reviewer contract and context-brief schema preservation.

```typescript
// Add inside describe("executor injects context-brief protocol") in tests/agents/leaf-no-knowledge-write.test.ts

it("states context capsule never replaces context-brief", () => {
  expect(executorPrompt).toContain("Context Capsule");
  expect(executorPrompt).toContain("capsule never replaces review policy");
  expect(executorPrompt).toContain("<context-brief");
});
```

```typescript
// Test-only regression guard. No production implementation block.
```

**Verify:** `bun test tests/agents/leaf-no-knowledge-write.test.ts`
**Commit:** `test(agents): preserve context brief with capsule protocol`

### Task 4.6: Knowledge Boundary Regression Test
**File:** `tests/lifecycle/context-capsule-boundary.test.ts`
**Test:** `tests/lifecycle/context-capsule-boundary.test.ts`
**Depends:** 3.4, 3.5, 3.6, 3.8
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Guards that capsules are not Project Memory, not Atlas, and not lifecycle_finish/resume side effects.
**Review policy:** mandatory — Atlas / Project Memory / lifecycle boundary.

```typescript
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const ROOT = join(__dirname, "..", "..");
const FILES = [
  "src/agents/context-capsule-protocol.ts",
  "src/agents/brainstormer.ts",
  "src/agents/commander.ts",
  "src/agents/executor.ts",
  "src/agents/atlas-initializer.ts",
];

describe("context capsule knowledge boundary", () => {
  it("does not instruct agents to promote capsules to Project Memory", () => {
    for (const file of FILES) {
      const source = readFileSync(join(ROOT, file), "utf-8");
      expect(source).not.toMatch(/project_memory_promote[\s\S]{0,120}capsule/i);
    }
  });

  it("does not instruct agents to write capsules into Atlas", () => {
    for (const file of FILES) {
      const source = readFileSync(join(ROOT, file), "utf-8");
      expect(source).not.toMatch(/(?:write|update|maintain)[\s\S]{0,80}atlas[\s\S]{0,80}capsule/i);
    }
  });

  it("keeps resume_subagent out of capsule reuse semantics", () => {
    const protocol = readFileSync(join(ROOT, "src/agents/context-capsule-protocol.ts"), "utf-8");
    expect(protocol).toContain("Do not extend resume_subagent");
    expect(protocol).not.toMatch(/resume_subagent\([^)]*contextCapsule/);
  });
});
```

```typescript
// Test-only boundary guard. No production implementation block.
```

**Verify:** `bun test tests/lifecycle/context-capsule-boundary.test.ts`
**Commit:** `test(lifecycle): guard context capsule knowledge boundaries`

### Task 4.7: Spawn Agent Resume Regression Test
**File:** `tests/integration/spawn-agent-allsettled.test.ts`
**Test:** `tests/integration/spawn-agent-allsettled.test.ts`
**Depends:** 3.2
**Domain:** general
**Atlas-impact:** none
**Behavior-impact:** Confirms capsule injection does not preserve failed sessions differently and does not alter `resume_subagent` behavior.
**Review policy:** mandatory — lifecycle/recovery/resume semantics.

```typescript
// Add to tests/integration/spawn-agent-allsettled.test.ts inside describe("spawn_agent allSettled integration")

it("does not preserve context capsule state for resume_subagent", async () => {
  const registry = createPreservedRegistry({ maxResumes: MAX_RESUMES, ttlHours: TTL_HOURS });
  const recorder: Recorder = { promptCalls: [], deleteCalls: [] };
  const ctx = createCtx(recorder);
  const contextCapsule = {
    path: "thoughts/shared/context-capsules/2026-05-17-working-context-capsule.md",
    sha: "a".repeat(64),
    token: "token123",
    content: "---\nlifecycle_issue: 91\n---\n\nCapsule body\n",
  };
  const spawnTool = createSpawnAgentTool(ctx, {
    registry,
    executeAgentSession: async (_ctx, task) => {
      expect(task.contextCapsule).toEqual(contextCapsule);
      return { sessionId: TASK_ERROR_SESSION, output: TASK_ERROR_OUTPUT };
    },
  });

  const spawnOutput = await callSpawnExecute(spawnTool, { agents: [{ ...TASK_ERROR_TASK, contextCapsule }] });
  expect(spawnOutput).toContain("**Outcome**: task_error");
  expect(registry.get(TASK_ERROR_SESSION)).toBeNull();

  const resumeTool = createResumeSubagentTool(ctx, { registry });
  const resumeOutput = await callResumeExecute(resumeTool, { session_id: TASK_ERROR_SESSION });
  expect(resumeOutput).toContain("Session not preserved or expired.");
  expect(resumeOutput).not.toContain("contextCapsule");
});
```

```typescript
// Test-only regression guard. No production implementation block.
```

**Verify:** `bun test tests/integration/spawn-agent-allsettled.test.ts`
**Commit:** `test(integration): preserve resume behavior with context capsules`
