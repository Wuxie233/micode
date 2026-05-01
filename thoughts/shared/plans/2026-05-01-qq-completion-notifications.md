---
date: 2026-05-01
topic: "QQ Completion Notifications"
issue: 16
scope: notifications
contract: none
---

# QQ Completion Notifications Implementation Plan

**Goal:** Wire a best-effort QQ completion notification layer that fires only on terminal workflow states (completed, blocked, failed-stop), defaults to private QQ user `445714414`, sanitizes summaries, deduplicates per task, and never propagates failure back into the core workflow.

**Architecture:** A new `src/notifications/` module owns the notification boundary: policy decides whether a terminal state notifies, composer builds a short sanitized message, dedupe state suppresses repeats, and a `NotificationSink` abstracts delivery. Production wiring delegates delivery to a tiny `notification-courier` subagent that invokes `autoinfo_send_qq_notification`; this keeps the lifecycle and plugin runtime free of direct MCP coupling. Lifecycle integration triggers the notifier on `finish` (completed), on abort paths (failed-stop), and on a new explicit `notifyBlocked` entry point. Primary agents (commander, brainstormer, octto) gain a `<completion-notify>` prompt block so quick-mode and non-lifecycle work uses the same policy through the courier path.

**Design:** [thoughts/shared/designs/2026-05-01-qq-completion-notifications-design.md](../designs/2026-05-01-qq-completion-notifications-design.md)

**Contract:** none (single-domain backend/general feature; no frontend tasks)

**Decisions and gap fills:**

- Delivery from plugin runtime uses an injected `NotificationSink` interface; the production sink is `createCourierSink({ ctx })` which spawns an internal session driving the new `notification-courier` subagent that has access to the autoinfo MCP. This mirrors how `constraintReviewerHook` delegates to `mm-constraint-reviewer`. Tests inject a stub sink.
- Agent-level fallback is implemented as prompt instructions only (commander, brainstormer, octto). Prompts tell agents to call `autoinfo_send_qq_notification` directly at terminal quick-mode/non-lifecycle points and to skip when a lifecycle is active (the lifecycle path already notifies).
- Sanitization rules: drop the message if `detectSecret` matches; strip control characters and newlines; truncate to `config.notifications.maxSummaryChars` (default 200); fall back to a generic terminal-status string when title is empty.
- Deduplication key: `lifecycle:<issueNumber>:<status>` for lifecycle work, `session:<sessionId>:<status>` for quick-mode. A later `completed` status is allowed to fire after an earlier `blocked` for the same key family (per design).
- `failed-stop` = lifecycle abort (`LIFECYCLE_STATES.ABORTED` reached) OR an explicit `notifyFailedStop` invocation from the agent fallback path. Plain commit/finish failures that leave the lifecycle in a recoverable state do NOT trigger failed-stop.
- All delivery exceptions are absorbed inside the sink and never re-raised. The notifier itself wraps the sink call in try/catch and logs via `log.warn("notifications", ...)`.

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2, 1.3, 1.4, 1.5 [foundation - no deps]
Batch 2 (parallel): 2.1, 2.2, 2.3, 2.4, 2.5 [core - depends on batch 1]
Batch 3 (parallel): 3.1, 3.2, 3.3, 3.4, 3.5, 3.6 [integration - depends on batch 2]
Batch 4 (parallel): 4.1 [integration test - depends on batch 3]
```

---

## Batch 1: Foundation (parallel - 5 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4, 1.5

### Task 1.1: Notification types and constants
**File:** `src/notifications/types.ts`
**Test:** `tests/notifications/types.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/notifications/types.test.ts
import { describe, expect, it } from "bun:test";

import {
  NOTIFICATION_STATUSES,
  type NotificationRequest,
  type NotificationStatus,
  type NotificationTarget,
} from "@/notifications/types";

describe("notification types", () => {
  it("exposes the three terminal statuses", () => {
    expect(NOTIFICATION_STATUSES.COMPLETED).toBe("completed");
    expect(NOTIFICATION_STATUSES.BLOCKED).toBe("blocked");
    expect(NOTIFICATION_STATUSES.FAILED_STOP).toBe("failed_stop");
  });

  it("derives the status union from the constant map", () => {
    const statuses: readonly NotificationStatus[] = [
      NOTIFICATION_STATUSES.COMPLETED,
      NOTIFICATION_STATUSES.BLOCKED,
      NOTIFICATION_STATUSES.FAILED_STOP,
    ];
    expect(statuses.length).toBe(3);
  });

  it("accepts a fully-formed notification request", () => {
    const target: NotificationTarget = { kind: "private", userId: "445714414" };
    const request: NotificationRequest = {
      key: "lifecycle:16:completed",
      status: NOTIFICATION_STATUSES.COMPLETED,
      title: "demo",
      summary: "done",
      reference: "https://example.com/issues/16",
      target,
    };
    expect(request.target.kind).toBe("private");
  });
});
```

```typescript
// src/notifications/types.ts
export const NOTIFICATION_STATUSES = {
  COMPLETED: "completed",
  BLOCKED: "blocked",
  FAILED_STOP: "failed_stop",
} as const;

export type NotificationStatus = (typeof NOTIFICATION_STATUSES)[keyof typeof NOTIFICATION_STATUSES];

export interface PrivateTarget {
  readonly kind: "private";
  readonly userId: string;
}

export interface GroupTarget {
  readonly kind: "group";
  readonly groupId: string;
}

export type NotificationTarget = PrivateTarget | GroupTarget;

export interface NotificationRequest {
  readonly key: string;
  readonly status: NotificationStatus;
  readonly title: string;
  readonly summary: string;
  readonly reference: string | null;
  readonly target: NotificationTarget;
}

export interface NotificationContext {
  readonly issueNumber?: number;
  readonly issueUrl?: string;
  readonly sessionId?: string;
  readonly title?: string;
  readonly summary?: string;
  readonly reference?: string | null;
}
```

**Verify:** `bun test tests/notifications/types.test.ts`
**Commit:** `feat(notifications): add notification status and request types`

### Task 1.2: Notifications config block
**File:** `src/utils/config.ts`
**Test:** `tests/utils/config.test.ts` (extend existing test file with new cases)
**Depends:** none
**Domain:** general

```typescript
// tests/utils/config.test.ts (append the following describe block; do NOT remove existing tests)
import { describe, expect, it } from "bun:test";

import { config } from "@/utils/config";

describe("config.notifications", () => {
  it("enables completion notifications by default", () => {
    expect(config.notifications.enabled).toBe(true);
  });

  it("defaults to private QQ user 445714414", () => {
    expect(config.notifications.qqUserId).toBe("445714414");
  });

  it("leaves group routing unset by default", () => {
    expect(config.notifications.qqGroupId).toBeNull();
  });

  it("caps the sanitized summary at 200 characters by default", () => {
    expect(config.notifications.maxSummaryChars).toBe(200);
  });

  it("retains a non-zero dedupe TTL so repeats are suppressed within a session", () => {
    expect(config.notifications.dedupeTtlMs).toBeGreaterThan(0);
  });
});
```

Add this block to `src/utils/config.ts` inside the exported `config` object (after the existing `projectMemory` block, before the closing `} as const;`):

```typescript
  notifications: {
    /** Master switch for completion notifications */
    enabled: true,
    /** Default private QQ user id used when no group is configured */
    qqUserId: "445714414",
    /** Optional group id; when null, notifications go to qqUserId */
    qqGroupId: null as string | null,
    /** Hard cap on the sanitized summary length sent to QQ */
    maxSummaryChars: 200,
    /** TTL for the in-memory dedupe state (ms). Default 6 hours. */
    dedupeTtlMs: 6 * 60 * 60 * 1000,
    /** Maximum number of dedupe entries kept in memory */
    dedupeMaxEntries: 500,
  },
```

**Verify:** `bun test tests/utils/config.test.ts`
**Commit:** `feat(notifications): add config.notifications defaults`

### Task 1.3: Dedupe store
**File:** `src/notifications/dedupe.ts`
**Test:** `tests/notifications/dedupe.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/notifications/dedupe.test.ts
import { describe, expect, it } from "bun:test";

import { createDedupeStore } from "@/notifications/dedupe";
import { NOTIFICATION_STATUSES } from "@/notifications/types";

describe("dedupe store", () => {
  it("returns false on first observation of a key", () => {
    const store = createDedupeStore({ ttlMs: 60_000, maxEntries: 10 });
    expect(store.shouldSuppress("lifecycle:1:completed", NOTIFICATION_STATUSES.COMPLETED)).toBe(false);
    store.record("lifecycle:1:completed", NOTIFICATION_STATUSES.COMPLETED);
  });

  it("returns true when the same key is observed again within TTL", () => {
    const store = createDedupeStore({ ttlMs: 60_000, maxEntries: 10 });
    store.record("lifecycle:1:completed", NOTIFICATION_STATUSES.COMPLETED);
    expect(store.shouldSuppress("lifecycle:1:completed", NOTIFICATION_STATUSES.COMPLETED)).toBe(true);
  });

  it("permits a later completed status after an earlier blocked status for the same task", () => {
    const store = createDedupeStore({ ttlMs: 60_000, maxEntries: 10 });
    store.record("lifecycle:1:blocked", NOTIFICATION_STATUSES.BLOCKED);
    expect(store.shouldSuppress("lifecycle:1:completed", NOTIFICATION_STATUSES.COMPLETED)).toBe(false);
  });

  it("expires entries after the TTL elapses", () => {
    let now = 1000;
    const store = createDedupeStore({ ttlMs: 50, maxEntries: 10, clock: () => now });
    store.record("k", NOTIFICATION_STATUSES.COMPLETED);
    now += 100;
    expect(store.shouldSuppress("k", NOTIFICATION_STATUSES.COMPLETED)).toBe(false);
  });

  it("evicts the oldest entry once maxEntries is exceeded", () => {
    let now = 0;
    const store = createDedupeStore({ ttlMs: 60_000, maxEntries: 2, clock: () => now });
    store.record("a", NOTIFICATION_STATUSES.COMPLETED);
    now += 1;
    store.record("b", NOTIFICATION_STATUSES.COMPLETED);
    now += 1;
    store.record("c", NOTIFICATION_STATUSES.COMPLETED);
    expect(store.shouldSuppress("a", NOTIFICATION_STATUSES.COMPLETED)).toBe(false);
    expect(store.shouldSuppress("b", NOTIFICATION_STATUSES.COMPLETED)).toBe(true);
    expect(store.shouldSuppress("c", NOTIFICATION_STATUSES.COMPLETED)).toBe(true);
  });
});
```

```typescript
// src/notifications/dedupe.ts
import type { NotificationStatus } from "./types";
import { NOTIFICATION_STATUSES } from "./types";

export interface DedupeStore {
  readonly shouldSuppress: (key: string, status: NotificationStatus) => boolean;
  readonly record: (key: string, status: NotificationStatus) => void;
}

export interface DedupeStoreInput {
  readonly ttlMs: number;
  readonly maxEntries: number;
  readonly clock?: () => number;
}

interface DedupeEntry {
  readonly status: NotificationStatus;
  readonly recordedAt: number;
}

const SAME_STATUS_REPEAT_SUPPRESSED = true;

const isExpired = (entry: DedupeEntry, now: number, ttlMs: number): boolean => {
  return now - entry.recordedAt >= ttlMs;
};

const evictExpired = (entries: Map<string, DedupeEntry>, now: number, ttlMs: number): void => {
  for (const [key, entry] of entries) {
    if (isExpired(entry, now, ttlMs)) entries.delete(key);
  }
};

const evictOldest = (entries: Map<string, DedupeEntry>, maxEntries: number): void => {
  while (entries.size > maxEntries) {
    const oldestKey = entries.keys().next().value;
    if (oldestKey === undefined) return;
    entries.delete(oldestKey);
  }
};

export function createDedupeStore(input: DedupeStoreInput): DedupeStore {
  const entries = new Map<string, DedupeEntry>();
  const clock = input.clock ?? Date.now;

  const shouldSuppress = (key: string, status: NotificationStatus): boolean => {
    const now = clock();
    evictExpired(entries, now, input.ttlMs);
    const existing = entries.get(key);
    if (!existing) return false;
    if (existing.status === status) return SAME_STATUS_REPEAT_SUPPRESSED;
    if (existing.status === NOTIFICATION_STATUSES.BLOCKED && status === NOTIFICATION_STATUSES.COMPLETED) return false;
    return SAME_STATUS_REPEAT_SUPPRESSED;
  };

  const record = (key: string, status: NotificationStatus): void => {
    const now = clock();
    entries.set(key, { status, recordedAt: now });
    evictOldest(entries, input.maxEntries);
  };

  return { shouldSuppress, record };
}
```

**Verify:** `bun test tests/notifications/dedupe.test.ts`
**Commit:** `feat(notifications): add in-memory dedupe store with TTL and LRU eviction`

### Task 1.4: Sanitization helpers
**File:** `src/notifications/scrub.ts`
**Test:** `tests/notifications/scrub.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/notifications/scrub.test.ts
import { describe, expect, it } from "bun:test";

import { containsSecret, scrubSummary } from "@/notifications/scrub";

describe("scrubSummary", () => {
  it("collapses internal whitespace and trims edges", () => {
    expect(scrubSummary("  hello\n\tworld  ", 50)).toBe("hello world");
  });

  it("removes ASCII control characters except space", () => {
    expect(scrubSummary("a\u0001b\u0002c", 50)).toBe("abc");
  });

  it("truncates to maxChars and appends an ellipsis when over budget", () => {
    const long = "x".repeat(300);
    const out = scrubSummary(long, 50);
    expect(out.length).toBe(50);
    expect(out.endsWith("...")).toBe(true);
  });

  it("returns an empty string when input is only whitespace", () => {
    expect(scrubSummary("   \n\t  ", 50)).toBe("");
  });
});

describe("containsSecret", () => {
  it("flags github tokens", () => {
    expect(containsSecret("token=ghp_AAAAAAAAAAAAAAAAAAAAAAAAA")).toBe(true);
  });

  it("does not flag normal plain text", () => {
    expect(containsSecret("Lifecycle finished, please review on octto portal")).toBe(false);
  });
});
```

```typescript
// src/notifications/scrub.ts
import { detectSecret } from "@/utils/secret-detect";

const CONTROL_CHAR_PATTERN = /[\u0000-\u0008\u000B-\u001F\u007F]/g;
const WHITESPACE_RUN_PATTERN = /\s+/g;
const ELLIPSIS = "...";
const MIN_TRUNCATION_BUDGET = ELLIPSIS.length + 1;

export function scrubSummary(input: string, maxChars: number): string {
  const stripped = input.replace(CONTROL_CHAR_PATTERN, "");
  const collapsed = stripped.replace(WHITESPACE_RUN_PATTERN, " ").trim();
  if (collapsed.length <= maxChars) return collapsed;
  if (maxChars < MIN_TRUNCATION_BUDGET) return collapsed.slice(0, maxChars);
  return `${collapsed.slice(0, maxChars - ELLIPSIS.length)}${ELLIPSIS}`;
}

export function containsSecret(input: string): boolean {
  return detectSecret(input) !== null;
}
```

**Verify:** `bun test tests/notifications/scrub.test.ts`
**Commit:** `feat(notifications): add summary sanitizer and secret guard`

### Task 1.5: notification-courier subagent config
**File:** `src/agents/notification-courier.ts`
**Test:** `tests/agents/notification-courier.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/agents/notification-courier.test.ts
import { describe, expect, it } from "bun:test";

import { notificationCourierAgent } from "@/agents/notification-courier";

describe("notificationCourierAgent", () => {
  it("is registered as a subagent", () => {
    expect(notificationCourierAgent.mode).toBe("subagent");
  });

  it("instructs the courier to call autoinfo_send_qq_notification", () => {
    expect(notificationCourierAgent.prompt).toContain("autoinfo_send_qq_notification");
  });

  it("forbids editing files or running shell commands", () => {
    expect(notificationCourierAgent.prompt.toLowerCase()).toContain("never edit");
    expect(notificationCourierAgent.prompt.toLowerCase()).toContain("never run");
  });

  it("uses a low temperature for deterministic dispatch", () => {
    expect(notificationCourierAgent.temperature ?? 0).toBeLessThanOrEqual(0.2);
  });
});
```

```typescript
// src/agents/notification-courier.ts
import type { AgentConfig } from "@opencode-ai/sdk";

const PROMPT = `<identity>
You are notification-courier - a single-purpose subagent.
Your only job is to call autoinfo_send_qq_notification with the exact payload provided in the prompt.
You do not summarize, edit, expand, or rephrase the payload.
You do not perform research, file IO, or git operations.
</identity>

<rules>
- Call autoinfo_send_qq_notification exactly once with the provided message and target.
- If group_id is provided, set group_id; otherwise set user_id (default 445714414).
- Never edit files. Never run shell commands. Never spawn other agents.
- If the autoinfo tool is unavailable or fails, return the literal text "delivery_unavailable" and stop.
- On success, return the literal text "delivered" and stop.
</rules>

<output>
Return either "delivered" or "delivery_unavailable". No other text.
</output>`;

export const notificationCourierAgent: AgentConfig = {
  description: "Single-purpose courier that dispatches QQ completion notifications via autoinfo MCP",
  mode: "subagent",
  temperature: 0.0,
  prompt: PROMPT,
};
```

**Verify:** `bun test tests/agents/notification-courier.test.ts`
**Commit:** `feat(notifications): add notification-courier subagent`

---

## Batch 2: Core Notification Module (parallel - 5 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2, 2.3, 2.4, 2.5

### Task 2.1: Notification policy
**File:** `src/notifications/policy.ts`
**Test:** `tests/notifications/policy.test.ts`
**Depends:** 1.1, 1.2, 1.3
**Domain:** general

```typescript
// tests/notifications/policy.test.ts
import { describe, expect, it } from "bun:test";

import { createDedupeStore } from "@/notifications/dedupe";
import { createPolicy } from "@/notifications/policy";
import { NOTIFICATION_STATUSES } from "@/notifications/types";

describe("createPolicy", () => {
  const baseConfig = {
    enabled: true,
    qqUserId: "445714414",
    qqGroupId: null as string | null,
    maxSummaryChars: 200,
    dedupeTtlMs: 60_000,
    dedupeMaxEntries: 100,
  };

  it("admits a first-time terminal status", () => {
    const dedupe = createDedupeStore({ ttlMs: 60_000, maxEntries: 100 });
    const policy = createPolicy({ config: baseConfig, dedupe });
    const decision = policy.evaluate({
      status: NOTIFICATION_STATUSES.COMPLETED,
      issueNumber: 16,
    });
    expect(decision.kind).toBe("notify");
  });

  it("suppresses a duplicate completed status for the same lifecycle issue", () => {
    const dedupe = createDedupeStore({ ttlMs: 60_000, maxEntries: 100 });
    const policy = createPolicy({ config: baseConfig, dedupe });
    policy.commit({ status: NOTIFICATION_STATUSES.COMPLETED, issueNumber: 16 });
    const decision = policy.evaluate({ status: NOTIFICATION_STATUSES.COMPLETED, issueNumber: 16 });
    expect(decision.kind).toBe("suppress");
  });

  it("permits completed after blocked for the same lifecycle issue", () => {
    const dedupe = createDedupeStore({ ttlMs: 60_000, maxEntries: 100 });
    const policy = createPolicy({ config: baseConfig, dedupe });
    policy.commit({ status: NOTIFICATION_STATUSES.BLOCKED, issueNumber: 16 });
    const decision = policy.evaluate({ status: NOTIFICATION_STATUSES.COMPLETED, issueNumber: 16 });
    expect(decision.kind).toBe("notify");
  });

  it("returns disabled when notifications are turned off in config", () => {
    const dedupe = createDedupeStore({ ttlMs: 60_000, maxEntries: 100 });
    const policy = createPolicy({ config: { ...baseConfig, enabled: false }, dedupe });
    const decision = policy.evaluate({ status: NOTIFICATION_STATUSES.COMPLETED, issueNumber: 16 });
    expect(decision.kind).toBe("disabled");
  });

  it("uses session id as the dedupe key when no issue is provided", () => {
    const dedupe = createDedupeStore({ ttlMs: 60_000, maxEntries: 100 });
    const policy = createPolicy({ config: baseConfig, dedupe });
    policy.commit({ status: NOTIFICATION_STATUSES.COMPLETED, sessionId: "sess-1" });
    const decision = policy.evaluate({ status: NOTIFICATION_STATUSES.COMPLETED, sessionId: "sess-1" });
    expect(decision.kind).toBe("suppress");
  });

  it("falls back to a generic key when neither issue nor session is provided", () => {
    const dedupe = createDedupeStore({ ttlMs: 60_000, maxEntries: 100 });
    const policy = createPolicy({ config: baseConfig, dedupe });
    const decision = policy.evaluate({ status: NOTIFICATION_STATUSES.FAILED_STOP });
    expect(decision.kind).toBe("notify");
    expect(decision.key).toContain("anonymous");
  });
});
```

```typescript
// src/notifications/policy.ts
import type { DedupeStore } from "./dedupe";
import type { NotificationContext, NotificationStatus, NotificationTarget } from "./types";

export interface PolicyConfig {
  readonly enabled: boolean;
  readonly qqUserId: string;
  readonly qqGroupId: string | null;
  readonly maxSummaryChars: number;
  readonly dedupeTtlMs: number;
  readonly dedupeMaxEntries: number;
}

export interface PolicyEvaluation {
  readonly status: NotificationStatus;
  readonly issueNumber?: number;
  readonly sessionId?: string;
}

export type PolicyDecision =
  | { readonly kind: "disabled" }
  | { readonly kind: "suppress"; readonly key: string }
  | { readonly kind: "notify"; readonly key: string; readonly target: NotificationTarget };

export interface Policy {
  readonly evaluate: (input: PolicyEvaluation) => PolicyDecision;
  readonly commit: (input: PolicyEvaluation) => void;
  readonly buildKey: (input: PolicyEvaluation) => string;
  readonly buildTarget: () => NotificationTarget;
}

export interface PolicyInput {
  readonly config: PolicyConfig;
  readonly dedupe: DedupeStore;
}

const ANONYMOUS_OWNER = "anonymous";

const buildKey = (input: PolicyEvaluation): string => {
  if (input.issueNumber !== undefined) return `lifecycle:${input.issueNumber}:${input.status}`;
  if (input.sessionId !== undefined) return `session:${input.sessionId}:${input.status}`;
  return `${ANONYMOUS_OWNER}:${input.status}:${Date.now()}`;
};

const buildTarget = (config: PolicyConfig): NotificationTarget => {
  if (config.qqGroupId !== null) return { kind: "group", groupId: config.qqGroupId };
  return { kind: "private", userId: config.qqUserId };
};

export function createPolicy(input: PolicyInput): Policy {
  const evaluate = (params: PolicyEvaluation): PolicyDecision => {
    if (!input.config.enabled) return { kind: "disabled" };
    const key = buildKey(params);
    if (input.dedupe.shouldSuppress(key, params.status)) return { kind: "suppress", key };
    return { kind: "notify", key, target: buildTarget(input.config) };
  };

  const commit = (params: PolicyEvaluation): void => {
    input.dedupe.record(buildKey(params), params.status);
  };

  return {
    evaluate,
    commit,
    buildKey,
    buildTarget: () => buildTarget(input.config),
  };
}

export type { NotificationContext };
```

**Verify:** `bun test tests/notifications/policy.test.ts`
**Commit:** `feat(notifications): add terminal-state notification policy`

### Task 2.2: Message composer
**File:** `src/notifications/composer.ts`
**Test:** `tests/notifications/composer.test.ts`
**Depends:** 1.1, 1.4
**Domain:** general

```typescript
// tests/notifications/composer.test.ts
import { describe, expect, it } from "bun:test";

import { composeMessage } from "@/notifications/composer";
import { NOTIFICATION_STATUSES } from "@/notifications/types";

describe("composeMessage", () => {
  it("includes the status, sanitized title, and reference URL", () => {
    const message = composeMessage({
      status: NOTIFICATION_STATUSES.COMPLETED,
      title: "Add QQ notifications",
      summary: "all batches green",
      reference: "https://github.com/example/repo/issues/16",
      maxSummaryChars: 200,
    });
    expect(message).toContain("[completed]");
    expect(message).toContain("Add QQ notifications");
    expect(message).toContain("https://github.com/example/repo/issues/16");
  });

  it("falls back to a generic label when title is empty", () => {
    const message = composeMessage({
      status: NOTIFICATION_STATUSES.BLOCKED,
      title: "",
      summary: "",
      reference: null,
      maxSummaryChars: 200,
    });
    expect(message).toContain("[blocked]");
    expect(message).toContain("micode task");
  });

  it("scrubs control characters and truncates the summary", () => {
    const message = composeMessage({
      status: NOTIFICATION_STATUSES.COMPLETED,
      title: "demo",
      summary: `${"x".repeat(500)}\u0001\u0002`,
      reference: null,
      maxSummaryChars: 50,
    });
    expect(message.length).toBeLessThan(500);
    expect(message).not.toContain("\u0001");
  });

  it("drops the summary entirely when it would contain a secret", () => {
    const message = composeMessage({
      status: NOTIFICATION_STATUSES.COMPLETED,
      title: "demo",
      summary: "leak ghp_AAAAAAAAAAAAAAAAAAAAAAAAA hello",
      reference: null,
      maxSummaryChars: 200,
    });
    expect(message).not.toContain("ghp_");
    expect(message).toContain("[redacted]");
  });

  it("emits the standard review instruction at the end of every message", () => {
    const message = composeMessage({
      status: NOTIFICATION_STATUSES.FAILED_STOP,
      title: "x",
      summary: "y",
      reference: null,
      maxSummaryChars: 200,
    });
    expect(message).toContain("Return to OpenCode");
  });
});
```

```typescript
// src/notifications/composer.ts
import { containsSecret, scrubSummary } from "./scrub";
import type { NotificationStatus } from "./types";

export interface ComposeInput {
  readonly status: NotificationStatus;
  readonly title: string;
  readonly summary: string;
  readonly reference: string | null;
  readonly maxSummaryChars: number;
}

const GENERIC_TITLE = "micode task";
const REVIEW_INSTRUCTION = "Return to OpenCode to review.";
const REDACTED_PLACEHOLDER = "[redacted]";
const TITLE_MAX_CHARS = 80;
const LINE_BREAK = "\n";

const sanitizeTitle = (title: string): string => {
  const cleaned = scrubSummary(title, TITLE_MAX_CHARS);
  if (cleaned.length === 0) return GENERIC_TITLE;
  return cleaned;
};

const sanitizeSummary = (summary: string, maxSummaryChars: number): string => {
  const cleaned = scrubSummary(summary, maxSummaryChars);
  if (cleaned.length === 0) return "";
  if (containsSecret(cleaned)) return REDACTED_PLACEHOLDER;
  return cleaned;
};

const formatReference = (reference: string | null): string => {
  if (reference === null) return "";
  const cleaned = scrubSummary(reference, TITLE_MAX_CHARS * 2);
  if (cleaned.length === 0) return "";
  return `${LINE_BREAK}${cleaned}`;
};

export function composeMessage(input: ComposeInput): string {
  const title = sanitizeTitle(input.title);
  const summary = sanitizeSummary(input.summary, input.maxSummaryChars);
  const summaryLine = summary.length > 0 ? `${LINE_BREAK}${summary}` : "";
  const reference = formatReference(input.reference);
  return `[${input.status}] ${title}${summaryLine}${reference}${LINE_BREAK}${REVIEW_INSTRUCTION}`;
}
```

**Verify:** `bun test tests/notifications/composer.test.ts`
**Commit:** `feat(notifications): add sanitized message composer`

### Task 2.3: Delivery sink interface and courier-backed implementation
**File:** `src/notifications/delivery.ts`
**Test:** `tests/notifications/delivery.test.ts`
**Depends:** 1.1
**Domain:** general

```typescript
// tests/notifications/delivery.test.ts
import { describe, expect, it } from "bun:test";

import { createCourierSink, createNoopSink } from "@/notifications/delivery";
import { NOTIFICATION_STATUSES, type NotificationRequest } from "@/notifications/types";

const sampleRequest = (): NotificationRequest => ({
  key: "lifecycle:1:completed",
  status: NOTIFICATION_STATUSES.COMPLETED,
  title: "demo",
  summary: "done",
  reference: null,
  target: { kind: "private", userId: "445714414" },
});

describe("createNoopSink", () => {
  it("records every delivery without throwing", async () => {
    const sink = createNoopSink();
    await sink.deliver(sampleRequest(), "[completed] demo\nReturn to OpenCode to review.");
    expect(sink.deliveries.length).toBe(1);
  });
});

describe("createCourierSink", () => {
  it("invokes the injected courier with target and message", async () => {
    const calls: Array<{ target: NotificationRequest["target"]; message: string }> = [];
    const sink = createCourierSink({
      invoke: async (target, message) => {
        calls.push({ target, message });
      },
    });
    await sink.deliver(sampleRequest(), "[completed] demo");
    expect(calls.length).toBe(1);
    expect(calls[0].message).toBe("[completed] demo");
  });

  it("absorbs courier failures so workflow callers never throw", async () => {
    const sink = createCourierSink({
      invoke: async () => {
        throw new Error("courier offline");
      },
    });
    await expect(sink.deliver(sampleRequest(), "[completed] demo")).resolves.toBeUndefined();
  });
});
```

```typescript
// src/notifications/delivery.ts
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import type { NotificationRequest, NotificationTarget } from "./types";

const LOG_MODULE = "notifications";

export interface NotificationSink {
  readonly deliver: (request: NotificationRequest, renderedMessage: string) => Promise<void>;
}

export interface RecordingSink extends NotificationSink {
  readonly deliveries: ReadonlyArray<{ readonly request: NotificationRequest; readonly message: string }>;
}

export function createNoopSink(): RecordingSink {
  const deliveries: Array<{ readonly request: NotificationRequest; readonly message: string }> = [];
  return {
    deliveries,
    deliver: async (request, message) => {
      deliveries.push({ request, message });
      log.info(LOG_MODULE, `noop sink recorded ${request.status} for ${request.key}`);
    },
  };
}

export type CourierInvoke = (target: NotificationTarget, message: string) => Promise<void>;

export interface CourierSinkInput {
  readonly invoke: CourierInvoke;
}

export function createCourierSink(input: CourierSinkInput): NotificationSink {
  return {
    deliver: async (request, message) => {
      try {
        await input.invoke(request.target, message);
      } catch (error) {
        log.warn(LOG_MODULE, `courier delivery failed: ${extractErrorMessage(error)}`);
      }
    },
  };
}
```

**Verify:** `bun test tests/notifications/delivery.test.ts`
**Commit:** `feat(notifications): add NotificationSink interface, noop and courier sinks`

### Task 2.4: Notifier factory
**File:** `src/notifications/notifier.ts`
**Test:** `tests/notifications/notifier.test.ts`
**Depends:** 2.1, 2.2, 2.3, 1.1, 1.2
**Domain:** general

```typescript
// tests/notifications/notifier.test.ts
import { describe, expect, it } from "bun:test";

import { createDedupeStore } from "@/notifications/dedupe";
import { createNoopSink } from "@/notifications/delivery";
import { createNotifier } from "@/notifications/notifier";
import { createPolicy } from "@/notifications/policy";
import { NOTIFICATION_STATUSES } from "@/notifications/types";

const baseConfig = {
  enabled: true,
  qqUserId: "445714414",
  qqGroupId: null as string | null,
  maxSummaryChars: 200,
  dedupeTtlMs: 60_000,
  dedupeMaxEntries: 100,
};

describe("createNotifier", () => {
  it("delivers a completed notification once per task", async () => {
    const sink = createNoopSink();
    const dedupe = createDedupeStore({ ttlMs: 60_000, maxEntries: 100 });
    const notifier = createNotifier({ config: baseConfig, sink, policy: createPolicy({ config: baseConfig, dedupe }) });

    await notifier.notify({
      status: NOTIFICATION_STATUSES.COMPLETED,
      issueNumber: 16,
      title: "demo",
      summary: "done",
      reference: null,
    });
    await notifier.notify({
      status: NOTIFICATION_STATUSES.COMPLETED,
      issueNumber: 16,
      title: "demo",
      summary: "done",
      reference: null,
    });

    expect(sink.deliveries.length).toBe(1);
  });

  it("never throws when the sink throws", async () => {
    const dedupe = createDedupeStore({ ttlMs: 60_000, maxEntries: 100 });
    const failingSink = {
      deliver: async () => {
        throw new Error("explode");
      },
    };
    const notifier = createNotifier({
      config: baseConfig,
      sink: failingSink,
      policy: createPolicy({ config: baseConfig, dedupe }),
    });

    await expect(
      notifier.notify({
        status: NOTIFICATION_STATUSES.FAILED_STOP,
        issueNumber: 1,
        title: "x",
        summary: "y",
        reference: null,
      }),
    ).resolves.toBeUndefined();
  });

  it("skips delivery when policy reports disabled", async () => {
    const sink = createNoopSink();
    const dedupe = createDedupeStore({ ttlMs: 60_000, maxEntries: 100 });
    const config = { ...baseConfig, enabled: false };
    const notifier = createNotifier({ config, sink, policy: createPolicy({ config, dedupe }) });

    await notifier.notify({
      status: NOTIFICATION_STATUSES.COMPLETED,
      issueNumber: 1,
      title: "x",
      summary: "y",
      reference: null,
    });
    expect(sink.deliveries.length).toBe(0);
  });
});
```

```typescript
// src/notifications/notifier.ts
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import { composeMessage } from "./composer";
import type { NotificationSink } from "./delivery";
import type { Policy, PolicyConfig } from "./policy";
import type { NotificationStatus } from "./types";

const LOG_MODULE = "notifications";

export interface NotifyInput {
  readonly status: NotificationStatus;
  readonly issueNumber?: number;
  readonly sessionId?: string;
  readonly title: string;
  readonly summary: string;
  readonly reference: string | null;
}

export interface CompletionNotifier {
  readonly notify: (input: NotifyInput) => Promise<void>;
}

export interface NotifierInput {
  readonly config: PolicyConfig;
  readonly sink: NotificationSink;
  readonly policy: Policy;
}

export function createNotifier(input: NotifierInput): CompletionNotifier {
  const notify = async (event: NotifyInput): Promise<void> => {
    try {
      const decision = input.policy.evaluate({
        status: event.status,
        issueNumber: event.issueNumber,
        sessionId: event.sessionId,
      });
      if (decision.kind !== "notify") return;

      const message = composeMessage({
        status: event.status,
        title: event.title,
        summary: event.summary,
        reference: event.reference,
        maxSummaryChars: input.config.maxSummaryChars,
      });

      await input.sink.deliver(
        {
          key: decision.key,
          status: event.status,
          title: event.title,
          summary: event.summary,
          reference: event.reference,
          target: decision.target,
        },
        message,
      );
      input.policy.commit({ status: event.status, issueNumber: event.issueNumber, sessionId: event.sessionId });
    } catch (error) {
      log.warn(LOG_MODULE, `notify failed: ${extractErrorMessage(error)}`);
    }
  };

  return { notify };
}
```

**Verify:** `bun test tests/notifications/notifier.test.ts`
**Commit:** `feat(notifications): add notifier factory tying policy, composer, and sink`

### Task 2.5: Notifications barrel export
**File:** `src/notifications/index.ts`
**Test:** none (barrel only)
**Depends:** 2.1, 2.2, 2.3, 2.4, 1.1, 1.3
**Domain:** general

```typescript
// no test file - barrel export only
```

```typescript
// src/notifications/index.ts
export type { DedupeStore, DedupeStoreInput } from "./dedupe";
export { createDedupeStore } from "./dedupe";
export type { CourierInvoke, CourierSinkInput, NotificationSink, RecordingSink } from "./delivery";
export { createCourierSink, createNoopSink } from "./delivery";
export type { CompletionNotifier, NotifierInput, NotifyInput } from "./notifier";
export { createNotifier } from "./notifier";
export type { Policy, PolicyConfig, PolicyDecision, PolicyEvaluation, PolicyInput } from "./policy";
export { createPolicy } from "./policy";
export { containsSecret, scrubSummary } from "./scrub";
export type {
  GroupTarget,
  NotificationContext,
  NotificationRequest,
  NotificationStatus,
  NotificationTarget,
  PrivateTarget,
} from "./types";
export { NOTIFICATION_STATUSES } from "./types";
```

**Verify:** `bun build --target=bun src/notifications/index.ts --outfile=/tmp/notifications-bundle.js`
**Commit:** `feat(notifications): expose notifications barrel`

---

## Batch 3: Integration (parallel - 6 implementers)

All tasks in this batch depend on Batch 2 completing.
Tasks: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6

### Task 3.1: Lifecycle integration with notifier
**File:** `src/lifecycle/index.ts`
**Test:** `tests/lifecycle/notifier-integration.test.ts`
**Depends:** 2.4, 2.5, 1.1
**Domain:** backend

This task extends the existing `LifecycleStoreInput` with an optional `notifier` and wires three terminal triggers:

1. After `finishLifecycle` returns merged → `completed`.
2. Inside `abortStart` and `abortRecord` → `failed_stop`.
3. New public method `notifyBlocked(issueNumber, summary)` on the handle → `blocked`.

Apply the following targeted edits to `src/lifecycle/index.ts`. The full file is too large to repeat here; the implementer must preserve all surrounding code and only insert/modify the regions described below.

**Edit A — extend `LifecycleHandle`:** add a `notifyBlocked` method.

```typescript
export interface LifecycleHandle {
  readonly start: (input: StartRequestInput) => Promise<LifecycleRecord>;
  readonly recordArtifact: (issueNumber: number, kind: ArtifactKind, pointer: string) => Promise<LifecycleRecord>;
  readonly commit: (issueNumber: number, input: CommitInput) => Promise<CommitOutcome>;
  readonly finish: (issueNumber: number, input: FinishInput) => Promise<FinishOutcome>;
  readonly load: (issueNumber: number) => Promise<LifecycleRecord | null>;
  readonly setState: (issueNumber: number, state: LifecycleState) => Promise<LifecycleRecord>;
  readonly recordExecutorEvent: (input: ExecutorEventInput) => Promise<void>;
  readonly decideRecovery: (issueNumber: number, currentOwner: string) => Promise<RecoveryDecision>;
  readonly notifyBlocked: (issueNumber: number, summary: string) => Promise<void>;
}
```

**Edit B — extend `LifecycleStoreInput`:** add an optional `notifier`.

```typescript
import type { CompletionNotifier } from "@/notifications";

export interface LifecycleStoreInput {
  readonly runner: LifecycleRunner;
  readonly worktreesRoot: string;
  readonly cwd: string;
  readonly baseDir?: string;
  readonly progress?: ProgressEmitter;
  readonly journal?: JournalStore;
  readonly lease?: LeaseStore;
  readonly notifier?: CompletionNotifier;
}
```

**Edit C — extend `LifecycleContext`:**

```typescript
interface LifecycleContext {
  readonly runner: LifecycleRunner;
  readonly store: LifecycleStore;
  readonly worktreesRoot: string;
  readonly cwd: string;
  readonly progress?: ProgressEmitter;
  readonly journal: JournalStore;
  readonly lease: LeaseStore;
  readonly notifier?: CompletionNotifier;
}
```

**Edit D — add a small helper near `safeEmit`:**

```typescript
import { NOTIFICATION_STATUSES, type NotificationStatus } from "@/notifications";

const safeNotify = async (
  context: LifecycleContext,
  status: NotificationStatus,
  record: LifecycleRecord,
  summary: string,
): Promise<void> => {
  if (!context.notifier) return;
  try {
    await context.notifier.notify({
      status,
      issueNumber: record.issueNumber,
      title: record.branch,
      summary,
      reference: record.issueUrl.length > 0 ? record.issueUrl : null,
    });
  } catch (error) {
    log.warn("lifecycle.notify", `notify failed: ${extractErrorMessage(error)}`);
  }
};
```

**Edit E — abort paths emit failed_stop:** at the end of `abortStart`, after `await context.store.save(record);`, append `await safeNotify(context, NOTIFICATION_STATUSES.FAILED_STOP, record, note);`. Likewise at the end of `abortRecord`, after the existing `saveAndSync` call, capture the returned record and append the same `safeNotify` call.

```typescript
const abortStart = async (
  context: LifecycleContext,
  input: StartRequestInput,
  preflight: PreFlightResult,
  note: string,
): Promise<LifecycleRecord> => {
  const identity = {
    issueNumber: ABORTED_ISSUE_NUMBER,
    issueUrl: issueUrlFor(preflight, ABORTED_ISSUE_NUMBER),
  };
  const record = createRecord(input, context.worktreesRoot, identity, LIFECYCLE_STATES.ABORTED, [
    note,
    ABORTED_SENTINEL_NOTE,
  ]);
  await context.store.save(record);
  await safeNotify(context, NOTIFICATION_STATUSES.FAILED_STOP, record, note);
  return record;
};

const abortRecord = async (
  context: LifecycleContext,
  record: LifecycleRecord,
  note: string,
): Promise<LifecycleRecord> => {
  const aborted = touch({ ...record, state: LIFECYCLE_STATES.ABORTED, notes: [...record.notes, note] });
  const saved = await saveAndSync(context, aborted);
  await safeNotify(context, NOTIFICATION_STATUSES.FAILED_STOP, saved, note);
  return saved;
};
```

**Edit F — completed notification at the end of `createFinisher`:** after `await safeEmit(...)`, before `return outcome;`, append a notify call ONLY when the lifecycle finish succeeded.

```typescript
const createFinisher = (context: LifecycleContext): LifecycleHandle["finish"] => {
  return async (issueNumber, finishInput) => {
    const record = await requireRecord(context.store, issueNumber);
    const merging = await saveAndSync(context, advanceTo(record, LIFECYCLE_STATES.MERGING));
    const resolvedBranch = await resolveDefaultBranch(context.runner, { cwd: context.cwd });
    const finished = await finishLifecycle(context.runner, {
      cwd: context.cwd,
      branch: merging.branch,
      worktree: merging.worktree,
      mergeStrategy: finishInput.mergeStrategy,
      waitForChecks: finishInput.waitForChecks,
      baseBranch: resolvedBranch.branch,
    });
    const annotated = annotateWithResolvedBranch(finished, resolvedBranch);
    const outcome = await closeMergedIssue(context.runner, issueNumber, annotated, context.cwd);
    const promoted = await promoteFinishedRecord(merging, outcome, context);
    const final = await saveAndSync(context, applyFinishOutcome(promoted, outcome));
    await safeEmit(context, issueNumber, `Finished: merged=${outcome.merged}, prUrl=${outcome.prUrl ?? "(none)"}`);
    if (outcome.merged) {
      await safeNotify(context, NOTIFICATION_STATUSES.COMPLETED, final, `merged: ${outcome.prUrl ?? "(local merge)"}`);
    }
    return outcome;
  };
};
```

**Edit G — new `createBlockedNotifier` factory + handle binding:**

```typescript
const createBlockedNotifier = (context: LifecycleContext): LifecycleHandle["notifyBlocked"] => {
  return async (issueNumber, summary) => {
    const record = await context.store.load(issueNumber);
    if (!record) {
      if (!context.notifier) return;
      await context.notifier.notify({
        status: NOTIFICATION_STATUSES.BLOCKED,
        issueNumber,
        title: `issue-${issueNumber}`,
        summary,
        reference: null,
      });
      return;
    }
    await safeNotify(context, NOTIFICATION_STATUSES.BLOCKED, record, summary);
  };
};
```

**Edit H — wire into `createLifecycleStore`'s returned handle:**

```typescript
  return {
    start: createStart(context),
    recordArtifact: createArtifactRecorder(context),
    commit: createCommitter(context),
    finish: createFinisher(context),
    load: store.load,
    setState: createStateSetter(context),
    recordExecutorEvent: createExecutorEventRecorder(context),
    decideRecovery: createRecoveryDecider(context),
    notifyBlocked: createBlockedNotifier(context),
  };
```

And ensure the `LifecycleContext` instance includes `notifier: input.notifier`.

```typescript
// tests/lifecycle/notifier-integration.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLifecycleStore, LIFECYCLE_STATES } from "@/lifecycle";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import type { CompletionNotifier, NotifyInput } from "@/notifications";
import { NOTIFICATION_STATUSES } from "@/notifications";

const PREFIX = "micode-notify-";
const ORIGIN = "git@github.com:Wuxie233/micode.git";
const ISSUE_URL = "https://github.com/Wuxie233/micode/issues/1";
const SHA = "abc123";

const okRun = (stdout = "", exitCode = 0, stderr = ""): RunResult => ({ stdout, stderr, exitCode });

const createRunner = (overrides: Partial<{ repoView: string }> = {}): LifecycleRunner => ({
  git: async (args) => {
    if (args[0] === "remote" && args[1] === "get-url") return okRun(`${ORIGIN}\n`);
    if (args[0] === "symbolic-ref") return okRun("origin/main\n");
    if (args[0] === "rev-parse") return okRun(`${SHA}\n`);
    return okRun();
  },
  gh: async (args) => {
    if (args[0] === "repo" && args[1] === "view") {
      return okRun(
        overrides.repoView ??
          JSON.stringify({
            nameWithOwner: "Wuxie233/micode",
            isFork: true,
            parent: { nameWithOwner: "vtemian/micode", url: "https://example.com" },
            owner: { login: "Wuxie233" },
            viewerPermission: "ADMIN",
            hasIssuesEnabled: true,
          }),
      );
    }
    if (args[0] === "issue" && args[1] === "create") return okRun(`${ISSUE_URL}\n`);
    if (args[0] === "issue" && args[1] === "view") return okRun(JSON.stringify({ body: "" }));
    return okRun();
  },
});

const createRecordingNotifier = (): { notifier: CompletionNotifier; events: NotifyInput[] } => {
  const events: NotifyInput[] = [];
  return {
    events,
    notifier: { notify: async (event) => void events.push(event) },
  };
};

describe("lifecycle notifier integration", () => {
  let baseDir: string;
  let worktreesRoot: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), PREFIX));
    worktreesRoot = mkdtempSync(join(tmpdir(), `${PREFIX}wt-`));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    rmSync(worktreesRoot, { recursive: true, force: true });
  });

  it("emits completed exactly once after a successful finish", async () => {
    const { notifier, events } = createRecordingNotifier();
    const handle = createLifecycleStore({
      runner: createRunner(),
      worktreesRoot,
      cwd: worktreesRoot,
      baseDir,
      notifier,
    });
    const started = await handle.start({ summary: "demo", goals: [], constraints: [] });
    await handle.finish(started.issueNumber, { mergeStrategy: "local-merge", waitForChecks: false });

    const completed = events.filter((e) => e.status === NOTIFICATION_STATUSES.COMPLETED);
    expect(completed.length).toBe(1);
    expect(completed[0].issueNumber).toBe(started.issueNumber);
  });

  it("emits failed_stop when start is aborted", async () => {
    const upstream = JSON.stringify({
      nameWithOwner: "vtemian/micode",
      isFork: false,
      parent: null,
      owner: { login: "vtemian" },
      viewerPermission: "READ",
      hasIssuesEnabled: true,
    });
    const { notifier, events } = createRecordingNotifier();
    const handle = createLifecycleStore({
      runner: createRunner({ repoView: upstream }),
      worktreesRoot,
      cwd: worktreesRoot,
      baseDir,
      notifier,
    });
    const record = await handle.start({ summary: "demo", goals: [], constraints: [] });
    expect(record.state).toBe(LIFECYCLE_STATES.ABORTED);
    expect(events.some((e) => e.status === NOTIFICATION_STATUSES.FAILED_STOP)).toBe(true);
  });

  it("emits blocked when notifyBlocked is invoked", async () => {
    const { notifier, events } = createRecordingNotifier();
    const handle = createLifecycleStore({
      runner: createRunner(),
      worktreesRoot,
      cwd: worktreesRoot,
      baseDir,
      notifier,
    });
    const started = await handle.start({ summary: "demo", goals: [], constraints: [] });
    await handle.notifyBlocked(started.issueNumber, "needs decision");

    const blocked = events.filter((e) => e.status === NOTIFICATION_STATUSES.BLOCKED);
    expect(blocked.length).toBe(1);
    expect(blocked[0].summary).toBe("needs decision");
  });

  it("never throws when the notifier itself throws", async () => {
    const handle = createLifecycleStore({
      runner: createRunner(),
      worktreesRoot,
      cwd: worktreesRoot,
      baseDir,
      notifier: {
        notify: async () => {
          throw new Error("boom");
        },
      },
    });
    const started = await handle.start({ summary: "demo", goals: [], constraints: [] });
    await expect(
      handle.finish(started.issueNumber, { mergeStrategy: "local-merge", waitForChecks: false }),
    ).resolves.toMatchObject({ merged: true });
  });

  it("works without a notifier (backward compatible)", async () => {
    const handle = createLifecycleStore({
      runner: createRunner(),
      worktreesRoot,
      cwd: worktreesRoot,
      baseDir,
    });
    const started = await handle.start({ summary: "demo", goals: [], constraints: [] });
    await expect(
      handle.finish(started.issueNumber, { mergeStrategy: "local-merge", waitForChecks: false }),
    ).resolves.toMatchObject({ merged: true });
  });
});
```

**Verify:** `bun test tests/lifecycle/notifier-integration.test.ts tests/lifecycle/index.test.ts`
**Commit:** `feat(lifecycle): emit completion notifications at terminal states`

### Task 3.2: Plugin wiring of notifier in src/index.ts
**File:** `src/index.ts`
**Test:** `tests/index-wiring.test.ts` (extend existing test file with one new case)
**Depends:** 2.4, 2.5, 1.5, 3.1
**Domain:** backend

Apply the following targeted edits to `src/index.ts`. Preserve all existing code unless replaced.

**Edit A — add imports near the top of the import block:**

```typescript
import {
  createDedupeStore,
  createCourierSink,
  createNoopSink,
  createNotifier,
  createPolicy,
  type CompletionNotifier,
  type NotificationTarget,
} from "@/notifications";
```

**Edit B — add a courier helper before `OpenCodeConfigPlugin`:**

```typescript
const NOTIFICATION_COURIER_AGENT = "notification-courier";
const NOTIFICATION_COURIER_TITLE = "notification-courier";

function buildCourierPrompt(target: NotificationTarget, message: string): string {
  if (target.kind === "group") {
    return `Call autoinfo_send_qq_notification with group_id="${target.groupId}" and the following message exactly:\n\n${message}`;
  }
  return `Call autoinfo_send_qq_notification with user_id="${target.userId}" and the following message exactly:\n\n${message}`;
}

function buildCourierInvoke(ctx: PluginInput): (target: NotificationTarget, message: string) => Promise<void> {
  return async (target, message) => {
    let sessionId: string | undefined;
    try {
      const created = await createInternalSession({ ctx, title: NOTIFICATION_COURIER_TITLE });
      sessionId = created.sessionId;
      await ctx.client.session.prompt({
        path: { id: sessionId },
        body: {
          agent: NOTIFICATION_COURIER_AGENT,
          tools: {},
          parts: [{ type: "text", text: buildCourierPrompt(target, message) }],
        },
      });
    } catch (error) {
      log.warn("notifications", `courier session failed: ${extractErrorMessage(error)}`);
    } finally {
      if (sessionId) {
        await deleteInternalSession({ ctx, sessionId, agent: NOTIFICATION_COURIER_AGENT });
      }
    }
  };
}

function buildCompletionNotifier(ctx: PluginInput): CompletionNotifier {
  const policyConfig = {
    enabled: config.notifications.enabled,
    qqUserId: config.notifications.qqUserId,
    qqGroupId: config.notifications.qqGroupId,
    maxSummaryChars: config.notifications.maxSummaryChars,
    dedupeTtlMs: config.notifications.dedupeTtlMs,
    dedupeMaxEntries: config.notifications.dedupeMaxEntries,
  };
  const dedupe = createDedupeStore({
    ttlMs: policyConfig.dedupeTtlMs,
    maxEntries: policyConfig.dedupeMaxEntries,
  });
  const sink = config.notifications.enabled
    ? createCourierSink({ invoke: buildCourierInvoke(ctx) })
    : createNoopSink();
  return createNotifier({
    config: policyConfig,
    sink,
    policy: createPolicy({ config: policyConfig, dedupe }),
  });
}
```

**Edit C — instantiate notifier and pass to `createLifecycleStore`:** locate the existing `lifecycleHandle = createLifecycleStore({ ... })` call inside `OpenCodeConfigPlugin` and add `notifier: buildCompletionNotifier(ctx),` to its options.

```typescript
  const completionNotifier = buildCompletionNotifier(ctx);
  const lifecycleHandle = createLifecycleStore({
    runner: createLifecycleRunner(),
    worktreesRoot: dirname(ctx.directory),
    cwd: ctx.directory,
    progress: lifecycleProgress,
    journal: lifecycleJournal,
    lease: lifecycleLease,
    notifier: completionNotifier,
  });
```

```typescript
// tests/index-wiring.test.ts (append the following describe block to the existing file)
import { describe, expect, it } from "bun:test";

describe("notifications wiring", () => {
  it("does not throw when imported", async () => {
    const mod = await import("@/index");
    expect(typeof mod.OpenCodeConfigPlugin).toBe("function");
  });
});
```

**Verify:** `bun test tests/index-wiring.test.ts && bun run typecheck`
**Commit:** `feat(notifications): wire completion notifier into plugin runtime`

### Task 3.3: Commander prompt update
**File:** `src/agents/commander.ts`
**Test:** `tests/agents/commander-notify.test.ts`
**Depends:** none (independent file edit)
**Domain:** general

Insert a new `<completion-notify>` block into the existing `PROMPT` constant in `src/agents/commander.ts`, placed after the `<workflow>` section and before `<agents>`. Do not remove or reorder existing blocks. The block must contain the exact rules and examples below so the test assertions pass.

```text
<completion-notify priority="high" description="QQ completion notifications for terminal states">
<rule>For lifecycle-driven work, the lifecycle layer already emits the QQ notification on completed/blocked/failed-stop. DO NOT manually call autoinfo_send_qq_notification for lifecycle terminal states.</rule>
<rule>For quick-mode and non-lifecycle work, when the task reaches a terminal state, call autoinfo_send_qq_notification exactly once before returning the final response.</rule>
<rule>Default target: user_id="445714414" (private). Only use group_id when the user explicitly configured a group.</rule>
<rule>Message must be short (under 200 chars), contain status (completed/blocked/failed-stop), brief title, and end with "Return to OpenCode to review."</rule>
<rule>Never include secrets, raw tool output, large logs, or sensitive environment details in the QQ message.</rule>
<rule>If autoinfo is unavailable, do nothing. Never let notification failure break the user task.</rule>
<terminal-states>
<state name="completed">User-visible work finished and ready for review.</state>
<state name="blocked">User decision or external action required to proceed.</state>
<state name="failed-stop">Unrecoverable failure stopped automation.</state>
</terminal-states>
<do-not-notify>
<phase>design completion</phase>
<phase>plan creation</phase>
<phase>individual executor batches</phase>
<phase>reviewer cycles</phase>
<phase>intermediate commits</phase>
</do-not-notify>
</completion-notify>
```

```typescript
// tests/agents/commander-notify.test.ts
import { describe, expect, it } from "bun:test";

import { primaryAgent } from "@/agents/commander";

describe("commander completion-notify prompt block", () => {
  it("contains a completion-notify block", () => {
    expect(primaryAgent.prompt).toContain("<completion-notify");
  });

  it("references the default private QQ user 445714414", () => {
    expect(primaryAgent.prompt).toContain("445714414");
  });

  it("instructs the agent to skip manual notification for lifecycle terminal states", () => {
    expect(primaryAgent.prompt).toMatch(/lifecycle.*already emits/);
  });

  it("lists the three terminal states", () => {
    expect(primaryAgent.prompt).toContain("completed");
    expect(primaryAgent.prompt).toContain("blocked");
    expect(primaryAgent.prompt).toContain("failed-stop");
  });

  it("forbids notifying intermediate phases", () => {
    expect(primaryAgent.prompt).toContain("plan creation");
    expect(primaryAgent.prompt).toContain("reviewer cycles");
  });
});
```

**Verify:** `bun test tests/agents/commander-notify.test.ts`
**Commit:** `feat(commander): add completion-notify prompt block for quick-mode work`

### Task 3.4: Brainstormer prompt update
**File:** `src/agents/brainstormer.ts`
**Test:** `tests/agents/brainstormer-notify.test.ts`
**Depends:** none (independent file edit)
**Domain:** general

Insert the same `<completion-notify>` block (verbatim from Task 3.3) into the brainstormer agent prompt, placed near the end of the agent prompt before the closing closer. Brainstormer typically operates inside an active lifecycle, so the block emphasizes the "lifecycle already notifies" rule. Implementer should locate brainstormer's PROMPT string and insert the block before the final closing tag of the prompt.

```typescript
// tests/agents/brainstormer-notify.test.ts
import { describe, expect, it } from "bun:test";

import { brainstormerAgent } from "@/agents/brainstormer";

describe("brainstormer completion-notify prompt block", () => {
  it("contains a completion-notify block", () => {
    expect(brainstormerAgent.prompt).toContain("<completion-notify");
  });

  it("instructs brainstormer to defer to lifecycle for lifecycle-driven work", () => {
    expect(brainstormerAgent.prompt).toMatch(/lifecycle.*already emits/);
  });

  it("references default private QQ user 445714414", () => {
    expect(brainstormerAgent.prompt).toContain("445714414");
  });
});
```

**Verify:** `bun test tests/agents/brainstormer-notify.test.ts`
**Commit:** `feat(brainstormer): add completion-notify prompt block`

### Task 3.5: Octto agent prompt update
**File:** `src/agents/octto.ts`
**Test:** `tests/agents/octto-notify.test.ts`
**Depends:** none (independent file edit)
**Domain:** general

Insert the same `<completion-notify>` block (verbatim from Task 3.3) into the octto agent prompt. Octto runs as a primary agent for browser-mediated brainstorming and may operate outside lifecycle, so the quick-mode fallback is most relevant here.

```typescript
// tests/agents/octto-notify.test.ts
import { describe, expect, it } from "bun:test";

import { octtoAgent } from "@/agents/octto";

describe("octto completion-notify prompt block", () => {
  it("contains a completion-notify block", () => {
    expect(octtoAgent.prompt).toContain("<completion-notify");
  });

  it("instructs octto to call autoinfo_send_qq_notification at terminal states for non-lifecycle work", () => {
    expect(octtoAgent.prompt).toContain("autoinfo_send_qq_notification");
  });

  it("references default private QQ user 445714414", () => {
    expect(octtoAgent.prompt).toContain("445714414");
  });
});
```

**Verify:** `bun test tests/agents/octto-notify.test.ts`
**Commit:** `feat(octto): add completion-notify prompt block`

### Task 3.6: Register notification-courier in agents barrel
**File:** `src/agents/index.ts`
**Test:** `tests/agents/notification-courier-registration.test.ts`
**Depends:** 1.5
**Domain:** general

Locate `src/agents/index.ts` and add an import + agent map entry for the courier subagent. The implementer must add the courier alongside other subagent registrations (do NOT replace existing entries).

**Edit A — import:**

```typescript
import { notificationCourierAgent } from "./notification-courier";
```

**Edit B — agent map entry:** add a new entry to the agents object literal:

```typescript
  "notification-courier": notificationCourierAgent,
```

**Edit C — re-export at bottom:**

```typescript
export { notificationCourierAgent } from "./notification-courier";
```

```typescript
// tests/agents/notification-courier-registration.test.ts
import { describe, expect, it } from "bun:test";

import { agents } from "@/agents";

describe("notification-courier agent registration", () => {
  it("is registered in the agents map under the kebab-case name", () => {
    expect(agents["notification-courier"]).toBeDefined();
  });

  it("is registered as a subagent", () => {
    expect(agents["notification-courier"]?.mode).toBe("subagent");
  });
});
```

**Verify:** `bun test tests/agents/notification-courier-registration.test.ts`
**Commit:** `feat(agents): register notification-courier subagent`

---

## Batch 4: End-to-end Integration Test (parallel - 1 implementer)

All tasks in this batch depend on Batch 3 completing.
Tasks: 4.1

### Task 4.1: End-to-end QQ completion notification integration test
**File:** `tests/integration/qq-completion-notifications.test.ts`
**Test:** self (integration test)
**Depends:** 3.1, 3.2, 3.6, 2.5
**Domain:** general

This test verifies the full notification path through the lifecycle handle and notifier without spawning real internal sessions. It uses a stub courier invoke that records calls in memory.

```typescript
// tests/integration/qq-completion-notifications.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createLifecycleStore, LIFECYCLE_STATES } from "@/lifecycle";
import type { LifecycleRunner, RunResult } from "@/lifecycle/runner";
import {
  createCourierSink,
  createDedupeStore,
  createNotifier,
  createPolicy,
  NOTIFICATION_STATUSES,
  type NotificationTarget,
} from "@/notifications";

const PREFIX = "micode-qq-notify-int-";
const ORIGIN = "git@github.com:Wuxie233/micode.git";
const ISSUE_URL = "https://github.com/Wuxie233/micode/issues/1";
const SHA = "abc123def";

const okRun = (stdout = "", exitCode = 0, stderr = ""): RunResult => ({ stdout, stderr, exitCode });

const baseConfig = {
  enabled: true,
  qqUserId: "445714414",
  qqGroupId: null as string | null,
  maxSummaryChars: 200,
  dedupeTtlMs: 60_000,
  dedupeMaxEntries: 100,
};

const createRunner = (overrides: Partial<{ repoView: string }> = {}): LifecycleRunner => ({
  git: async (args) => {
    if (args[0] === "remote" && args[1] === "get-url") return okRun(`${ORIGIN}\n`);
    if (args[0] === "symbolic-ref") return okRun("origin/main\n");
    if (args[0] === "rev-parse") return okRun(`${SHA}\n`);
    return okRun();
  },
  gh: async (args) => {
    if (args[0] === "repo" && args[1] === "view") {
      return okRun(
        overrides.repoView ??
          JSON.stringify({
            nameWithOwner: "Wuxie233/micode",
            isFork: true,
            parent: { nameWithOwner: "vtemian/micode", url: "https://example.com" },
            owner: { login: "Wuxie233" },
            viewerPermission: "ADMIN",
            hasIssuesEnabled: true,
          }),
      );
    }
    if (args[0] === "issue" && args[1] === "create") return okRun(`${ISSUE_URL}\n`);
    if (args[0] === "issue" && args[1] === "view") return okRun(JSON.stringify({ body: "" }));
    return okRun();
  },
});

describe("QQ completion notifications end-to-end", () => {
  let baseDir: string;
  let worktreesRoot: string;

  beforeEach(() => {
    baseDir = mkdtempSync(join(tmpdir(), PREFIX));
    worktreesRoot = mkdtempSync(join(tmpdir(), `${PREFIX}wt-`));
  });

  afterEach(() => {
    rmSync(baseDir, { recursive: true, force: true });
    rmSync(worktreesRoot, { recursive: true, force: true });
  });

  it("delivers exactly one completed message via the courier path on successful finish", async () => {
    const calls: Array<{ target: NotificationTarget; message: string }> = [];
    const sink = createCourierSink({
      invoke: async (target, message) => {
        calls.push({ target, message });
      },
    });
    const dedupe = createDedupeStore({ ttlMs: baseConfig.dedupeTtlMs, maxEntries: baseConfig.dedupeMaxEntries });
    const notifier = createNotifier({ config: baseConfig, sink, policy: createPolicy({ config: baseConfig, dedupe }) });

    const handle = createLifecycleStore({
      runner: createRunner(),
      worktreesRoot,
      cwd: worktreesRoot,
      baseDir,
      notifier,
    });

    const started = await handle.start({ summary: "demo", goals: [], constraints: [] });
    await handle.finish(started.issueNumber, { mergeStrategy: "local-merge", waitForChecks: false });

    expect(calls.length).toBe(1);
    expect(calls[0].target.kind).toBe("private");
    expect((calls[0].target as { userId: string }).userId).toBe("445714414");
    expect(calls[0].message).toContain("[completed]");
    expect(calls[0].message).toContain("Return to OpenCode to review.");
  });

  it("suppresses repeated completed deliveries for the same issue", async () => {
    const calls: Array<{ target: NotificationTarget; message: string }> = [];
    const sink = createCourierSink({
      invoke: async (target, message) => {
        calls.push({ target, message });
      },
    });
    const dedupe = createDedupeStore({ ttlMs: baseConfig.dedupeTtlMs, maxEntries: baseConfig.dedupeMaxEntries });
    const notifier = createNotifier({ config: baseConfig, sink, policy: createPolicy({ config: baseConfig, dedupe }) });

    const handle = createLifecycleStore({
      runner: createRunner(),
      worktreesRoot,
      cwd: worktreesRoot,
      baseDir,
      notifier,
    });

    const started = await handle.start({ summary: "demo", goals: [], constraints: [] });
    await handle.finish(started.issueNumber, { mergeStrategy: "local-merge", waitForChecks: false });
    await handle.finish(started.issueNumber, { mergeStrategy: "local-merge", waitForChecks: false });

    expect(calls.length).toBe(1);
  });

  it("delivers blocked then completed for the same issue (blocked does not block later completed)", async () => {
    const calls: Array<{ status: string; target: NotificationTarget }> = [];
    const sink = createCourierSink({
      invoke: async (target, message) => {
        const statusToken = message.match(/\[(completed|blocked|failed_stop)\]/)?.[1] ?? "unknown";
        calls.push({ status: statusToken, target });
      },
    });
    const dedupe = createDedupeStore({ ttlMs: baseConfig.dedupeTtlMs, maxEntries: baseConfig.dedupeMaxEntries });
    const notifier = createNotifier({ config: baseConfig, sink, policy: createPolicy({ config: baseConfig, dedupe }) });

    const handle = createLifecycleStore({
      runner: createRunner(),
      worktreesRoot,
      cwd: worktreesRoot,
      baseDir,
      notifier,
    });

    const started = await handle.start({ summary: "demo", goals: [], constraints: [] });
    await handle.notifyBlocked(started.issueNumber, "needs decision");
    await handle.finish(started.issueNumber, { mergeStrategy: "local-merge", waitForChecks: false });

    expect(calls.map((c) => c.status)).toEqual(["blocked", "completed"]);
  });

  it("delivers failed_stop when start aborts on upstream pre-flight", async () => {
    const upstream = JSON.stringify({
      nameWithOwner: "vtemian/micode",
      isFork: false,
      parent: null,
      owner: { login: "vtemian" },
      viewerPermission: "READ",
      hasIssuesEnabled: true,
    });
    const calls: Array<{ message: string }> = [];
    const sink = createCourierSink({
      invoke: async (_target, message) => {
        calls.push({ message });
      },
    });
    const dedupe = createDedupeStore({ ttlMs: baseConfig.dedupeTtlMs, maxEntries: baseConfig.dedupeMaxEntries });
    const notifier = createNotifier({ config: baseConfig, sink, policy: createPolicy({ config: baseConfig, dedupe }) });

    const handle = createLifecycleStore({
      runner: createRunner({ repoView: upstream }),
      worktreesRoot,
      cwd: worktreesRoot,
      baseDir,
      notifier,
    });

    const record = await handle.start({ summary: "demo", goals: [], constraints: [] });
    expect(record.state).toBe(LIFECYCLE_STATES.ABORTED);
    expect(calls.some((c) => c.message.includes(`[${NOTIFICATION_STATUSES.FAILED_STOP}]`))).toBe(true);
  });

  it("never propagates courier failure into the lifecycle finish outcome", async () => {
    const sink = createCourierSink({
      invoke: async () => {
        throw new Error("autoinfo offline");
      },
    });
    const dedupe = createDedupeStore({ ttlMs: baseConfig.dedupeTtlMs, maxEntries: baseConfig.dedupeMaxEntries });
    const notifier = createNotifier({ config: baseConfig, sink, policy: createPolicy({ config: baseConfig, dedupe }) });

    const handle = createLifecycleStore({
      runner: createRunner(),
      worktreesRoot,
      cwd: worktreesRoot,
      baseDir,
      notifier,
    });

    const started = await handle.start({ summary: "demo", goals: [], constraints: [] });
    const outcome = await handle.finish(started.issueNumber, { mergeStrategy: "local-merge", waitForChecks: false });

    expect(outcome.merged).toBe(true);
  });

  it("does not notify any intermediate phase (recordArtifact, commit)", async () => {
    const calls: Array<{ message: string }> = [];
    const sink = createCourierSink({
      invoke: async (_target, message) => {
        calls.push({ message });
      },
    });
    const dedupe = createDedupeStore({ ttlMs: baseConfig.dedupeTtlMs, maxEntries: baseConfig.dedupeMaxEntries });
    const notifier = createNotifier({ config: baseConfig, sink, policy: createPolicy({ config: baseConfig, dedupe }) });

    const handle = createLifecycleStore({
      runner: createRunner(),
      worktreesRoot,
      cwd: worktreesRoot,
      baseDir,
      notifier,
    });

    const started = await handle.start({ summary: "demo", goals: [], constraints: [] });
    await handle.recordArtifact(started.issueNumber, "plan", "thoughts/shared/plans/x.md");
    await handle.commit(started.issueNumber, { summary: "wip", scope: "demo", push: false });

    expect(calls.length).toBe(0);
  });
});
```

**Verify:** `bun test tests/integration/qq-completion-notifications.test.ts`
**Commit:** `test(notifications): add end-to-end QQ completion notification integration test`
