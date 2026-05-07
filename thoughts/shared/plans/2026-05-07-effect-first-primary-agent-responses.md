---
date: 2026-05-07
topic: "Effect First Primary Agent Responses"
issue: 54
scope: agents
contract: none
---

# Effect-First Primary Agent Responses Implementation Plan

**Goal:** 让 commander / brainstormer / octto 三个 primary agent 在终态用户可见汇报里先讲"用户会看到什么效果、怎么验收、还有什么限制"，把 commit / test / batch / 子任务等过程细节压缩到末尾。

**Architecture:** 在三个 primary agent prompt 中各自插入一个 `<effect-first-reporting>` block，三块在 commander 和 brainstormer 之间 byte-identical（沿用现有 specialist-dispatch / intent-classification drift-guard 模式），octto 因 workflow 不同使用语义一致但措辞贴合 octto 角色的版本（不强制 byte-identical，但同样涵盖 4 个段落 + blocked/failed-stop 异常）。AGENTS.md 增加 `## Effect-First User-Facing Reports` 一节作为单源说明。新增 `tests/agents/effect-first-reporting.test.ts` 覆盖三个 prompt + AGENTS.md，并附加 commander/brainstormer drift-guard。

**Design:** [thoughts/shared/designs/2026-05-07-effect-first-primary-agent-responses-design.md](../designs/2026-05-07-effect-first-primary-agent-responses-design.md)

**Contract:** none (single-domain, prompt-only edits + tests)

**Octto inclusion rationale:** Octto 是 `mode: "primary"` 的第三个主入口（src/agents/octto.ts:6），workflow step 4 在 `end_brainstorm` 后会把 brainstorm 综合结果写入 design 文档并向用户汇报。这次汇报和 brainstormer 的设计完成汇报形态一致：用户最关心的是"会得到什么 design 输出、怎么继续"，不是 branch 数量 / question 数量等过程指标。如果只改 commander/brainstormer，octto 会成为唯一一个仍然过程优先的 primary agent，造成新的表达 drift。因此 octto 同步纳入；考虑到 octto prompt 的 workflow 段落和角色定位（browser session 主持人）与 commander/brainstormer 不同，octto 的 block 与另外两者**语义对齐但不强制 byte-identical**，drift-guard 仅作用于 commander vs brainstormer。

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2, 1.3, 1.4 [prompt + doc edits, no inter-file dep]
Batch 2 (sequential after Batch 1): 2.1 [unified test file consuming all four artifacts]
```

Batch 1 的四个任务都是独立文件编辑，互不依赖；可以由四个 implementer 并行执行。Batch 2 依赖 Batch 1 全部完成，因为它的断言要 grep 三个 prompt 源 + AGENTS.md。

---

## Batch 1: Prompt and AGENTS.md edits (parallel - 4 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4

### Task 1.1: Insert effect-first-reporting block in commander.ts
**File:** `src/agents/commander.ts`
**Test:** `tests/agents/effect-first-reporting.test.ts` (added by Task 2.1; 1.1 itself is a prompt-string edit, the unit test for the block lives in 2.1 per project pattern of `tests/agents/specialist-routing.test.ts`)
**Depends:** none
**Domain:** general

**Decision (gap-fill from design):** The design says the block "supplements" formatting / notification / intent-classification rules. I'm placing the block immediately AFTER `</completion-notify>` (commander.ts:209) and BEFORE `<intent-classification priority="HIGH">` (commander.ts:211). Rationale: completion-notify governs the QQ side-channel terminal-state notification; effect-first-reporting governs what the user sees inside the conversation at the same terminal state. Adjacent placement reflects that they are sibling rules covering the same end-of-turn moment. Placing the block here also keeps it before intent-classification (which fires on the FIRST turn) and routing/agents/etc. (which describe ongoing behavior) — order matches "first-turn intent → ongoing routing → end-of-turn report".

**Implementation (prompt-string insertion):**

Open `src/agents/commander.ts`. Find the line containing `</completion-notify>` (currently line 209). Insert a blank line, then the following XML block, then a blank line, BEFORE the existing `<intent-classification priority="HIGH">` line:

```xml
<effect-first-reporting priority="high" description="User-facing terminal-state summary structure">
<purpose>
当主 agent 的一个用户可见工作单元到达终态时（设计完成 / 计划完成 / 实现完成 / 审查完成 / 较大 quick-op 完成），用户最关心的是改动后的实际表现，不是过程产物。本块要求把汇报中心从"我做了什么"切换到"你会看到什么效果，以及怎么验证它"。
</purpose>

<structure description="Default user-facing summary order. Use these section labels verbatim.">
<section name="预期表现">
现在用户会看到 / 触发到的实际行为。一句话或 2-3 个 bullet。说"是什么"不说"我改了哪个文件"。
</section>
<section name="你可以怎么验收">
用户用 2-4 个步骤自己验证。每步是用户可执行的具体动作（打开某页、跑某命令、检查某输出），不是 agent 内部的 verify 脚本。
</section>
<section name="已知限制 / 下一步">
没完成的部分、需要用户手动处理的事、已知边界。没有就明确写"无"。
</section>
<section name="实现记录">
commit hash / 测试命令 / issue / batch / 子任务摘要，压缩为 1-2 行。除非用户明确要求展开，不要把 reviewer 报告原文、子任务表、commit 列表贴在最前面。
</section>
</structure>

<exceptions>
<rule name="blocked">任务 blocked 时，先输出"为什么阻塞"和"用户需要做什么"，再讲已完成的部分。不要先讲已完成的部分让用户去推断什么阻塞了。</rule>
<rule name="failed-stop">任务 failed-stop 时，先输出失败结论和恢复建议，再讲实现记录。</rule>
<rule name="user-asks-process">用户明确要求详细过程（"展开 commit / 测试 / 子任务"）时，可以把"实现记录"展开到正常长度，但仍然保留"预期表现"和"你可以怎么验收"两段在前面。</rule>
<rule name="trivial">纯查询、单行回答、状态查询类任务，可以一句话完成，不强行套完整四段。本块只在终态用户可见汇报中触发，不是每个回合都要套模板。</rule>
</exceptions>

<relationship-to-other-rules>
<rule>本块补充而非替代 completion-notify：QQ 通知是带外短消息（≤200 字符），用户在 OpenCode 里看到的对话回复才是本块作用对象。</rule>
<rule>本块不影响 intent-classification：意图声明仍然在新请求第一回合的最顶端输出，是路由 UX 信号，不是终态汇报。</rule>
<rule>本块不改变 executor / reviewer / planner 等 subagent 的内部详细报告格式；它们仍然返回完整结构化输出。primary agent 在综合给用户时按本块压缩。</rule>
</relationship-to-other-rules>

<anti-patterns>
<anti-pattern>把 commit hash / 测试命令 / batch 编号 / 子任务表放在响应最前面让用户自己读出"现在能干嘛了"。</anti-pattern>
<anti-pattern>用"已完成 N 个 task / N 次 review / N 次 commit"开头汇报。这是过程指标不是效果。</anti-pattern>
<anti-pattern>blocked 时先列已完成的部分，让用户翻到末尾才发现下一步要他做什么。</anti-pattern>
<anti-pattern>把 reviewer 详细报告或 implementer 报告原文贴进 primary 汇报。它们是过程材料，已经在 thoughts / lifecycle issue 里留档。</anti-pattern>
</anti-patterns>
</effect-first-reporting>
```

**Verify:**
```sh
bun run lint
grep -c "<effect-first-reporting" src/agents/commander.ts   # expect 1
grep -c "</effect-first-reporting>" src/agents/commander.ts # expect 1
grep -n "effect-first-reporting" src/agents/commander.ts | head -2
# Sanity: block precedes intent-classification
awk '/<effect-first-reporting/{a=NR} /<intent-classification/{b=NR} END{exit !(a>0 && b>0 && a<b)}' src/agents/commander.ts && echo "order OK"
```

**Commit:** `feat(agents): add effect-first-reporting block to commander prompt`

---

### Task 1.2: Insert effect-first-reporting block in brainstormer.ts
**File:** `src/agents/brainstormer.ts`
**Test:** `tests/agents/effect-first-reporting.test.ts` (added by Task 2.1; drift-guard test in 2.1 enforces byte-identity with commander)
**Depends:** none
**Domain:** general

**Decision (gap-fill from design):** The brainstormer block MUST be byte-identical to the commander block, mirroring the existing drift-guard pattern used by `<specialist-dispatch>` and `<intent-classification>`. Place it directly AFTER the existing `</completion-notify>` line (brainstormer.ts:506) and BEFORE the next existing block. This matches commander's placement (after completion-notify, before intent-classification) so byte-identity holds at both endpoints of the block (no surrounding whitespace difference inside the matched substring; the regex `/<effect-first-reporting[\s\S]*?<\/effect-first-reporting>/` only captures the block itself).

**Implementation (prompt-string insertion):**

Open `src/agents/brainstormer.ts`. Locate the line containing `</completion-notify>` (currently line 506). Insert a blank line, then the SAME XML block as Task 1.1 (verbatim — copy character-for-character from Task 1.1), then a blank line.

The block content is identical to Task 1.1. Do NOT paraphrase or reorder lines. The drift-guard test compares the matched substrings byte-for-byte.

**Verify:**
```sh
bun run lint
grep -c "<effect-first-reporting" src/agents/brainstormer.ts   # expect 1
grep -c "</effect-first-reporting>" src/agents/brainstormer.ts # expect 1
# Quick byte-identity sanity check (the formal test runs in Batch 2)
diff <(awk '/<effect-first-reporting/,/<\/effect-first-reporting>/' src/agents/commander.ts) \
     <(awk '/<effect-first-reporting/,/<\/effect-first-reporting>/' src/agents/brainstormer.ts) \
  && echo "byte-identical OK"
```

**Commit:** `feat(agents): add effect-first-reporting block to brainstormer prompt`

---

### Task 1.3: Insert octto-tailored effect-first-reporting block in octto.ts
**File:** `src/agents/octto.ts`
**Test:** `tests/agents/effect-first-reporting.test.ts` (added by Task 2.1)
**Depends:** none
**Domain:** general

**Decision (gap-fill from design):** Design Open Question explicitly asked whether octto joins. Decision: include octto. Rationale: octto is a third `mode: "primary"` agent (octto.ts:6) and its workflow step 4 (`end_brainstorm` + write design document) ends in a user-visible terminal summary that is the same UX surface the design targets. Excluding it would create a new drift where octto stays process-first while commander/brainstormer go effect-first.

However, octto's role and workflow differ from commander/brainstormer (it is a browser-session host that synthesizes brainstorm branches into a design document). Forcing byte-identity with commander would either water down commander's general-purpose framing or pollute octto's session-specific framing. So: octto gets a SEMANTICALLY ALIGNED block (same four section labels: 预期表现 / 你可以怎么验收 / 已知限制 / 下一步 / 实现记录, same blocked/failed-stop exception) but tailored wording that names octto's actual deliverable (browser-driven design doc).

The drift-guard test in Task 2.1 compares ONLY commander vs brainstormer byte-for-byte; octto is asserted to contain the four section labels and the blocked/failed-stop exceptions, NOT byte-identity.

**Implementation (prompt-string insertion):**

Open `src/agents/octto.ts`. Locate the line containing `</completion-notify>` (currently line 148). Insert a blank line, then the following XML block, then a blank line, BEFORE the existing `<design-document-format>` block (line 150):

```xml
<effect-first-reporting priority="high" description="User-facing terminal-state summary structure">
<purpose>
当 octto 完成一次 brainstorm 会话（end_brainstorm 后向用户汇报设计结果）或中途用户可见 checkpoint 时，用户最关心的是 design 文档说了什么、下一步怎么走，不是分支数量、问题数量、回答数量等过程指标。本块要求 octto 在终态汇报里把中心切换到"你拿到了什么 design 输出、怎么验收它、还有什么没拍板"。
</purpose>

<structure description="Default user-facing summary order. Use these section labels verbatim.">
<section name="预期表现">
设计现在落到了什么结论：架构 / 数据流 / 关键决策一句话或 2-3 个 bullet。说"决定是什么"，不说"分支 N 跑了 M 个问题"。
</section>
<section name="你可以怎么验收">
用户用 2-4 个步骤自己验证设计文档：打开 thoughts/shared/plans/YYYY-MM-DD-{topic}-design.md，检查 problem / findings / recommendation 是否覆盖原始请求；指出文档里 2-3 个最影响后续落地的关键决策让用户确认。
</section>
<section name="已知限制 / 下一步">
brainstorm 没拍板的开放问题、需要用户在进入 planner 前回答的事、已知不在本次设计范围的事。没有就明确写"无"。
</section>
<section name="实现记录">
session_id / 分支数 / 设计文档路径压缩为 1-2 行。除非用户明确要求展开，不要把每个分支的完整 finding 贴在前面（设计文档里已经留档）。
</section>
</structure>

<exceptions>
<rule name="blocked">brainstorm 因 bootstrapper 失败 / 浏览器不可达 / 用户长时间未在浏览器作答而 blocked 时，先输出"为什么阻塞"和"用户需要做什么"（重新打开 URL / 重启 octto / 改走 brainstormer 文本流），再讲已经写出去的部分。</rule>
<rule name="failed-stop">create_brainstorm / await_brainstorm_complete / end_brainstorm 不可恢复失败时，先输出失败结论和恢复建议（例如改走 brainstormer 主入口），再讲 session 元数据。</rule>
<rule name="user-asks-process">用户明确要求展开（"把每个分支的 finding 都贴出来"）时可以展开，但仍然保留"预期表现"和"你可以怎么验收"两段在前面。</rule>
<rule name="trivial">单纯启动 session、单纯回报浏览器 URL 这类中间步骤不是终态，不套模板。</rule>
</exceptions>

<relationship-to-other-rules>
<rule>本块补充而非替代 completion-notify：QQ 通知是带外短消息，用户在 OpenCode 里看到的对话回复才是本块作用对象。</rule>
<rule>本块不替代 design-document-format：design 文档结构（problem / findings / recommendation）由 design-document-format 负责；本块只决定用户在 chat 里看到的"汇报"长什么样。</rule>
<rule>本块不改变 bootstrapper / brainstorm 工具内部返回；它们仍然返回完整结构化输出。octto 在综合给用户时按本块压缩。</rule>
</relationship-to-other-rules>

<anti-patterns>
<anti-pattern>用"跑了 N 个分支 / 收到 M 个回答"开头汇报。这是过程指标，不是设计结论。</anti-pattern>
<anti-pattern>把每个分支的完整 finding 文本贴进 chat 汇报。设计文档里已经留档，chat 应该是"导读"。</anti-pattern>
<anti-pattern>blocked 时先讲已经走过的步骤，让用户自己推断卡在哪一步。</anti-pattern>
</anti-patterns>
</effect-first-reporting>
```

**Verify:**
```sh
bun run lint
grep -c "<effect-first-reporting" src/agents/octto.ts   # expect 1
grep -c "</effect-first-reporting>" src/agents/octto.ts # expect 1
grep -n "效果\|预期表现\|你可以怎么验收\|实现记录" src/agents/octto.ts | head -10
# Block must come BEFORE design-document-format
awk '/<effect-first-reporting/{a=NR} /<design-document-format/{b=NR} END{exit !(a>0 && b>0 && a<b)}' src/agents/octto.ts && echo "order OK"
```

**Commit:** `feat(agents): add octto-tailored effect-first-reporting block`

---

### Task 1.4: Add Effect-First User-Facing Reports section to AGENTS.md
**File:** `AGENTS.md`
**Test:** `tests/agents/effect-first-reporting.test.ts` (added by Task 2.1)
**Depends:** none
**Domain:** general

**Decision (gap-fill from design):** Design says AGENTS.md gets a `## Effect-First User-Facing Reports` section as a single source of truth. Place it AFTER the existing `## User-Triggered Specialist Agents` section (which currently ends with the "Drift guard" subsection at line 36, end-of-file). Append the new section at the end of the file. This puts effect-first reporting as a sibling top-level section to specialist agents and design philosophy, matching the file's existing organization (one top-level `##` per cross-cutting concern).

**Implementation (markdown append):**

Append the following to `AGENTS.md` (after the current EOF):

```markdown

## Effect-First User-Facing Reports

主 agent（commander / brainstormer / octto）在用户可见的终态汇报里，必须把表达中心从"我做了什么"切到"你会看到什么效果，以及怎么验证它"。详细 prompt 规则见 `src/agents/commander.ts`、`src/agents/brainstormer.ts`、`src/agents/octto.ts` 的 `<effect-first-reporting>` block；本节是 markdown 镜像，给后续 prompt 编辑一个单源说明。

### 默认四段结构

终态汇报按以下顺序输出，section 标题用以下中文原文：

1. **预期表现**：用户现在会看到什么行为。1 句话或 2-3 个 bullet，说"是什么"不说"改了哪个文件"。
2. **你可以怎么验收**：用户用 2-4 个步骤自己验证（打开某页 / 跑某命令 / 检查某输出），不是 agent 内部 verify 脚本。
3. **已知限制 / 下一步**：没完成的部分、需要用户手动处理的事、已知边界。没有就写"无"。
4. **实现记录**：commit / 测试 / issue / batch / 子任务等过程产物压缩为 1-2 行。

### Blocked / failed-stop 例外

- **blocked**：先输出"为什么阻塞"和"用户需要做什么"，再讲已完成的部分。不要让用户翻到末尾才发现下一步要他做什么。
- **failed-stop**：先输出失败结论和恢复建议，再讲过程产物。

### 何时不强行套模板

- 纯查询 / 状态查询 / 单行回答类任务可以一句话完成。
- 中间 checkpoint（不是终态）不需要套四段；只在用户可见的终态汇报触发。
- 用户明确要求"展开 commit / 测试 / 子任务"时，"实现记录"段可以展开到正常长度，但"预期表现"和"你可以怎么验收"仍然在前。

### 与其它规则的关系

- **不替代 completion-notify (QQ)**：QQ 是带外 ≤200 字符短消息；本节作用对象是 OpenCode 对话里的回复内容。
- **不替代 intent-classification**：新请求第一回合"意图: ..."声明仍然写在响应顶端，是 UX 路由信号，不是终态汇报。
- **不改变 executor / reviewer / planner 等 subagent 的内部报告格式**：subagent 仍然返回完整结构化输出，primary agent 在综合给用户时按本节压缩。

### Drift guard

`commander.ts` 与 `brainstormer.ts` 的 `<effect-first-reporting>` block 互为单源，必须 byte-identical（由 `tests/agents/effect-first-reporting.test.ts` 强制）。`octto.ts` 因 workflow 不同使用语义对齐但措辞贴合 octto 角色的版本，drift-guard 不强制 byte-identity，但仍然检查四个 section 标题和 blocked / failed-stop 例外存在。本节是 markdown 镜像，命名和段落顺序需保持一致。
```

**Verify:**
```sh
grep -n "## Effect-First User-Facing Reports" AGENTS.md   # expect 1 hit
grep -c "预期表现\|你可以怎么验收\|已知限制\|实现记录" AGENTS.md  # expect >= 4
grep -c "blocked\|failed-stop" AGENTS.md  # expect >= 2
```

**Commit:** `docs(agents): add Effect-First User-Facing Reports section to AGENTS.md`

---

## Batch 2: Unified prompt-source test (sequential - 1 implementer)

This batch depends on Batch 1 completing.
Tasks: 2.1

### Task 2.1: Add focused tests for effect-first-reporting across all four artifacts
**File:** `tests/agents/effect-first-reporting.test.ts`
**Test:** N/A (this IS the test file; it consumes Tasks 1.1–1.4 outputs)
**Depends:** 1.1, 1.2, 1.3, 1.4
**Domain:** general

**Decision (gap-fill from design):** Design Testing Strategy says: "Prompt source tests check commander/brainstormer contain effect-first block, AGENTS.md test checks the project-local rule, optional drift test for byte-identity between the two primary blocks." I'm consolidating all assertions into ONE focused test file (`effect-first-reporting.test.ts`) instead of scattering across four test files, mirroring the existing pattern of `tests/agents/specialist-routing.test.ts` and `tests/agents/specialist-agents-md.test.ts` (one cross-artifact concern → one test file). This keeps the assertion surface for the rule in a single place and matches the project convention.

Test groups:

1. **commander effect-first block presence and structure.**
2. **brainstormer effect-first block presence and structure.**
3. **octto effect-first block presence and structure (octto-tailored, not byte-identical).**
4. **AGENTS.md `## Effect-First User-Facing Reports` section presence and structure.**
5. **Drift guard:** commander vs brainstormer byte-identity for the block.
6. **Octto semantic alignment:** octto block contains the four section labels and blocked / failed-stop exceptions, but is NOT asserted to be byte-identical to commander.

**Implementation:**

Create new file `tests/agents/effect-first-reporting.test.ts`:

```ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const COMMANDER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "commander.ts"), "utf-8");
const BRAINSTORMER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"), "utf-8");
const OCTTO_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "octto.ts"), "utf-8");
const AGENTS_MD = readFileSync(join(__dirname, "..", "..", "AGENTS.md"), "utf-8");

const SECTION_LABELS = ["预期表现", "你可以怎么验收", "已知限制", "实现记录"] as const;
const EXCEPTION_KEYS = ["blocked", "failed-stop"] as const;

const PRIMARIES_WITH_BLOCK = [
  { name: "commander", source: COMMANDER_SOURCE },
  { name: "brainstormer", source: BRAINSTORMER_SOURCE },
  { name: "octto", source: OCTTO_SOURCE },
] as const;

describe("effect-first-reporting prompt block", () => {
  for (const agent of PRIMARIES_WITH_BLOCK) {
    describe(agent.name, () => {
      it("declares exactly one <effect-first-reporting> block", () => {
        const opens = agent.source.match(/<effect-first-reporting[\s>]/g) ?? [];
        const closes = agent.source.match(/<\/effect-first-reporting>/g) ?? [];
        expect(opens).toHaveLength(1);
        expect(closes).toHaveLength(1);
      });

      it("contains all four section labels verbatim", () => {
        const block = agent.source.match(/<effect-first-reporting[\s\S]*?<\/effect-first-reporting>/);
        expect(block).not.toBeNull();
        const body = block?.[0] ?? "";
        for (const label of SECTION_LABELS) {
          expect(body).toContain(label);
        }
      });

      it("declares blocked and failed-stop exception rules", () => {
        const block = agent.source.match(/<effect-first-reporting[\s\S]*?<\/effect-first-reporting>/);
        expect(block).not.toBeNull();
        const body = block?.[0] ?? "";
        for (const key of EXCEPTION_KEYS) {
          expect(body).toContain(key);
        }
      });

      it("explicitly does NOT replace completion-notify or intent-classification", () => {
        const block = agent.source.match(/<effect-first-reporting[\s\S]*?<\/effect-first-reporting>/);
        expect(block).not.toBeNull();
        const body = (block?.[0] ?? "").toLowerCase();
        // Block must clarify it supplements rather than replaces existing rules.
        expect(body).toMatch(/补充|不替代|supplement|does not replace/i);
      });
    });
  }

  describe("placement (commander)", () => {
    it("commander block is placed AFTER </completion-notify> and BEFORE <intent-classification>", () => {
      const completionEnd = COMMANDER_SOURCE.indexOf("</completion-notify>");
      const blockOpen = COMMANDER_SOURCE.search(/<effect-first-reporting[\s>]/);
      const intentOpen = COMMANDER_SOURCE.search(/<intent-classification[\s>]/);

      expect(completionEnd).toBeGreaterThan(-1);
      expect(blockOpen).toBeGreaterThan(-1);
      expect(intentOpen).toBeGreaterThan(-1);

      expect(blockOpen).toBeGreaterThan(completionEnd);
      expect(blockOpen).toBeLessThan(intentOpen);
    });
  });

  describe("placement (brainstormer)", () => {
    it("brainstormer block is placed AFTER </completion-notify>", () => {
      const completionEnd = BRAINSTORMER_SOURCE.indexOf("</completion-notify>");
      const blockOpen = BRAINSTORMER_SOURCE.search(/<effect-first-reporting[\s>]/);
      expect(completionEnd).toBeGreaterThan(-1);
      expect(blockOpen).toBeGreaterThan(-1);
      expect(blockOpen).toBeGreaterThan(completionEnd);
    });
  });

  describe("placement (octto)", () => {
    it("octto block is placed AFTER </completion-notify> and BEFORE <design-document-format>", () => {
      const completionEnd = OCTTO_SOURCE.indexOf("</completion-notify>");
      const blockOpen = OCTTO_SOURCE.search(/<effect-first-reporting[\s>]/);
      const designOpen = OCTTO_SOURCE.search(/<design-document-format[\s>]/);

      expect(completionEnd).toBeGreaterThan(-1);
      expect(blockOpen).toBeGreaterThan(-1);
      expect(designOpen).toBeGreaterThan(-1);

      expect(blockOpen).toBeGreaterThan(completionEnd);
      expect(blockOpen).toBeLessThan(designOpen);
    });
  });

  describe("drift guard", () => {
    it("commander and brainstormer effect-first blocks are byte-identical", () => {
      const commanderBlock = COMMANDER_SOURCE.match(/<effect-first-reporting[\s\S]*?<\/effect-first-reporting>/);
      const brainstormerBlock = BRAINSTORMER_SOURCE.match(/<effect-first-reporting[\s\S]*?<\/effect-first-reporting>/);

      expect(commanderBlock).not.toBeNull();
      expect(brainstormerBlock).not.toBeNull();
      expect(commanderBlock?.[0]).toBe(brainstormerBlock?.[0]);
    });

    it("octto block is semantically aligned but NOT required to be byte-identical to commander", () => {
      // Sanity: octto is intentionally tailored (mentions brainstorm session
      // semantics like end_brainstorm / design document path). It must NOT be
      // byte-identical to commander; if a future edit collapses them, this
      // test forces a deliberate decision.
      const commanderBlock = COMMANDER_SOURCE.match(/<effect-first-reporting[\s\S]*?<\/effect-first-reporting>/);
      const octtoBlock = OCTTO_SOURCE.match(/<effect-first-reporting[\s\S]*?<\/effect-first-reporting>/);

      expect(commanderBlock).not.toBeNull();
      expect(octtoBlock).not.toBeNull();
      expect(octtoBlock?.[0]).not.toBe(commanderBlock?.[0]);

      // But octto MUST mention its workflow-specific terms, otherwise it has
      // drifted into a generic copy.
      const octtoBody = octtoBlock?.[0] ?? "";
      expect(octtoBody).toMatch(/brainstorm|end_brainstorm|design.{0,20}文档|session/i);
    });
  });

  describe("AGENTS.md mirror", () => {
    it("declares the section heading", () => {
      expect(AGENTS_MD).toMatch(/##\s+Effect-First User-Facing Reports/);
    });

    it("contains all four section labels verbatim", () => {
      for (const label of SECTION_LABELS) {
        expect(AGENTS_MD).toContain(label);
      }
    });

    it("declares blocked and failed-stop exceptions", () => {
      expect(AGENTS_MD).toContain("blocked");
      expect(AGENTS_MD).toContain("failed-stop");
    });

    it("clarifies it does NOT replace completion-notify or intent-classification", () => {
      const lower = AGENTS_MD.toLowerCase();
      expect(lower).toMatch(/不替代\s*completion-?notify|does not replace.*completion-?notify/);
      expect(lower).toMatch(/不替代\s*intent-?classification|does not replace.*intent-?classification/);
    });

    it("declares the drift-guard relationship between commander, brainstormer, and octto", () => {
      // Section must explain that commander and brainstormer are byte-identical,
      // octto is semantically aligned only.
      expect(AGENTS_MD).toMatch(/byte-identical/i);
      expect(AGENTS_MD).toContain("octto");
      expect(AGENTS_MD).toMatch(/effect-first-reporting/i);
    });
  });
});
```

**Verify:**
```sh
bun test tests/agents/effect-first-reporting.test.ts
bun run lint
# Sanity: no other test file should already declare effect-first-reporting
grep -rn "effect-first-reporting" tests/ | grep -v "effect-first-reporting.test.ts" | head -5  # expect empty
```

**Commit:** `test(agents): cover effect-first-reporting across commander, brainstormer, octto, and AGENTS.md`
