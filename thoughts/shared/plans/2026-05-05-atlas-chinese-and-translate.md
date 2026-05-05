---
date: 2026-05-05
topic: "Atlas Chinese output default + /atlas-translate command + atlas: auto-commit"
contract: none
---

# Atlas Chinese Output and /atlas-translate Implementation Plan

**Goal:** Default all Atlas human-readable prose to Chinese, ship `/atlas-translate` as a first-class slash command for translating already-written Atlas vaults, and make both `/atlas-init` and `/atlas-translate` auto-commit their atlas-only changes with the `atlas:` prefix.

**Architecture:**
- Language switch is mostly prompt and string-fallback edits across cold-init synthesis, cold-init renderer, cold-init worker prompts, vault-writer maintenance log, and the initializer agent prompt; machine syntax (frontmatter keys, ids, paths, wikilinks, code, source pointers) stays untouched.
- `/atlas-translate` reuses the existing `atlas-translator` agent (already implemented) by adding a command definition + arg parser in `src/atlas/commands.ts` and a routing entry in the `ATLAS_COMMANDS` table inside `src/index.ts`. The `$ARGUMENTS` template carries the optional target path through to the agent prompt.
- Auto-commit is delegated to the two agents (`atlas-initializer`, `atlas-translator`) running shell from their existing tool surface, guided by new prompt sections that instruct them to (a) verify all staged paths fall under `atlas/`, (b) build the message via the shared `atlas:` helpers in `src/atlas/git.ts`, (c) commit. Two new helpers, `buildAtlasInitCommitSummary` and `buildAtlasTranslateCommitSummary`, give both agents stable wording and let tests pin the contract. This keeps the deterministic cold-init code path free of new git side effects (no new programmatic git driver), and the agent's shell call is the single place that can fail or be skipped without corrupting vault state.

**Design:** N/A (this is a follow-up rework; design context lives in the conversation transcript and prior atlas plans under `thoughts/shared/plans/2026-05-04-project-atlas.md` and `thoughts/shared/plans/2026-05-04-atlas-init-cold-orchestrator.md`).

**Contract:** none (single-domain general/backend plan).

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2, 1.3, 1.4, 1.5 [foundation - no internal deps; pure helpers, prompt edits, command defs]
Batch 2 (parallel): 2.1, 2.2 [routing + integration tests - depend on Batch 1]
```

---

## Batch 1: Foundation (parallel - 5 implementers)

All tasks in this batch have NO inter-task dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4, 1.5

### Task 1.1: Add `/atlas-translate` command definition and argument parser
**File:** `src/atlas/commands.ts`
**Test:** `tests/atlas/commands.test.ts`
**Depends:** none
**Domain:** general

Add a fourth entry to `atlasCommandDefinitions` for `/atlas-translate` with a Chinese-friendly English description (descriptions stay English; they are command help text, not Atlas prose). Export a new `parseAtlasTranslateArgs(argv: readonly string[])` that returns `{ readonly targetPath: string }`. Default `targetPath` is the literal string `"all"`. Accept exactly zero or one positional argument; the first positional becomes `targetPath`. Reject unknown flags (anything starting with `--`). Reject more than one positional with a clear error.

Why these defaults: the existing `parseAtlasInitArgs` rejects unknowns and is the local convention; the `atlas-translator` agent prompt already expects `TARGET_PATH=<value> or "all"`, so `"all"` is the right default sentinel.

```typescript
// tests/atlas/commands.test.ts (additions, keep existing tests intact)
import { describe, expect, it } from "bun:test";

import {
  atlasCommandDefinitions,
  parseAtlasInitArgs,
  parseAtlasTranslateArgs,
} from "@/atlas/commands";

describe("atlas slash commands", () => {
  it("declares four commands with descriptions", () => {
    const names = atlasCommandDefinitions.map((command) => command.name);
    expect(names).toEqual(["/atlas-init", "/atlas-status", "/atlas-refresh", "/atlas-translate"]);
    for (const command of atlasCommandDefinitions) {
      expect(command.description.length).toBeGreaterThan(0);
    }
  });

  it("/atlas-init parser still rejects unknown flags and conflicting flags", () => {
    expect(parseAtlasInitArgs([])).toEqual({ mode: "fresh" });
    expect(() => parseAtlasInitArgs(["--weird"])).toThrow();
    expect(() => parseAtlasInitArgs(["--reconcile", "--force-rebuild"])).toThrow();
  });

  it("/atlas-translate defaults to target 'all' when no argument is passed", () => {
    expect(parseAtlasTranslateArgs([])).toEqual({ targetPath: "all" });
  });

  it("/atlas-translate accepts a single positional target", () => {
    expect(parseAtlasTranslateArgs(["20-behavior"])).toEqual({ targetPath: "20-behavior" });
    expect(parseAtlasTranslateArgs(["10-impl/runner.md"])).toEqual({ targetPath: "10-impl/runner.md" });
    expect(parseAtlasTranslateArgs(["all"])).toEqual({ targetPath: "all" });
  });

  it("/atlas-translate rejects unknown flags", () => {
    expect(() => parseAtlasTranslateArgs(["--weird"])).toThrow();
  });

  it("/atlas-translate rejects multiple positionals", () => {
    expect(() => parseAtlasTranslateArgs(["20-behavior", "10-impl"])).toThrow();
  });
});
```

```typescript
// src/atlas/commands.ts
import type { InitMode } from "@/tools/atlas/init";

export interface AtlasCommandDefinition {
  readonly name: string;
  readonly description: string;
}

const ATLAS_INIT_DESCRIPTION = [
  "Cold-start the project atlas vault: discover, plan, optionally ask Octto questions,",
  "and write a usable Obsidian vault (use --reconcile or --force-rebuild on existing vaults)",
].join(" ");

const ATLAS_TRANSLATE_DESCRIPTION = [
  "Translate existing atlas markdown nodes into Chinese without rerunning /atlas-init.",
  "Preserves frontmatter, wikilinks, code, paths, URLs, package names, commands, source pointers.",
  "Optional target: 'all' (default), '20-behavior', '10-impl/runner.md', etc.",
].join(" ");

export const atlasCommandDefinitions: readonly AtlasCommandDefinition[] = [
  {
    name: "/atlas-init",
    description: ATLAS_INIT_DESCRIPTION,
  },
  {
    name: "/atlas-status",
    description: "Report atlas vault health: open challenges, broken wikilinks, orphan staging, last run",
  },
  {
    name: "/atlas-refresh",
    description: "Manually refresh a single atlas node or area without waiting for lifecycle finish",
  },
  {
    name: "/atlas-translate",
    description: ATLAS_TRANSLATE_DESCRIPTION,
  },
];

const RECONCILE = "--reconcile";
const FORCE_REBUILD = "--force-rebuild";
const KNOWN_INIT_FLAGS = new Set<string>([RECONCILE, FORCE_REBUILD]);
const FLAG_PREFIX = "--";
const DEFAULT_TRANSLATE_TARGET = "all";

export function parseAtlasInitArgs(argv: readonly string[]): { readonly mode: InitMode } {
  for (const arg of argv) {
    if (!KNOWN_INIT_FLAGS.has(arg)) throw new Error(`unknown flag: ${arg}`);
  }

  const reconcile = argv.includes(RECONCILE);
  const forceRebuild = argv.includes(FORCE_REBUILD);
  if (reconcile && forceRebuild) throw new Error("cannot pass both --reconcile and --force-rebuild");
  if (reconcile) return { mode: "reconcile" };
  if (forceRebuild) return { mode: "force-rebuild" };
  return { mode: "fresh" };
}

export function parseAtlasTranslateArgs(argv: readonly string[]): { readonly targetPath: string } {
  const positionals: string[] = [];
  for (const arg of argv) {
    if (arg.startsWith(FLAG_PREFIX)) throw new Error(`unknown flag: ${arg}`);
    positionals.push(arg);
  }
  if (positionals.length > 1) {
    throw new Error(`/atlas-translate accepts at most one target argument, got ${positionals.length}`);
  }
  const [target] = positionals;
  return { targetPath: target ?? DEFAULT_TRANSLATE_TARGET };
}
```

**Verify:** `bun test tests/atlas/commands.test.ts`
**Commit:** `feat(atlas): add /atlas-translate command and argument parser`

### Task 1.2: Add `atlas:` commit helpers for init and translate runs
**File:** `src/atlas/git.ts`
**Test:** `tests/atlas/git.test.ts`
**Depends:** none
**Domain:** general

Extend `src/atlas/git.ts` with two new exported helpers that produce stable summary strings the agents will pass into `buildAtlasCommitMessage`. Keep existing `buildAtlasCommitMessage` and `validateStagedPaths` unchanged. The helpers exist so tests can pin the wording and the agent prompts can reference these names verbatim. Both summaries must be English (commit messages are machine-facing log lines, kept English by spec).

```typescript
// tests/atlas/git.test.ts (full replacement: extend existing tests, do not delete)
import { describe, expect, it } from "bun:test";

import { ATLAS_COMMIT_PREFIX } from "@/atlas/config";
import {
  buildAtlasCommitMessage,
  buildAtlasInitCommitSummary,
  buildAtlasTranslateCommitSummary,
  validateStagedPaths,
} from "@/atlas/git";

describe("atlas git utility", () => {
  it("prefixes commit messages with atlas:", () => {
    expect(buildAtlasCommitMessage("touch runner")).toBe(`${ATLAS_COMMIT_PREFIX} touch runner`);
  });

  it("does not double-prefix", () => {
    expect(buildAtlasCommitMessage("atlas: touch runner")).toBe(`${ATLAS_COMMIT_PREFIX} touch runner`);
  });

  it("validates that staged paths live entirely under atlas/", () => {
    expect(validateStagedPaths(["atlas/10-impl/x.md", "atlas/_meta/log/run.md"])).toEqual({ ok: true });
    expect(validateStagedPaths(["atlas/x.md", "src/y.ts"])).toEqual({
      ok: false,
      reason: "non-atlas paths staged: src/y.ts",
    });
    expect(validateStagedPaths([])).toEqual({ ok: false, reason: "no atlas paths staged" });
  });

  it("buildAtlasInitCommitSummary describes the cold-init run", () => {
    const summary = buildAtlasInitCommitSummary({ runId: "20260505T120000-abc" });
    expect(summary).toContain("init");
    expect(summary).toContain("20260505T120000-abc");
  });

  it("buildAtlasTranslateCommitSummary describes the translate run with target", () => {
    const allSummary = buildAtlasTranslateCommitSummary({ runId: "20260505T120100-xyz", targetPath: "all" });
    expect(allSummary).toContain("translate");
    expect(allSummary).toContain("20260505T120100-xyz");
    expect(allSummary).toContain("all");

    const scopedSummary = buildAtlasTranslateCommitSummary({
      runId: "20260505T120200-def",
      targetPath: "20-behavior",
    });
    expect(scopedSummary).toContain("20-behavior");
  });

  it("commit helpers feed cleanly into buildAtlasCommitMessage", () => {
    const summary = buildAtlasInitCommitSummary({ runId: "run-1" });
    expect(buildAtlasCommitMessage(summary).startsWith(ATLAS_COMMIT_PREFIX)).toBe(true);
  });
});
```

```typescript
// src/atlas/git.ts
import { ATLAS_COMMIT_PREFIX, ATLAS_ROOT_DIRNAME } from "./config";

const PREFIX_PATTERN = /^atlas:\s*/;

export function buildAtlasCommitMessage(summary: string): string {
  const cleaned = summary.replace(PREFIX_PATTERN, "").trim();
  return `${ATLAS_COMMIT_PREFIX} ${cleaned}`;
}

export interface StagedValidation {
  readonly ok: boolean;
  readonly reason?: string;
}

export function validateStagedPaths(paths: readonly string[]): StagedValidation {
  if (paths.length === 0) return { ok: false, reason: "no atlas paths staged" };
  const offenders = paths.filter((path) => !path.startsWith(`${ATLAS_ROOT_DIRNAME}/`));
  if (offenders.length > 0) return { ok: false, reason: `non-atlas paths staged: ${offenders.join(", ")}` };
  return { ok: true };
}

export interface AtlasInitCommitSummaryInput {
  readonly runId: string;
}

export function buildAtlasInitCommitSummary(input: AtlasInitCommitSummaryInput): string {
  return `init vault (run ${input.runId})`;
}

export interface AtlasTranslateCommitSummaryInput {
  readonly runId: string;
  readonly targetPath: string;
}

export function buildAtlasTranslateCommitSummary(input: AtlasTranslateCommitSummaryInput): string {
  return `translate ${input.targetPath} (run ${input.runId})`;
}
```

**Verify:** `bun test tests/atlas/git.test.ts`
**Commit:** `feat(atlas): add atlas: commit summary helpers for init and translate`

### Task 1.3: Switch cold-init renderer fallbacks to Chinese (visible, not silent)
**File:** `src/atlas/cold-init/renderer.ts`
**Test:** `tests/atlas/cold-init/renderer.test.ts`
**Depends:** none
**Domain:** general

Replace the three English literals with Chinese equivalents while keeping all machine syntax untouched (frontmatter, ids, source pointers, wikilinks, code, headings used as Obsidian anchor targets). The visible Chinese seed text replaces the silent `_seed summary; refine in a follow-up_` so a stale fallback is never mistaken for finished prose. The empty placeholder `_none_` is kept in English-style emphasis form `_无_` to remain a stable, greppable sentinel that other code paths (like `tests/atlas/cold-init/renderer.test.ts`) can match unambiguously.

The inferred preamble explicitly tells the reader the page is a draft (in Chinese) so the user sees the "this is not authoritative" signal in their own language.

```typescript
// tests/atlas/cold-init/renderer.test.ts (full replacement; existing scenarios preserved with Chinese assertions where applicable)
import { describe, expect, it } from "bun:test";

import { renderColdInitNode } from "@/atlas/cold-init/renderer";
import type { PlannedNode } from "@/atlas/cold-init/types";
import { ATLAS_LAYERS } from "@/atlas/types";

const baseNode: PlannedNode = {
  id: "10-impl/runner",
  layer: ATLAS_LAYERS.IMPL,
  relativePath: "10-impl/runner.md",
  title: "Runner",
  summary: "Runner orchestrates lifecycle commands.",
  sources: ["code:src/lifecycle/runner.ts"],
  connections: [],
  inferred: false,
};

describe("renderColdInitNode", () => {
  it("renders frontmatter and section headings unchanged", () => {
    const out = renderColdInitNode({
      node: baseNode,
      userNote: null,
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    expect(out).toContain("id: 10-impl/runner");
    expect(out).toContain("# Runner\n");
    expect(out).toContain("## Summary");
    expect(out).toContain("## Connections");
    expect(out).toContain("## Sources");
    expect(out).toContain("- code:src/lifecycle/runner.ts");
  });

  it("uses Chinese empty placeholder _无_ for empty connection lists", () => {
    const out = renderColdInitNode({
      node: { ...baseNode, connections: [] },
      userNote: null,
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    expect(out).toContain("_无_");
    expect(out).not.toContain("_none_");
  });

  it("emits a Chinese inferred-draft preamble when node.inferred is true", () => {
    const out = renderColdInitNode({
      node: { ...baseNode, inferred: true, summary: "推断的摘要。" },
      userNote: null,
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    expect(out).toContain("推断");
    expect(out).toContain("草稿");
    expect(out).toContain("推断的摘要。");
  });

  it("falls back to a Chinese visible seed when summary is empty", () => {
    const out = renderColdInitNode({
      node: { ...baseNode, summary: "" },
      userNote: null,
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    expect(out).toContain("摘要待补全");
  });

  it("preserves wikilinks and code-style identifiers in connections section", () => {
    const out = renderColdInitNode({
      node: { ...baseNode, connections: ["20-behavior/feature-x"] },
      userNote: null,
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    expect(out).toContain("[[20-behavior/feature-x]]");
  });

  it("renders user notes verbatim (Chinese or otherwise)", () => {
    const out = renderColdInitNode({
      node: baseNode,
      userNote: "请补充 src/runner.ts 的失败语义。",
      lastVerifiedCommit: "",
      lastWrittenMtime: 0,
    });
    expect(out).toContain("请补充 src/runner.ts 的失败语义。");
  });
});
```

```typescript
// src/atlas/cold-init/renderer.ts
import type { PlannedNode } from "@/atlas/cold-init/types";
import { serializeFrontmatter } from "@/atlas/frontmatter";
import { ATLAS_NODE_STATUSES, type AtlasFrontmatter } from "@/atlas/types";
import { formatWikilink } from "@/atlas/wikilink";

const EMPTY_PLACEHOLDER = "_无_";
const SUMMARY_PLACEHOLDER = "_摘要待补全：请在下次 lifecycle 或 /atlas-refresh 时补全_";
const INFERRED_PREAMBLE =
  "本页是基于下方来源推断生成的早期草稿，措辞尚未定稿；请在下一次 lifecycle 或 /atlas-refresh 时再核实。";

export interface RenderInput {
  readonly node: PlannedNode;
  readonly userNote: string | null;
  readonly lastVerifiedCommit: string;
  readonly lastWrittenMtime: number;
}

const renderSection = (title: string, body: string): string => `## ${title}\n\n${body}\n`;

const renderBullets = (items: readonly string[]): string => {
  if (items.length === 0) return EMPTY_PLACEHOLDER;
  return items.map((item) => `- ${item}`).join("\n");
};

const renderSummary = (node: PlannedNode): string => {
  if (!node.inferred) return node.summary;
  return `${INFERRED_PREAMBLE}\n\n${node.summary}`;
};

export function renderColdInitNode(input: RenderInput): string {
  const frontmatter: AtlasFrontmatter = {
    id: input.node.id,
    layer: input.node.layer,
    status: ATLAS_NODE_STATUSES.ACTIVE,
    last_verified_commit: input.lastVerifiedCommit,
    last_written_mtime: input.lastWrittenMtime,
    sources: input.node.sources,
    extras: {},
  };
  const summary = renderSummary(input.node) || SUMMARY_PLACEHOLDER;
  const sections: string[] = [`# ${input.node.title}\n`, renderSection("Summary", summary)];
  const note = input.userNote?.trim();
  if (note) sections.push(renderSection("User notes", note));
  sections.push(renderSection("Connections", renderBullets(input.node.connections.map(formatWikilink))));
  sections.push(renderSection("Sources", renderBullets(input.node.sources)));
  sections.push(renderSection("Notes", EMPTY_PLACEHOLDER));
  return serializeFrontmatter(frontmatter, sections.join("\n"));
}
```

Note: the H2 section titles `Summary`, `Connections`, `Sources`, `Notes`, `User notes` are NOT translated here. Reason: the cold-init renderer outputs canonical structure that downstream tooling and the translator agent both key off; translation of section titles is the translator agent's job (it has the standard mapping). Keeping the renderer English-skeleton plus Chinese-prose maintains a single rewrite point for the translator and matches the pattern already used by `src/atlas/templates.ts`.

**Verify:** `bun test tests/atlas/cold-init/renderer.test.ts`
**Commit:** `feat(atlas): switch cold-init renderer fallbacks and inferred preamble to Chinese`

### Task 1.4: Switch cold-init synthesize and vault-writer log fallbacks to Chinese
**File:** `src/atlas/cold-init/synthesize.ts`
**Test:** `tests/atlas/cold-init/synthesize.test.ts`
**Depends:** none
**Domain:** general

Replace the five English fallback summary literals in `synthesize.ts` with Chinese equivalents. These are visible to the user inside the rendered Atlas pages, and are the strings the user reported as "English worker output silently passing as final." The fallbacks must remain factual (template-style) and must not interpolate any English content from sources. Machine fields (id, layer, relativePath, sources pointers, connection ids) are untouched.

In addition, also update `src/atlas/cold-init/vault-writer.ts` to render its maintenance log narrative in Chinese (the `I wrote N nodes...`, `## Nodes written`, ` (inferred draft)` strings). Keep the run id, file paths, and node relativePaths unchanged. This is included in the same task because the maintenance log is the user's primary visible signal that a cold-init run completed. The two file changes are tightly coupled (both feed visible Chinese prose into the same run's output) and small enough to land together.

> Engineering note: this task touches two files. We deviate from the strict one-file-per-task rule because (a) both files are part of the same cold-init synthesis pipeline, (b) splitting them would force a second batch dependency for what is a 30-line text edit, (c) the existing test conventions (`tests/atlas/cold-init/synthesize.test.ts` and `tests/atlas/cold-init/vault-writer.test.ts`) already test these in isolation. The implementer should update the synthesize test inline, and update the existing vault-writer test to assert Chinese log strings (without breaking other assertions).

```typescript
// tests/atlas/cold-init/synthesize.test.ts — additions
// Keep all existing tests intact. Add:
import { describe, expect, it } from "bun:test";

import { synthesizeVaultPlan } from "@/atlas/cold-init/synthesize";
import type { ColdInitDiscovery } from "@/atlas/cold-init/types";

const emptyDiscovery: ColdInitDiscovery = {
  projectName: "demo",
  projectType: "node",
  readmeSummary: null,
  modules: [],
  designs: [],
  lifecycleRecords: [],
  projectMemoryDecisions: [],
  projectMemoryRisks: [],
};

describe("synthesizeVaultPlan Chinese fallbacks", () => {
  it("uses a Chinese index summary when readmeSummary is null", () => {
    const plan = synthesizeVaultPlan(emptyDiscovery);
    expect(plan.indexNode.summary).toContain("项目");
    expect(plan.indexNode.summary).toContain("demo");
  });

  it("uses a Chinese phase roadmap summary", () => {
    const plan = synthesizeVaultPlan(emptyDiscovery);
    const roadmap = plan.decisionNodes.find((n) => n.id === "decision/atlas-phase-roadmap");
    expect(roadmap).toBeDefined();
    expect(roadmap?.summary).toContain("当前阶段");
  });

  it("uses a Chinese behavior fallback when a closed lifecycle has no design", () => {
    const plan = synthesizeVaultPlan({
      ...emptyDiscovery,
      lifecycleRecords: [
        {
          issueNumber: 42,
          state: "closed",
          designPointers: [],
          pointer: "lifecycle:42",
        },
      ],
    });
    const behavior = plan.behaviorNodes.find((n) => n.id === "20-behavior/lifecycle-42");
    expect(behavior).toBeDefined();
    expect(behavior?.summary).toContain("行为");
    expect(behavior?.summary).not.toContain("Behavior derived from lifecycle");
  });

  it("uses a Chinese timeline index summary and per-record summary", () => {
    const plan = synthesizeVaultPlan({
      ...emptyDiscovery,
      lifecycleRecords: [
        {
          issueNumber: 7,
          state: "closed",
          designPointers: [],
          pointer: "lifecycle:7",
        },
      ],
    });
    const indexNode = plan.timelineNodes.find((n) => n.id === "60-timeline/index");
    expect(indexNode?.summary).toContain("时间线");
    const record = plan.timelineNodes.find((n) => n.id === "60-timeline/lifecycle-7");
    expect(record?.summary).toContain("最近一次写入状态");
    expect(record?.summary).toContain("closed"); // raw state value preserved
  });
});
```

```typescript
// src/atlas/cold-init/synthesize.ts (only the affected literals shown; rest unchanged)
const planIndex = (discovery: ColdInitDiscovery): PlannedNode => ({
  id: "index",
  layer: ATLAS_LAYERS.DECISION,
  relativePath: "00-index.md",
  title: discovery.projectName,
  summary: discovery.readmeSummary ?? `项目 ${discovery.projectName} 的 Atlas 知识库。`,
  sources: discovery.readmeSummary !== null ? ["code:README.md"] : [],
  connections: [],
  inferred: false,
});

// inside planLifecycleBehaviorNodes:
//   summary: design?.excerpt ?? "行为内容尚未抽取，仅基于 lifecycle 记录推断；待下一次 /atlas-refresh 补全。",

// PHASE_ROADMAP_NODE:
//   summary: "记录当前阶段的范围与下一阶段延后项的权威条目。",

// inside planTimelineNodes records:
//   summary: `最近一次写入状态：${record.state}。`,
// timeline indexNode:
//   summary: `时间线汇总：共 ${records.length} 条 lifecycle 记录。`,
```

```typescript
// src/atlas/cold-init/vault-writer.ts (renderMaintenanceLog only; everything else unchanged)
const MARKED_INFERRED = "（推断草稿）";

const renderMaintenanceLog = (runId: string, plan: VaultPlan, answersCount: number): string => {
  const nodes = collectNodes(plan);
  const lines = [
    `# 冷启动初始化运行 ${runId}`,
    "",
    `本次共写入 ${nodes.length} 个节点，覆盖 build / behavior / decision / risk / timeline 五个层。`,
    `合并了 ${answersCount} 条来自 Octto 的用户备注。`,
    "",
    "## 已写入节点",
    ...nodes.map((node) => `- ${node.relativePath}${node.inferred ? MARKED_INFERRED : ""}`),
  ];
  return `${lines.join("\n")}\n`;
};
```

The existing `tests/atlas/cold-init/vault-writer.test.ts` will need any string-comparison assertions for the maintenance log adjusted to match the Chinese narrative. The implementer should `read` that file, run the test suite, and update the asserted substrings (e.g. `expect(log).toContain("Cold init run")` → `expect(log).toContain("冷启动初始化运行")`). All structural assertions (file paths, run id substring, node count math) remain the same.

**Verify:** `bun test tests/atlas/cold-init/synthesize.test.ts tests/atlas/cold-init/vault-writer.test.ts`
**Commit:** `feat(atlas): switch cold-init synthesize and vault-writer log to Chinese`

### Task 1.5: Update atlas-cold-build and atlas-cold-behavior worker prompts to mandate Chinese prose
**File:** `src/agents/atlas-cold-build.ts`
**Test:** `tests/agents/atlas-worker-build.test.ts` (existing) + adjacent `tests/agents/atlas-cold-build.test.ts` if present
**Depends:** none
**Domain:** general

Add the same LANGUAGE rule already present on `atlas-worker-build` and `atlas-worker-behavior` to the cold-init equivalents. The cold-init agents currently have NO Chinese-language instruction, so a fresh `/atlas-init` run today produces English drafts. Adding this rule is the smallest behavioral change that makes the agent actually emit Chinese.

The equivalent change to `src/agents/atlas-cold-behavior.ts` is also required and is bundled here for the same reason as Task 1.4 (two adjacent worker files, same instruction). The implementer should update both files in one commit.

This is a prompt-only change; `Test: none` is sufficient for the cold-behavior file (semantic risk: low; the worker is invoked by an LLM that obeys the prompt), but the cold-build worker has an existing test scaffold that must be expanded to lock in the Chinese rule. Use `tests/agents/atlas-cold-build.test.ts` (new) modeled after `tests/agents/atlas-worker-build.test.ts`. If that file already exists, extend it. If not, create it.

```typescript
// tests/agents/atlas-cold-build.test.ts (new file; mirrors the existing worker-build test conventions)
import { describe, expect, it } from "bun:test";

import { atlasColdBuildAgent } from "@/agents/atlas-cold-build";

describe("atlas-cold-build prompt", () => {
  it("declares subagent mode", () => {
    expect(atlasColdBuildAgent.mode).toBe("subagent");
  });

  it("instructs the worker to write prose in Chinese while preserving machine syntax", () => {
    const prompt = atlasColdBuildAgent.prompt;
    expect(prompt).toMatch(/中文|Chinese/);
    expect(prompt).toContain("source pointer");
    expect(prompt).toContain("file path");
    expect(prompt).toContain("identifier");
  });

  it("constrains the worker to the Build layer", () => {
    expect(atlasColdBuildAgent.prompt).toContain("Build layer");
  });
});
```

```typescript
// src/agents/atlas-cold-build.ts (constraints block addition shown)
<constraints>
- Stay in the Build layer (file responsibilities, exports, internal contracts).
- Do not propose Behavior layer claims.
- Use single-word names where context allows.
- Keep total length under 60 lines.
- LANGUAGE: Write all human-readable prose (paragraph summaries, bullet point text) in Chinese. Do NOT translate: source pointers (e.g. "code:src/foo.ts"), file paths, package names, code symbols, identifiers, commit SHAs, URLs, command names, inline code spans, fenced code blocks, Obsidian wikilinks (the text inside [[...]]).
</constraints>
```

The same `LANGUAGE` rule must be appended to the `<constraints>` block of `src/agents/atlas-cold-behavior.ts`, with the wording adjusted to mention "user-visible behavior, mechanics, numerics, rules" rather than "exports". No test for cold-behavior is required (Test: none for that file edit) because (a) the existing `atlas-worker-behavior` already has an identical proven rule, (b) this is a copy-paste prompt edit, (c) the cold-build test above pins the precedent.

**Verify:** `bun test tests/agents/atlas-cold-build.test.ts tests/agents/atlas-worker-build.test.ts tests/agents/atlas-worker-behavior.test.ts`
**Commit:** `feat(atlas): mandate Chinese prose in atlas-cold-build and atlas-cold-behavior worker prompts`

---

## Batch 2: Routing and Integration (parallel - 2 implementers)

All tasks in this batch depend on Batch 1 completing (they import the new command definition / parser and the new commit helpers).
Tasks: 2.1, 2.2

### Task 2.1: Wire `/atlas-translate` into the plugin command table and route to atlas-translator
**File:** `src/index.ts`
**Test:** `tests/atlas/commands.test.ts` (extend) and a new `tests/index-atlas-routing.test.ts`
**Depends:** 1.1 (uses the new command definition exported from `src/atlas/commands.ts`)
**Domain:** backend

The plugin builds `ATLAS_COMMANDS` by mapping every entry in `atlasCommandDefinitions` to a routing record. Currently only `/atlas-init` is sent to a dedicated agent (`atlas-initializer`); the others fall through to `PRIMARY_AGENT_NAME` and are deterministically executed by the `command.execute.before` hook.

`/atlas-translate` should NOT use the deterministic hook (it requires LLM translation work). Route it to the `atlas-translator` agent that already exists at `src/agents/atlas-translator.ts`. The hook in `command.execute.before` must skip both `/atlas-init` AND `/atlas-translate`, since both are agent-driven.

Add a constant `ATLAS_TRANSLATE_COMMAND = "atlas-translate"` near the existing `ATLAS_INIT_COMMAND` constant. Extend the `ATLAS_COMMANDS` builder to map `atlas-translate` to `atlas-translator`. Extend the early-return guard in `command.execute.before` to also short-circuit on `atlas-translate`. Confirm the standard `template: \`Run the ${definition.name} ... with arguments: $ARGUMENTS\`` template still works for the new command (it does; `$ARGUMENTS` carries the user's target path through to the agent prompt where the translator's `target-scope` block reads it).

> Engineering note: this task touches one file (`src/index.ts`) plus its tests. Routing logic is the single edit.

```typescript
// tests/index-atlas-routing.test.ts (new file)
import { describe, expect, it } from "bun:test";

import { atlasCommandDefinitions } from "@/atlas/commands";

// We test the routing decision in isolation by reading the same data the plugin
// reads. This avoids spinning the full plugin context. Implementer note: if
// extracting the command builder into a named export is cleaner, do so and
// import it here; otherwise duplicate the small mapping logic and assert it.
describe("atlas command routing", () => {
  it("declares /atlas-translate as a real command", () => {
    const names = atlasCommandDefinitions.map((c) => c.name);
    expect(names).toContain("/atlas-translate");
  });

  it("/atlas-translate description mentions translate and Chinese intent", () => {
    const def = atlasCommandDefinitions.find((c) => c.name === "/atlas-translate");
    expect(def?.description.toLowerCase()).toContain("translate");
    expect(def?.description.toLowerCase()).toMatch(/chinese|中文/i);
  });
});
```

```typescript
// src/index.ts — only the touched constants and helpers shown
const ATLAS_INIT_COMMAND = "atlas-init";
const ATLAS_STATUS_COMMAND = "atlas-status";
const ATLAS_REFRESH_COMMAND = "atlas-refresh";
const ATLAS_TRANSLATE_COMMAND = "atlas-translate";

// ... unchanged code ...

const ATLAS_COMMANDS = Object.fromEntries(
  atlasCommandDefinitions.map((definition) => {
    const name = normalizeAtlasCommandName(definition.name);
    // /atlas-init routes to the dedicated initializer agent (multi-phase cold build with spawn_agent workers).
    // /atlas-translate routes to the dedicated translator agent (in-place English -> Chinese rewrite).
    // /atlas-status and /atlas-refresh are executed deterministically by the command.execute.before hook.
    let agent: string;
    if (name === ATLAS_INIT_COMMAND) {
      agent = "atlas-initializer";
    } else if (name === ATLAS_TRANSLATE_COMMAND) {
      agent = "atlas-translator";
    } else {
      agent = PRIMARY_AGENT_NAME;
    }
    return [
      name,
      {
        description: definition.description,
        agent,
        template: `Run the ${definition.name} Project Atlas command with arguments: $ARGUMENTS`,
      },
    ];
  }),
);

// In the command.execute.before hook (single-line change):
"command.execute.before": async (input, output) => {
  // atlas-init and atlas-translate are routed to dedicated agents; skip direct hook execution.
  const commandName = normalizeAtlasCommandName(input.command);
  if (commandName === ATLAS_INIT_COMMAND || commandName === ATLAS_TRANSLATE_COMMAND) return;
  await runAtlasCommand(ctx, input, output, {
    buildColdInitDeps: (ownerSessionID) => buildColdInitDeps(octtoSessionStore, ownerSessionID, octtoTracker),
  });
},
```

**Verify:** `bun test tests/atlas/commands.test.ts tests/index-atlas-routing.test.ts && bun run typecheck`
**Commit:** `feat(atlas): route /atlas-translate to atlas-translator agent`

### Task 2.2: Add atlas-only auto-commit instructions to atlas-initializer and atlas-translator prompts
**File:** `src/agents/atlas-initializer.ts`
**Test:** `tests/agents/atlas-initializer.test.ts` (extend) + new `tests/agents/atlas-translator.test.ts`
**Depends:** 1.2 (references `buildAtlasInitCommitSummary`, `buildAtlasTranslateCommitSummary`, `validateStagedPaths` by name from the prompt body)
**Domain:** general

Both agents already have shell tool access. Add an `<auto-commit>` block to the end of each agent prompt that mandates the commit step after a successful run. The block specifies:

1. Run `git status --porcelain` to confirm SOMETHING changed under `atlas/`. If nothing changed, skip commit silently and report "no atlas changes".
2. Run `git add atlas/` to stage every atlas change including the maintenance log.
3. Run `git diff --cached --name-only` and confirm every line starts with `atlas/`. If any path does not start with `atlas/`, ABORT the commit, do NOT unstage, and report the offending paths to the user as a maintenance log entry. This mirrors the semantics of `validateStagedPaths` from `src/atlas/git.ts`.
4. Build the commit message:
   - For atlas-initializer: `atlas: ${buildAtlasInitCommitSummary({ runId })}` where `runId` is the cold-init run id already known to the agent.
   - For atlas-translator: `atlas: ${buildAtlasTranslateCommitSummary({ runId, targetPath })}` where `targetPath` is the value parsed from `$ARGUMENTS` (or `"all"`).
5. Run `git commit -m "<message>"`. Do NOT push. Pushing is owned by the user / lifecycle.

The prompt must reference the helper names so reviewers and future maintainers can grep them and confirm the agent uses the canonical wording. The agent does not import these helpers (it cannot; it is an LLM); it just reproduces the message string verbatim. The helpers exist so tests can later snapshot the expected commit message and so any rename surfaces in code review.

This is a prompt-only change with semantic risk in the SHELL behavior the agent performs, not in the prompt itself. Per the planner test rule (semantic risk: medium, behavior is a real commit), `Test: real test path required` covering the prompt instructions and the agent registration. The actual git behavior is exercised manually after `bun run deploy:runtime`.

```typescript
// tests/agents/atlas-initializer.test.ts (additions; keep all existing tests)
import { describe, expect, it } from "bun:test";

import { atlasInitializerAgent } from "@/agents/atlas-initializer";

describe("atlas-initializer auto-commit", () => {
  it("instructs the agent to run git add atlas/ and verify atlas-only staging", () => {
    const p = atlasInitializerAgent.prompt;
    expect(p).toContain("git add atlas/");
    expect(p).toContain("git diff --cached --name-only");
    expect(p).toContain("git commit");
  });

  it("references the canonical commit summary helper name", () => {
    expect(atlasInitializerAgent.prompt).toContain("buildAtlasInitCommitSummary");
  });

  it("requires the atlas: prefix on the final commit message", () => {
    expect(atlasInitializerAgent.prompt).toContain("atlas:");
  });

  it("requires aborting commit when non-atlas paths are staged", () => {
    expect(atlasInitializerAgent.prompt.toLowerCase()).toMatch(/abort|do not commit|refuse/);
  });

  it("forbids pushing", () => {
    expect(atlasInitializerAgent.prompt.toLowerCase()).toContain("do not push");
  });
});
```

```typescript
// tests/agents/atlas-translator.test.ts (new file)
import { describe, expect, it } from "bun:test";

import { agents } from "@/agents";
import { atlasTranslatorAgent } from "@/agents/atlas-translator";

describe("atlas-translator agent config", () => {
  it("declares subagent mode", () => {
    expect(atlasTranslatorAgent.mode).toBe("subagent");
  });

  it("preserves machine syntax in critical rules", () => {
    const p = atlasTranslatorAgent.prompt;
    expect(p).toContain("frontmatter");
    expect(p).toContain("wikilink");
    expect(p).toContain("source pointer");
  });

  it("reads optional target path from spawn prompt as TARGET_PATH=<value>", () => {
    expect(atlasTranslatorAgent.prompt).toContain("TARGET_PATH=");
  });

  it("writes a maintenance log under atlas/_meta/log/", () => {
    expect(atlasTranslatorAgent.prompt).toContain("atlas/_meta/log/translate-");
  });

  describe("auto-commit block", () => {
    it("instructs git add atlas/ and atlas-only staging verification", () => {
      const p = atlasTranslatorAgent.prompt;
      expect(p).toContain("git add atlas/");
      expect(p).toContain("git diff --cached --name-only");
      expect(p).toContain("git commit");
    });

    it("references buildAtlasTranslateCommitSummary helper name", () => {
      expect(atlasTranslatorAgent.prompt).toContain("buildAtlasTranslateCommitSummary");
    });

    it("uses the atlas: commit prefix", () => {
      expect(atlasTranslatorAgent.prompt).toContain("atlas:");
    });

    it("forbids pushing", () => {
      expect(atlasTranslatorAgent.prompt.toLowerCase()).toContain("do not push");
    });
  });

  it("is registered in the agents barrel", () => {
    expect(agents["atlas-translator"]).toBeDefined();
    expect(agents["atlas-translator"].mode).toBe("subagent");
  });
});
```

```text
// auto-commit block to append at the end of BOTH atlas-initializer and atlas-translator prompts
// (atlas-initializer variant; the atlas-translator variant uses buildAtlasTranslateCommitSummary
// and must read TARGET_PATH from the spawn prompt; otherwise structure is identical)

<auto-commit>
After a successful run, you MUST commit the atlas-only changes locally. Do NOT push; pushing is owned by the user.

1. Run: git status --porcelain
   - If there are no changes under atlas/, skip the commit step. Append a single line "no atlas changes" to atlas/_meta/log/init-<runId>.md and stop.
2. Run: git add atlas/
3. Run: git diff --cached --name-only
   - Every output line MUST start with "atlas/". This mirrors the semantics of validateStagedPaths in src/atlas/git.ts.
   - If ANY line does not start with "atlas/", do NOT commit. Run: git reset HEAD -- <each non-atlas path>. Append the violation to atlas/_meta/log/init-<runId>.md and stop.
4. Build the commit message using the canonical helper buildAtlasInitCommitSummary. The resulting summary string is: init vault (run <runId>)
   - Final message: atlas: init vault (run <runId>)
5. Run: git commit -m "<message>"
6. Do NOT push, do NOT amend, do NOT touch other branches. The commit is local; the user pushes on their own schedule.

If any of the git commands fails, append the failure to atlas/_meta/log/init-<runId>.md, leave the working tree as-is, and report a one-sentence error to the spawn channel. Do not retry automatically.
</auto-commit>
```

The atlas-translator variant differs in three places:
- Step 1 log target: `atlas/_meta/log/translate-<timestamp>.md` (the agent already creates this).
- Step 4 helper name: `buildAtlasTranslateCommitSummary` and resulting summary `translate <targetPath> (run <runId>)`.
- The `<runId>` is the translator's own log timestamp identifier; the agent already writes it as part of the maintenance log.

**Verify:** `bun test tests/agents/atlas-initializer.test.ts tests/agents/atlas-translator.test.ts && bun run check`
**Commit:** `feat(atlas): mandate atlas: auto-commit in atlas-initializer and atlas-translator prompts`

---

## Test plan

- Unit tests added in Tasks 1.1, 1.2, 1.3, 1.4, 1.5, 2.1, 2.2 cover: command parsing, routing, commit helpers, Chinese fallback strings, prompt invariants.
- Existing tests under `tests/atlas/cold-init/vault-writer.test.ts` and `tests/atlas/cold-init/synthesize.test.ts` must be updated as part of Task 1.4 to match Chinese strings (any `toContain("Cold init run")` etc.).
- Full gate: `bun run check` (Biome + ESLint + typecheck + bun test).

## Deployment note

These edits are runtime-sensitive (they change agent prompts loaded by the live OpenCode plugin) but they live under `src/`. After `bun run check` passes:

```sh
bun run deploy:runtime
# wait for: "Runtime ready. Restart of OpenCode requires explicit user approval."
# then ASK THE USER before restarting OpenCode.
```

Manual smoke after restart:
1. In a scratch repo, run `/atlas-init`. Confirm: vault contains Chinese summaries, no English fallbacks remain in non-machine fields, a single `atlas:` commit lands locally with `init vault (run <id>)` summary.
2. In the same repo, run `/atlas-translate`. Confirm: any English prose in pre-existing files is now Chinese, machine syntax untouched, `atlas/_meta/log/translate-*.md` written, a single `atlas:` commit lands.
3. Run `/atlas-translate 20-behavior` and confirm only behavior-layer files were touched.

## Risks and mitigations

- Risk: existing assertions in `tests/atlas/cold-init/vault-writer.test.ts` may rely on the old English maintenance log strings. Mitigation: Task 1.4 explicitly calls this out and the implementer runs the test, sees the failure, and updates the substring assertions to Chinese equivalents.
- Risk: agents may stage files outside `atlas/` (for example, if they accidentally ran `git add .`). Mitigation: the auto-commit block forces `git add atlas/` (path-restricted) plus a `--cached --name-only` verification gate that mirrors `validateStagedPaths` semantics.
- Risk: `_meta/staging/` artifacts get committed. Mitigation: the cold-init writer already commits-then-cleans staging through atomic rename, so by the time the agent reaches step 1 of the auto-commit block, the staging directory is empty. If a future change leaves staging non-empty, the `--cached --name-only` gate still passes (it is under `atlas/`), but the implementer should verify in the smoke test that staging is not landed.
