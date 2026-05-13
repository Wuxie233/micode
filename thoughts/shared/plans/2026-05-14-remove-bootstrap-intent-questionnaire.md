---
date: 2026-05-14
topic: "Remove intent.* octto questionnaire from /all-init and /all-rebuild"
issue: 70
scope: knowledge-bootstrap
contract: none
---

# Remove Bootstrap Intent Questionnaire — Implementation Plan

**Goal:** 删除 `/all-init` 与 `/all-rebuild` 在 `knowledge-bootstrap-orchestrator` 入口的 intent.pitch / intent.user / intent.shape octto 问卷收集步骤，让 `atlas-initializer` 在 phase 2 自行从 README / package.json / ARCHITECTURE.md 推断 intent；保留 `/all-rebuild` 的 octto.confirm 覆盖确认。

**Architecture:** 删除 `src/tools/knowledge-bootstrap/questionnaire.ts` 整个模块与其在 `index.ts` 的 re-export；从 `knowledge-bootstrap-orchestrator` prompt 中移除问卷收集语义；从 `src/index.ts` 的 `/all-rebuild` 命令 template 移除 "bootstrap-questionnaire / pre-seed octto answers" 短语；在 `atlas-initializer` phase 2 加入硬约束，明确"README / package.json description / ARCHITECTURE.md 任一可读时不得用 octto 问 intent 类问题"，保留三者全空时 octto 问最多 1 题的 escape hatch。AGENTS.md 镜像段与所有相关测试同步更新。

**Design:** `thoughts/shared/designs/2026-05-14-remove-bootstrap-intent-questionnaire-design.md`

**Contract:** `none` (单 domain：全部 general，无 frontend↔backend 拆分)

---

## Decisions made by planner (gap-filling)

- **AGENTS.md 行 183 改写策略**：原行整段替换为"`atlas-initializer` 在 phase 2 自行从 README / package.json / ARCHITECTURE.md 推断 pitch / user / shape；只有当三者全空白时由 atlas-initializer 自决用 octto 问最多 1 个最关键问题。orchestrator 入口不再收集 intent 类答案。"。表格 `/all-rebuild` 行保持不变（octto confirm 描述与本次改动语义一致）。
- **`src/index.ts` `/all-rebuild` template 改写**：将 `"...If confirmed, collect bootstrap-questionnaire answers via octto and serial-spawn project-initializer (overwrite ARCHITECTURE.md/CODE_STYLE.md), mm-orchestrator (overwrite .mindmodel/), atlas-initializer (force-rebuild atlas/, pre-seed octto answers in the spawn prompt)."` 改为 `"...If confirmed, serial-spawn project-initializer (overwrite ARCHITECTURE.md/CODE_STYLE.md), mm-orchestrator (overwrite .mindmodel/), atlas-initializer (force-rebuild atlas/; atlas-initializer self-infers intent from README / package.json / ARCHITECTURE.md in phase 2, no pre-seeded answers)."`。`/all-init` template 当前未提及 questionnaire，无需修改。
- **`knowledge-bootstrap-orchestrator.ts` Step 2 改写**：
  - missing-only 分支：删除 `→ 进入 octto 问卷收集` 短语；改为 `→ 串行 spawn 三个子 agent（project-initializer → mm-orchestrator → atlas-initializer）；atlas-initializer 自行在 phase 2 推断 intent，本 agent 不收集 intent 答案`。
  - refresh-all 分支：保留 `octto confirm`；删除 `→ 收集 bootstrap-questionnaire 答案 → ` 以及 atlas 子步骤中的 `并把 octto 答案以 "Pre-seeded answers (skip these questions): intent.pitch=..., intent.user=..., intent.shape=..." 形式拼接到 prompt`；改为 `atlas-initializer 在 spawn prompt 中只接收 "mode=force-rebuild" 语义；intent 推断由 atlas-initializer phase 2 自行完成`。
  - 删除 `${buildBootstrapQuestionPrompt()}` 模板插入和 import 语句。
  - `<available-tools>` 块：将 `/all-init 全缺失或 /all-rebuild 模式下收集 bootstrap-questionnaire 答案。` 改为 `/all-rebuild 模式下用 octto confirm 让用户确认覆盖；不再收集 intent.* 问卷答案。` 同时保留 `octto 工具集` 描述（confirm 仍然使用 octto）。
- **`atlas-initializer.ts` phase 2 硬约束位置**：在现有 `<phase name="2-synthesis" ...>` 块结尾 `If critical information is missing...` 那段之前插入一段硬约束，使新的更严格条件覆盖原 escape hatch，但不删除原 escape hatch。新增句的精确字串（用于 drift-guard 测试断言）：`If README, package.json description, or ARCHITECTURE.md is readable, do NOT use Octto to ask intent questions; infer pitch, primary user, and deployment shape directly from these sources. Only when ALL THREE are blank may you use Octto to ask AT MOST ONE most critical question.`
- **测试断言新增**：`tests/agents/atlas-initializer.test.ts` 增加一个测试 `it("requires self-inference of intent before falling back to octto", ...)`，断言 prompt 含 `README`, `package.json`, `ARCHITECTURE.md`, `do NOT use Octto to ask intent`, `AT MOST ONE` 等关键短语。
- **`tests/integration/knowledge-bootstrap-orchestrator.test.ts` 改动幅度**：检视发现该集成测试当前并未真正断言"答案被传到 atlas-initializer prompt"——它只在文件头注释里提到 `octto questionnaire`。因此只需更新该注释（行 10、行 16 区域），无需删除测试逻辑。
- **测试理由 (Test: none for source tasks)**：本计划中 source-file 任务全部是 prompt-string / 命令 template / 文档镜像 / 整文件删除（包含的 4 个工具函数本身已无外部消费者），属于 "prompt-only changes, pure config, glue code, agent strings" 范畴，semantic risk 低；行为正确性的回归保护已由 Batch 2 的 5 个测试任务承担（drift-guard 断言 / orchestrator prompt 反向断言 / atlas-initializer 新硬约束断言 / AGENTS.md 镜像断言）。

---

## Dependency Graph

```
Batch 1 (parallel, 6 implementers): 1.1, 1.2, 1.3, 1.4, 1.5, 1.6 [source + docs — no inter-deps; final state consistent]
Batch 2 (parallel, 5 implementers): 2.1, 2.2, 2.3, 2.4, 2.5 [tests — depend on Batch 1's new strings/absences]
```

实际依赖说明：Batch 1 内 6 个文件互相独立（修改/删除不同文件）。`questionnaire.ts` 被 `index.ts` 与 `knowledge-bootstrap-orchestrator.ts` import，但三者都在同一 batch 内同步落地，batch 完成后整个 import graph 自洽。Batch 2 所有测试断言 Batch 1 落地后的新字符串状态，必须等 Batch 1 完成后启动。

---

## Batch 1: Source + Documentation Changes (parallel — 6 implementers)

All tasks in this batch have NO dependencies on each other and run simultaneously. They touch six distinct files. After all six land, the project compiles and the import graph is consistent.

Tasks: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6

### Task 1.1: Delete questionnaire module
**File:** `src/tools/knowledge-bootstrap/questionnaire.ts`
**Test:** none (整文件删除；行为回归保护由 Task 2.1 的"测试文件同步删除"承担，整套四个导出已无外部消费者)
**Depends:** none
**Domain:** general
**Atlas-impact:** none

Delete the entire file. The four exports (`BOOTSTRAP_QUESTION_KEYS`, `BootstrapQuestionKey` type, `BootstrapAnswers` type, `DEFAULT_BOOTSTRAP_ANSWERS`, `buildBootstrapQuestionPrompt`) have no remaining external consumers after Tasks 1.2 and 1.3 land in the same batch.

Operation: `rm src/tools/knowledge-bootstrap/questionnaire.ts` (or equivalent file deletion via the implementer's editor tool).

**Verify:** `test ! -f src/tools/knowledge-bootstrap/questionnaire.ts && bun run typecheck 2>&1 | grep -v "questionnaire"` — file gone, no TS error mentioning the removed module path.
**Commit:** `refactor(knowledge-bootstrap): delete questionnaire module (no remaining consumers)`

### Task 1.2: Remove questionnaire re-exports from knowledge-bootstrap barrel
**File:** `src/tools/knowledge-bootstrap/index.ts`
**Test:** none (pure barrel cleanup; type-graph consistency verified by typecheck at batch end; Task 1.1's file deletion would surface here as missing-module error if these re-exports stayed)
**Depends:** none (independent file; Task 1.1 deletes the source the re-exports point to, but the two changes settle together in this batch)
**Domain:** general
**Atlas-impact:** none

Remove the following lines from `src/tools/knowledge-bootstrap/index.ts`:

- `export type { BootstrapAnswers, BootstrapQuestionKey } from "./questionnaire";`
- The 5-line `export { BOOTSTRAP_QUESTION_KEYS, buildBootstrapQuestionPrompt, DEFAULT_BOOTSTRAP_ANSWERS, } from "./questionnaire";` block.

Keep all other exports intact: `detectKnowledgeState`, `createDetectKnowledgeStateTool`, `renderBootstrapStatus`, the `FilePresence` / `KnowledgeState` / `LayerState` / `ProjectMemorySummary` types, and the `AtlasStatusResult` type. Do not modify `DESCRIPTION` / `HEADER` / `ISO_DATE_LENGTH` / `formatPresence` / `formatState` / the tool factory body.

**Verify:** `bun run typecheck` passes; `rg "questionnaire" src/tools/knowledge-bootstrap/index.ts` returns no matches.
**Commit:** `refactor(knowledge-bootstrap): drop questionnaire re-exports from barrel`

### Task 1.3: Strip questionnaire references from knowledge-bootstrap-orchestrator prompt
**File:** `src/agents/knowledge-bootstrap-orchestrator.ts`
**Test:** none (prompt-string changes; behavioral regression coverage by Task 2.2's reverse assertions on intent.pitch/intent.user/intent.shape/buildBootstrapQuestionPrompt/<bootstrap-questionnaire>)
**Depends:** none (independent file; lands in same batch as 1.1/1.2)
**Domain:** general
**Atlas-impact:** none

Three edits to this file:

1. **Remove the import line:**
   - Delete: `import { buildBootstrapQuestionPrompt } from "@/tools/knowledge-bootstrap/questionnaire";`

2. **Remove the template insertion:**
   - Delete the standalone line containing `${buildBootstrapQuestionPrompt()}` inside the PROMPT template literal.

3. **Update the `<process>` Step 2 block text:**

   - missing-only branch (`── missing-only (/all-init) ──`):
     - REMOVE the phrase `→ 进入 octto 问卷收集` from the "三层全 missing" bullet so the bullet reads "三层全 missing → 串行 spawn 三个子 agent (project-initializer → mm-orchestrator → atlas-initializer)。atlas-initializer 在 phase 2 自行从 README / package.json / ARCHITECTURE.md 推断 intent；本 orchestrator 不收集 intent 答案。"
     - Other bullets of this branch (`all present`, `部分缺失`) unchanged.

   - refresh-all branch (`── refresh-all (/all-rebuild) ──`):
     - KEEP the `octto confirm` bullet exactly as-is (this is the destructive overwrite safety gate).
     - On the `用户确认 →` bullet, REMOVE the substring `收集 bootstrap-questionnaire 答案 → ` so the line reads "用户确认 → 串行 spawn 三个子 agent，每个 prompt 显式说明覆盖语义：".
     - In the atlas sub-bullet (`* Atlas 阶段不走 spawn_agent("atlas-initializer", ...) 的纯 cold-init...`), REMOVE the trailing clause `，并把 octto 答案以 "Pre-seeded answers (skip these questions): intent.pitch=..., intent.user=..., intent.shape=..." 形式拼接到 prompt`. Replace with: `；atlas-initializer 在 phase 2 自行从 README / package.json / ARCHITECTURE.md 推断 intent，spawn prompt 不再含 Pre-seeded answers 段。`

4. **Update the `<available-tools>` block:**
   - The current last line reads:
     `octto 工具集 (start_session / confirm / get_next_answer / end_session)：/all-init 全缺失或 /all-rebuild 模式下收集 bootstrap-questionnaire 答案。`
   - Replace with:
     `octto 工具集 (confirm 为主)：/all-rebuild 模式下用 octto.confirm 让用户确认覆盖。本 orchestrator 不再用 octto 收集 intent.* 问卷答案。`

After these edits the resulting PROMPT MUST NOT contain any of: `intent.pitch`, `intent.user`, `intent.shape`, `buildBootstrapQuestionPrompt`, `<bootstrap-questionnaire>`, `Pre-seeded answers`, `bootstrap-questionnaire`. The PROMPT MUST still contain: `<mode-handling>`, `<process>`, `detect_knowledge_state`, `project-initializer`, `mm-orchestrator`, `atlas-initializer`, `force-rebuild`, `confirm`, `串行`, `不回滚`, `<atlas-mental-model`, `<knowledge-context-section`.

**Verify:** `rg -F "intent.pitch|intent.user|intent.shape|buildBootstrapQuestionPrompt|bootstrap-questionnaire|Pre-seeded answers" src/agents/knowledge-bootstrap-orchestrator.ts` returns no matches; `bun run typecheck` passes.
**Commit:** `refactor(orchestrator): remove intent.* questionnaire from knowledge-bootstrap-orchestrator prompt`

### Task 1.4: Add intent self-inference hard constraint to atlas-initializer phase 2
**File:** `src/agents/atlas-initializer.ts`
**Test:** none (prompt-string addition; behavioral regression coverage by Task 2.5's new assertion in `tests/agents/atlas-initializer.test.ts`)
**Depends:** none
**Domain:** general
**Atlas-impact:** none

In the `<phase name="2-synthesis" description="Build the node plan">` block, BEFORE the existing sentence `If critical information is missing (e.g., purpose of the project is unclear), use Octto to ask the user ONE focused question before proceeding. Keep questions minimal; default to making a reasonable inference if the answer can be guessed from code.`, INSERT the following hard-constraint paragraph (verbatim, English; this exact wording is asserted by Task 2.5):

```
      Intent self-inference (hard constraint): If README, package.json description, or ARCHITECTURE.md is readable, do NOT use Octto to ask intent questions; infer pitch, primary user, and deployment shape directly from these sources. Only when ALL THREE are blank may you use Octto to ask AT MOST ONE most critical question. This constraint tightens — but does not remove — the escape hatch in the next paragraph.
```

The existing "If critical information is missing..." escape-hatch sentence is RETAINED immediately after the new paragraph. No other phases (0-preflight, 1-discovery, 3-worker-fanout, 4-reconcile, 5-write), no other sections (`<critical-rule>`, `<output-layout>`, `<node-schema>`, `<available-subagents>`, `<wikilink-rules>`, `<rules>`, `<execution-example>`, `<auto-commit>`) are modified.

**Verify:** `rg -F "Intent self-inference (hard constraint)" src/agents/atlas-initializer.ts` returns one match in the phase-2 block; `rg -F "If README, package.json description, or ARCHITECTURE.md is readable" src/agents/atlas-initializer.ts` returns one match; `bun run typecheck` passes.
**Commit:** `feat(atlas-initializer): add intent self-inference hard constraint in phase 2`

### Task 1.5: Update /all-rebuild command template in src/index.ts
**File:** `src/index.ts`
**Test:** none (command-template string change; existing `tests/index-all-commands-routing.test.ts` already asserts the template contains `refresh-all` and `confirm`, which both remain; no new behavioral risk surface)
**Depends:** none
**Domain:** general
**Atlas-impact:** none

Locate the `"all-rebuild"` entry in `PLUGIN_COMMANDS` (around line 185-191). Replace the `template:` string value.

Current value (one logical line):
```
"Mode: refresh-all. The user invoked /all-rebuild. Use detect_knowledge_state to list files that will be overwritten, then ask the user to confirm via octto. If confirmed, collect bootstrap-questionnaire answers via octto and serial-spawn project-initializer (overwrite ARCHITECTURE.md/CODE_STYLE.md), mm-orchestrator (overwrite .mindmodel/), atlas-initializer (force-rebuild atlas/, pre-seed octto answers in the spawn prompt). $ARGUMENTS"
```

New value (one logical line):
```
"Mode: refresh-all. The user invoked /all-rebuild. Use detect_knowledge_state to list files that will be overwritten, then ask the user to confirm via octto. If confirmed, serial-spawn project-initializer (overwrite ARCHITECTURE.md/CODE_STYLE.md), mm-orchestrator (overwrite .mindmodel/), atlas-initializer (force-rebuild atlas/; atlas-initializer self-infers intent from README / package.json / ARCHITECTURE.md in phase 2, no pre-seeded answers). $ARGUMENTS"
```

Do NOT modify the `"all-init"` entry (it does not currently mention the questionnaire and the dispatch description already covers the missing-only semantics). Do NOT modify the `"all-status"` entry. Do NOT modify the `description` field of `"all-rebuild"` (which only says "with overwrite (requires user confirm)" — still accurate).

**Verify:** `rg -F "bootstrap-questionnaire" src/index.ts` returns no matches; `rg -F "pre-seed octto answers" src/index.ts` returns no matches; `rg -F "refresh-all" src/index.ts` still finds the all-rebuild template; `bun test tests/index-all-commands-routing.test.ts tests/index-knowledge-bootstrap-commands.test.ts` passes.
**Commit:** `refactor(commands): drop questionnaire pre-seed from /all-rebuild template`

### Task 1.6: Update AGENTS.md Knowledge Bootstrap Commands section
**File:** `AGENTS.md`
**Test:** none (markdown mirror change; drift-guard regression coverage by Task 2.4)
**Depends:** none
**Domain:** general
**Atlas-impact:** none

In the `## Knowledge Bootstrap Commands` section (starts at line 166), replace the LAST bullet of the `### Dispatch rules` subsection.

Current bullet (line 183):
```
- octto 问卷在 orchestrator 入口一次性收集（`intent.pitch` / `intent.user` / `intent.shape`），下传给 `atlas-initializer` 的 spawn prompt，避免重复询问。octto 不可用时用 `DEFAULT_BOOTSTRAP_ANSWERS` 兜底并 warn。
```

Replace with the following TWO bullets (preserving the leading `- `):
```
- orchestrator 入口不再收集 intent.* 问卷答案。`/all-rebuild` 的 octto.confirm 覆盖确认保留（破坏性操作的安全闸）。
- `atlas-initializer` 在 phase 2 自行从 README / package.json description / ARCHITECTURE.md 推断 pitch / 主要用户 / 部署形态；当三者全空白时由 atlas-initializer 自决用 octto 问最多 1 个最关键问题。orchestrator 不再下传 `Pre-seeded answers`。
```

Do NOT modify the section heading, the introduction paragraph (line 168), the command table (lines 170-174 — the `/all-rebuild` row's "octto confirm" description remains accurate), or the `### Output discipline` and `### Drift guard` subsections (lines 185-191).

**Verify:** `rg -F "intent.pitch" AGENTS.md` returns no matches; `rg -F "DEFAULT_BOOTSTRAP_ANSWERS" AGENTS.md` returns no matches; `rg -F "atlas-initializer 在 phase 2 自行" AGENTS.md` returns one match; the `## Knowledge Bootstrap Commands` heading still exists at the original location.
**Commit:** `docs(agents-md): update Knowledge Bootstrap Commands to reflect questionnaire removal`

---

## Batch 2: Test Updates (parallel — 5 implementers)

All tasks in this batch depend on Batch 1 completing (they assert on strings introduced/removed in Batch 1).

Tasks: 2.1, 2.2, 2.3, 2.4, 2.5

### Task 2.1: Delete questionnaire unit test file
**File:** `tests/tools/knowledge-bootstrap/questionnaire.test.ts`
**Test:** none (this task IS a test file deletion; nothing left to test)
**Depends:** 1.1 (source file gone makes this test impossible to keep), 1.2 (re-exports gone makes the import in this test resolve to nothing)
**Domain:** general
**Atlas-impact:** none

Delete the entire file. The three `describe` blocks (`BOOTSTRAP_QUESTION_KEYS`, `DEFAULT_BOOTSTRAP_ANSWERS`, `buildBootstrapQuestionPrompt`) all target symbols deleted in Task 1.1.

Operation: `rm tests/tools/knowledge-bootstrap/questionnaire.test.ts`.

If the parent directory `tests/tools/knowledge-bootstrap/` becomes empty after this deletion, leave it as-is (the implementer does not need to clean up empty directories; future tests under this tools path will recreate it).

**Verify:** `test ! -f tests/tools/knowledge-bootstrap/questionnaire.test.ts && bun test 2>&1 | grep -v "questionnaire.test"` — file gone and `bun test` does not try to run it.
**Commit:** `test(knowledge-bootstrap): drop questionnaire unit test (module deleted)`

### Task 2.2: Flip orchestrator prompt test to reverse-assert questionnaire is gone
**File:** `tests/agents/knowledge-bootstrap-orchestrator.test.ts`
**Test:** N/A (this IS the test; it is its own verification)
**Depends:** 1.3 (asserts on the new orchestrator prompt state)
**Domain:** general
**Atlas-impact:** none

Two edits to this file:

1. **Replace the existing positive assertion test** (around line 50-55):

   Current block:
   ```ts
   it("prompt includes the octto questionnaire block and references intent question keys", () => {
     const p = knowledgeBootstrapOrchestratorAgent.prompt;
     expect(p).toContain("<bootstrap-questionnaire>");
     expect(p).toContain("intent.pitch");
     expect(p).toContain("intent.user");
     expect(p).toContain("intent.shape");
   });
   ```

   Replace with:
   ```ts
   it("prompt does NOT contain the removed intent questionnaire surface", () => {
     const p = knowledgeBootstrapOrchestratorAgent.prompt;
     expect(p).not.toContain("<bootstrap-questionnaire>");
     expect(p).not.toContain("intent.pitch");
     expect(p).not.toContain("intent.user");
     expect(p).not.toContain("intent.shape");
     expect(p).not.toContain("buildBootstrapQuestionPrompt");
     expect(p).not.toContain("Pre-seeded answers");
     expect(p).not.toContain("bootstrap-questionnaire");
   });
   ```

2. **Keep all other tests in the file unchanged**, including:
   - The `confirm` rule test on the refresh-all branch (Task 1.3 keeps `octto.confirm`).
   - The serial-execution / no-rollback / status-only read-only / mode-handling / detect_knowledge_state / friendly-exit / force-rebuild / atlas-mental-model / knowledge-context-section tests.
   - The barrel registration test at the bottom.

**Verify:** `bun test tests/agents/knowledge-bootstrap-orchestrator.test.ts` passes (all original tests still green plus the flipped reverse-assertion test green).
**Commit:** `test(orchestrator): reverse-assert questionnaire surface is absent from prompt`

### Task 2.3: Update integration test comment to drop questionnaire mention
**File:** `tests/integration/knowledge-bootstrap-orchestrator.test.ts`
**Test:** N/A (this IS the test file; comment-only edit)
**Depends:** 1.3 (semantic alignment; the file's runtime test logic is unaffected since it never asserted on questionnaire-passed-to-atlas)
**Domain:** general
**Atlas-impact:** none

In the file header comment block, update line 10:

Current:
```
// LLM-driven behaviour (octto questionnaire, serial spawn, mode switching) is
```

Replace with:
```
// LLM-driven behaviour (octto confirm on rebuild, serial spawn, mode switching) is
```

The remaining test logic (5 `describe` blocks covering empty-project, partial, fully-bootstrapped, rebuild-detector-view, and status-render scenarios) is UNCHANGED. None of the runtime assertions touch questionnaire-related state.

If the implementer finds any other body-line reference to `questionnaire` in this file beyond the design's stated scope (the audit during planning found only the line-10 comment), they should ALSO remove it; otherwise leave the body intact.

**Verify:** `rg -F "questionnaire" tests/integration/knowledge-bootstrap-orchestrator.test.ts` returns no matches; `bun test tests/integration/knowledge-bootstrap-orchestrator.test.ts` passes (no behavioral change expected).
**Commit:** `test(integration): drop questionnaire mention from orchestrator integration test comment`

### Task 2.4: Update AGENTS.md drift-guard test for new Knowledge Bootstrap Commands wording
**File:** `tests/agents/agents-md-knowledge-bootstrap.test.ts`
**Test:** N/A (this IS the test file)
**Depends:** 1.6 (asserts on the new AGENTS.md content)
**Domain:** general
**Atlas-impact:** none

Add ONE new `it(...)` block to the existing `describe("project AGENTS.md: Knowledge Bootstrap Commands section", ...)` suite. Place it AFTER the existing `"names the knowledge-bootstrap-orchestrator agent as the routing target"` test and BEFORE the `"states the three commands do NOT replace /init /mindmodel /atlas-init"` test:

```ts
it("states orchestrator does not collect intent questionnaire and atlas-initializer self-infers", () => {
  // After 2026-05-14 questionnaire removal, the Dispatch rules section must
  // (a) explicitly state intent.* questionnaire is no longer collected at orchestrator entry
  // (b) state atlas-initializer self-infers intent in phase 2 from README/package.json/ARCHITECTURE.md
  // (c) NOT mention the deleted intent.pitch / intent.user / intent.shape keys
  // (d) NOT mention the deleted DEFAULT_BOOTSTRAP_ANSWERS fallback
  expect(AGENTS_MD).toMatch(/不再收集 intent\.\* 问卷|orchestrator 入口不再收集 intent/);
  expect(AGENTS_MD).toMatch(/atlas-initializer.*phase 2.*推断|自行.*README.*package\.json.*ARCHITECTURE/);
  expect(AGENTS_MD).not.toContain("intent.pitch");
  expect(AGENTS_MD).not.toContain("intent.user");
  expect(AGENTS_MD).not.toContain("intent.shape");
  expect(AGENTS_MD).not.toContain("DEFAULT_BOOTSTRAP_ANSWERS");
});
```

Do NOT modify the existing 6 tests in this file:
- `contains a section heading naming the three commands`
- `documents /all-init mode and behaviour`
- `documents /all-rebuild mode and confirm requirement` (still passes — `confirm` is kept)
- `documents /all-status mode and read-only nature`
- `names the knowledge-bootstrap-orchestrator agent as the routing target`
- `states the three commands do NOT replace /init /mindmodel /atlas-init`

**Verify:** `bun test tests/agents/agents-md-knowledge-bootstrap.test.ts` passes with 7 tests green.
**Commit:** `test(agents-md): drift-guard new questionnaire-removed wording`

### Task 2.5: Add atlas-initializer phase-2 hard-constraint assertion
**File:** `tests/agents/atlas-initializer.test.ts`
**Test:** N/A (this IS the test file)
**Depends:** 1.4 (asserts on the new phase-2 hard constraint inserted there)
**Domain:** general
**Atlas-impact:** none

Add ONE new `it(...)` block to the existing `describe("atlas-initializer agent config", ...)` suite. Place it AFTER the existing `"mentions multi-phase cold-init flow"` test and BEFORE the `"bans confidence and human_authored fields"` test:

```ts
it("phase 2 requires intent self-inference before falling back to octto", () => {
  const p = atlasInitializerAgent.prompt;
  // The 2026-05-14 hard constraint must be present in the phase-2 synthesis block
  expect(p).toContain("Intent self-inference (hard constraint)");
  expect(p).toContain("If README, package.json description, or ARCHITECTURE.md is readable");
  expect(p).toContain("do NOT use Octto to ask intent questions");
  expect(p).toContain("infer pitch, primary user, and deployment shape");
  expect(p).toContain("Only when ALL THREE are blank");
  expect(p).toContain("AT MOST ONE most critical question");
  // The constraint lives inside the phase-2 block; verify ordering
  const phase2Idx = p.indexOf('<phase name="2-synthesis"');
  const constraintIdx = p.indexOf("Intent self-inference (hard constraint)");
  const phase3Idx = p.indexOf('<phase name="3-worker-fanout"');
  expect(phase2Idx).toBeGreaterThan(-1);
  expect(constraintIdx).toBeGreaterThan(phase2Idx);
  expect(phase3Idx).toBeGreaterThan(constraintIdx);
  // The pre-existing escape-hatch sentence is RETAINED right after the new constraint
  expect(p).toContain("If critical information is missing");
});
```

Do NOT modify any other test in this file. The existing tests for subagent mode / temperature / maxTokens / description / spawn_agent / multi-phase keywords / banned fields / wikilinks / worker agents / discovery agents / vault layout / lifecycle handoff / auto-commit / push / push-failure / skip-on-no-changes / non-atlas-paths all REMAIN GREEN because Task 1.4 only ADDS one paragraph to phase 2 and does not touch any other prompt content.

**Verify:** `bun test tests/agents/atlas-initializer.test.ts` passes with the new test green plus all original tests green.
**Commit:** `test(atlas-initializer): assert phase-2 intent self-inference hard constraint`
