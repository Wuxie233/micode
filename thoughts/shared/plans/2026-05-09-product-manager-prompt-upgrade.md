---
date: 2026-05-09
topic: "Product Manager Prompt Upgrade"
issue: 57
scope: agents
contract: none
---

# Product Manager Prompt Upgrade Implementation Plan

**Goal:** Upgrade `productManagerAgent` prompt from "PRD template generator" to "professional product manager judgment" (problem framing, stakeholders, success metrics, scope boundary, risks/assumptions, decision recommendation) without breaking any existing read-only / user-triggered / non-overlap / 3-question / A-E constraints.

**Architecture:** Single-file prompt edit in `src/agents/product-manager.ts`. No new agent, no registry change, no tool change, no coordinator change. Test file `tests/agents/product-manager.test.ts` is extended with 7 new assertions covering the upgraded sections; all 11 existing assertions remain. AGENTS.md mirror line for `product-manager` is updated to reflect PM judgment language.

**Design:** [thoughts/shared/designs/2026-05-09-product-manager-prompt-upgrade-design.md](../designs/2026-05-09-product-manager-prompt-upgrade-design.md)

**Contract:** none (single-domain plan; only `general` tasks touching prompt text + test text + docs)

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2 [test additions + AGENTS.md mirror — both red/independent of impl]
Batch 2 (sequential): 2.1 [prompt upgrade — turns red tests green; depends on 1.1]
Batch 3 (sequential): 3.1 [full test suite + typecheck verification — depends on 2.1]
```

TDD order: test additions land first and fail (Batch 1.1 alone is red). Implementation in Batch 2 turns them green. Batch 3 confirms no regression in the broader test suite. Batch 1.2 (AGENTS.md mirror) is independent of impl so it parallelizes with the test edit.

---

## Batch 1: Test Additions + Docs Mirror (parallel — 2 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2

### Task 1.1: Extend product-manager test file with upgrade assertions
**File:** `tests/agents/product-manager.test.ts`
**Test:** self (this IS the test file; no separate test of the test file)
**Depends:** none
**Domain:** general

This task adds 7 new `it(...)` blocks to the existing `describe("product-manager agent", ...)` suite. ALL 11 existing assertions MUST remain intact and unchanged — the upgrade is additive. After this task lands and before Task 2.1 runs, the new assertions will fail (red). That is the intended TDD signal.

Replace the entire file contents with the following copy-paste-ready text:

```typescript
import { describe, expect, it } from "bun:test";

import { productManagerAgent } from "../../src/agents/product-manager";

describe("product-manager agent", () => {
  it("is a subagent with read-only tool restrictions", () => {
    expect(productManagerAgent.mode).toBe("subagent");
    expect(productManagerAgent.tools?.write).toBe(false);
    expect(productManagerAgent.tools?.edit).toBe(false);
    expect(productManagerAgent.tools?.bash).toBe(false);
    expect(productManagerAgent.tools?.task).toBe(false);
  });

  it("uses a low temperature for disciplined PRD output", () => {
    expect(productManagerAgent.temperature).toBeLessThanOrEqual(0.3);
  });

  it("describes itself as a read-only product manager specialist", () => {
    const description = (productManagerAgent.description ?? "").toLowerCase();
    expect(description).toContain("read-only");
    expect(description).toContain("product");
  });

  it("declares the micode subagent environment", () => {
    const prompt = productManagerAgent.prompt ?? "";
    expect(prompt).toContain("micode");
    expect(prompt).toContain("SUBAGENT");
  });

  it("prompt forbids mutation, commits, deploys, restarts, and file edits", () => {
    const lower = (productManagerAgent.prompt ?? "").toLowerCase();
    expect(lower).toContain("never");
    expect(lower).toContain("commit");
    expect(lower).toContain("deploy");
    expect(lower).toContain("restart");
    expect(lower).toContain("read-only");
  });

  it("prompt caps clarifying questions at 3 and requires recommended defaults", () => {
    const prompt = productManagerAgent.prompt ?? "";
    expect(prompt).toMatch(/\b3\b/);
    expect(prompt.toLowerCase()).toContain("default");
  });

  it("prompt declares A/B/C/D/E option discipline with D=custom and E=auto", () => {
    const prompt = productManagerAgent.prompt ?? "";
    expect(prompt).toContain("A");
    expect(prompt).toContain("B");
    expect(prompt).toContain("C");
    expect(prompt).toContain("D");
    expect(prompt).toContain("E");
    const lower = prompt.toLowerCase();
    expect(lower).toMatch(/d[^a-z0-9]{0,8}(custom|自定义)/);
    expect(lower).toMatch(/e[^a-z0-9]{0,8}(auto|自动)/);
  });

  it("prompt requires PRD output with user stories, Given/When/Then, and Non-Goals", () => {
    const prompt = productManagerAgent.prompt ?? "";
    expect(prompt).toContain("PRD");
    expect(prompt.toLowerCase()).toContain("user stor");
    expect(prompt).toContain("Given");
    expect(prompt).toContain("When");
    expect(prompt).toContain("Then");
    expect(prompt).toContain("Non-Goals");
  });

  it("prompt forbids overlap with planner, executor, brainstormer", () => {
    const lower = (productManagerAgent.prompt ?? "").toLowerCase();
    expect(lower).toContain("not the planner");
    expect(lower).toContain("not the executor");
    expect(lower).toContain("not the brainstormer");
  });

  it("prompt declares user-triggered semantics", () => {
    const lower = (productManagerAgent.prompt ?? "").toLowerCase();
    expect(lower).toContain("user-triggered");
  });

  // ---- Upgrade assertions (issue #57) ----

  it("prompt anchors product-manager as a professional PM, not a template", () => {
    const prompt = productManagerAgent.prompt ?? "";
    const lower = prompt.toLowerCase();
    expect(lower).toContain("professional");
    expect(lower).toContain("product manager");
    // The 6 PM judgment dimensions called out in <purpose> / <pm-judgment>
    expect(lower).toContain("problem framing");
    expect(lower).toContain("stakeholder");
    expect(lower).toContain("success");
    expect(lower).toContain("scope");
    expect(lower).toContain("risk");
    expect(lower).toContain("recommendation");
  });

  it("prompt PRD requires Problem/Opportunity, Stakeholders, Success Metrics sections", () => {
    const prompt = productManagerAgent.prompt ?? "";
    // Problem/Opportunity heading
    expect(prompt).toMatch(/Problem\s*\/?\s*Opportunity|Problem & Opportunity/);
    // Stakeholders heading (case-sensitive PRD section header)
    expect(prompt).toContain("Stakeholders");
    // Success Metrics heading
    expect(prompt).toMatch(/Success Metric/);
  });

  it("prompt PRD requires explicit Scope Boundary with In Scope / Out of Scope", () => {
    const prompt = productManagerAgent.prompt ?? "";
    expect(prompt).toContain("Scope Boundary");
    expect(prompt).toContain("In Scope");
    expect(prompt).toContain("Out of Scope");
  });

  it("prompt PRD requires Risks & Assumptions section", () => {
    const prompt = productManagerAgent.prompt ?? "";
    expect(prompt).toContain("Risks");
    expect(prompt).toContain("Assumptions");
  });

  it("prompt PRD requires mandatory Decision Recommendation with three outcomes", () => {
    const prompt = productManagerAgent.prompt ?? "";
    expect(prompt).toContain("Decision Recommendation");
    const lower = prompt.toLowerCase();
    expect(lower).toContain("build as proposed");
    expect(lower).toContain("build with adjustments");
    // "do not build" or "defer" — accept either since design lists both
    expect(lower).toMatch(/do not build|defer/);
  });

  it("prompt has evidence discipline: cite source or mark Cannot Assess", () => {
    const prompt = productManagerAgent.prompt ?? "";
    const lower = prompt.toLowerCase();
    expect(lower).toMatch(/evidence|证据/);
    expect(prompt).toContain("Cannot Assess");
  });

  it("prompt forbids omitting Decision Recommendation in never-do block", () => {
    const prompt = productManagerAgent.prompt ?? "";
    // The never-do block must explicitly forbid omitting Decision Recommendation.
    // Match within ~120 chars after a NEVER keyword to ensure the forbid is bound to "Decision Recommendation".
    expect(prompt).toMatch(/NEVER[^\n]{0,120}Decision Recommendation/);
  });
});
```

**Verify:** `bun test tests/agents/product-manager.test.ts` — expected: 11 existing tests pass, 7 new tests fail (red). This is the intended pre-Batch-2 state. DO NOT proceed to Batch 2 commit until red is observed; that confirms the assertions are actually exercising the prompt rather than passing vacuously.
**Commit:** `test(agents): add product-manager prompt upgrade assertions`

---

### Task 1.2: Update AGENTS.md product-manager mirror line
**File:** `AGENTS.md`
**Test:** none (docs-only mirror; `tests/agents/specialist-agents-md.test.ts` only asserts the agent id string `product-manager` and section-level invariants, not the description text — verified at design time)
**Depends:** none
**Domain:** general

Update only the `product-manager` row in the `## User-Triggered Specialist Agents` table to reflect PM judgment language. Do NOT change column ordering, do NOT change the agent id, do NOT change the Chinese role label `产品经理`, do NOT touch any other row.

Use Edit tool with this exact replacement:

oldString:
```
| `product-manager` | 产品经理 | 需求模糊时把请求收敛成 PRD（用户故事 / Given-When-Then / Non-Goals）。最多 3 个澄清问题，每个带 A/B/C/D/E 选项与推荐默认。 |
```

newString:
```
| `product-manager` | 产品经理 | 需求模糊时用产品经理判断把请求收敛成 PRD：问题框定（Problem/Opportunity）、利益相关者、成功度量、范围边界（In/Out of Scope）、风险与假设、决策建议（build / build with adjustments / do not build 或 defer），保留 user stories 与 Given-When-Then 验收。最多 3 个澄清问题，每个带 A/B/C/D/E 选项与推荐默认；证据不足处显式 Cannot Assess。 |
```

Rationale for keeping it on one line: matches the format of all other specialist rows in the same table; markdown table renderers handle long single cells. This avoids restructuring the table and minimizes drift surface.

**Verify:** `bun test tests/agents/specialist-agents-md.test.ts` — all assertions still pass (none are tied to the description text).
**Commit:** `docs(agents): update AGENTS.md product-manager row to reflect PM judgment`

---

## Batch 2: Prompt Upgrade Implementation (sequential — 1 implementer)

All tasks in this batch depend on Batch 1.1 completing (the new red tests must exist so this task can turn them green).
Tasks: 2.1

### Task 2.1: Upgrade product-manager.ts prompt with PM judgment sections
**File:** `src/agents/product-manager.ts`
**Test:** `tests/agents/product-manager.test.ts` (extended in Task 1.1)
**Depends:** 1.1 (TDD: red tests must exist first so we can verify green transition)
**Domain:** general

Replace the entire file with the following copy-paste-ready content. Structural changes from current:

1. `description` field updated to mention PM judgment + still contains `read-only` and `product` (existing description test).
2. `<purpose>` section rewritten to anchor as professional PM with 6 judgment dimensions.
3. NEW `<pm-judgment>` section after `<user-triggered>`.
4. `<question-discipline>` augmented with "prefer PM-critical ambiguities".
5. `<output-format>` `<prd-block>` expanded with 6 new mandatory sections (Problem/Opportunity, Stakeholders, Success Metrics, Scope Boundary, Risks & Assumptions, Decision Recommendation) BEFORE User Stories. Non-Goals retained inside Scope Boundary's Out of Scope subsection AND as a backwards-compatible standalone bullet keyword (so existing `Non-Goals` test still passes).
6. NEW `<evidence-discipline>` section.
7. `<never-do>` extended with `NEVER omit Decision Recommendation`.
8. `tools`, `mode`, `temperature` UNCHANGED.

```typescript
import type { AgentConfig } from "@opencode-ai/sdk";

export const productManagerAgent: AgentConfig = {
  description:
    "Read-only professional product manager specialist: applies PM judgment (problem framing, stakeholders, success metrics, scope, risks, recommendation) and emits an enriched PRD with at most 3 clarifying questions (A/B/C/D/E + recommended defaults). User-triggered only.",
  mode: "subagent",
  temperature: 0.2,
  tools: {
    write: false,
    edit: false,
    bash: false,
    task: false,
  },
  prompt: `<environment>
You are running as part of the "micode" OpenCode plugin (NOT Claude Code).
You are a SUBAGENT for read-only product requirement clarification with professional product manager judgment.
</environment>

<purpose>
You are a professional product manager. The user (via the coordinator) summons you when a request is fuzzy and needs product judgment before brainstormer / planner can do their job. Your output is a PRD, but PRD is the artifact, not the goal. The goal is to apply six PM judgment dimensions to the request:

1. Problem framing — what real problem is behind this request, why now
2. Stakeholders — who asked, who is affected, who validates
3. Success metrics — how we will know it worked, in observable terms
4. Scope boundary — what is in, what is out, where the edges are
5. Risks and assumptions — what could go wrong, what we are betting on
6. Decision recommendation — should we build as proposed, build with adjustments, or not build / defer, with one-line rationale

You are a decision aid, not a decision maker. The user retains the final call. But a professional PM still gives a recommendation.
</purpose>

<not-this-role>
<rule>You are NOT the planner. You do not produce implementation plans, task batches, or file paths.</rule>
<rule>You are NOT the executor. You do not implement, mutate, commit, deploy, or restart.</rule>
<rule>You are NOT the brainstormer. You do not run multi-round design exploration; you converge to a PRD in one round.</rule>
<rule>You are NOT a generic read-only fallback. You exist for product requirement clarification with PM judgment.</rule>
</not-this-role>

<hard-restrictions>
<rule>NEVER write or edit files. NEVER call commit, push, merge, deploy, restart, or any side-effecting operation.</rule>
<rule>NEVER perform a mutation. You are strictly read-only.</rule>
<rule>You do not have shell access. If a clarification needs runtime evidence, mark it CANNOT_ASSESS, do not invent.</rule>
</hard-restrictions>

<user-triggered priority="critical">
You are spawned only when the user explicitly asks for a product manager (例如: "派产品经理", "上 PM", "summon product manager"). The coordinator never auto-spawns you. If the request you receive is not a product / requirement clarification request, output one line ("Out of scope for product-manager. Suggest: <other-specialist or main agent>.") and stop.
</user-triggered>

<pm-judgment priority="critical">
Before you write a single line of PRD, run these PM thinking prompts in your head:

- Problem framing: "What problem is behind this request? Is the user describing a symptom or a cause? Is there a stated user, or is it implied?"
- Stakeholders: "Who asked for this? Who else is affected (positively or negatively)? Who validates the result? Are any of them missing from the request?"
- Success metrics: "If we ship this and walk away, how do we know it worked? Is the success observable, user-perceivable, or measurable?"
- Scope boundary: "What part of this request is core? What is adjacent and tempting but should be deferred? Where does this PRD end?"
- Risks and assumptions: "What am I assuming that could be wrong? What execution risk, user acceptance risk, dependency risk, unknown am I aware of?"
- Decision recommendation: "Given everything above, would I tell my engineering lead to build this as proposed, build it with adjustments, or not build it / defer it? Why in one line?"

These six dimensions feed directly into the PRD sections. If a dimension has no evidence in the user message or referenced design / plan / issue, do NOT invent — list it under Cannot Assess and reflect that uncertainty in your Decision Recommendation rationale.
</pm-judgment>

<question-discipline priority="critical">
<rule>Ask at most 3 clarifying questions in one batch. Never more. Fewer is better when the request is already clear.</rule>
<rule>Every question MUST come with a recommended default that you would pick if the user does not answer.</rule>
<rule>Every question MUST list options A / B / C / D / E where:
  - A, B, C are concrete, distinct candidate answers tailored to the request
  - D is "自定义 / custom" (user types their own answer)
  - E is "自动 / auto" (you pick the recommended default and proceed)
</rule>
<rule>If the user replies with E (auto) or does not reply, proceed using your recommended defaults. Do not block.</rule>
<rule>If the request is already unambiguous, skip questions entirely and emit the PRD directly.</rule>
<rule priority="critical">When choosing which ambiguities to ask about, prefer PM-critical dimensions: problem framing, primary stakeholder, success metric, scope boundary. Skip implementation-detail ambiguities (those belong to brainstormer / planner). A 3-question budget spent on shallow details is a wasted PM round.</rule>
</question-discipline>

<process>
<step>Read the user's request and any referenced design / plan / lifecycle issue text.</step>
<step>Run the six pm-judgment prompts internally. Mark each dimension as "have evidence" or "Cannot Assess".</step>
<step>Identify the smallest set of PM-critical ambiguities (max 3) that materially change the PRD. Drop ambiguities that don't.</step>
<step>If any ambiguities remain, emit the questions block (A/B/C/D/E with recommended defaults) and stop, waiting for user input.</step>
<step>If no ambiguities remain (or the user already chose), emit the PRD in the format below.</step>
</process>

<output-format>
<questions-block description="Used only when clarification is needed. Otherwise skip directly to the PRD.">
## Clarifying Questions ([N]/3)

### Q1: [one-sentence question — preferably about problem framing / stakeholder / success metric / scope]
- A: [concrete option]
- B: [concrete option]
- C: [concrete option]
- D: 自定义 / custom — describe your own answer
- E: 自动 / auto — accept my recommended default ([letter])
- Recommended default: [A | B | C] — [one-line rationale]

(Repeat Q2, Q3 only if truly needed.)
</questions-block>

<prd-block description="Final output once requirement is clear. ALL sections below marked mandatory must appear.">
## PRD: [one-line product summary]

_Generated [using recommended defaults | after user clarification]; awaiting user confirmation._

### Problem / Opportunity (mandatory)
[One paragraph: what problem is behind this request, why now, what changes if we do nothing. If evidence is thin, name what is missing here and reflect in Cannot Assess.]

### Stakeholders (mandatory)
- Requester: [who asked]
- Affected: [who experiences the change]
- Validator: [who confirms it worked]
- (At least 1 entry. Use Cannot Assess if a role is unknown rather than inventing one.)

### Success Metrics (mandatory)
- [At least 1 observable metric: behavioral, user-perceivable, or statistical. Each metric must be checkable without re-interviewing the user.]

### Scope Boundary (mandatory)
- In Scope:
  - [bullet]
  - [bullet]
- Out of Scope (Non-Goals):
  - [bullet]
  - [bullet]
- (At least 2 entries on each side. The Out of Scope list IS the Non-Goals list — they are the same concept.)

### Risks & Assumptions (mandatory)
- Risk / Assumption: [statement] — Why it matters: [one line]
- (At least 2 entries combined. Include execution risk, user acceptance, dependencies, or unknowns.)

### Decision Recommendation (mandatory)
**Recommendation:** [build as proposed | build with adjustments | do not build / defer]
**Rationale:** [one line tying back to Problem / Stakeholders / Success / Risks above]
(If "build with adjustments", list the key adjustments as 1-3 bullets. If "do not build / defer", list the trigger condition that would change the recommendation.)

### User Stories
- As a [user persona], I want to [capability], so that [outcome].
- (3-5 stories total. Each must name a concrete persona and outcome.)

### Acceptance Criteria (Given/When/Then)
- Given [precondition], When [action], Then [observable outcome].
- (One Given/When/Then per user story. Be specific enough to test.)

### Cannot Assess
[Optional. List items where evidence was insufficient to make a confident PM call (per dimension: problem / stakeholder / metric / scope / risk / recommendation). Each entry: what is unknown, what evidence would resolve it.]
</prd-block>
</output-format>

<evidence-discipline priority="critical">
Every claim in the PRD — stakeholder, success metric, risk, recommendation, persona — must trace to one of three evidence sources:

1. The user's message text (quote the relevant phrase or paraphrase faithfully).
2. A referenced design / plan / lifecycle issue / file the user pointed at (cite path or doc title).
3. Coordinator-provided context passed into your subagent prompt.

If a claim has none of the three, you have two and only two options: list the gap under Cannot Assess, OR ask one of your ≤3 clarifying questions about it. NEVER invent a stakeholder, metric, risk, or recommendation rationale. Decision Recommendation is still mandatory even when evidence is thin — but in that case the rationale must be honest ("evidence insufficient on success metric and primary stakeholder; recommending defer until at least one is clarified").
</evidence-discipline>

<rules>
<rule>Cite evidence for any claim about existing behavior: file:line, design doc path, or quoted user message. No undeclared assumptions.</rule>
<rule>Keep the PRD short. The reader (coordinator + user) is converging, not designing. Brainstormer and planner will expand it.</rule>
<rule>Do not invent personas the user did not mention. If a persona is unclear, that is a clarifying question or a Cannot Assess entry, not a fabrication.</rule>
<rule>Stay strictly within product / requirement scope. If the request is really an architecture, UX, quality, or scoring question, redirect to the corresponding specialist.</rule>
</rules>

<autonomy-rules>
<rule>You are a SUBAGENT — complete the PRD without asking the coordinator for confirmation.</rule>
<rule>NEVER ask "should I include a story for X?" — include it with rationale, or omit it with rationale.</rule>
<rule>NEVER ask the coordinator to choose between options — you ask the USER once via the questions block, then proceed.</rule>
</autonomy-rules>

<never-do>
<forbidden>NEVER write, edit, commit, push, deploy, restart, or mutate anything.</forbidden>
<forbidden>NEVER produce an implementation plan — that is the planner's job.</forbidden>
<forbidden>NEVER produce a code patch — that is the implementer's job.</forbidden>
<forbidden>NEVER ask more than 3 clarifying questions in one round.</forbidden>
<forbidden>NEVER omit recommended defaults from questions — every question must have one.</forbidden>
<forbidden>NEVER omit Non-Goals from the PRD — they are mandatory scope-creep guards (rendered as the Out of Scope half of Scope Boundary).</forbidden>
<forbidden>NEVER omit Decision Recommendation — a PRD without a PM recommendation is not a delivered PRD. If evidence is thin, recommend defer with an honest rationale; do not silently skip the section.</forbidden>
<forbidden>NEVER invent stakeholders, success metrics, risks, or persona details that have no basis in the user message, referenced docs, or coordinator context. Use Cannot Assess instead.</forbidden>
</never-do>`,
};
```

Implementation notes baked into the rewrite:

- The phrase `Non-Goals` still appears literally in `<never-do>` (forbidden block) so the existing test `expect(prompt).toContain("Non-Goals")` continues to pass even though Non-Goals is now structurally inside Scope Boundary's Out of Scope half.
- All six lowercase dimension keywords (`problem framing`, `stakeholder`, `success`, `scope`, `risk`, `recommendation`) appear in `<purpose>` and `<pm-judgment>`, satisfying the new `prompt anchors product-manager as a professional PM` test.
- `Problem / Opportunity` is rendered with the `/` so the regex `/Problem\s*\/?\s*Opportunity/` matches.
- `Decision Recommendation` is mentioned in `<output-format>`, `<pm-judgment>`, AND `<never-do>` — satisfying both the section-presence test and the regex `/NEVER[^\n]{0,120}Decision Recommendation/`.
- `In Scope` and `Out of Scope` appear in the Scope Boundary section.
- `Risks` and `Assumptions` both appear in the Risks & Assumptions header.
- The three Decision Recommendation outcomes (`build as proposed`, `build with adjustments`, `do not build` / `defer`) are emitted exactly in the recommendation line.
- `Cannot Assess` and `evidence` both appear (the latter in `<evidence-discipline>` heading and prose).
- Existing `<not-this-role>`, `<hard-restrictions>`, `<user-triggered>`, A/B/C/D/E discipline, `Given/When/Then`, `read-only`, `commit`, `deploy`, `restart` keywords are all preserved verbatim or in equivalent form, satisfying every existing assertion.

**Verify:** `bun test tests/agents/product-manager.test.ts` — all 18 tests must pass (11 existing + 7 new). If any existing test fails, the rewrite broke a constraint and must be fixed before commit.
**Commit:** `feat(agents): upgrade product-manager prompt with professional PM judgment`

---

## Batch 3: Full Test Suite + Type Check (sequential — 1 implementer)

All tasks in this batch depend on Batch 2 completing.
Tasks: 3.1

### Task 3.1: Run full bun test + tsc to confirm no regressions
**File:** none (verification-only task; runs commands and reports)
**Test:** none (this IS the verification step)
**Depends:** 2.1
**Domain:** general

Run these two commands sequentially. Both must pass before the lifecycle is considered ready for finish. No file modification happens in this task.

1. `bun test` — full project test suite. Confirms:
   - `tests/agents/product-manager.test.ts` all 18 tests pass.
   - `tests/agents/specialist-routing.test.ts` byte-identity drift guard between `commander.ts` and `brainstormer.ts` `<specialist-dispatch>` blocks still passes (we did not touch those files).
   - `tests/agents/specialist-agents-md.test.ts` AGENTS.md mirror invariants still pass (the `product-manager` id string still appears; section headers and rules unchanged).
   - All other test files unaffected.

2. `bunx tsc --noEmit` (or whatever the project's typecheck command is — check `package.json` `scripts.typecheck` first; fall back to `bunx tsc --noEmit` only if no script exists). This catches any accidental TypeScript regression in `src/agents/product-manager.ts` (e.g., the `description` field type, the `AgentConfig` import, template-literal escaping inside the prompt).

If either command fails, do NOT commit. Report the failure to the executor for diagnosis. Likely failure modes and fixes:

- `tests/agents/product-manager.test.ts` test fails with "expected to contain X" — the prompt rewrite missed a keyword. Fix the prompt, re-run.
- `tests/agents/specialist-routing.test.ts` fails — somehow `commander.ts` or `brainstormer.ts` got modified. Revert those changes; this plan does not touch them.
- `bunx tsc --noEmit` fails with parse error in product-manager.ts — likely an unescaped backtick or `${` inside the template literal prompt. Inspect the prompt body for those characters. The new prompt as written contains none, but be alert.

**Verify:** both commands exit 0.
**Commit:** none (this batch is verification; commits already happened in batches 1 and 2). After this batch passes, hand off to lifecycle_finish.
