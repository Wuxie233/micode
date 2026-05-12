---
date: 2026-05-12
topic: "Knowledge Bootstrap Orchestrator Commands"
issue: 64
scope: commands
contract: none
---

# Knowledge Bootstrap Orchestrator Commands Implementation Plan

**Goal:** 实现三个零参数 orchestrator 命令 `/all-init` `/all-rebuild` `/all-status`，串联 `/init` `/mindmodel` `/atlas-init` 三层知识库建立流程，并新增统一的状态检测器、报告器和 octto 问卷复用层。

**Architecture:** 新增一个 primary 模式的 `knowledge-bootstrap-orchestrator` agent，通过 prompt template 传入命令名决定 mode（missing-only / refresh-all / status-only）。新增 `src/tools/knowledge-bootstrap/` 目录承载 `detect.ts` `status.ts` `questionnaire.ts` 三个纯函数模块和一个 `detect_knowledge_state` 工具。命令在 `PLUGIN_COMMANDS` 注册并路由到 orchestrator agent。沿用现有 `runAtlasInit` `runAtlasStatus` `project_memory_health` `project-initializer` `mm-orchestrator` 子能力，不重写任何 `/init` `/mindmodel` `/atlas-init` 逻辑。

**Design:** [thoughts/shared/designs/2026-05-12-knowledge-bootstrap-commands-design.md](../designs/2026-05-12-knowledge-bootstrap-commands-design.md)

**Contract:** none（单 domain：general，全部是 plugin 运行时 / agent prompt / 工具模块，无前后端契约）

**Notes on design gap-filling:**

- Design 引用了 issue #63 的 `KNOWLEDGE_CONTEXT_SECTION` 单源 `src/agents/knowledge-context-section.ts`，但 #63 尚未落地。决策：本计划在 Batch 1 新建该文件作为最小化本地模块（导出一个静态 prompt 片段常量 `KNOWLEDGE_CONTEXT_SECTION`，约束输出"本次知识上下文"板块格式）。若 #63 后续落地并扩展该文件，这是兼容点；若 #63 先落地，本任务直接复用文件不重复创建（resume rule 检测）。
- Design 提到 "atlas-initializer 接受外部传入的 octto 答案（可能需要小幅调整）"。决策：不修改 `runAtlasInit` 接口和 `atlas-initializer` agent prompt。Orchestrator agent 通过自身 octto 问卷预先收集答案，把答案文本拼接到 `spawn_agent("atlas-initializer", ...)` 的 prompt 中作为 "pre-seeded answers"，atlas-initializer 在 phase-2 synthesis 时按 prompt 提示跳过对应 octto 询问。这避开了破坏现有 atlas-initializer 的 drift guard 测试。
- `/all-rebuild` 的 force-rebuild 语义：orchestrator 调用 `runAtlasInit({ mode: "force-rebuild" })`、`spawn_agent("project-initializer", ...)` 时 prompt 显式说明"覆盖现有 ARCHITECTURE.md/CODE_STYLE.md"、`spawn_agent("mm-orchestrator", ...)` 时 prompt 显式说明"覆盖现有 .mindmodel/"。子 agent 已有覆盖语义（写文件 = 覆盖），无需修改。

---

## Dependency Graph

```
Batch 1 (parallel, 4 tasks): foundation modules - all independent
  1.1 src/tools/knowledge-bootstrap/types.ts          [no deps]
  1.2 src/tools/knowledge-bootstrap/detect.ts          [depends 1.1]
  1.3 src/tools/knowledge-bootstrap/status.ts          [depends 1.1]
  1.4 src/tools/knowledge-bootstrap/questionnaire.ts   [no deps]
  1.5 src/agents/knowledge-context-section.ts          [no deps]

Batch 2 (parallel, 2 tasks): tool registration - depends on Batch 1
  2.1 src/tools/knowledge-bootstrap/index.ts + tool factory   [depends 1.2]
  2.2 src/tools/index.ts barrel export                       [depends 2.1]

Batch 3 (parallel, 2 tasks): orchestrator agent - depends on Batch 2
  3.1 src/agents/knowledge-bootstrap-orchestrator.ts          [depends 1.5, 2.1]
  3.2 src/agents/index.ts registration                        [depends 3.1]

Batch 4 (parallel, 4 tasks): commands + integration + docs - depends on Batch 3
  4.1 src/index.ts PLUGIN_COMMANDS additions + tool wiring    [depends 2.2, 3.2]
  4.2 AGENTS.md mirror update                                 [depends 3.1]
  4.3 fixture integration test (5 scenarios)                  [depends 4.1]
  4.4 routing + drift test for three commands                 [depends 4.1]
```

**Batch counts:** 5 + 2 + 2 + 4 = 13 tasks across 4 batches.

---

## Batch 1: Foundation Modules (parallel - 5 implementers)

All tasks in this batch are independent (1.2/1.3 import 1.1's types but bun handles unwritten-import fine and tests stub). Implementers run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4, 1.5

### Task 1.1: Knowledge bootstrap types
**File:** `src/tools/knowledge-bootstrap/types.ts`
**Test:** none (pure type declarations, no runtime risk — see semantic-risk rule)
**Depends:** none
**Domain:** general
**Atlas-impact:** none

```typescript
// src/tools/knowledge-bootstrap/types.ts
// Shared types for the knowledge bootstrap orchestrator tooling.
// Layer state tri-value lets the orchestrator distinguish a clean miss
// from a permissions / IO failure (which must not be silently treated as missing).

export type LayerState = "missing" | "present" | "unknown";

export interface FilePresence {
  readonly exists: boolean;
  readonly mtime?: Date;
}

export interface ProjectMemorySummary {
  readonly entries: number;
  readonly healthy: boolean;
}

export interface KnowledgeState {
  readonly init: LayerState;
  readonly mindmodel: LayerState;
  readonly atlas: LayerState;
  readonly projectMemory: ProjectMemorySummary;
  readonly files: {
    readonly architectureMd: FilePresence;
    readonly codeStyleMd: FilePresence;
    readonly mindmodelManifest: FilePresence;
    readonly atlasIndex: FilePresence;
  };
}
```

**Verify:** `bun run typecheck` (no test file; typecheck guards the schema)
**Commit:** `feat(tools): add knowledge bootstrap shared types\n\nRefs #64`

---

### Task 1.2: Knowledge state detector
**File:** `src/tools/knowledge-bootstrap/detect.ts`
**Test:** `tests/tools/knowledge-bootstrap/detect.test.ts`
**Depends:** 1.1 (imports types)
**Domain:** general
**Atlas-impact:** none

```typescript
// tests/tools/knowledge-bootstrap/detect.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectKnowledgeState } from "@/tools/knowledge-bootstrap/detect";

let projectRoot: string;

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "knowledge-bootstrap-detect-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("detectKnowledgeState", () => {
  it("reports all three layers missing for an empty project", () => {
    const state = detectKnowledgeState(projectRoot);
    expect(state.init).toBe("missing");
    expect(state.mindmodel).toBe("missing");
    expect(state.atlas).toBe("missing");
    expect(state.files.architectureMd.exists).toBe(false);
    expect(state.files.codeStyleMd.exists).toBe(false);
    expect(state.files.mindmodelManifest.exists).toBe(false);
    expect(state.files.atlasIndex.exists).toBe(false);
    expect(state.projectMemory.entries).toBe(0);
    expect(state.projectMemory.healthy).toBe(false);
  });

  it("reports init=present when both ARCHITECTURE.md and CODE_STYLE.md exist", () => {
    writeFileSync(join(projectRoot, "ARCHITECTURE.md"), "# Arch\n", "utf8");
    writeFileSync(join(projectRoot, "CODE_STYLE.md"), "# Style\n", "utf8");
    const state = detectKnowledgeState(projectRoot);
    expect(state.init).toBe("present");
    expect(state.files.architectureMd.exists).toBe(true);
    expect(state.files.codeStyleMd.exists).toBe(true);
    expect(state.files.architectureMd.mtime).toBeInstanceOf(Date);
  });

  it("reports init=missing when only one of ARCHITECTURE.md / CODE_STYLE.md exists", () => {
    writeFileSync(join(projectRoot, "ARCHITECTURE.md"), "# Arch\n", "utf8");
    const state = detectKnowledgeState(projectRoot);
    expect(state.init).toBe("missing");
    expect(state.files.architectureMd.exists).toBe(true);
    expect(state.files.codeStyleMd.exists).toBe(false);
  });

  it("reports mindmodel=present when .mindmodel/manifest.yaml exists", () => {
    mkdirSync(join(projectRoot, ".mindmodel"), { recursive: true });
    writeFileSync(join(projectRoot, ".mindmodel", "manifest.yaml"), "version: 1\n", "utf8");
    const state = detectKnowledgeState(projectRoot);
    expect(state.mindmodel).toBe("present");
    expect(state.files.mindmodelManifest.exists).toBe(true);
  });

  it("reports atlas=present when atlas/00-index.md exists", () => {
    mkdirSync(join(projectRoot, "atlas"), { recursive: true });
    writeFileSync(join(projectRoot, "atlas", "00-index.md"), "# Index\n", "utf8");
    const state = detectKnowledgeState(projectRoot);
    expect(state.atlas).toBe("present");
    expect(state.files.atlasIndex.exists).toBe(true);
  });

  it("reports atlas=missing when atlas/ exists but 00-index.md is absent", () => {
    mkdirSync(join(projectRoot, "atlas"), { recursive: true });
    const state = detectKnowledgeState(projectRoot);
    expect(state.atlas).toBe("missing");
    expect(state.files.atlasIndex.exists).toBe(false);
  });

  it("reports all three layers present in a fully-bootstrapped project", () => {
    writeFileSync(join(projectRoot, "ARCHITECTURE.md"), "# Arch\n", "utf8");
    writeFileSync(join(projectRoot, "CODE_STYLE.md"), "# Style\n", "utf8");
    mkdirSync(join(projectRoot, ".mindmodel"), { recursive: true });
    writeFileSync(join(projectRoot, ".mindmodel", "manifest.yaml"), "version: 1\n", "utf8");
    mkdirSync(join(projectRoot, "atlas"), { recursive: true });
    writeFileSync(join(projectRoot, "atlas", "00-index.md"), "# Index\n", "utf8");
    const state = detectKnowledgeState(projectRoot);
    expect(state.init).toBe("present");
    expect(state.mindmodel).toBe("present");
    expect(state.atlas).toBe("present");
  });

  it("includes Project Memory placeholder summary (zero entries by default)", () => {
    const state = detectKnowledgeState(projectRoot);
    expect(state.projectMemory).toEqual({ entries: 0, healthy: false });
  });
});
```

```typescript
// src/tools/knowledge-bootstrap/detect.ts
import { existsSync, statSync } from "node:fs";
import { join } from "node:path";

import type { FilePresence, KnowledgeState, LayerState } from "./types";

const ARCHITECTURE_MD = "ARCHITECTURE.md";
const CODE_STYLE_MD = "CODE_STYLE.md";
const MINDMODEL_MANIFEST = join(".mindmodel", "manifest.yaml");
const ATLAS_INDEX = join("atlas", "00-index.md");

function readPresence(absolutePath: string): FilePresence {
  try {
    if (!existsSync(absolutePath)) return { exists: false };
    const stat = statSync(absolutePath);
    return { exists: stat.isFile(), mtime: stat.mtime };
  } catch {
    // Permission / IO error: surface as "exists: false" with no mtime so the
    // caller can downgrade the layer to "unknown".
    return { exists: false };
  }
}

function deriveInitState(arch: FilePresence, style: FilePresence): LayerState {
  if (arch.exists && style.exists) return "present";
  return "missing";
}

function deriveMindmodelState(manifest: FilePresence): LayerState {
  return manifest.exists ? "present" : "missing";
}

function deriveAtlasState(index: FilePresence): LayerState {
  return index.exists ? "present" : "missing";
}

// detectKnowledgeState reads file presence on disk and returns a synchronous,
// dependency-free snapshot. Project Memory entries default to {0, false}; the
// orchestrator augments this with project_memory_health output when available.
export function detectKnowledgeState(projectRoot: string): KnowledgeState {
  const architectureMd = readPresence(join(projectRoot, ARCHITECTURE_MD));
  const codeStyleMd = readPresence(join(projectRoot, CODE_STYLE_MD));
  const mindmodelManifest = readPresence(join(projectRoot, MINDMODEL_MANIFEST));
  const atlasIndex = readPresence(join(projectRoot, ATLAS_INDEX));

  return {
    init: deriveInitState(architectureMd, codeStyleMd),
    mindmodel: deriveMindmodelState(mindmodelManifest),
    atlas: deriveAtlasState(atlasIndex),
    projectMemory: { entries: 0, healthy: false },
    files: { architectureMd, codeStyleMd, mindmodelManifest, atlasIndex },
  };
}
```

**Verify:** `bun test tests/tools/knowledge-bootstrap/detect.test.ts`
**Commit:** `feat(tools): add knowledge bootstrap state detector\n\nRefs #64`

---

### Task 1.3: Knowledge bootstrap status reporter
**File:** `src/tools/knowledge-bootstrap/status.ts`
**Test:** `tests/tools/knowledge-bootstrap/status.test.ts`
**Depends:** 1.1 (imports types)
**Domain:** general
**Atlas-impact:** none

```typescript
// tests/tools/knowledge-bootstrap/status.test.ts
import { describe, expect, it } from "bun:test";

import { renderBootstrapStatus } from "@/tools/knowledge-bootstrap/status";
import type { KnowledgeState } from "@/tools/knowledge-bootstrap/types";

const FIXED_DATE = new Date("2026-05-12T10:00:00Z");

function buildState(overrides: Partial<KnowledgeState> = {}): KnowledgeState {
  return {
    init: "missing",
    mindmodel: "missing",
    atlas: "missing",
    projectMemory: { entries: 0, healthy: false },
    files: {
      architectureMd: { exists: false },
      codeStyleMd: { exists: false },
      mindmodelManifest: { exists: false },
      atlasIndex: { exists: false },
    },
    ...overrides,
  };
}

const EMPTY_ATLAS_STATUS = {
  openChallenges: 0,
  brokenWikilinks: 0,
  orphanStagingDirs: 0,
  staleNodes: 0,
  lastSuccessfulRun: null,
  spawnReceiptDiff: 0,
};

describe("renderBootstrapStatus", () => {
  it("renders an all-missing report and recommends /all-init", () => {
    const out = renderBootstrapStatus(buildState(), EMPTY_ATLAS_STATUS);
    expect(out).toContain("/init layer");
    expect(out).toContain("missing");
    expect(out).toContain(".mindmodel/");
    expect(out).toContain("atlas/");
    expect(out).toContain("/all-init");
  });

  it("renders an all-present report and recommends /all-rebuild", () => {
    const state = buildState({
      init: "present",
      mindmodel: "present",
      atlas: "present",
      files: {
        architectureMd: { exists: true, mtime: FIXED_DATE },
        codeStyleMd: { exists: true, mtime: FIXED_DATE },
        mindmodelManifest: { exists: true, mtime: FIXED_DATE },
        atlasIndex: { exists: true, mtime: FIXED_DATE },
      },
    });
    const out = renderBootstrapStatus(state, EMPTY_ATLAS_STATUS);
    expect(out).toContain("present");
    expect(out).toContain("/all-rebuild");
  });

  it("surfaces atlas open challenges count", () => {
    const out = renderBootstrapStatus(buildState({ atlas: "present" }), {
      ...EMPTY_ATLAS_STATUS,
      openChallenges: 3,
    });
    expect(out).toContain("open challenges");
    expect(out).toContain("3");
  });

  it("surfaces broken wikilinks count", () => {
    const out = renderBootstrapStatus(buildState({ atlas: "present" }), {
      ...EMPTY_ATLAS_STATUS,
      brokenWikilinks: 2,
    });
    expect(out).toContain("broken wikilinks");
    expect(out).toContain("2");
  });

  it("includes mtime for present files when available", () => {
    const state = buildState({
      init: "present",
      files: {
        architectureMd: { exists: true, mtime: FIXED_DATE },
        codeStyleMd: { exists: true, mtime: FIXED_DATE },
        mindmodelManifest: { exists: false },
        atlasIndex: { exists: false },
      },
    });
    const out = renderBootstrapStatus(state, EMPTY_ATLAS_STATUS);
    expect(out).toContain("2026-05-12");
  });

  it("includes Project Memory summary line", () => {
    const state = buildState({ projectMemory: { entries: 42, healthy: true } });
    const out = renderBootstrapStatus(state, EMPTY_ATLAS_STATUS);
    expect(out).toContain("Project Memory");
    expect(out).toContain("42");
  });
});
```

```typescript
// src/tools/knowledge-bootstrap/status.ts
import type { FilePresence, KnowledgeState, LayerState } from "./types";

// AtlasStatusResult mirrors the public shape of runAtlasStatus's StatusReport.
// Declared here as a structural type to avoid a cross-import cycle with src/tools/atlas/.
export interface AtlasStatusResult {
  readonly openChallenges: number;
  readonly brokenWikilinks: number;
  readonly orphanStagingDirs: number;
  readonly staleNodes: number;
  readonly lastSuccessfulRun: string | null;
  readonly spawnReceiptDiff: number;
}

const HEADER = "# Knowledge Bootstrap Status";
const LAYER_HEADER = "## Layer presence";
const ATLAS_HEADER = "## Atlas health";
const MEMORY_HEADER = "## Project Memory";
const RECOMMENDATION_HEADER = "## Recommendation";
const SEPARATOR = "\n\n";

function formatLayerState(state: LayerState): string {
  switch (state) {
    case "present":
      return "✔ present";
    case "missing":
      return "✗ missing";
    case "unknown":
      return "? unknown (read failed)";
  }
}

function formatMtime(presence: FilePresence): string {
  if (!presence.exists || !presence.mtime) return "";
  return ` (mtime: ${presence.mtime.toISOString().slice(0, 10)})`;
}

function renderLayerSection(state: KnowledgeState): string {
  const lines: string[] = [LAYER_HEADER];
  lines.push(
    `- /init layer: ${formatLayerState(state.init)}` +
      `\n  - ARCHITECTURE.md: ${state.files.architectureMd.exists ? "exists" : "missing"}${formatMtime(state.files.architectureMd)}` +
      `\n  - CODE_STYLE.md: ${state.files.codeStyleMd.exists ? "exists" : "missing"}${formatMtime(state.files.codeStyleMd)}`,
  );
  lines.push(
    `- .mindmodel/ layer: ${formatLayerState(state.mindmodel)}` +
      `\n  - .mindmodel/manifest.yaml: ${state.files.mindmodelManifest.exists ? "exists" : "missing"}${formatMtime(state.files.mindmodelManifest)}`,
  );
  lines.push(
    `- atlas/ layer: ${formatLayerState(state.atlas)}` +
      `\n  - atlas/00-index.md: ${state.files.atlasIndex.exists ? "exists" : "missing"}${formatMtime(state.files.atlasIndex)}`,
  );
  return lines.join("\n");
}

function renderAtlasSection(atlas: AtlasStatusResult): string {
  return [
    ATLAS_HEADER,
    `- open challenges: ${atlas.openChallenges}`,
    `- broken wikilinks: ${atlas.brokenWikilinks}`,
    `- orphan staging dirs: ${atlas.orphanStagingDirs}`,
    `- last successful run: ${atlas.lastSuccessfulRun ?? "n/a"}`,
  ].join("\n");
}

function renderMemorySection(state: KnowledgeState): string {
  return [
    MEMORY_HEADER,
    `- entries: ${state.projectMemory.entries}`,
    `- healthy: ${state.projectMemory.healthy ? "yes" : "no"}`,
  ].join("\n");
}

function renderRecommendation(state: KnowledgeState): string {
  const allPresent =
    state.init === "present" && state.mindmodel === "present" && state.atlas === "present";
  const allMissing =
    state.init === "missing" && state.mindmodel === "missing" && state.atlas === "missing";
  const anyUnknown =
    state.init === "unknown" || state.mindmodel === "unknown" || state.atlas === "unknown";

  if (anyUnknown) {
    return [
      RECOMMENDATION_HEADER,
      "- Some layers could not be read (permissions / IO failure). Inspect the project root and re-run.",
    ].join("\n");
  }
  if (allPresent) {
    return [
      RECOMMENDATION_HEADER,
      "- All three layers are present. To refresh after major changes, run `/all-rebuild` (overwrites in place).",
    ].join("\n");
  }
  if (allMissing) {
    return [
      RECOMMENDATION_HEADER,
      "- All three layers are missing. Run `/all-init` to bootstrap them in order.",
    ].join("\n");
  }
  return [
    RECOMMENDATION_HEADER,
    "- Some layers are missing. Run `/all-init` to fill the gaps without overwriting existing layers.",
  ].join("\n");
}

// renderBootstrapStatus returns a plain markdown report safe to print in chat.
// It does NOT write any files; /all-status is read-only.
export function renderBootstrapStatus(state: KnowledgeState, atlas: AtlasStatusResult): string {
  return [
    HEADER,
    renderLayerSection(state),
    renderAtlasSection(atlas),
    renderMemorySection(state),
    renderRecommendation(state),
  ].join(SEPARATOR);
}
```

**Verify:** `bun test tests/tools/knowledge-bootstrap/status.test.ts`
**Commit:** `feat(tools): add knowledge bootstrap status reporter\n\nRefs #64`

---

### Task 1.4: Knowledge bootstrap questionnaire wrapper
**File:** `src/tools/knowledge-bootstrap/questionnaire.ts`
**Test:** `tests/tools/knowledge-bootstrap/questionnaire.test.ts`
**Depends:** none (re-exports types from cold-init)
**Domain:** general
**Atlas-impact:** none

```typescript
// tests/tools/knowledge-bootstrap/questionnaire.test.ts
import { describe, expect, it } from "bun:test";

import {
  BOOTSTRAP_QUESTION_KEYS,
  buildBootstrapQuestionPrompt,
  DEFAULT_BOOTSTRAP_ANSWERS,
} from "@/tools/knowledge-bootstrap/questionnaire";

describe("BOOTSTRAP_QUESTION_KEYS", () => {
  it("exposes the three atlas cold-init intent question ids", () => {
    expect(BOOTSTRAP_QUESTION_KEYS).toEqual(["intent.pitch", "intent.user", "intent.shape"]);
  });
});

describe("DEFAULT_BOOTSTRAP_ANSWERS", () => {
  it("provides safe defaults so atlas-initializer never blocks on octto", () => {
    expect(DEFAULT_BOOTSTRAP_ANSWERS["intent.pitch"]).toBeDefined();
    expect(DEFAULT_BOOTSTRAP_ANSWERS["intent.user"]).toBeDefined();
    expect(DEFAULT_BOOTSTRAP_ANSWERS["intent.shape"]).toBe("other");
  });
});

describe("buildBootstrapQuestionPrompt", () => {
  it("renders a chinese-friendly prompt block listing all bootstrap questions", () => {
    const prompt = buildBootstrapQuestionPrompt();
    expect(prompt).toContain("intent.pitch");
    expect(prompt).toContain("intent.user");
    expect(prompt).toContain("intent.shape");
    expect(prompt).toContain("octto");
  });

  it("includes a fallback instruction for when octto is unavailable", () => {
    const prompt = buildBootstrapQuestionPrompt();
    expect(prompt.toLowerCase()).toContain("fallback");
    expect(prompt).toContain("default");
  });
});
```

```typescript
// src/tools/knowledge-bootstrap/questionnaire.ts
// Centralised question keys for the knowledge bootstrap flow.
// The orchestrator agent collects these once at entry and pre-seeds them into
// the atlas-initializer prompt; atlas-initializer therefore does not need to
// re-ask intent.* questions when invoked by the orchestrator.
//
// The actual question wording lives in src/atlas/cold-init/questions.ts; this
// module is the contract surface the orchestrator agent prompt refers to.

export const BOOTSTRAP_QUESTION_KEYS = ["intent.pitch", "intent.user", "intent.shape"] as const;

export type BootstrapQuestionKey = (typeof BOOTSTRAP_QUESTION_KEYS)[number];

export type BootstrapAnswers = Readonly<Record<BootstrapQuestionKey, string>>;

// Defaults applied when the user skips octto or octto is unavailable. These
// keep atlas-initializer unblocked while still producing a usable vault draft.
export const DEFAULT_BOOTSTRAP_ANSWERS: BootstrapAnswers = {
  "intent.pitch": "Project purpose not yet specified; inferred from code.",
  "intent.user": "Primary user not yet specified; inferred from code.",
  "intent.shape": "other",
};

const PROMPT_HEADER = "<bootstrap-questionnaire>";
const PROMPT_FOOTER = "</bootstrap-questionnaire>";

// buildBootstrapQuestionPrompt returns the canonical prompt fragment that the
// orchestrator agent embeds verbatim. It instructs the agent on how to collect
// answers via octto and what to do when octto is unavailable.
export function buildBootstrapQuestionPrompt(): string {
  return [
    PROMPT_HEADER,
    "When the user invokes /all-init (on an empty project) or /all-rebuild, collect the",
    "following three atlas cold-init intent answers up front in ONE octto session, then",
    "pre-seed them into the atlas-initializer spawn prompt so atlas-initializer does NOT",
    "re-ask them. Question ids and meaning:",
    "- intent.pitch: one sentence describing what this project is for",
    "- intent.user: who is the primary user, human role, or other agent",
    "- intent.shape: deployment shape (lib | cli | service | plugin | other)",
    "",
    "Fallback: if octto is unavailable, or the user dismisses the session, or any answer",
    "is empty, substitute the matching DEFAULT_BOOTSTRAP_ANSWERS value and warn the user",
    "in the final report. Do NOT block the run on missing answers.",
    PROMPT_FOOTER,
  ].join("\n");
}
```

**Verify:** `bun test tests/tools/knowledge-bootstrap/questionnaire.test.ts`
**Commit:** `feat(tools): add knowledge bootstrap questionnaire wrapper\n\nRefs #64`

---

### Task 1.5: Knowledge context section prompt module
**File:** `src/agents/knowledge-context-section.ts`
**Test:** `tests/agents/knowledge-context-section.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** layer-update (new agent prompt surface that issue #63 will later extend)

```typescript
// tests/agents/knowledge-context-section.test.ts
import { describe, expect, it } from "bun:test";

import { KNOWLEDGE_CONTEXT_SECTION } from "@/agents/knowledge-context-section";

describe("KNOWLEDGE_CONTEXT_SECTION", () => {
  it("is a non-empty string", () => {
    expect(typeof KNOWLEDGE_CONTEXT_SECTION).toBe("string");
    expect(KNOWLEDGE_CONTEXT_SECTION.length).toBeGreaterThan(0);
  });

  it("declares the 本次知识上下文 output block", () => {
    expect(KNOWLEDGE_CONTEXT_SECTION).toContain("本次知识上下文");
  });

  it("instructs agents to list what they READ from atlas / mindmodel / project memory", () => {
    expect(KNOWLEDGE_CONTEXT_SECTION).toContain("读取");
    expect(KNOWLEDGE_CONTEXT_SECTION.toLowerCase()).toContain("atlas");
    expect(KNOWLEDGE_CONTEXT_SECTION.toLowerCase()).toContain("mindmodel");
    expect(KNOWLEDGE_CONTEXT_SECTION.toLowerCase()).toContain("project memory");
  });

  it("instructs agents to list what they MAINTAINED / wrote", () => {
    expect(KNOWLEDGE_CONTEXT_SECTION).toContain("维护");
  });

  it("uses a wrapping XML-style block so it can be injected into agent prompts", () => {
    expect(KNOWLEDGE_CONTEXT_SECTION).toContain("<knowledge-context-section");
    expect(KNOWLEDGE_CONTEXT_SECTION).toContain("</knowledge-context-section>");
  });
});
```

```typescript
// src/agents/knowledge-context-section.ts
// Single-source prompt fragment for the "本次知识上下文" output block.
//
// Context: issue #63 plans an agent-owned knowledge protocol with a unified
// final-report section listing what an agent READ from atlas / mindmodel /
// project memory and what it MAINTAINED back. Issue #64 (these orchestrator
// commands) lands first, so we own this minimal local definition. When #63
// lands, this file becomes the canonical single source — both issues share it
// byte-for-byte, no drift.
//
// The block is injected into agent prompts via template literal interpolation
// (see knowledge-bootstrap-orchestrator.ts). The block name and Chinese
// section title are stable surface that downstream tests assert on.

export const KNOWLEDGE_CONTEXT_SECTION = `<knowledge-context-section priority="critical" description="终态汇报必须包含本次知识上下文板块">
任务终态用户可见汇报必须包含一段"本次知识上下文"板块，让用户看见 agent 接触过的项目知识基础。最少包含两小节：

1. **读取**：列出本次任务读取的知识来源，可能包括：
   - atlas/ 节点（按 layer + node id，例如 \`10-impl/plugin-composition\`）
   - .mindmodel/ 约束文件（按相对路径）
   - project memory 条目（按 entity_id + entry_id 或简短摘要）
   - ARCHITECTURE.md / CODE_STYLE.md 等项目文档（按相对路径）
   若未读取任何知识来源，明确写"无"。

2. **维护**：列出本次任务对知识层的写入或新建，可能包括：
   - 新建或刷新的 atlas/ 节点 / atlas delta 文件
   - 新建或刷新的 .mindmodel/ 文件
   - 新增 project memory entry（type + summary）
   - 新建 ARCHITECTURE.md / CODE_STYLE.md
   若未维护任何知识来源，明确写"无"。

放在四段终态汇报"实现记录"段之前或之后皆可，但必须出现且使用上述两小节标题。中文优先；机器语法（路径、id、frontmatter key、tool name、code symbol）保留英文。
</knowledge-context-section>`;
```

**Verify:** `bun test tests/agents/knowledge-context-section.test.ts`
**Commit:** `feat(agents): add KNOWLEDGE_CONTEXT_SECTION prompt fragment\n\nRefs #64`

---

## Batch 2: Tool Registration (sequential within batch - 2 implementers)

2.1 creates the tool factory; 2.2 wires it into the barrel. 2.2 depends on 2.1 so dispatch them in order or as one batch where 2.2 implementer waits.
Tasks: 2.1, 2.2

### Task 2.1: Knowledge bootstrap tool factory and barrel
**File:** `src/tools/knowledge-bootstrap/index.ts`
**Test:** `tests/tools/knowledge-bootstrap/index.test.ts`
**Depends:** 1.2 (uses detectKnowledgeState)
**Domain:** general
**Atlas-impact:** none

```typescript
// tests/tools/knowledge-bootstrap/index.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";

import { createDetectKnowledgeStateTool } from "@/tools/knowledge-bootstrap";

let projectRoot: string;

function ctx(directory: string): PluginInput {
  return { directory } as unknown as PluginInput;
}

beforeEach(() => {
  projectRoot = mkdtempSync(join(tmpdir(), "knowledge-bootstrap-tool-"));
});

afterEach(() => {
  rmSync(projectRoot, { recursive: true, force: true });
});

describe("createDetectKnowledgeStateTool", () => {
  it("returns a tool object with detect_knowledge_state", () => {
    const tools = createDetectKnowledgeStateTool(ctx(projectRoot));
    expect(tools.detect_knowledge_state).toBeDefined();
  });

  it("executing the tool reports an empty project's three layers as missing", async () => {
    const tools = createDetectKnowledgeStateTool(ctx(projectRoot));
    const result = (await tools.detect_knowledge_state.execute({}, {} as never)) as string;
    expect(typeof result).toBe("string");
    expect(result).toContain("missing");
    expect(result).toContain("init");
    expect(result).toContain("mindmodel");
    expect(result).toContain("atlas");
  });

  it("executing the tool reports present layers after files are created", async () => {
    writeFileSync(join(projectRoot, "ARCHITECTURE.md"), "# Arch\n", "utf8");
    writeFileSync(join(projectRoot, "CODE_STYLE.md"), "# Style\n", "utf8");
    mkdirSync(join(projectRoot, ".mindmodel"), { recursive: true });
    writeFileSync(join(projectRoot, ".mindmodel", "manifest.yaml"), "version: 1\n", "utf8");
    mkdirSync(join(projectRoot, "atlas"), { recursive: true });
    writeFileSync(join(projectRoot, "atlas", "00-index.md"), "# Index\n", "utf8");

    const tools = createDetectKnowledgeStateTool(ctx(projectRoot));
    const result = (await tools.detect_knowledge_state.execute({}, {} as never)) as string;
    expect(result).toContain("present");
    // ensure all three layers appear in the report
    expect(result.match(/present/g)?.length ?? 0).toBeGreaterThanOrEqual(3);
  });
});
```

```typescript
// src/tools/knowledge-bootstrap/index.ts
import type { PluginInput, ToolDefinition } from "@opencode-ai/plugin";
import { tool } from "@opencode-ai/plugin/tool";

import { detectKnowledgeState } from "./detect";
import type { KnowledgeState } from "./types";

const DESCRIPTION = `Detect which of the three project knowledge layers are present on disk:
- /init layer (ARCHITECTURE.md + CODE_STYLE.md)
- .mindmodel/ layer (.mindmodel/manifest.yaml)
- atlas/ layer (atlas/00-index.md)

Returns a markdown report. Used by the knowledge-bootstrap-orchestrator agent at the start of
/all-init, /all-rebuild, and /all-status to plan which sub-orchestrators to spawn.`;

const HEADER = "## Knowledge State";

function formatPresence(label: string, exists: boolean, mtime?: Date): string {
  const status = exists ? "exists" : "missing";
  const mtimeText = exists && mtime ? ` (mtime ${mtime.toISOString().slice(0, 10)})` : "";
  return `  - ${label}: ${status}${mtimeText}`;
}

function formatState(state: KnowledgeState): string {
  return [
    HEADER,
    `- init layer: ${state.init}`,
    formatPresence("ARCHITECTURE.md", state.files.architectureMd.exists, state.files.architectureMd.mtime),
    formatPresence("CODE_STYLE.md", state.files.codeStyleMd.exists, state.files.codeStyleMd.mtime),
    `- mindmodel layer: ${state.mindmodel}`,
    formatPresence(".mindmodel/manifest.yaml", state.files.mindmodelManifest.exists, state.files.mindmodelManifest.mtime),
    `- atlas layer: ${state.atlas}`,
    formatPresence("atlas/00-index.md", state.files.atlasIndex.exists, state.files.atlasIndex.mtime),
    `- project memory: entries=${state.projectMemory.entries}, healthy=${state.projectMemory.healthy}`,
  ].join("\n");
}

export function createDetectKnowledgeStateTool(
  ctx: PluginInput,
): { detect_knowledge_state: ToolDefinition } {
  const detect_knowledge_state = tool({
    description: DESCRIPTION,
    args: {},
    execute: async () => {
      const state = detectKnowledgeState(ctx.directory);
      return formatState(state);
    },
  });
  return { detect_knowledge_state };
}

export { detectKnowledgeState } from "./detect";
export { renderBootstrapStatus, type AtlasStatusResult } from "./status";
export type { BootstrapAnswers, BootstrapQuestionKey } from "./questionnaire";
export {
  BOOTSTRAP_QUESTION_KEYS,
  buildBootstrapQuestionPrompt,
  DEFAULT_BOOTSTRAP_ANSWERS,
} from "./questionnaire";
export type { FilePresence, KnowledgeState, LayerState, ProjectMemorySummary } from "./types";
```

**Verify:** `bun test tests/tools/knowledge-bootstrap/index.test.ts`
**Commit:** `feat(tools): expose detect_knowledge_state tool and barrel\n\nRefs #64`

---

### Task 2.2: Wire knowledge-bootstrap into top-level tools barrel
**File:** `src/tools/index.ts`
**Test:** `tests/tools/index-knowledge-bootstrap.test.ts`
**Depends:** 2.1
**Domain:** general
**Atlas-impact:** none

```typescript
// tests/tools/index-knowledge-bootstrap.test.ts
import { describe, expect, it } from "bun:test";

import { createDetectKnowledgeStateTool } from "@/tools";

describe("top-level tools barrel: knowledge bootstrap", () => {
  it("re-exports createDetectKnowledgeStateTool", () => {
    expect(typeof createDetectKnowledgeStateTool).toBe("function");
  });
});
```

```typescript
// src/tools/index.ts
export { artifact_search } from "./artifact-search";
export { ast_grep_replace, ast_grep_search, checkAstGrepAvailable } from "./ast-grep";
export { createAtlasLookupTool } from "./atlas";
export { createBatchReadTool } from "./batch-read";
export { btca_ask, checkBtcaAvailable } from "./btca";
export { createDetectKnowledgeStateTool } from "./knowledge-bootstrap";
export { look_at } from "./look-at";
export { milestone_artifact_search } from "./milestone-artifact-search";
export { createMindmodelLookupTool } from "./mindmodel-lookup";
export { createOcttoTools, createSessionStore } from "./octto";
export {
  createProjectMemoryForgetTool,
  createProjectMemoryHealthTool,
  createProjectMemoryLookupTool,
  createProjectMemoryPromoteTool,
} from "./project-memory";
export { createPTYManager, createPtyTools, loadBunPty } from "./pty";
export { createSpawnAgentTool } from "./spawn-agent";
```

**Verify:** `bun test tests/tools/index-knowledge-bootstrap.test.ts`
**Commit:** `feat(tools): re-export detect_knowledge_state from tools barrel\n\nRefs #64`

---

## Batch 3: Orchestrator Agent (parallel - 2 implementers)

3.1 creates the agent; 3.2 registers it in the barrel.
Tasks: 3.1, 3.2

### Task 3.1: Knowledge bootstrap orchestrator agent
**File:** `src/agents/knowledge-bootstrap-orchestrator.ts`
**Test:** `tests/agents/knowledge-bootstrap-orchestrator.test.ts`
**Depends:** 1.5 (KNOWLEDGE_CONTEXT_SECTION), 2.1 (detect_knowledge_state tool)
**Domain:** general
**Atlas-impact:** layer-update (new workflow contract: 三命令 orchestrator)

```typescript
// tests/agents/knowledge-bootstrap-orchestrator.test.ts
import { describe, expect, it } from "bun:test";

import { agents } from "@/agents";
import { knowledgeBootstrapOrchestratorAgent } from "@/agents/knowledge-bootstrap-orchestrator";

describe("knowledge-bootstrap-orchestrator agent config", () => {
  it("is registered as a primary-mode agent", () => {
    expect(knowledgeBootstrapOrchestratorAgent.mode).toBe("primary");
  });

  it("has a non-empty description naming the three commands", () => {
    const desc = knowledgeBootstrapOrchestratorAgent.description ?? "";
    expect(desc.length).toBeGreaterThan(0);
    expect(desc).toContain("/all-init");
    expect(desc).toContain("/all-rebuild");
    expect(desc).toContain("/all-status");
  });

  it("prompt contains a mode-handling block keyed by command name", () => {
    const p = knowledgeBootstrapOrchestratorAgent.prompt;
    expect(p).toContain("<mode-handling>");
    expect(p).toContain("/all-init");
    expect(p).toContain("/all-rebuild");
    expect(p).toContain("/all-status");
    expect(p).toContain("missing-only");
    expect(p).toContain("refresh-all");
    expect(p).toContain("status-only");
  });

  it("prompt contains a process block referencing detect_knowledge_state", () => {
    const p = knowledgeBootstrapOrchestratorAgent.prompt;
    expect(p).toContain("<process>");
    expect(p).toContain("detect_knowledge_state");
  });

  it("prompt instructs serial spawning of project-initializer, mm-orchestrator, atlas-initializer", () => {
    const p = knowledgeBootstrapOrchestratorAgent.prompt;
    expect(p).toContain("project-initializer");
    expect(p).toContain("mm-orchestrator");
    expect(p).toContain("atlas-initializer");
    // dependency order asserted by appearance order
    const pi = p.indexOf("project-initializer");
    const mm = p.indexOf("mm-orchestrator");
    const ai = p.indexOf("atlas-initializer");
    expect(pi).toBeGreaterThan(-1);
    expect(mm).toBeGreaterThan(pi);
    expect(ai).toBeGreaterThan(mm);
  });

  it("prompt includes the octto questionnaire block and references intent question keys", () => {
    const p = knowledgeBootstrapOrchestratorAgent.prompt;
    expect(p).toContain("<bootstrap-questionnaire>");
    expect(p).toContain("intent.pitch");
    expect(p).toContain("intent.user");
    expect(p).toContain("intent.shape");
  });

  it("prompt explicitly requires confirm before /all-rebuild executes", () => {
    const p = knowledgeBootstrapOrchestratorAgent.prompt;
    expect(p).toContain("confirm");
    // confirm rule must appear inside the refresh-all branch
    expect(p).toMatch(/refresh-all[\s\S]*confirm/);
  });

  it("prompt forbids parallel spawning of the three child orchestrators", () => {
    const p = knowledgeBootstrapOrchestratorAgent.prompt.toLowerCase();
    expect(p).toMatch(/serial|sequential|in order|顺序|串行/);
  });

  it("prompt forbids rollback on mid-flight failure", () => {
    const p = knowledgeBootstrapOrchestratorAgent.prompt.toLowerCase();
    expect(p).toMatch(/no rollback|do not rollback|不回滚|不撤销/);
  });

  it("prompt status-only branch is read-only", () => {
    const p = knowledgeBootstrapOrchestratorAgent.prompt;
    expect(p).toMatch(/status-only[\s\S]*read[- ]only|status-only[\s\S]*不写/);
  });

  it("prompt injects ATLAS_MENTAL_MODEL_PROTOCOL", () => {
    expect(knowledgeBootstrapOrchestratorAgent.prompt).toContain("<atlas-mental-model");
  });

  it("prompt injects KNOWLEDGE_CONTEXT_SECTION", () => {
    expect(knowledgeBootstrapOrchestratorAgent.prompt).toContain("<knowledge-context-section");
    expect(knowledgeBootstrapOrchestratorAgent.prompt).toContain("本次知识上下文");
  });

  it("prompt instructs friendly exit when /all-init finds all three layers present", () => {
    const p = knowledgeBootstrapOrchestratorAgent.prompt;
    expect(p).toMatch(/all.*present|all.*三层都.?在|全有/);
    expect(p).toContain("/all-rebuild");
  });

  it("prompt mentions runAtlasInit force-rebuild semantics for /all-rebuild atlas step", () => {
    const p = knowledgeBootstrapOrchestratorAgent.prompt;
    expect(p).toContain("force-rebuild");
  });
});

describe("agents barrel includes knowledge-bootstrap-orchestrator", () => {
  it("registers knowledge-bootstrap-orchestrator", () => {
    expect(agents["knowledge-bootstrap-orchestrator"]).toBeDefined();
    expect(agents["knowledge-bootstrap-orchestrator"].mode).toBe("primary");
  });
});
```

```typescript
// src/agents/knowledge-bootstrap-orchestrator.ts
import type { AgentConfig } from "@opencode-ai/sdk";

import { buildBootstrapQuestionPrompt } from "@/tools/knowledge-bootstrap/questionnaire";
import { ATLAS_MENTAL_MODEL_PROTOCOL } from "./atlas-mental-model";
import { KNOWLEDGE_CONTEXT_SECTION } from "./knowledge-context-section";

const PROMPT = `<environment>
You are running as part of the "micode" OpenCode plugin.
You are the Knowledge Bootstrap Orchestrator: a primary agent that owns the
/all-init, /all-rebuild, and /all-status commands.
Use spawn_agent (not Task) for all child orchestrators.
</environment>

<identity>
  <name>Knowledge Bootstrap Orchestrator</name>
  <role>串联 /init, /mindmodel, /atlas-init 三层知识库 bootstrap 的统一入口</role>
  <purpose>
    根据用户调用的命令 (/all-init | /all-rebuild | /all-status)，按模式串行执行
    现有的 project-initializer / mm-orchestrator / atlas-initializer 三个子流程，
    并产出统一的"本次知识上下文"输出板块。本 agent 不重写任何子命令实现。
  </purpose>
</identity>

<mode-handling>
  根据用户调用的命令决定模式，模式名称来自命令注册时通过 prompt template 传入的标识：

  - /all-init    → mode = missing-only
  - /all-rebuild → mode = refresh-all
  - /all-status  → mode = status-only

  prompt template 会以 "Mode: <mode-name>" 形式注入触发命令信息。若 prompt 中未携带 mode 标识，
  默认按 missing-only 处理并 warn 用户命令路由可能损坏。
</mode-handling>

<process>
  Step 1: 调用 detect_knowledge_state 工具一次性获取三层状态。这是所有模式的入口动作。

  Step 2: 按 mode 分发：

  ── missing-only (/all-init) ──
    - 三层全 present → 输出友好提示"三层都已存在"，建议用户改用 /all-rebuild，结束。
    - 三层全 missing → 进入 octto 问卷收集 → 串行 spawn 三个子 agent (project-initializer →
      mm-orchestrator → atlas-initializer)。
    - 部分缺失 → 仅 spawn 缺失部分对应的 agent，串行顺序依旧是 init → mindmodel → atlas
      (跳过已 present 的层)。已存在的层 NOT 覆盖。

  ── refresh-all (/all-rebuild) ──
    - 调用 octto confirm 列出会被覆盖的文件路径 (ARCHITECTURE.md, CODE_STYLE.md,
      .mindmodel/, atlas/00-index.md 及其它 atlas 节点)。
    - 用户拒绝 → 优雅退出，不动任何文件。
    - 用户确认 → 收集 bootstrap-questionnaire 答案 → 串行 spawn 三个子 agent，每个 prompt
      显式说明覆盖语义：
        * spawn_agent(agent="project-initializer", prompt="覆盖模式：重写 ARCHITECTURE.md
          和 CODE_STYLE.md，即使它们已存在...", description="rebuild init")
        * spawn_agent(agent="mm-orchestrator", prompt="覆盖模式：重新生成 .mindmodel/...",
          description="rebuild mindmodel")
        * Atlas 阶段不走 spawn_agent("atlas-initializer", ...) 的纯 cold-init；而是先调用
          runAtlasInit 工具入口的等价语义 —— 即 spawn_agent("atlas-initializer", ...) 时
          prompt 显式说明 "mode=force-rebuild，旧 atlas/ 已被外层删除/将由 atlas-initializer
          走 force-rebuild 分支"，并把 octto 答案以 "Pre-seeded answers (skip these questions):
          intent.pitch=..., intent.user=..., intent.shape=..." 形式拼接到 prompt。

  ── status-only (/all-status) ──
    - 这是 READ-ONLY 流程。不调 octto，不写任何文件，不 spawn 子 agent。
    - 调 detect_knowledge_state → 已有结果。
    - 调 runAtlasStatus 等价信息（通过 atlas_lookup 或读取 atlas/_meta/log/*.md 推断）。
    - 调 project_memory_health 工具。
    - 合并为单一 markdown 报告输出（参考 renderBootstrapStatus 的输出契约）。

  Step 3: 输出"本次知识上下文"板块（见下方 knowledge-context-section 注入）。
</process>

<serial-execution>
  本 agent 三个子流程严格串行 (sequential / 顺序)，原因：
  - 依赖顺序：mm-orchestrator 读取 ARCHITECTURE.md，atlas-initializer 读取
    .mindmodel/manifest.yaml。并发会导致后两阶段读到空内容。
  - 资源边界：三个子 agent 各自的 spawn_agent 内部已经高度并行；外层再并发会撞 token 限额。

  禁止 (no rollback)：任一子 agent 失败时，已完成阶段保留，不撤销，不删除其产物。用户可
  复跑 /all-init 智能补齐继续。
</serial-execution>

${buildBootstrapQuestionPrompt()}

<friendly-exits>
  - /all-init 三层都已存在 → 输出："✓ 三层知识库 (/init, .mindmodel, atlas) 均已存在。
    若需要刷新所有层，运行 /all-rebuild。" 然后输出"本次知识上下文"板块并结束。
  - /all-rebuild 用户取消 confirm → 输出："已取消 /all-rebuild。未修改任何文件。" 结束。
  - 任一子 agent 失败 → 输出失败步骤名称、错误摘要、保留下来的产物清单，建议用户复跑
    /all-init。不抛错。
</friendly-exits>

<available-tools>
  - detect_knowledge_state: 一次性返回三层状态报告，所有模式的入口动作。
  - project_memory_health: status-only 模式调用，合并到 status 报告。
  - spawn_agent: 串行调用 project-initializer / mm-orchestrator / atlas-initializer。
    每次只 spawn 一个 agent，等待其完成再 spawn 下一个。
  - octto 工具集 (start_session / confirm / get_next_answer / end_session)：
    /all-init 全缺失或 /all-rebuild 模式下收集 bootstrap-questionnaire 答案。
</available-tools>

${ATLAS_MENTAL_MODEL_PROTOCOL}

${KNOWLEDGE_CONTEXT_SECTION}

<output-discipline>
  - 单次输出顺序：mode 声明 → 各阶段状态消息（**Phase 1/3**: project-initializer ... 等）→
    最终四段终态汇报（按 commander effect-first 规则：预期表现 / 你可以怎么验收 / 已知限制
    / 实现记录）→ 本次知识上下文板块。
  - status-only 模式跳过四段终态汇报的写入语义，直接输出 status markdown + 本次知识上下文。
  - 中间 spawn_agent 调用必须前后输出 "**Phase X/Y**: ..." 状态行，让用户实时看到进度。
</output-discipline>
`;

export const knowledgeBootstrapOrchestratorAgent: AgentConfig = {
  description:
    "Knowledge bootstrap orchestrator for /all-init, /all-rebuild, /all-status: serial-spawns project-initializer, mm-orchestrator, atlas-initializer",
  mode: "primary",
  temperature: 0.2,
  maxTokens: 32000,
  prompt: PROMPT,
};
```

**Verify:** `bun test tests/agents/knowledge-bootstrap-orchestrator.test.ts`
**Commit:** `feat(agents): add knowledge-bootstrap-orchestrator agent\n\nRefs #64`

---

### Task 3.2: Register knowledge-bootstrap-orchestrator in agents barrel
**File:** `src/agents/index.ts`
**Test:** `tests/agents/index-knowledge-bootstrap.test.ts`
**Depends:** 3.1
**Domain:** general
**Atlas-impact:** none

```typescript
// tests/agents/index-knowledge-bootstrap.test.ts
import { describe, expect, it } from "bun:test";

import { agents } from "@/agents";

describe("agents barrel: knowledge-bootstrap-orchestrator", () => {
  it("registers knowledge-bootstrap-orchestrator", () => {
    expect(agents["knowledge-bootstrap-orchestrator"]).toBeDefined();
  });

  it("knowledge-bootstrap-orchestrator is primary mode", () => {
    expect(agents["knowledge-bootstrap-orchestrator"].mode).toBe("primary");
  });

  it("preserves project-initializer, mm-orchestrator, atlas-initializer registrations", () => {
    expect(agents["project-initializer"]).toBeDefined();
    expect(agents["mm-orchestrator"]).toBeDefined();
    expect(agents["atlas-initializer"]).toBeDefined();
  });
});
```

```typescript
// src/agents/index.ts
// (Apply ONLY the diff below to the existing file; full file unchanged elsewhere.)
//
// 1. Add the import after the projectInitializerAgent import (alphabetical group order):
//
//    import { knowledgeBootstrapOrchestratorAgent } from "./knowledge-bootstrap-orchestrator";
//
//    Place it in alphabetical position between investigatorAgent and ledgerCreatorAgent
//    or wherever alphabetical order applies in the local conventions; if conventions place
//    primary-mode agents next to commander, group it with primary agents in the export
//    block. Implementer: match existing file's grouping convention.
//
// 2. Inside the `agents` record (the Record<string, AgentConfig> literal), add the entry
//    in the same block as other primary-mode agents (commander, brainstormer, octto):
//
//    "knowledge-bootstrap-orchestrator": { ...knowledgeBootstrapOrchestratorAgent, model: DEFAULT_MODEL },
//
//    Place it near brainstormer / bootstrapper for grouping; exact line order is not
//    semantically meaningful but should follow existing file conventions.

import type { AgentConfig } from "@opencode-ai/sdk";

import { DEFAULT_MODEL } from "@/utils/config";
import { architectureQualityInspectorAgent } from "./architecture-quality-inspector";
import { artifactSearcherAgent } from "./artifact-searcher";
import { atlasColdBehaviorAgent } from "./atlas-cold-behavior";
import { atlasColdBuildAgent } from "./atlas-cold-build";
import { atlasCompilerAgent } from "./atlas-compiler";
import { atlasInitializerAgent } from "./atlas-initializer";
import { atlasTranslatorAgent } from "./atlas-translator";
import { atlasWorkerBehaviorAgent } from "./atlas-worker-behavior";
import { atlasWorkerBuildAgent } from "./atlas-worker-build";
import { bootstrapperAgent } from "./bootstrapper";
import { brainstormerAgent } from "./brainstormer";
import { codebaseAnalyzerAgent } from "./codebase-analyzer";
import { codebaseLocatorAgent } from "./codebase-locator";
import { PRIMARY_AGENT_NAME, primaryAgent } from "./commander";
import { criticAgent } from "./critic";
import { executorAgent } from "./executor";
import { executorDirectAgent } from "./executor-direct";
import { implementerAgent } from "./implementer";
import { implementerBackendAgent } from "./implementer-backend";
import { implementerFrontendCodeAgent } from "./implementer-frontend-code";
import { implementerFrontendUiAgent } from "./implementer-frontend-ui";
import { implementerGeneralAgent } from "./implementer-general";
import { investigatorAgent } from "./investigator";
import { knowledgeBootstrapOrchestratorAgent } from "./knowledge-bootstrap-orchestrator";
import { ledgerCreatorAgent } from "./ledger-creator";
import {
  antiPatternDetectorAgent,
  codeClustererAgent,
  constraintReviewerAgent,
  constraintWriterAgent,
  conventionExtractorAgent,
  dependencyMapperAgent,
  domainExtractorAgent,
  exampleExtractorAgent,
  mindmodelOrchestratorAgent,
  mindmodelPatternDiscovererAgent,
  stackDetectorAgent,
} from "./mindmodel";
import { notificationCourierAgent } from "./notification-courier";
import { octtoAgent } from "./octto";
import { patternFinderAgent } from "./pattern-finder";
import { plannerAgent } from "./planner";
import { probeAgent } from "./probe";
import { productManagerAgent } from "./product-manager";
import { projectInitializerAgent } from "./project-initializer";
import { reviewerAgent } from "./reviewer";
import { rubricReviewerAgent } from "./rubric-reviewer";
import { softwareArchitectAgent } from "./software-architect";
import { uxDesignerAgent } from "./ux-designer";

export const agents: Record<string, AgentConfig> = {
  [PRIMARY_AGENT_NAME]: { ...primaryAgent, model: DEFAULT_MODEL },
  brainstormer: { ...brainstormerAgent, model: DEFAULT_MODEL },
  bootstrapper: { ...bootstrapperAgent, model: DEFAULT_MODEL },
  "knowledge-bootstrap-orchestrator": { ...knowledgeBootstrapOrchestratorAgent, model: DEFAULT_MODEL },
  "codebase-locator": { ...codebaseLocatorAgent, model: DEFAULT_MODEL },
  "codebase-analyzer": { ...codebaseAnalyzerAgent, model: DEFAULT_MODEL },
  critic: { ...criticAgent, model: DEFAULT_MODEL },
  "product-manager": { ...productManagerAgent, model: DEFAULT_MODEL },
  "software-architect": { ...softwareArchitectAgent, model: DEFAULT_MODEL },
  "ux-designer": { ...uxDesignerAgent, model: DEFAULT_MODEL },
  "architecture-quality-inspector": { ...architectureQualityInspectorAgent, model: DEFAULT_MODEL },
  "rubric-reviewer": { ...rubricReviewerAgent, model: DEFAULT_MODEL },
  "pattern-finder": { ...patternFinderAgent, model: DEFAULT_MODEL },
  planner: { ...plannerAgent, model: DEFAULT_MODEL },
  "implementer-frontend-ui": { ...implementerFrontendUiAgent, model: DEFAULT_MODEL },
  "implementer-frontend-code": { ...implementerFrontendCodeAgent, model: DEFAULT_MODEL },
  "implementer-backend": { ...implementerBackendAgent, model: DEFAULT_MODEL },
  "implementer-general": { ...implementerGeneralAgent, model: DEFAULT_MODEL },
  reviewer: { ...reviewerAgent, model: DEFAULT_MODEL },
  investigator: { ...investigatorAgent, model: DEFAULT_MODEL },
  executor: { ...executorAgent, model: DEFAULT_MODEL },
  "executor-direct": { ...executorDirectAgent, model: DEFAULT_MODEL },
  "ledger-creator": { ...ledgerCreatorAgent, model: DEFAULT_MODEL },
  "artifact-searcher": { ...artifactSearcherAgent, model: DEFAULT_MODEL },
  "atlas-compiler": { ...atlasCompilerAgent, model: DEFAULT_MODEL },
  "atlas-cold-build": { ...atlasColdBuildAgent, model: DEFAULT_MODEL },
  "atlas-cold-behavior": { ...atlasColdBehaviorAgent, model: DEFAULT_MODEL },
  "atlas-initializer": { ...atlasInitializerAgent, model: DEFAULT_MODEL },
  "atlas-translator": { ...atlasTranslatorAgent, model: DEFAULT_MODEL },
  "atlas-worker-build": { ...atlasWorkerBuildAgent, model: DEFAULT_MODEL },
  "atlas-worker-behavior": { ...atlasWorkerBehaviorAgent, model: DEFAULT_MODEL },
  "notification-courier": { ...notificationCourierAgent, model: DEFAULT_MODEL },
  "project-initializer": { ...projectInitializerAgent, model: DEFAULT_MODEL },
  octto: { ...octtoAgent, model: DEFAULT_MODEL },
  probe: { ...probeAgent, model: DEFAULT_MODEL },
  "mm-stack-detector": { ...stackDetectorAgent, model: DEFAULT_MODEL },
  "mm-pattern-discoverer": { ...mindmodelPatternDiscovererAgent, model: DEFAULT_MODEL },
  "mm-example-extractor": { ...exampleExtractorAgent, model: DEFAULT_MODEL },
  "mm-orchestrator": { ...mindmodelOrchestratorAgent, model: DEFAULT_MODEL },
  "mm-dependency-mapper": { ...dependencyMapperAgent, model: DEFAULT_MODEL },
  "mm-convention-extractor": { ...conventionExtractorAgent, model: DEFAULT_MODEL },
  "mm-domain-extractor": { ...domainExtractorAgent, model: DEFAULT_MODEL },
  "mm-code-clusterer": { ...codeClustererAgent, model: DEFAULT_MODEL },
  "mm-anti-pattern-detector": { ...antiPatternDetectorAgent, model: DEFAULT_MODEL },
  "mm-constraint-writer": { ...constraintWriterAgent, model: DEFAULT_MODEL },
  "mm-constraint-reviewer": { ...constraintReviewerAgent, model: DEFAULT_MODEL },
};

export {
  primaryAgent,
  PRIMARY_AGENT_NAME,
  brainstormerAgent,
  bootstrapperAgent,
  knowledgeBootstrapOrchestratorAgent,
  codebaseLocatorAgent,
  codebaseAnalyzerAgent,
  criticAgent,
  productManagerAgent,
  softwareArchitectAgent,
  uxDesignerAgent,
  architectureQualityInspectorAgent,
  rubricReviewerAgent,
  patternFinderAgent,
  plannerAgent,
  implementerAgent,
  implementerFrontendUiAgent,
  implementerFrontendCodeAgent,
  implementerBackendAgent,
  implementerGeneralAgent,
  reviewerAgent,
  investigatorAgent,
  executorAgent,
  executorDirectAgent,
  ledgerCreatorAgent,
  artifactSearcherAgent,
  octtoAgent,
  probeAgent,
};

export { notificationCourierAgent } from "./notification-courier";
```

**Verify:** `bun test tests/agents/index-knowledge-bootstrap.test.ts`
**Commit:** `feat(agents): register knowledge-bootstrap-orchestrator in barrel\n\nRefs #64`

---

## Batch 4: Commands, Integration & Docs (parallel - 4 implementers)

All depend on Batch 3 completing. Independent within the batch.
Tasks: 4.1, 4.2, 4.3, 4.4

### Task 4.1: Register three slash commands and wire detect_knowledge_state tool in plugin
**File:** `src/index.ts`
**Test:** `tests/index-knowledge-bootstrap-commands.test.ts`
**Depends:** 2.2 (top-level tools barrel), 3.2 (agent registered)
**Domain:** general
**Atlas-impact:** layer-update (new workflow contract: 三个 user-facing slash commands)

```typescript
// tests/index-knowledge-bootstrap-commands.test.ts
import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";

import { OpenCodeConfigPlugin } from "@/index";
import { stopSharedServer } from "@/octto/session/server";

const PREFIX = "micode-knowledge-bootstrap-commands-";

let tempRoot: string | undefined;

interface CommandConfig {
  readonly agent?: string;
  readonly template?: string;
  readonly description?: string;
}

function createCtx(directory: string): PluginInput {
  return {
    directory,
    client: {
      session: {
        create: async () => ({ data: { id: "test-session" } }),
        prompt: async () => ({ data: { parts: [] } }),
        delete: async () => ({ data: { id: "test-session" } }),
        messages: async () => ({ data: [] }),
        abort: async () => ({ data: { id: "test-session" } }),
        summarize: async () => ({ data: { id: "test-session" } }),
      },
      tui: { showToast: async () => undefined },
    },
  } as unknown as PluginInput;
}

async function loadCommands(): Promise<Record<string, CommandConfig>> {
  tempRoot = mkdtempSync(join(tmpdir(), PREFIX));
  const plugin = await OpenCodeConfigPlugin(createCtx(tempRoot));
  const configObj: Parameters<NonNullable<typeof plugin.config>>[0] = {
    permission: {},
    agent: {},
    mcp: {},
    command: {},
  } as Parameters<NonNullable<typeof plugin.config>>[0];
  await plugin.config?.(configObj);
  return (configObj.command ?? {}) as Record<string, CommandConfig>;
}

afterEach(async () => {
  await stopSharedServer();
  if (!tempRoot) return;
  rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe("knowledge bootstrap commands registration", () => {
  it("registers /all-init routed to knowledge-bootstrap-orchestrator", async () => {
    const commands = await loadCommands();
    const cmd = commands["all-init"];
    expect(cmd).toBeDefined();
    expect(cmd?.agent).toBe("knowledge-bootstrap-orchestrator");
    expect(cmd?.template).toContain("missing-only");
  });

  it("registers /all-rebuild routed to knowledge-bootstrap-orchestrator", async () => {
    const commands = await loadCommands();
    const cmd = commands["all-rebuild"];
    expect(cmd).toBeDefined();
    expect(cmd?.agent).toBe("knowledge-bootstrap-orchestrator");
    expect(cmd?.template).toContain("refresh-all");
  });

  it("registers /all-status routed to knowledge-bootstrap-orchestrator", async () => {
    const commands = await loadCommands();
    const cmd = commands["all-status"];
    expect(cmd).toBeDefined();
    expect(cmd?.agent).toBe("knowledge-bootstrap-orchestrator");
    expect(cmd?.template).toContain("status-only");
  });

  it("preserves the existing /init, /mindmodel, /atlas-init commands", async () => {
    const commands = await loadCommands();
    expect(commands.init?.agent).toBe("project-initializer");
    expect(commands.mindmodel?.agent).toBe("mm-orchestrator");
    expect(commands["atlas-init"]?.agent).toBe("atlas-initializer");
  });

  it("commands have non-empty descriptions naming bootstrap intent", async () => {
    const commands = await loadCommands();
    expect(commands["all-init"]?.description?.toLowerCase()).toContain("bootstrap");
    expect(commands["all-rebuild"]?.description?.toLowerCase()).toContain("rebuild");
    expect(commands["all-status"]?.description?.toLowerCase()).toContain("status");
  });
});

describe("plugin tool wiring: detect_knowledge_state", () => {
  it("exposes detect_knowledge_state in plugin tool record", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), PREFIX));
    const plugin = await OpenCodeConfigPlugin(createCtx(tempRoot));
    expect(plugin.tool).toBeDefined();
    expect((plugin.tool as Record<string, unknown>).detect_knowledge_state).toBeDefined();
  });
});
```

```typescript
// src/index.ts
// (Apply ONLY the following diffs to the existing 1200+ line file.)
//
// 1) Import block: add the new tool factory next to other tool imports
//    (alphabetical grouping with createDetectKnowledgeStateTool):
//
//    import { createDetectKnowledgeStateTool } from "@/tools";
//
//    The tool is already re-exported from "@/tools" by Task 2.2.
//
// 2) PLUGIN_COMMANDS literal (currently at ~line 148): add three new command entries
//    AFTER the existing memory: { ... } entry, BEFORE the closing brace. Final shape:

const PLUGIN_COMMANDS = {
  init: {
    description: "Initialize project with ARCHITECTURE.md and CODE_STYLE.md",
    agent: "project-initializer",
    template: "Initialize this project. $ARGUMENTS",
  },
  mindmodel: {
    description: "Generate .mindmodel/ constraints for this project",
    agent: "mm-orchestrator",
    template: "Generate mindmodel for this project. $ARGUMENTS",
  },
  ledger: {
    description: "Create or update continuity ledger for session state",
    agent: "ledger-creator",
    template: "Update the continuity ledger. $ARGUMENTS",
  },
  search: {
    description: "Search past handoffs, plans, and ledgers",
    agent: "artifact-searcher",
    template: "Search for: $ARGUMENTS",
  },
  memory: {
    description: "Inspect or query durable project memory (entities, decisions, lessons, risks)",
    agent: PRIMARY_AGENT_NAME,
    template:
      "Use the project_memory_* tools to handle this request. Default behaviour: if no arguments are given, run project_memory_health and report a concise summary; if arguments are given, run project_memory_lookup with the arguments as the query. $ARGUMENTS",
  },
  "all-init": {
    description:
      "Bootstrap all three knowledge layers (/init + /mindmodel + /atlas-init) for the missing parts only",
    agent: "knowledge-bootstrap-orchestrator",
    template:
      "Mode: missing-only. The user invoked /all-init. Use detect_knowledge_state to inspect which of the three layers (/init, .mindmodel, atlas) are missing, then serial-spawn only the missing parts (project-initializer for /init, mm-orchestrator for .mindmodel, atlas-initializer for atlas). If all three layers are present, exit friendly and recommend /all-rebuild. $ARGUMENTS",
  },
  "all-rebuild": {
    description:
      "Rebuild all three knowledge layers (/init + /mindmodel + /atlas-init) with overwrite (requires user confirm)",
    agent: "knowledge-bootstrap-orchestrator",
    template:
      "Mode: refresh-all. The user invoked /all-rebuild. Use detect_knowledge_state to list files that will be overwritten, then ask the user to confirm via octto. If confirmed, collect bootstrap-questionnaire answers via octto and serial-spawn project-initializer (overwrite ARCHITECTURE.md/CODE_STYLE.md), mm-orchestrator (overwrite .mindmodel/), atlas-initializer (force-rebuild atlas/, pre-seed octto answers in the spawn prompt). $ARGUMENTS",
  },
  "all-status": {
    description: "Inspect status of all three knowledge layers and Project Memory (read-only)",
    agent: "knowledge-bootstrap-orchestrator",
    template:
      "Mode: status-only. The user invoked /all-status. Use detect_knowledge_state, atlas_lookup-derived signals, and project_memory_health to produce a single read-only markdown report. Do NOT write any files. Do NOT spawn any child orchestrators. $ARGUMENTS",
  },
};

// 3) Tool record (currently at the `return { tool: { ... } }` block ~line 952): add the
//    new tool to the spread record. Final shape (only the relevant lines shown):
//
//    tool: {
//      ast_grep_search,
//      ast_grep_replace,
//      btca_ask,
//      look_at,
//      artifact_search,
//      milestone_artifact_search,
//      spawn_agent,
//      resume_subagent,
//      cleanup_parent_run,
//      batch_read,
//      ...atlasLookupTool,
//      ...mindmodelLookupTool,
//      ...projectMemoryTools,
//      ...ptyTools,
//      ...octtoTools,
//      ...lifecycleTools,
//      ...createDetectKnowledgeStateTool(ctx),  // NEW LINE
//    },
//
// 4) command.execute.before hook does NOT need to handle "all-init" / "all-rebuild" /
//    "all-status". These commands are routed entirely through the agent system via
//    PLUGIN_COMMANDS.agent, exactly like /init and /mindmodel today. The runAtlasCommand
//    deterministic dispatcher must not intercept them. shouldSkipAtlasCommandHook only
//    matches the atlas-* prefix; the all-* commands fall through naturally because they
//    do not match any of ATLAS_INIT_COMMAND / ATLAS_STATUS_COMMAND / ATLAS_REFRESH_COMMAND.
//    No change needed to runAtlasCommand or shouldSkipAtlasCommandHook.
```

**Verify:** `bun test tests/index-knowledge-bootstrap-commands.test.ts`
**Commit:** `feat(commands): register /all-init /all-rebuild /all-status\n\nRefs #64`

---

### Task 4.2: AGENTS.md mirror update
**File:** `AGENTS.md`
**Test:** `tests/agents/agents-md-knowledge-bootstrap.test.ts`
**Depends:** 3.1
**Domain:** general
**Atlas-impact:** layer-update (workflow contract documentation)

```typescript
// tests/agents/agents-md-knowledge-bootstrap.test.ts
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { describe, expect, it } from "bun:test";

const AGENTS_MD = readFileSync(join(__dirname, "..", "..", "AGENTS.md"), "utf-8");

describe("project AGENTS.md: Knowledge Bootstrap Commands section", () => {
  it("contains a section heading naming the three commands", () => {
    expect(AGENTS_MD).toContain("## Knowledge Bootstrap Commands");
  });

  it("documents /all-init mode and behaviour", () => {
    expect(AGENTS_MD).toContain("/all-init");
    expect(AGENTS_MD).toContain("missing-only");
  });

  it("documents /all-rebuild mode and confirm requirement", () => {
    expect(AGENTS_MD).toContain("/all-rebuild");
    expect(AGENTS_MD).toContain("refresh-all");
    expect(AGENTS_MD.toLowerCase()).toContain("confirm");
  });

  it("documents /all-status mode and read-only nature", () => {
    expect(AGENTS_MD).toContain("/all-status");
    expect(AGENTS_MD).toContain("status-only");
    expect(AGENTS_MD.toLowerCase()).toMatch(/read[- ]only|只读/);
  });

  it("names the knowledge-bootstrap-orchestrator agent as the routing target", () => {
    expect(AGENTS_MD).toContain("knowledge-bootstrap-orchestrator");
  });

  it("states the three commands do NOT replace /init /mindmodel /atlas-init", () => {
    expect(AGENTS_MD).toMatch(/不替换|do not replace|保留.*\/init.*\/mindmodel.*\/atlas-init/);
  });
});
```

```markdown
<!-- Add a new top-level section to AGENTS.md, placed AFTER the existing
     "## Atlas Shared Mental Model" section and BEFORE the trailing
     "Instructions from: /root/.config/opencode/AGENTS.md" sentinel if any.
     Implementer: match existing section style (level-2 heading, level-3 sub-headings,
     Chinese-first prose, code spans for command and agent names). -->

## Knowledge Bootstrap Commands

micode 提供三条零参数 orchestrator 命令，用单一入口建立 / 大更新 / 体检三层项目知识库 (`/init` → `ARCHITECTURE.md` + `CODE_STYLE.md`；`/mindmodel` → `.mindmodel/`；`/atlas-init` → `atlas/`)。三条命令均路由到 `knowledge-bootstrap-orchestrator` agent，由该 agent 按 mode 串行调度现有 `project-initializer` / `mm-orchestrator` / `atlas-initializer` 子流程。

| 命令 | Mode | 行为 |
|---|---|---|
| `/all-init` | missing-only | 检测三层状态；仅建立缺失部分，已有的层不动 |
| `/all-rebuild` | refresh-all | 列出会被覆盖的文件并 octto confirm；确认后串行重建三层（force-rebuild 语义） |
| `/all-status` | status-only | 只读体检：三层是否存在 + atlas 健康度 + Project Memory 摘要，不写任何文件 |

### Dispatch rules

- 三条命令零参数。不引入 `--flag`，每个 mode 一个独立命令。
- 不替换 `/init`、`/mindmodel`、`/atlas-init`、`/atlas-status`、`/atlas-refresh`。这些原有命令继续可独立使用。
- 串行执行：`project-initializer` → `mm-orchestrator` → `atlas-initializer`，依赖顺序由后两阶段读取前阶段文件决定。禁止并发。
- 中间失败不回滚：任一子 agent 失败时已完成阶段保留，用户复跑 `/all-init` 智能补齐。
- `/all-rebuild` 必须显式 confirm，否则不动文件。
- octto 问卷在 orchestrator 入口一次性收集（`intent.pitch` / `intent.user` / `intent.shape`），下传给 `atlas-initializer` 的 spawn prompt，避免重复询问。octto 不可用时用 `DEFAULT_BOOTSTRAP_ANSWERS` 兜底并 warn。

### Output discipline

每次执行后必须输出"本次知识上下文"板块（参见 `src/agents/knowledge-context-section.ts` 的 `KNOWLEDGE_CONTEXT_SECTION` 单源），列出本次任务读取与维护的知识来源。`/all-status` 之外的模式还需输出 commander effect-first 的四段终态汇报（预期表现 / 你可以怎么验收 / 已知限制 / 实现记录）。

### Drift guard

`src/agents/knowledge-bootstrap-orchestrator.ts`、`src/tools/knowledge-bootstrap/`、`src/index.ts` 中 `PLUGIN_COMMANDS` 的 `all-init` / `all-rebuild` / `all-status` 条目是单源；本节是 markdown 镜像，drift 由 `tests/agents/agents-md-knowledge-bootstrap.test.ts` 强制。
```

**Verify:** `bun test tests/agents/agents-md-knowledge-bootstrap.test.ts`
**Commit:** `docs(agents): add Knowledge Bootstrap Commands section to AGENTS.md\n\nRefs #64`

---

### Task 4.3: Fixture integration tests for five orchestrator scenarios
**File:** `tests/integration/knowledge-bootstrap-orchestrator.test.ts`
**Test:** itself (integration test file)
**Depends:** 4.1
**Domain:** general
**Atlas-impact:** none

```typescript
// tests/integration/knowledge-bootstrap-orchestrator.test.ts
//
// Integration tests for the knowledge-bootstrap-orchestrator command dispatch.
//
// These tests do NOT invoke the LLM. They exercise the deterministic surface:
//   - detect_knowledge_state's view of fixture project trees
//   - renderBootstrapStatus over those fixtures
//   - PLUGIN_COMMANDS routing
//
// LLM-driven behaviour (octto questionnaire, serial spawn, mode switching) is
// asserted indirectly via knowledge-bootstrap-orchestrator prompt tests in
// tests/agents/knowledge-bootstrap-orchestrator.test.ts.
//
// The five fixture scenarios mirror the design's open-questions list:
//   1) 全空 + /all-init   → detector says all missing, recommend bootstrap
//   2) 部分有 + /all-init → detector says some missing, surface gaps
//   3) 全有 + /all-init   → detector says all present, recommend /all-rebuild
//   4) 全有 + /all-rebuild → detector still present, status report unchanged
//      (the confirm step is LLM-driven; we only assert detector input)
//   5) 任意 + /all-status → renderBootstrapStatus returns markdown over any state

import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { detectKnowledgeState } from "@/tools/knowledge-bootstrap/detect";
import { renderBootstrapStatus } from "@/tools/knowledge-bootstrap/status";

const EMPTY_ATLAS_STATUS = {
  openChallenges: 0,
  brokenWikilinks: 0,
  orphanStagingDirs: 0,
  staleNodes: 0,
  lastSuccessfulRun: null,
  spawnReceiptDiff: 0,
};

let root: string;

function seedInit(root: string): void {
  writeFileSync(join(root, "ARCHITECTURE.md"), "# Arch\n", "utf8");
  writeFileSync(join(root, "CODE_STYLE.md"), "# Style\n", "utf8");
}

function seedMindmodel(root: string): void {
  mkdirSync(join(root, ".mindmodel"), { recursive: true });
  writeFileSync(join(root, ".mindmodel", "manifest.yaml"), "version: 1\n", "utf8");
}

function seedAtlas(root: string): void {
  mkdirSync(join(root, "atlas"), { recursive: true });
  writeFileSync(join(root, "atlas", "00-index.md"), "# Index\n", "utf8");
}

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "knowledge-bootstrap-int-"));
});

afterEach(() => {
  rmSync(root, { recursive: true, force: true });
});

describe("scenario 1: empty project + /all-init", () => {
  it("detector reports all three layers missing", () => {
    const state = detectKnowledgeState(root);
    expect(state.init).toBe("missing");
    expect(state.mindmodel).toBe("missing");
    expect(state.atlas).toBe("missing");
  });

  it("status report recommends /all-init for an empty project", () => {
    const state = detectKnowledgeState(root);
    const report = renderBootstrapStatus(state, EMPTY_ATLAS_STATUS);
    expect(report).toContain("/all-init");
  });
});

describe("scenario 2: partially-bootstrapped project + /all-init", () => {
  it("detector reports init=present, mindmodel=missing, atlas=missing when only /init has run", () => {
    seedInit(root);
    const state = detectKnowledgeState(root);
    expect(state.init).toBe("present");
    expect(state.mindmodel).toBe("missing");
    expect(state.atlas).toBe("missing");
  });

  it("status report surfaces gaps for /all-init to fill", () => {
    seedInit(root);
    seedMindmodel(root);
    const state = detectKnowledgeState(root);
    const report = renderBootstrapStatus(state, EMPTY_ATLAS_STATUS);
    // mindmodel present, init present, atlas still missing
    expect(state.atlas).toBe("missing");
    expect(report).toContain("/all-init");
  });
});

describe("scenario 3: fully-bootstrapped project + /all-init", () => {
  it("detector reports all three layers present", () => {
    seedInit(root);
    seedMindmodel(root);
    seedAtlas(root);
    const state = detectKnowledgeState(root);
    expect(state.init).toBe("present");
    expect(state.mindmodel).toBe("present");
    expect(state.atlas).toBe("present");
  });

  it("status report recommends /all-rebuild when all layers are present", () => {
    seedInit(root);
    seedMindmodel(root);
    seedAtlas(root);
    const state = detectKnowledgeState(root);
    const report = renderBootstrapStatus(state, EMPTY_ATLAS_STATUS);
    expect(report).toContain("/all-rebuild");
  });
});

describe("scenario 4: fully-bootstrapped project + /all-rebuild", () => {
  it("detector input does not change before/after confirm gating", () => {
    // /all-rebuild's confirm step is LLM-driven; this test verifies the
    // detector view stays read-only on a fully-bootstrapped fixture. Actual
    // file overwrite is asserted by the child agents' own test suites.
    seedInit(root);
    seedMindmodel(root);
    seedAtlas(root);
    const before = detectKnowledgeState(root);
    const after = detectKnowledgeState(root);
    expect(before).toEqual(after);
  });
});

describe("scenario 5: any state + /all-status", () => {
  it("renderBootstrapStatus returns markdown over an empty fixture", () => {
    const state = detectKnowledgeState(root);
    const report = renderBootstrapStatus(state, EMPTY_ATLAS_STATUS);
    expect(report.startsWith("# Knowledge Bootstrap Status")).toBe(true);
  });

  it("renderBootstrapStatus returns markdown over a partial fixture", () => {
    seedInit(root);
    const state = detectKnowledgeState(root);
    const report = renderBootstrapStatus(state, EMPTY_ATLAS_STATUS);
    expect(report).toContain("Layer presence");
    expect(report).toContain("Atlas health");
    expect(report).toContain("Project Memory");
  });

  it("renderBootstrapStatus returns markdown over a full fixture", () => {
    seedInit(root);
    seedMindmodel(root);
    seedAtlas(root);
    const state = detectKnowledgeState(root);
    const report = renderBootstrapStatus(state, EMPTY_ATLAS_STATUS);
    expect(report).toContain("Recommendation");
  });
});
```

```typescript
// No implementation file. This task is test-only; it validates the deterministic
// surface assembled by Tasks 1.2 / 1.3 / 1.4 / 2.1 against five fixture scenarios.
// If any assertion fails, the failure is in the corresponding foundation task.
```

**Verify:** `bun test tests/integration/knowledge-bootstrap-orchestrator.test.ts`
**Commit:** `test(integration): cover five knowledge-bootstrap orchestrator scenarios\n\nRefs #64`

---

### Task 4.4: Routing + skip-hook drift test for three commands
**File:** `tests/index-all-commands-routing.test.ts`
**Test:** itself (this is a drift-guard test)
**Depends:** 4.1
**Domain:** general
**Atlas-impact:** none

```typescript
// tests/index-all-commands-routing.test.ts
//
// Drift-guard test ensuring the three /all-* commands route to
// knowledge-bootstrap-orchestrator and that the atlas-command-execute-before
// hook does NOT intercept them.

import { afterEach, describe, expect, it } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import type { PluginInput } from "@opencode-ai/plugin";

import { OpenCodeConfigPlugin, shouldSkipAtlasCommandHook } from "@/index";
import { stopSharedServer } from "@/octto/session/server";

const PREFIX = "micode-all-commands-routing-";

let tempRoot: string | undefined;

interface CommandConfig {
  readonly agent?: string;
  readonly template?: string;
  readonly description?: string;
}

function createCtx(directory: string): PluginInput {
  return {
    directory,
    client: {
      session: {
        create: async () => ({ data: { id: "test-session" } }),
        prompt: async () => ({ data: { parts: [] } }),
        delete: async () => ({ data: { id: "test-session" } }),
        messages: async () => ({ data: [] }),
        abort: async () => ({ data: { id: "test-session" } }),
        summarize: async () => ({ data: { id: "test-session" } }),
      },
      tui: { showToast: async () => undefined },
    },
  } as unknown as PluginInput;
}

async function loadCommands(): Promise<Record<string, CommandConfig>> {
  tempRoot = mkdtempSync(join(tmpdir(), PREFIX));
  const plugin = await OpenCodeConfigPlugin(createCtx(tempRoot));
  const configObj: Parameters<NonNullable<typeof plugin.config>>[0] = {
    permission: {},
    agent: {},
    mcp: {},
    command: {},
  } as Parameters<NonNullable<typeof plugin.config>>[0];
  await plugin.config?.(configObj);
  return (configObj.command ?? {}) as Record<string, CommandConfig>;
}

afterEach(async () => {
  await stopSharedServer();
  if (!tempRoot) return;
  rmSync(tempRoot, { recursive: true, force: true });
  tempRoot = undefined;
});

describe("/all-* command routing", () => {
  it("routes /all-init to knowledge-bootstrap-orchestrator", async () => {
    const commands = await loadCommands();
    expect(commands["all-init"]?.agent).toBe("knowledge-bootstrap-orchestrator");
  });

  it("routes /all-rebuild to knowledge-bootstrap-orchestrator", async () => {
    const commands = await loadCommands();
    expect(commands["all-rebuild"]?.agent).toBe("knowledge-bootstrap-orchestrator");
  });

  it("routes /all-status to knowledge-bootstrap-orchestrator", async () => {
    const commands = await loadCommands();
    expect(commands["all-status"]?.agent).toBe("knowledge-bootstrap-orchestrator");
  });

  it("template injects mode hint for each command", async () => {
    const commands = await loadCommands();
    expect(commands["all-init"]?.template).toContain("missing-only");
    expect(commands["all-rebuild"]?.template).toContain("refresh-all");
    expect(commands["all-status"]?.template).toContain("status-only");
  });

  it("/all-rebuild template instructs confirm before overwrite", async () => {
    const commands = await loadCommands();
    expect(commands["all-rebuild"]?.template?.toLowerCase()).toContain("confirm");
  });

  it("/all-status template forbids writing files", async () => {
    const commands = await loadCommands();
    expect(commands["all-status"]?.template).toMatch(/do NOT write|read-only|read only/);
  });
});

describe("/all-* commands bypass the atlas deterministic hook", () => {
  it("shouldSkipAtlasCommandHook returns false for /all-init (no interception)", () => {
    expect(shouldSkipAtlasCommandHook("all-init")).toBe(false);
  });

  it("shouldSkipAtlasCommandHook returns false for /all-rebuild", () => {
    expect(shouldSkipAtlasCommandHook("all-rebuild")).toBe(false);
  });

  it("shouldSkipAtlasCommandHook returns false for /all-status", () => {
    expect(shouldSkipAtlasCommandHook("all-status")).toBe(false);
  });

  it("the atlas hook does not match all-* commands", async () => {
    tempRoot = mkdtempSync(join(tmpdir(), PREFIX));
    const ctx = createCtx(tempRoot);
    const plugin = await OpenCodeConfigPlugin(ctx);

    const input = { command: "all-init", sessionID: "test-session", arguments: "" };
    const output = { parts: [] as unknown[] };

    const hook = plugin["command.execute.before"] as ((...args: never) => unknown) | undefined;
    await hook?.(input as never, output as never);

    // The atlas hook only handles atlas-init, atlas-status, atlas-refresh, atlas-translate.
    // For all-init it should NOT append a part.
    expect(output.parts).toHaveLength(0);
  });
});
```

```typescript
// No implementation file. This task is a drift-guard test against Task 4.1's
// PLUGIN_COMMANDS edit. If the registration is removed, downgraded, or the
// atlas hook starts intercepting all-* commands, this test fails.
```

**Verify:** `bun test tests/index-all-commands-routing.test.ts`
**Commit:** `test(commands): drift-guard /all-* routing and hook bypass\n\nRefs #64`
