---
date: 2026-04-30
topic: "main-agent-issue-chinese-titles"
issue: 13
scope: conversation-title
contract: none
---

# Main Agent Issue Chinese Titles Implementation Plan

**Goal:** Make main agent conversation titles use the form `#13 执行中：优化主会话标题生成` when an issue is known, while preserving spawn-agent child session behavior and existing opt-out / throttle / done-freeze semantics.

**Architecture:** Extend the existing three-layer conversation-title pipeline (classifier → state registry → formatter). The classifier learns to extract issue numbers from `lifecycle_start_request` output and from `lifecycle_commit` / `lifecycle_finish` args. The state registry stores `issueNumber` as part of session topic, with sticky semantics (cannot be cleared by lower-confidence signals). The formatter gains a new `buildIssueAwareTitle` path that emits `#N 状态：需求` with full-width colon and prefix-protected truncation. A low-info filter rejects technical tool/agent names (`spawn-agent`, `implementer-*`, `executor`, `reviewer`) and English process phrases (`Create implementation plan`, `Execute implementation plan`).

**Design:** [thoughts/shared/designs/2026-04-30-main-agent-issue-chinese-titles-design.md](../designs/2026-04-30-main-agent-issue-chinese-titles-design.md)

**Contract:** none (single-domain: all changes are in `src/utils/conversation-title/` and `src/hooks/conversation-title.ts`)

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2 [foundation - extend format constants and low-info filters; no deps]
Batch 2 (parallel): 2.1, 2.2 [classifier issue extraction + state registry issue field; depends on 1.1, 1.2]
Batch 3 (parallel): 3.1 [hook wiring; depends on 2.1, 2.2]
Batch 4 (parallel): 4.1 [end-to-end scenario coverage; depends on 3.1]
```

---

## Batch 1: Foundation (parallel - 2 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2

### Task 1.1: Issue-aware formatter and prefix-protected truncation
**File:** `src/utils/conversation-title/format.ts`
**Test:** `tests/utils/conversation-title/format.test.ts`
**Depends:** none
**Domain:** general

Add a new `buildIssueAwareTitle(parts, maxLength)` formatter that emits `#N 状态：需求` with the full-width colon `：` and a `STATUS_SUFFIX_SEPARATOR` of ` · ` for conclusive statuses without summary. Truncation must protect the `#N 状态：` prefix; only the summary portion is truncated with the existing `…` ellipsis. The existing `buildTitle` and `buildTopicTitle` stay untouched (they remain the no-issue fallback).

Design choice: the new formatter accepts an optional `issueNumber: number | null`. When `issueNumber` is null the function falls back to the existing semantics by delegating to `buildTopicTitle`. This keeps a single entry point for the hook layer.

```typescript
// tests/utils/conversation-title/format.test.ts (append to existing describes)
import { describe, expect, it } from "bun:test";

import {
  buildIssueAwareTitle,
  buildTitle,
  summaryFromPlanPath,
  summaryFromUserMessage,
  TITLE_STATUS,
} from "@/utils/conversation-title";

describe("buildIssueAwareTitle", () => {
  it("formats issue-prefixed executing state with full-width colon", () => {
    expect(
      buildIssueAwareTitle({
        issueNumber: 13,
        topic: "优化主会话标题生成",
        status: TITLE_STATUS.EXECUTING,
      }),
    ).toBe("#13 执行中：优化主会话标题生成");
  });

  it("formats issue-prefixed done state with full-width colon", () => {
    expect(
      buildIssueAwareTitle({
        issueNumber: 13,
        topic: "优化主会话标题生成",
        status: TITLE_STATUS.DONE,
      }),
    ).toBe("#13 已完成：优化主会话标题生成");
  });

  it("formats issue-prefixed failed state", () => {
    expect(
      buildIssueAwareTitle({
        issueNumber: 7,
        topic: "修复登录",
        status: TITLE_STATUS.FAILED,
      }),
    ).toBe("#7 失败：修复登录");
  });

  it("falls back to topic title when issueNumber is null", () => {
    expect(
      buildIssueAwareTitle({
        issueNumber: null,
        topic: "优化主会话标题生成",
        status: TITLE_STATUS.EXECUTING,
      }),
    ).toBe("优化主会话标题生成");
  });

  it("falls back to topic title with conclusive suffix when issueNumber is null and status is DONE", () => {
    expect(
      buildIssueAwareTitle({
        issueNumber: null,
        topic: "优化主会话标题生成",
        status: TITLE_STATUS.DONE,
      }),
    ).toBe("优化主会话标题生成 · 已完成");
  });

  it("emits status alone when topic is empty and issueNumber is provided", () => {
    expect(
      buildIssueAwareTitle({
        issueNumber: 13,
        topic: "",
        status: TITLE_STATUS.EXECUTING,
      }),
    ).toBe("#13 执行中");
  });

  it("emits status alone when topic is whitespace and issueNumber is provided", () => {
    expect(
      buildIssueAwareTitle({
        issueNumber: 13,
        topic: "   ",
        status: TITLE_STATUS.PLANNING,
      }),
    ).toBe("#13 规划中");
  });

  it("truncates only the topic and preserves the issue prefix", () => {
    const longTopic = "优".repeat(80);
    const title = buildIssueAwareTitle(
      {
        issueNumber: 999,
        topic: longTopic,
        status: TITLE_STATUS.EXECUTING,
      },
      30,
    );
    expect(title.startsWith("#999 执行中：")).toBe(true);
    expect(title.length).toBeLessThanOrEqual(30);
    expect(title.endsWith("…")).toBe(true);
  });

  it("falls back to status alone when even the prefix overflows maxLength", () => {
    const title = buildIssueAwareTitle(
      {
        issueNumber: 13,
        topic: "anything",
        status: TITLE_STATUS.EXECUTING,
      },
      3,
    );
    expect(title.length).toBeLessThanOrEqual(3);
  });

  it("normalizes whitespace inside the topic", () => {
    expect(
      buildIssueAwareTitle({
        issueNumber: 13,
        topic: "fix\n  bug \t now",
        status: TITLE_STATUS.EXECUTING,
      }),
    ).toBe("#13 执行中：fix bug now");
  });

  // Sanity: the legacy formatters still work
  it("legacy buildTitle still uses ASCII colon", () => {
    expect(buildTitle({ status: TITLE_STATUS.EXECUTING, summary: "x" })).toBe("执行中: x");
  });

  it("plan path helpers still work", () => {
    expect(summaryFromPlanPath("thoughts/shared/plans/2026-04-30-foo-design.md")).toBe("foo");
    expect(summaryFromUserMessage("hi")).toBe("hi");
  });
});
```

```typescript
// src/utils/conversation-title/format.ts
// (Existing exports stay; ADD the following near the bottom of the file, alongside the existing
// buildTopicTitle helpers. Keep all existing constants and exported functions intact.)

const ISSUE_PREFIX_SYMBOL = "#";
const ISSUE_SEPARATOR_FULLWIDTH = "：";
const ISSUE_PREFIX_SPACE = " ";

export interface IssueTitleParts {
  readonly issueNumber: number | null;
  readonly topic: string;
  readonly status: TitleStatus;
}

const buildIssueFixedPrefix = (issueNumber: number, status: TitleStatus): string => {
  return `${ISSUE_PREFIX_SYMBOL}${issueNumber}${ISSUE_PREFIX_SPACE}${status}${ISSUE_SEPARATOR_FULLWIDTH}`;
};

const buildIssueStatusOnly = (issueNumber: number, status: TitleStatus): string => {
  return `${ISSUE_PREFIX_SYMBOL}${issueNumber}${ISSUE_PREFIX_SPACE}${status}`;
};

export function buildIssueAwareTitle(parts: IssueTitleParts, maxLength: number = DEFAULT_MAX_LENGTH): string {
  const topic = normalizeWhitespace(parts.topic);

  if (parts.issueNumber === null) {
    return buildTopicTitle({ topic, status: parts.status }, maxLength);
  }

  if (topic.length === 0) {
    const statusOnly = buildIssueStatusOnly(parts.issueNumber, parts.status);
    return truncate(statusOnly, maxLength);
  }

  const fixed = buildIssueFixedPrefix(parts.issueNumber, parts.status);
  const remaining = maxLength - fixed.length;
  if (remaining <= 0) return truncate(parts.status, maxLength);
  return `${fixed}${truncate(topic, remaining)}`;
}
```

Also add to `src/utils/conversation-title/index.ts`:

```typescript
// src/utils/conversation-title/index.ts
// Keep existing exports. ADD buildIssueAwareTitle and IssueTitleParts to the format re-export block.
export {
  buildIssueAwareTitle,
  buildTitle,
  buildTopicTitle,
  CONCLUSIVE_STATUSES,
  type IssueTitleParts,
  summaryFromPlanPath,
  summaryFromUserMessage,
  TITLE_STATUS,
  type TitleParts,
  type TitleStatus,
  type TopicTitleParts,
} from "./format";
```

**Verify:** `bun test tests/utils/conversation-title/format.test.ts`
**Commit:** `feat(conversation-title): add issue-aware formatter with prefix-protected truncation`

### Task 1.2: Low-info filter expansion for tool/agent names and process phrases
**File:** `src/utils/conversation-title/source.ts`
**Test:** `tests/utils/conversation-title/source.test.ts`
**Depends:** none
**Domain:** general

Extend the existing low-information set with two new groups:

1. Tool/agent technical names: `spawn-agent`, `spawn_agent`, `implementer-frontend`, `implementer-backend`, `implementer-general`, `executor`, `reviewer`, `codebase-locator`, `codebase-analyzer`, `pattern-finder`, `planner`, `brainstormer`, `octto`, `commander`.
2. English process-phrase placeholders: `create implementation plan`, `execute implementation plan`, `creating implementation plan`, `running executor`, `start executor`, `start implementer`.

Also add a new exported helper `isToolLikeTopic(text)` that returns `true` when the text matches a tool/agent name pattern (used by the classifier and state layer to refuse low-quality summaries even before the topic-replace check). The pattern is case-insensitive and trims edge punctuation/whitespace using the existing normalizer.

```typescript
// tests/utils/conversation-title/source.test.ts (extend the existing describe block)
import { describe, expect, it } from "bun:test";

import {
  compareConfidence,
  isLowInformationMessage,
  isToolLikeTopic,
  LOW_INFO_PATTERNS,
  TITLE_SOURCE,
  TITLE_SOURCE_CONFIDENCE,
} from "@/utils/conversation-title/source";

describe("conversation title source - tool/agent low-info expansion", () => {
  const TOOL_NAMES = [
    "spawn-agent",
    "spawn_agent",
    "implementer-frontend",
    "implementer-backend",
    "implementer-general",
    "executor",
    "reviewer",
    "codebase-locator",
    "codebase-analyzer",
    "pattern-finder",
    "planner",
    "brainstormer",
    "octto",
    "commander",
  ] as const;

  const PROCESS_PHRASES = [
    "Create implementation plan",
    "Execute implementation plan",
    "Creating implementation plan",
    "Running executor",
    "Start executor",
    "Start implementer",
  ] as const;

  it("treats every tool/agent name as low information", () => {
    for (const name of TOOL_NAMES) {
      expect(isLowInformationMessage(name)).toBe(true);
    }
  });

  it("treats process-phrase placeholders as low information", () => {
    for (const phrase of PROCESS_PHRASES) {
      expect(isLowInformationMessage(phrase)).toBe(true);
    }
  });

  it("normalizes case for tool/agent low-info patterns", () => {
    expect(isLowInformationMessage("EXECUTOR")).toBe(true);
    expect(isLowInformationMessage(" Implementer-Backend ")).toBe(true);
  });

  it("isToolLikeTopic flags exact tool/agent names", () => {
    for (const name of TOOL_NAMES) {
      expect(isToolLikeTopic(name)).toBe(true);
    }
  });

  it("isToolLikeTopic returns false for genuine Chinese requirement topics", () => {
    expect(isToolLikeTopic("优化主会话标题生成")).toBe(false);
    expect(isToolLikeTopic("自动改名")).toBe(false);
    expect(isToolLikeTopic("中文对话名字")).toBe(false);
  });

  it("isToolLikeTopic returns false for short Chinese task names", () => {
    expect(isToolLikeTopic("登录")).toBe(false);
    expect(isToolLikeTopic("改UI")).toBe(false);
  });

  it("LOW_INFO_PATTERNS exposes the expanded set", () => {
    expect(LOW_INFO_PATTERNS.has("executor")).toBe(true);
    expect(LOW_INFO_PATTERNS.has("create implementation plan")).toBe(true);
  });

  it("preserves existing low-info behavior", () => {
    expect(isLowInformationMessage("继续")).toBe(true);
    expect(isLowInformationMessage("想给 octto 加一个新功能")).toBe(false);
    expect(TITLE_SOURCE_CONFIDENCE[TITLE_SOURCE.LIFECYCLE_ISSUE]).toBe(100);
    expect(compareConfidence(TITLE_SOURCE.LIFECYCLE_ISSUE, TITLE_SOURCE.USER_MESSAGE)).toBeGreaterThan(0);
  });
});
```

```typescript
// src/utils/conversation-title/source.ts
// Keep all existing exports. UPDATE the LOW_INFO_MESSAGES list to include the new tool/agent names
// and process phrases. ADD isToolLikeTopic helper.

const TOOL_AND_AGENT_NAMES = [
  "spawn-agent",
  "spawn_agent",
  "implementer-frontend",
  "implementer-backend",
  "implementer-general",
  "executor",
  "reviewer",
  "codebase-locator",
  "codebase-analyzer",
  "pattern-finder",
  "planner",
  "brainstormer",
  "octto",
  "commander",
] as const;

const PROCESS_PHRASES = [
  "create implementation plan",
  "execute implementation plan",
  "creating implementation plan",
  "running executor",
  "start executor",
  "start implementer",
] as const;

const LOW_INFO_MESSAGES = [
  // ... existing messages ...
  "重启了",
  "什么",
  "继续",
  "接着",
  "ok",
  "okay",
  "好了",
  "好的",
  "收到",
  "嗯",
  "行",
  "done",
  "这是符合预期吗",
  "这是符合预期吗?",
  "这符合预期吗",
  "what did we do so far",
  "what did we do so far?",
  "怎么样",
  "然后呢",
  "next",
  "继续做",
  "继续吧",
  ...TOOL_AND_AGENT_NAMES,
  ...PROCESS_PHRASES,
] as const;

// Reuse the existing normalizer.
const TOOL_LIKE_PATTERNS: ReadonlySet<string> = new Set(
  [...TOOL_AND_AGENT_NAMES].map((name) => normalizeLowInformationMessage(name)),
);

export function isToolLikeTopic(text: string): boolean {
  const normalized = normalizeLowInformationMessage(text);
  if (normalized === EMPTY) return false;
  return TOOL_LIKE_PATTERNS.has(normalized);
}
```

Note for implementer: keep `isLowInformationMessage`, `LOW_INFO_PATTERNS`, `compareConfidence`, `TITLE_SOURCE`, and `TITLE_SOURCE_CONFIDENCE` unchanged in their public shape. The refactor is additive: extend `LOW_INFO_MESSAGES`, add `TOOL_LIKE_PATTERNS` constant, and add the `isToolLikeTopic` export.

**Verify:** `bun test tests/utils/conversation-title/source.test.ts`
**Commit:** `feat(conversation-title): expand low-info filter for tool, agent, and process phrases`

---

## Batch 2: Core Modules (parallel - 2 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2

### Task 2.1: Classifier extracts issue numbers from lifecycle tool inputs and outputs
**File:** `src/utils/conversation-title/classifier.ts`
**Test:** `tests/utils/conversation-title/classifier.test.ts`
**Depends:** 1.1, 1.2

Extend `MilestoneSignal` with a new optional field `issueNumber: number | null`. Detection rules:

- `lifecycle_start_request`: parse the issue number from the tool's stringified output. The output contains a markdown table row `| 13 | \`issue/13-...\` | ...`. Use a regex to capture the first integer in `| <N> |` after the table header, OR the first match of `issue/(\d+)-` in the output. Both succeed for well-formed lifecycle output.
- `lifecycle_commit`: read `args.issue_number` if it is a finite positive integer.
- `lifecycle_finish`: read `args.issue_number` if it is a finite positive integer.
- `write` (plan path): no issue extraction; `issueNumber` is `null`.
- `spawn_agent` (implementer-* / executor): no issue extraction; `issueNumber` is `null`. The state layer carries the issue number forward.

Also, when extracting the `summary` field from `lifecycle_commit` and `lifecycle_finish`, the classifier must reject summaries that are tool-like by calling `isToolLikeTopic(summary)` from Task 1.2 and returning `summary: null` instead. This prevents `lifecycle_commit({ summary: "executor" })` from polluting the topic.

Design choice: I picked the markdown-table regex `/^\|\s*(\d+)\s*\|/m` for `lifecycle_start_request` because the existing `start-request.ts` formatter writes exactly this row layout (see `formatRecordRow` in `src/tools/lifecycle/start-request.ts`). The `issue/(\d+)-` fallback handles aborted records whose table still includes the branch slug.

```typescript
// tests/utils/conversation-title/classifier.test.ts (extend the existing describe)
import { describe, expect, it } from "bun:test";

import { classifyToolMilestone, TITLE_STATUS } from "@/utils/conversation-title";
import { TITLE_SOURCE } from "@/utils/conversation-title/source";

describe("classifyToolMilestone - issue number extraction", () => {
  it("extracts issue number from lifecycle_start_request output table", () => {
    const output = [
      "| Issue # | Branch | Worktree | State |",
      "|---|---|---|---|",
      "| 13 | `issue/13-foo` | `/tmp/wt-13-foo` | `planning` |",
    ].join("\n");

    const signal = classifyToolMilestone({
      tool: "lifecycle_start_request",
      args: { summary: "优化主会话标题生成", goals: [], constraints: [] },
      output,
    });

    expect(signal?.status).toBe(TITLE_STATUS.PLANNING);
    expect(signal?.summary).toBe("优化主会话标题生成");
    expect(signal?.source).toBe(TITLE_SOURCE.LIFECYCLE_ISSUE);
    expect(signal?.issueNumber).toBe(13);
  });

  it("falls back to issue/<N>- branch slug when table row is missing", () => {
    const output = "## Lifecycle pre-flight failed\n\nbranch was issue/27-foo before abort";
    const signal = classifyToolMilestone({
      tool: "lifecycle_start_request",
      args: { summary: "x", goals: [], constraints: [] },
      output,
    });
    expect(signal?.issueNumber).toBe(27);
  });

  it("returns null issueNumber when start output has no parseable number", () => {
    const signal = classifyToolMilestone({
      tool: "lifecycle_start_request",
      args: { summary: "x", goals: [], constraints: [] },
      output: "(empty)",
    });
    expect(signal?.issueNumber).toBeNull();
  });

  it("reads issue_number from lifecycle_commit args", () => {
    const signal = classifyToolMilestone({
      tool: "lifecycle_commit",
      args: { issue_number: 13, scope: "title", summary: "wire hook" },
    });
    expect(signal?.issueNumber).toBe(13);
    expect(signal?.summary).toBe("wire hook");
  });

  it("reads issue_number from lifecycle_finish args", () => {
    const signal = classifyToolMilestone({
      tool: "lifecycle_finish",
      args: { issue_number: 13 },
      output: "merged and closed",
    });
    expect(signal?.status).toBe(TITLE_STATUS.DONE);
    expect(signal?.issueNumber).toBe(13);
  });

  it("rejects tool-like summaries from lifecycle_commit", () => {
    const signal = classifyToolMilestone({
      tool: "lifecycle_commit",
      args: { issue_number: 13, scope: "title", summary: "executor" },
    });
    expect(signal?.summary).toBeNull();
    expect(signal?.issueNumber).toBe(13);
  });

  it("rejects tool-like summaries from lifecycle_start_request", () => {
    const output = "| 13 | `issue/13-x` | `/tmp/x` | `planning` |";
    const signal = classifyToolMilestone({
      tool: "lifecycle_start_request",
      args: { summary: "spawn_agent", goals: [], constraints: [] },
      output,
    });
    expect(signal?.summary).toBeNull();
    expect(signal?.issueNumber).toBe(13);
  });

  it("ignores invalid issue_number values", () => {
    const signal = classifyToolMilestone({
      tool: "lifecycle_commit",
      args: { issue_number: -3, scope: "x", summary: "fix" },
    });
    expect(signal?.issueNumber).toBeNull();

    const signalString = classifyToolMilestone({
      tool: "lifecycle_commit",
      args: { issue_number: "13", scope: "x", summary: "fix" },
    });
    expect(signalString?.issueNumber).toBeNull();
  });

  it("plan write keeps issueNumber null", () => {
    const signal = classifyToolMilestone({
      tool: "write",
      args: { filePath: "thoughts/shared/plans/2026-04-30-foo.md" },
    });
    expect(signal?.issueNumber).toBeNull();
  });

  it("spawn_agent for implementer keeps issueNumber null and summary null", () => {
    const signal = classifyToolMilestone({
      tool: "spawn_agent",
      args: { agents: [{ agent: "implementer-frontend", prompt: "x", description: "y" }] },
    });
    expect(signal?.issueNumber).toBeNull();
    expect(signal?.summary).toBeNull();
  });

  // Sanity: existing behaviors continue to pass
  it("recognizes plan write under thoughts/shared/plans/", () => {
    const signal = classifyToolMilestone({
      tool: "write",
      args: { filePath: "thoughts/shared/plans/2026-04-30-foo-design.md" },
    });
    expect(signal?.status).toBe(TITLE_STATUS.PLANNING);
    expect(signal?.summary).toBe("foo");
    expect(signal?.source).toBe(TITLE_SOURCE.DESIGN_PATH);
  });
});
```

```typescript
// src/utils/conversation-title/classifier.ts
// Add issueNumber to MilestoneSignal and extraction helpers. Keep existing logic intact.

import { summaryFromPlanPath, TITLE_STATUS, type TitleStatus } from "./format";
import { isToolLikeTopic, TITLE_SOURCE, type TitleSource } from "./source";

export interface ToolMilestoneInput {
  readonly tool: string;
  readonly args?: Record<string, unknown>;
  readonly output?: string;
}

export interface MilestoneSignal {
  readonly status: TitleStatus;
  readonly summary: string | null;
  readonly source: TitleSource;
  readonly issueNumber: number | null;
}

const PLAN_PATH_FIELDS = ["filePath", "path"] as const;
const TOOL_NAMES = {
  WRITE: "write",
  LIFECYCLE_START: "lifecycle_start_request",
  LIFECYCLE_COMMIT: "lifecycle_commit",
  LIFECYCLE_FINISH: "lifecycle_finish",
  SPAWN_AGENT: "spawn_agent",
} as const;

const PLAN_PATH_PATTERN = /thoughts\/shared\/plans\/[^/]+\.md$/u;
const DESIGN_PATH_SUFFIX = "-design.md";
const TABLE_ROW_PATTERN = /^\|\s*(\d+)\s*\|/m;
const BRANCH_SLUG_PATTERN = /issue\/(\d+)-/;

const sourceFromPlanPath = (path: string): TitleSource => {
  return path.endsWith(DESIGN_PATH_SUFFIX) ? TITLE_SOURCE.DESIGN_PATH : TITLE_SOURCE.PLAN_PATH;
};

const stringField = (args: Record<string, unknown> | undefined, key: string): string | null => {
  if (!args) return null;
  const value = args[key];
  return typeof value === "string" ? value : null;
};

const positiveIntegerField = (args: Record<string, unknown> | undefined, key: string): number | null => {
  if (!args) return null;
  const value = args[key];
  if (typeof value !== "number") return null;
  if (!Number.isSafeInteger(value)) return null;
  if (value <= 0) return null;
  return value;
};

const firstStringField = (args: Record<string, unknown> | undefined, keys: readonly string[]): string | null => {
  for (const key of keys) {
    const value = stringField(args, key);
    if (value !== null) return value;
  }
  return null;
};

const parseIssueNumberFromOutput = (output: string | undefined): number | null => {
  if (!output) return null;
  const tableMatch = TABLE_ROW_PATTERN.exec(output);
  if (tableMatch) {
    const parsed = Number.parseInt(tableMatch[1] ?? "", 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  const slugMatch = BRANCH_SLUG_PATTERN.exec(output);
  if (slugMatch) {
    const parsed = Number.parseInt(slugMatch[1] ?? "", 10);
    if (Number.isSafeInteger(parsed) && parsed > 0) return parsed;
  }
  return null;
};

const sanitizeSummary = (summary: string | null): string | null => {
  if (summary === null) return null;
  if (isToolLikeTopic(summary)) return null;
  return summary;
};

const detectPlanWrite = (input: ToolMilestoneInput): MilestoneSignal | null => {
  if (input.tool.toLowerCase() !== TOOL_NAMES.WRITE) return null;
  const path = firstStringField(input.args, PLAN_PATH_FIELDS);
  if (!path || !PLAN_PATH_PATTERN.test(path)) return null;
  return {
    status: TITLE_STATUS.PLANNING,
    summary: summaryFromPlanPath(path),
    source: sourceFromPlanPath(path),
    issueNumber: null,
  };
};

const detectLifecycleStart = (input: ToolMilestoneInput): MilestoneSignal | null => {
  if (input.tool !== TOOL_NAMES.LIFECYCLE_START) return null;
  return {
    status: TITLE_STATUS.PLANNING,
    summary: sanitizeSummary(stringField(input.args, "summary")),
    source: TITLE_SOURCE.LIFECYCLE_ISSUE,
    issueNumber: parseIssueNumberFromOutput(input.output),
  };
};

const detectLifecycleCommit = (input: ToolMilestoneInput): MilestoneSignal | null => {
  if (input.tool !== TOOL_NAMES.LIFECYCLE_COMMIT) return null;
  return {
    status: TITLE_STATUS.EXECUTING,
    summary: sanitizeSummary(stringField(input.args, "summary")),
    source: TITLE_SOURCE.COMMIT_TITLE,
    issueNumber: positiveIntegerField(input.args, "issue_number"),
  };
};

const FINISH_CLOSED_PATTERN = /\bclosed\b/iu;

const detectLifecycleFinish = (input: ToolMilestoneInput): MilestoneSignal | null => {
  if (input.tool !== TOOL_NAMES.LIFECYCLE_FINISH) return null;
  const issueNumber = positiveIntegerField(input.args, "issue_number");
  if (!input.output || !FINISH_CLOSED_PATTERN.test(input.output)) {
    return {
      status: TITLE_STATUS.EXECUTING,
      summary: null,
      source: TITLE_SOURCE.LIFECYCLE_FINISH,
      issueNumber,
    };
  }
  return {
    status: TITLE_STATUS.DONE,
    summary: null,
    source: TITLE_SOURCE.LIFECYCLE_FINISH,
    issueNumber,
  };
};

const detectImplementerSpawn = (input: ToolMilestoneInput): MilestoneSignal | null => {
  if (input.tool !== TOOL_NAMES.SPAWN_AGENT) return null;
  const text = JSON.stringify(input.args ?? {});
  if (!/"agent"\s*:\s*"(implementer-[^"]+|executor)"/u.test(text)) return null;
  return {
    status: TITLE_STATUS.EXECUTING,
    summary: null,
    source: TITLE_SOURCE.COMMIT_TITLE,
    issueNumber: null,
  };
};

const DETECTORS = [
  detectLifecycleStart,
  detectLifecycleCommit,
  detectLifecycleFinish,
  detectPlanWrite,
  detectImplementerSpawn,
] as const;

export function classifyToolMilestone(input: ToolMilestoneInput): MilestoneSignal | null {
  for (const detector of DETECTORS) {
    const signal = detector(input);
    if (signal) return signal;
  }
  return null;
}
```

**Verify:** `bun test tests/utils/conversation-title/classifier.test.ts`
**Commit:** `feat(conversation-title): extract issue number from lifecycle classifier signals`

### Task 2.2: State registry stores sticky issueNumber and uses issue-aware formatter
**File:** `src/utils/conversation-title/state.ts`
**Test:** `tests/utils/conversation-title/state.test.ts`
**Depends:** 1.1, 1.2

Extend `DecisionInput` with `issueNumber: number | null` (optional). Extend `SessionRecord` with an internal `issueNumber: number | null`. Extend `SessionTopic` with `issueNumber: number | null`. Update the `decide` flow:

- When the incoming `issueNumber` is a positive integer, write it to the record. Once set, never clear it via `null` from a later signal: a `null` incoming `issueNumber` is ignored (sticky semantics).
- Always render via `buildIssueAwareTitle({ issueNumber: record.issueNumber, topic: record.topic ?? "", status: input.status }, input.maxLength)`.
- Topic replacement logic stays the same. Done-freeze, throttle, opt-out semantics stay the same.

Also: when `input.summary` is non-null and `isToolLikeTopic(input.summary)` is true, refuse to apply it as the topic, regardless of source confidence. (The classifier should already filter, but this is a defense-in-depth check.)

```typescript
// tests/utils/conversation-title/state.test.ts (extend the existing describe)
import { describe, expect, it } from "bun:test";

import { createTitleStateRegistry, type DecisionInput, TITLE_STATUS } from "@/utils/conversation-title";
import { TITLE_SOURCE } from "@/utils/conversation-title/source";

const SESSION = "ses_main";
const NOW = 1_700_000_000_000;
const NEXT_NOW = NOW + 2_000;
const LATER_NOW = NOW + 5_000;
const TOPIC = "优化主会话标题生成";
const TOPIC_RENAMED = "改进主会话标题命名";

const baseInput = (overrides: Partial<DecisionInput> = {}): DecisionInput => ({
  sessionID: SESSION,
  status: TITLE_STATUS.PLANNING,
  summary: TOPIC,
  source: TITLE_SOURCE.LIFECYCLE_ISSUE,
  currentTitle: null,
  now: NOW,
  ...overrides,
});

describe("title state registry - issue prefix", () => {
  it("renders #N 状态：需求 when issueNumber is set", () => {
    const registry = createTitleStateRegistry();
    const decision = registry.decide({ ...baseInput(), issueNumber: 13 });

    expect(decision.kind).toBe("write");
    if (decision.kind !== "write") throw new Error("expected write");
    expect(decision.title).toBe("#13 规划中：优化主会话标题生成");
    expect(registry.getTopic(SESSION)).toEqual({
      topic: TOPIC,
      source: TITLE_SOURCE.LIFECYCLE_ISSUE,
      issueNumber: 13,
    });
  });

  it("keeps issueNumber sticky across later null signals", () => {
    const registry = createTitleStateRegistry();
    registry.decide({ ...baseInput(), issueNumber: 13 });

    const next = registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.EXECUTING,
      summary: null,
      source: TITLE_SOURCE.COMMIT_TITLE,
      currentTitle: "#13 规划中：优化主会话标题生成",
      now: NEXT_NOW,
      issueNumber: null,
    });

    expect(next.kind).toBe("write");
    if (next.kind !== "write") throw new Error("expected write");
    expect(next.title).toBe("#13 执行中：优化主会话标题生成");
    expect(registry.getTopic(SESSION).issueNumber).toBe(13);
  });

  it("formats DONE with full-width colon under issue prefix", () => {
    const registry = createTitleStateRegistry();
    registry.decide({ ...baseInput(), issueNumber: 13 });

    const finished = registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.DONE,
      summary: null,
      source: TITLE_SOURCE.LIFECYCLE_FINISH,
      currentTitle: "#13 规划中：优化主会话标题生成",
      now: NEXT_NOW,
      issueNumber: 13,
    });

    expect(finished.kind).toBe("write");
    if (finished.kind !== "write") throw new Error("expected write");
    expect(finished.title).toBe("#13 已完成：优化主会话标题生成");
  });

  it("renders no-issue title when issueNumber is null and never set", () => {
    const registry = createTitleStateRegistry();
    const decision = registry.decide({ ...baseInput(), issueNumber: null });

    expect(decision.kind).toBe("write");
    if (decision.kind !== "write") throw new Error("expected write");
    expect(decision.title).toBe(TOPIC);
    expect(registry.getTopic(SESSION).issueNumber).toBeNull();
  });

  it("upgrades from no-issue to issue-prefixed once issueNumber arrives", () => {
    const registry = createTitleStateRegistry();
    const first = registry.decide({ ...baseInput(), issueNumber: null });
    expect(first.kind).toBe("write");

    const upgraded = registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.PLANNING,
      summary: null,
      source: TITLE_SOURCE.LIFECYCLE_ISSUE,
      currentTitle: TOPIC,
      now: NEXT_NOW,
      issueNumber: 13,
    });
    expect(upgraded.kind).toBe("write");
    if (upgraded.kind !== "write") throw new Error("expected write");
    expect(upgraded.title).toBe("#13 规划中：优化主会话标题生成");
  });

  it("rejects tool-like summary as topic regardless of source confidence", () => {
    const registry = createTitleStateRegistry();
    registry.decide({ ...baseInput(), issueNumber: 13 });

    const polluted = registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.EXECUTING,
      summary: "executor",
      source: TITLE_SOURCE.LIFECYCLE_ISSUE,
      currentTitle: "#13 规划中：优化主会话标题生成",
      now: NEXT_NOW,
      issueNumber: 13,
    });

    expect(polluted.kind).toBe("write");
    if (polluted.kind !== "write") throw new Error("expected write");
    // Topic stays as the original Chinese requirement; status rolls forward.
    expect(polluted.title).toBe("#13 执行中：优化主会话标题生成");
  });

  it("higher-confidence tool-like summary still does not replace a real topic", () => {
    const registry = createTitleStateRegistry();
    registry.decide({
      ...baseInput(),
      summary: TOPIC,
      source: TITLE_SOURCE.USER_MESSAGE,
      issueNumber: null,
    });

    const polluted = registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.EXECUTING,
      summary: "implementer-backend",
      source: TITLE_SOURCE.LIFECYCLE_ISSUE,
      currentTitle: TOPIC,
      now: NEXT_NOW,
      issueNumber: 13,
    });

    expect(polluted.kind).toBe("write");
    if (polluted.kind !== "write") throw new Error("expected write");
    expect(polluted.title).toBe("#13 执行中：优化主会话标题生成");
  });

  it("higher-confidence real topic still replaces an earlier weaker topic", () => {
    const registry = createTitleStateRegistry();
    registry.decide({
      ...baseInput(),
      summary: TOPIC,
      source: TITLE_SOURCE.USER_MESSAGE,
      issueNumber: null,
    });

    const upgraded = registry.decide({
      sessionID: SESSION,
      status: TITLE_STATUS.PLANNING,
      summary: TOPIC_RENAMED,
      source: TITLE_SOURCE.LIFECYCLE_ISSUE,
      currentTitle: TOPIC,
      now: LATER_NOW,
      issueNumber: 13,
    });

    expect(upgraded.kind).toBe("write");
    if (upgraded.kind !== "write") throw new Error("expected write");
    expect(upgraded.title).toBe(`#13 规划中：${TOPIC_RENAMED}`);
  });

  it("getTopic returns issueNumber as null when never set", () => {
    const registry = createTitleStateRegistry();
    expect(registry.getTopic("never_seen")).toEqual({ topic: null, source: null, issueNumber: null });
  });
});
```

```typescript
// src/utils/conversation-title/state.ts
// Update DecisionInput, SessionTopic, SessionRecord, decideForRecord. Replace the buildTopicTitle
// call with buildIssueAwareTitle. Add isToolLikeTopic guard before applying topic.

import { buildIssueAwareTitle, CONCLUSIVE_STATUSES, type TitleStatus } from "./format";
import { compareConfidence, isToolLikeTopic, type TitleSource } from "./source";

const TITLE_THROTTLE_MS = 1000;
const DONE_FREEZE_MS = 60_000;

export const DECISION_KIND = {
  WRITE: "write",
  SKIP: "skip",
} as const;

export type DecisionKind = (typeof DECISION_KIND)[keyof typeof DECISION_KIND];

export interface DecisionInput {
  readonly sessionID: string;
  readonly status: TitleStatus;
  readonly summary: string | null;
  readonly source: TitleSource;
  readonly currentTitle: string | null;
  readonly now: number;
  readonly maxLength?: number;
  readonly issueNumber?: number | null;
}

export interface SessionTopic {
  readonly topic: string | null;
  readonly source: TitleSource | null;
  readonly issueNumber: number | null;
}

export type TitleDecision =
  | { readonly kind: typeof DECISION_KIND.WRITE; readonly title: string }
  | { readonly kind: typeof DECISION_KIND.SKIP; readonly reason: string };

interface SessionRecord {
  lastTitle: string | null;
  lastUpdateAt: number;
  doneAt: number | null;
  optedOut: boolean;
  systemTitleConfirmed: boolean;
  topic: string | null;
  topicSource: TitleSource | null;
  issueNumber: number | null;
}

export interface TitleStateRegistry {
  decide(input: DecisionInput): TitleDecision;
  getTopic(sessionID: string): SessionTopic;
  forget(sessionID: string): void;
  isOptedOut(sessionID: string): boolean;
  size(): number;
}

const skip = (reason: string): TitleDecision => ({ kind: DECISION_KIND.SKIP, reason });

// (Keep all the existing helpers: isUserAuthoredTitle, observeCurrentTitle, detectOptOut,
// isDoneFrozen, isThrottled, canReplaceTopic, isDoneExpired, updateDoneAt, updateRecord, newRecord,
// readTopic, getOrCreate. Update newRecord and readTopic and applyTopic as below.)

const newRecord = (): SessionRecord => ({
  lastTitle: null,
  lastUpdateAt: 0,
  doneAt: null,
  optedOut: false,
  systemTitleConfirmed: false,
  topic: null,
  topicSource: null,
  issueNumber: null,
});

const readTopic = (record: SessionRecord | undefined): SessionTopic => ({
  topic: record?.topic ?? null,
  source: record?.topicSource ?? null,
  issueNumber: record?.issueNumber ?? null,
});

const applyIssueNumber = (record: SessionRecord, incoming: number | null | undefined): void => {
  if (incoming === null || incoming === undefined) return;
  if (!Number.isSafeInteger(incoming) || incoming <= 0) return;
  record.issueNumber = incoming;
};

const applyTopic = (record: SessionRecord, input: DecisionInput, allowEqualConfidence: boolean): boolean => {
  const incomingTopic = input.summary;
  if (incomingTopic === null || incomingTopic === "") return false;
  if (isToolLikeTopic(incomingTopic)) return false;
  if (!canReplaceTopic(record, input.source, allowEqualConfidence)) return false;
  record.topic = incomingTopic;
  record.topicSource = input.source;
  return true;
};

const decideForRecord = (record: SessionRecord, input: DecisionInput): TitleDecision => {
  observeCurrentTitle(record, input.currentTitle);

  if (detectOptOut(record, input.currentTitle)) {
    record.optedOut = true;
    return skip("opted-out");
  }

  if (isDoneFrozen(record, input.now)) {
    return skip("done-frozen");
  }

  applyIssueNumber(record, input.issueNumber);
  const doneExpired = isDoneExpired(record, input.now);
  const replacedTopic = applyTopic(record, input, doneExpired);
  const title = buildIssueAwareTitle(
    {
      issueNumber: record.issueNumber,
      topic: record.topic ?? "",
      status: input.status,
    },
    input.maxLength,
  );

  if (isThrottled(record, title, input.now)) {
    return skip("throttled");
  }

  updateRecord(record, title, input.status, input.now, replacedTopic);
  return { kind: DECISION_KIND.WRITE, title };
};

export function createTitleStateRegistry(): TitleStateRegistry {
  const records = new Map<string, SessionRecord>();

  return {
    decide(input) {
      return decideForRecord(getOrCreate(records, input.sessionID), input);
    },

    getTopic(sessionID) {
      return readTopic(records.get(sessionID));
    },

    forget(sessionID) {
      records.delete(sessionID);
    },

    isOptedOut(sessionID) {
      return records.get(sessionID)?.optedOut ?? false;
    },

    size() {
      return records.size;
    },
  };
}
```

Note for implementer: existing tests in `tests/utils/conversation-title/state.test.ts` assert `getTopic` returns `{ topic, source }`. After this change `getTopic` returns `{ topic, source, issueNumber }`. Update the existing assertions in that file to include `issueNumber: null` for cases that did not pass an issue number, and `issueNumber: 13` for cases that did. Do not delete existing test cases — just extend the expected object shape.

**Verify:** `bun test tests/utils/conversation-title/state.test.ts`
**Commit:** `feat(conversation-title): make state registry track sticky issue number and use issue-aware formatter`

---

## Batch 3: Hook Wiring (1 implementer)

Depends on Batch 2 completing.
Tasks: 3.1

### Task 3.1: Hook forwards issueNumber from classifier to state registry
**File:** `src/hooks/conversation-title.ts`
**Test:** `tests/hooks/conversation-title.test.ts`
**Depends:** 2.1, 2.2

The hook must thread `issueNumber` from the classifier signal into `dispatch` and ultimately into `registry.decide`. Two paths:

- `tool.execute.after` path: the classifier already carries `issueNumber`; pass it through.
- `chat.message` path: user messages do not carry an issue number. Pass `issueNumber: null` (the registry's sticky logic preserves any earlier-seen issue number).

Spawn-agent child sessions: the existing `isMainAgentSession(info)` check (which requires `info.parentID === null`) already excludes them. Do NOT add issue prefixes to child sessions. This is the canonical guard; keep it intact.

Internal sessions (config-marked): the existing `config.isInternalSession?.(sessionID)` check stays in place.

```typescript
// tests/hooks/conversation-title.test.ts (extend the existing describe with new cases)
import { beforeEach, describe, expect, it } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { createConversationTitleHook } from "@/hooks";

interface FakeSession {
  readonly id: string;
  readonly title: string | null;
  readonly parentID: string | null;
}

interface UpdateCall {
  readonly id: string;
  readonly title: string;
}

interface Harness {
  readonly ctx: PluginInput;
  readonly sessions: Map<string, FakeSession>;
  readonly updates: UpdateCall[];
}

const SESSION_MAIN = "ses_main";
const SESSION_CHILD = "ses_child";

const createHarness = (): Harness => {
  const sessions = new Map<string, FakeSession>();
  const updates: UpdateCall[] = [];

  const ctx = {
    directory: "/tmp/fake-project",
    client: {
      session: {
        get: async ({ path }: { path: { id: string } }) => {
          const session = sessions.get(path.id);
          if (!session) return { data: undefined };
          return { data: { id: session.id, title: session.title, parentID: session.parentID } };
        },
        update: async ({ path, body }: { path: { id: string }; body: { title?: string } }) => {
          if (typeof body.title !== "string") return { data: undefined };
          updates.push({ id: path.id, title: body.title });
          const existing = sessions.get(path.id);
          if (existing) sessions.set(path.id, { ...existing, title: body.title });
          return { data: { id: path.id } };
        },
      },
    },
  } as unknown as PluginInput;

  return { ctx, sessions, updates };
};

describe("conversation-title hook - issue prefix", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
    harness.sessions.set(SESSION_MAIN, { id: SESSION_MAIN, title: null, parentID: null });
    harness.sessions.set(SESSION_CHILD, { id: SESSION_CHILD, title: null, parentID: SESSION_MAIN });
  });

  it("renames the main session with #N 状态：需求 after lifecycle_start_request", async () => {
    const hook = createConversationTitleHook(harness.ctx);

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_start_request",
        sessionID: SESSION_MAIN,
        args: { summary: "优化主会话标题生成", goals: [], constraints: [] },
      },
      {
        output: [
          "| Issue # | Branch | Worktree | State |",
          "|---|---|---|---|",
          "| 13 | `issue/13-foo` | `/tmp/wt-13` | `planning` |",
        ].join("\n"),
      },
    );

    expect(harness.updates).toHaveLength(1);
    expect(harness.updates[0]?.id).toBe(SESSION_MAIN);
    expect(harness.updates[0]?.title).toBe("#13 规划中：优化主会话标题生成");
  });

  it("preserves issue prefix across later lifecycle_commit calls", async () => {
    const hook = createConversationTitleHook(harness.ctx);

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_start_request",
        sessionID: SESSION_MAIN,
        args: { summary: "优化主会话标题生成", goals: [], constraints: [] },
      },
      { output: "| 13 | `issue/13-foo` | `/tmp/wt-13` | `planning` |" },
    );

    // Wait past throttle window using a fresh hook is overkill; instead simulate a different title shape.
    await new Promise((resolve) => setTimeout(resolve, 1100));

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_commit",
        sessionID: SESSION_MAIN,
        args: { issue_number: 13, scope: "title", summary: "wire hook" },
      },
      { output: "" },
    );

    const last = harness.updates.at(-1);
    expect(last?.id).toBe(SESSION_MAIN);
    expect(last?.title?.startsWith("#13 ")).toBe(true);
    expect(last?.title?.includes("：")).toBe(true);
  });

  it("renders #N 已完成：需求 after lifecycle_finish closes the issue", async () => {
    const hook = createConversationTitleHook(harness.ctx);

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_start_request",
        sessionID: SESSION_MAIN,
        args: { summary: "优化主会话标题生成", goals: [], constraints: [] },
      },
      { output: "| 13 | `issue/13-foo` | `/tmp/wt-13` | `planning` |" },
    );

    await new Promise((resolve) => setTimeout(resolve, 1100));

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_finish",
        sessionID: SESSION_MAIN,
        args: { issue_number: 13 },
      },
      { output: "merged and closed" },
    );

    const last = harness.updates.at(-1);
    expect(last?.title).toBe("#13 已完成：优化主会话标题生成");
  });

  it("does not add issue prefix to child spawn-agent sessions", async () => {
    const hook = createConversationTitleHook(harness.ctx);

    // Trigger from a child session: parentID !== null, so dispatch should bail out at isMainAgentSession.
    await hook["tool.execute.after"](
      {
        tool: "lifecycle_start_request",
        sessionID: SESSION_CHILD,
        args: { summary: "should not affect child", goals: [], constraints: [] },
      },
      { output: "| 13 | `issue/13-foo` | `/tmp/wt-13` | `planning` |" },
    );

    expect(harness.updates).toHaveLength(0);
  });

  it("falls back to no-issue title when start output has no parseable number", async () => {
    const hook = createConversationTitleHook(harness.ctx);

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_start_request",
        sessionID: SESSION_MAIN,
        args: { summary: "优化主会话标题生成", goals: [], constraints: [] },
      },
      { output: "(no table)" },
    );

    expect(harness.updates).toHaveLength(1);
    expect(harness.updates[0]?.title).toBe("优化主会话标题生成");
  });

  it("rejects tool-name summary even from a high-confidence source", async () => {
    const hook = createConversationTitleHook(harness.ctx);

    // First: legitimate user message sets a real Chinese topic (no issue yet).
    await hook["chat.message"](
      { sessionID: SESSION_MAIN },
      { parts: [{ type: "text", text: "优化主会话标题生成" }] },
    );

    await new Promise((resolve) => setTimeout(resolve, 1100));

    // Then: lifecycle_start_request with a tool-like summary "executor" should not pollute.
    await hook["tool.execute.after"](
      {
        tool: "lifecycle_start_request",
        sessionID: SESSION_MAIN,
        args: { summary: "executor", goals: [], constraints: [] },
      },
      { output: "| 13 | `issue/13-foo` | `/tmp/wt-13` | `planning` |" },
    );

    const last = harness.updates.at(-1);
    expect(last?.title).toBe("#13 规划中：优化主会话标题生成");
  });
});
```

```typescript
// src/hooks/conversation-title.ts
// Add issueNumber to DispatchOptions; thread it from the classifier signal into registry.decide.

import type { PluginInput } from "@opencode-ai/plugin";

import {
  classifyToolMilestone,
  createTitleStateRegistry,
  summaryFromUserMessage,
  TITLE_STATUS,
  type TitleStateRegistry,
  type TitleStatus,
} from "@/utils/conversation-title";
import { isLowInformationMessage, TITLE_SOURCE, type TitleSource } from "@/utils/conversation-title/source";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

const LOG_SCOPE = "conversation-title";

export interface ConversationTitleConfig {
  readonly enabled: boolean;
  readonly chatFallbackEnabled: boolean;
  readonly maxLength: number;
  readonly isInternalSession?: (sessionID: string) => boolean;
}

const DEFAULT_MAX_LENGTH = 50;

const defaultConfig = (): ConversationTitleConfig => ({
  enabled: true,
  chatFallbackEnabled: false,
  maxLength: DEFAULT_MAX_LENGTH,
});

interface ToolAfterInput {
  readonly tool: string;
  readonly sessionID: string;
  readonly args?: Record<string, unknown>;
}

interface ToolAfterOutput {
  readonly output?: string;
}

interface ChatMessageInput {
  readonly sessionID: string;
}

interface ChatMessageOutput {
  readonly parts: readonly { readonly type: string; readonly text?: string }[];
}

interface SessionInfo {
  readonly title: string | null;
  readonly parentID: string | null;
}

const fetchSessionInfo = async (ctx: PluginInput, sessionID: string): Promise<SessionInfo | null> => {
  try {
    const response = await ctx.client.session.get({
      path: { id: sessionID },
      query: { directory: ctx.directory },
    });
    const data = response.data;
    if (!data) return null;
    const parentID =
      typeof (data as { parentID?: unknown }).parentID === "string" ? (data as { parentID: string }).parentID : null;
    return {
      title: typeof data.title === "string" ? data.title : null,
      parentID,
    };
  } catch (error) {
    log.warn(LOG_SCOPE, `session.get failed for ${sessionID}: ${extractErrorMessage(error)}`);
    return null;
  }
};

const isMainAgentSession = (info: SessionInfo | null): boolean => {
  if (!info) return false;
  return info.parentID === null;
};

const writeTitle = async (ctx: PluginInput, sessionID: string, title: string): Promise<void> => {
  try {
    await ctx.client.session.update({
      path: { id: sessionID },
      body: { title },
      query: { directory: ctx.directory },
    });
  } catch (error) {
    log.warn(LOG_SCOPE, `session.update failed for ${sessionID}: ${extractErrorMessage(error)}`);
  }
};

interface DispatchOptions {
  readonly status: TitleStatus;
  readonly summary: string | null;
  readonly source: TitleSource;
  readonly currentTitle: string | null;
  readonly issueNumber: number | null;
}

interface ConversationTitleHookHandlers {
  "tool.execute.after": (input: ToolAfterInput, output: ToolAfterOutput) => Promise<void>;
  "chat.message": (input: ChatMessageInput, output: ChatMessageOutput) => Promise<void>;
  event: (input: { event: { type: string; properties?: unknown } }) => Promise<void>;
}

const extractMessageText = (output: ChatMessageOutput): string => {
  return output.parts
    .filter((p) => p.type === "text" && typeof p.text === "string")
    .map((p) => p.text ?? "")
    .join(" ");
};

interface ContextDeps {
  readonly ctx: PluginInput;
  readonly registry: TitleStateRegistry;
  readonly config: ConversationTitleConfig;
}

const dispatch = async (deps: ContextDeps, sessionID: string, options: DispatchOptions): Promise<void> => {
  if (deps.config.isInternalSession?.(sessionID)) return;

  const info = await fetchSessionInfo(deps.ctx, sessionID);
  if (!isMainAgentSession(info)) return;

  const decision = deps.registry.decide({
    sessionID,
    status: options.status,
    summary: options.summary,
    source: options.source,
    currentTitle: options.currentTitle,
    now: Date.now(),
    maxLength: deps.config.maxLength,
    issueNumber: options.issueNumber,
  });

  if (decision.kind === "skip") return;
  await writeTitle(deps.ctx, sessionID, decision.title);
};

export interface ConversationTitleHook extends ConversationTitleHookHandlers {
  registry: TitleStateRegistry;
}

const handleToolAfter = async (deps: ContextDeps, input: ToolAfterInput, output: ToolAfterOutput): Promise<void> => {
  if (!deps.config.enabled) return;
  const signal = classifyToolMilestone({ tool: input.tool, args: input.args, output: output.output });
  if (!signal) return;

  const info = await fetchSessionInfo(deps.ctx, input.sessionID);
  await dispatch(deps, input.sessionID, {
    status: signal.status,
    summary: signal.summary,
    source: signal.source,
    currentTitle: info?.title ?? null,
    issueNumber: signal.issueNumber,
  });
};

const handleChatMessage = async (
  deps: ContextDeps,
  input: ChatMessageInput,
  output: ChatMessageOutput,
): Promise<void> => {
  if (!deps.config.enabled) return;
  if (!deps.config.chatFallbackEnabled) return;
  if (deps.registry.isOptedOut(input.sessionID)) return;

  const info = await fetchSessionInfo(deps.ctx, input.sessionID);
  if (!isMainAgentSession(info)) return;

  const summary = summaryFromUserMessage(extractMessageText(output));
  if (!summary) return;
  if (isLowInformationMessage(summary)) return;

  await dispatch(deps, input.sessionID, {
    status: TITLE_STATUS.INITIALIZING,
    summary,
    source: TITLE_SOURCE.USER_MESSAGE,
    currentTitle: info?.title ?? null,
    issueNumber: null,
  });
};

const handleEvent = (registry: TitleStateRegistry, event: { type: string; properties?: unknown }): void => {
  if (event.type !== "session.deleted") return;
  const props = event.properties as { info?: { id?: string } } | undefined;
  const sessionID = props?.info?.id;
  if (!sessionID) return;
  registry.forget(sessionID);
};

export function createConversationTitleHook(
  ctx: PluginInput,
  overrides?: Partial<ConversationTitleConfig>,
): ConversationTitleHook {
  const config: ConversationTitleConfig = { ...defaultConfig(), ...overrides };
  const registry = createTitleStateRegistry();
  const deps: ContextDeps = { ctx, registry, config };

  return {
    registry,
    "tool.execute.after": (input, output) => handleToolAfter(deps, input, output),
    "chat.message": (input, output) => handleChatMessage(deps, input, output),
    event: async ({ event }) => handleEvent(registry, event),
  };
}
```

Note for implementer: the `chat.message` test that uses `chatFallbackEnabled: false` (the default) does NOT trigger title writes, which is why the new test enables chat fallback by overriding it. Pass `{ chatFallbackEnabled: true }` to `createConversationTitleHook` in the new test that exercises the user-message path. If existing tests in `tests/hooks/conversation-title.test.ts` already pass `chatFallbackEnabled: true` for that path, follow the same pattern.

Also: the new tests use `setTimeout(1100)` to bypass the 1-second throttle. This is acceptable in a Bun test; alternative is to inject `Date.now` via the registry interface, but that is out of scope for this task. Keep it as a real-time wait.

**Verify:** `bun test tests/hooks/conversation-title.test.ts`
**Commit:** `feat(conversation-title): thread issueNumber through hook dispatch and preserve child session behavior`

---

## Batch 4: Scenario Coverage (1 implementer)

Depends on Batch 3 completing.
Tasks: 4.1

### Task 4.1: End-to-end scenario test for the full lifecycle title sequence
**File:** `tests/hooks/conversation-title.scenario.test.ts`
**Test:** (this IS the test file)
**Depends:** 3.1
**Domain:** general

Add a new scenario test file (next to `conversation-title.test.ts`) that exercises the entire user-visible title sequence for a single main agent session over a realistic lifecycle. This is the integration safety net that catches regressions across classifier, state, formatter, and hook wiring at once.

Scenarios to cover:

1. **Happy path with issue:**
   - User message: `想让主对话标题在有 issue 时显示中文需求和编号`
   - Then: `lifecycle_start_request` with summary `优化主会话标题生成` and output containing `| 13 | issue/13-... | ... |`
   - Then: `lifecycle_commit` with `issue_number: 13` (after throttle)
   - Then: `lifecycle_finish` with `issue_number: 13` and output `merged and closed`
   - Expected sequence of titles applied: `想让主对话标题在有 issue 时显示中文需求和编号`, then `#13 规划中：优化主会话标题生成`, then `#13 执行中：优化主会话标题生成`, then `#13 已完成：优化主会话标题生成`.

2. **No-issue path:**
   - User message: `登录注册页面`
   - Then: `write` to `thoughts/shared/plans/2026-04-30-login-signup.md`
   - Expected last title: starts with the topic and does NOT include `#`.

3. **Pollution-resistance:**
   - User message: `登录注册页面`
   - Then: `lifecycle_commit` with `summary: "executor"` and `issue_number: 13`
   - Expected last title: `#13 执行中：登录注册页面` (executor summary rejected, real topic preserved).

4. **Child session isolation:**
   - Same harness with `parentID = SESSION_MAIN` for `SESSION_CHILD`.
   - `lifecycle_start_request` triggered on `SESSION_CHILD`.
   - Expected: zero title writes for either session from this child trigger.

```typescript
// tests/hooks/conversation-title.scenario.test.ts
import { beforeEach, describe, expect, it } from "bun:test";
import type { PluginInput } from "@opencode-ai/plugin";

import { createConversationTitleHook } from "@/hooks";

interface FakeSession {
  readonly id: string;
  readonly title: string | null;
  readonly parentID: string | null;
}

interface UpdateCall {
  readonly id: string;
  readonly title: string;
}

interface Harness {
  readonly ctx: PluginInput;
  readonly sessions: Map<string, FakeSession>;
  readonly updates: UpdateCall[];
}

const SESSION_MAIN = "ses_main";
const SESSION_CHILD = "ses_child";
const THROTTLE_BUFFER_MS = 1100;

const createHarness = (): Harness => {
  const sessions = new Map<string, FakeSession>();
  const updates: UpdateCall[] = [];

  const ctx = {
    directory: "/tmp/fake-project",
    client: {
      session: {
        get: async ({ path }: { path: { id: string } }) => {
          const session = sessions.get(path.id);
          if (!session) return { data: undefined };
          return { data: { id: session.id, title: session.title, parentID: session.parentID } };
        },
        update: async ({ path, body }: { path: { id: string }; body: { title?: string } }) => {
          if (typeof body.title !== "string") return { data: undefined };
          updates.push({ id: path.id, title: body.title });
          const existing = sessions.get(path.id);
          if (existing) sessions.set(path.id, { ...existing, title: body.title });
          return { data: { id: path.id } };
        },
      },
    },
  } as unknown as PluginInput;

  return { ctx, sessions, updates };
};

const wait = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

const sleepPastThrottle = (): Promise<void> => wait(THROTTLE_BUFFER_MS);

describe("conversation-title scenario - full lifecycle", () => {
  let harness: Harness;

  beforeEach(() => {
    harness = createHarness();
    harness.sessions.set(SESSION_MAIN, { id: SESSION_MAIN, title: null, parentID: null });
    harness.sessions.set(SESSION_CHILD, { id: SESSION_CHILD, title: null, parentID: SESSION_MAIN });
  });

  it("emits #N 状态：需求 across the start → commit → finish lifecycle", async () => {
    const hook = createConversationTitleHook(harness.ctx, { chatFallbackEnabled: true });

    await hook["chat.message"](
      { sessionID: SESSION_MAIN },
      { parts: [{ type: "text", text: "想让主对话标题在有 issue 时显示中文需求和编号" }] },
    );

    await sleepPastThrottle();

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_start_request",
        sessionID: SESSION_MAIN,
        args: { summary: "优化主会话标题生成", goals: [], constraints: [] },
      },
      {
        output: [
          "| Issue # | Branch | Worktree | State |",
          "|---|---|---|---|",
          "| 13 | `issue/13-foo` | `/tmp/wt-13` | `planning` |",
        ].join("\n"),
      },
    );

    await sleepPastThrottle();

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_commit",
        sessionID: SESSION_MAIN,
        args: { issue_number: 13, scope: "title", summary: "wire hook" },
      },
      { output: "" },
    );

    await sleepPastThrottle();

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_finish",
        sessionID: SESSION_MAIN,
        args: { issue_number: 13 },
      },
      { output: "merged and closed" },
    );

    const titles = harness.updates.map((u) => u.title);
    expect(titles[0]).toBe("想让主对话标题在有 issue 时显示中文需求和编号");
    // After lifecycle start, issue prefix appears with the lifecycle topic.
    expect(titles).toContain("#13 规划中：优化主会话标题生成");
    expect(titles).toContain("#13 执行中：优化主会话标题生成");
    // Final title is the conclusive form.
    expect(titles.at(-1)).toBe("#13 已完成：优化主会话标题生成");
  });

  it("renders no-issue chinese title when no lifecycle issue exists", async () => {
    const hook = createConversationTitleHook(harness.ctx, { chatFallbackEnabled: true });

    await hook["chat.message"](
      { sessionID: SESSION_MAIN },
      { parts: [{ type: "text", text: "登录注册页面" }] },
    );

    await sleepPastThrottle();

    await hook["tool.execute.after"](
      {
        tool: "write",
        sessionID: SESSION_MAIN,
        args: { filePath: "thoughts/shared/plans/2026-04-30-login-signup.md" },
      },
      { output: "" },
    );

    const last = harness.updates.at(-1);
    expect(last?.title?.includes("#")).toBe(false);
    expect(last?.title).toBeDefined();
  });

  it("rejects tool-name summary even when carried by a high-confidence lifecycle source", async () => {
    const hook = createConversationTitleHook(harness.ctx, { chatFallbackEnabled: true });

    await hook["chat.message"](
      { sessionID: SESSION_MAIN },
      { parts: [{ type: "text", text: "登录注册页面" }] },
    );

    await sleepPastThrottle();

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_commit",
        sessionID: SESSION_MAIN,
        args: { issue_number: 13, scope: "title", summary: "executor" },
      },
      { output: "" },
    );

    const last = harness.updates.at(-1);
    expect(last?.title).toBe("#13 执行中：登录注册页面");
  });

  it("does not affect either session when lifecycle_start_request fires on a child session", async () => {
    const hook = createConversationTitleHook(harness.ctx, { chatFallbackEnabled: true });

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_start_request",
        sessionID: SESSION_CHILD,
        args: { summary: "should not affect child", goals: [], constraints: [] },
      },
      {
        output: [
          "| Issue # | Branch | Worktree | State |",
          "|---|---|---|---|",
          "| 13 | `issue/13-foo` | `/tmp/wt-13` | `planning` |",
        ].join("\n"),
      },
    );

    expect(harness.updates).toHaveLength(0);
  });

  it("preserves opt-out semantics: a manual user title freezes future writes", async () => {
    const hook = createConversationTitleHook(harness.ctx, { chatFallbackEnabled: true });

    await hook["tool.execute.after"](
      {
        tool: "lifecycle_start_request",
        sessionID: SESSION_MAIN,
        args: { summary: "优化主会话标题生成", goals: [], constraints: [] },
      },
      { output: "| 13 | `issue/13-foo` | `/tmp/wt-13` | `planning` |" },
    );

    // Confirm the system title is observed (sets systemTitleConfirmed).
    await sleepPastThrottle();
    await hook["tool.execute.after"](
      {
        tool: "lifecycle_commit",
        sessionID: SESSION_MAIN,
        args: { issue_number: 13, scope: "title", summary: "wire hook" },
      },
      { output: "" },
    );

    // Now the user manually renames the session.
    const manualTitle = "我自己起的名字";
    const existing = harness.sessions.get(SESSION_MAIN);
    if (!existing) throw new Error("missing session");
    harness.sessions.set(SESSION_MAIN, { ...existing, title: manualTitle });

    await sleepPastThrottle();
    const updateCountBeforeOptOut = harness.updates.length;

    // A subsequent lifecycle event must not overwrite the manual title.
    await hook["tool.execute.after"](
      {
        tool: "lifecycle_finish",
        sessionID: SESSION_MAIN,
        args: { issue_number: 13 },
      },
      { output: "merged and closed" },
    );

    expect(harness.updates.length).toBe(updateCountBeforeOptOut);
    expect(harness.sessions.get(SESSION_MAIN)?.title).toBe(manualTitle);
  });
});
```

There is no production-code change in this task. It is the integration test that proves Batches 1-3 wire together correctly.

**Verify:** `bun test tests/hooks/conversation-title.scenario.test.ts && bun run check`
**Commit:** `test(conversation-title): cover full issue-aware title lifecycle scenario`
