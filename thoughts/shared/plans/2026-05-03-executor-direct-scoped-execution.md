---
date: 2026-05-03
topic: "Executor Direct for No-Plan Scoped Execution"
issue: 25
scope: agents
contract: none
---

# Executor Direct Implementation Plan

**Goal:** Add a new `executor-direct` subagent for no-plan scoped direct execution while keeping the existing `executor` as the plan-driven dispatcher and pinning `executor-direct` to Claude Sonnet 4.6 in active host config.

**Architecture:** Add a single new subagent file (`src/agents/executor-direct.ts`) that owns scoped direct execution with write/edit/bash but no `task` / `spawn_agent` so it cannot become a dispatcher. Harden existing `executor` to require an explicit `thoughts/shared/plans/*.md` path in its input. Add a fourth routing output class (`direct-execution`) to commander and brainstormer's `routing-by-requested-output` block. Register the new agent in `src/agents/index.ts`, add the runtime model pin in `~/.config/opencode/micode.jsonc`, and document the placeholder in `micode.example.jsonc`. All work lives in plugin agent metadata and plain text prompts; no runtime tooling is added.

**Design:** thoughts/shared/designs/2026-05-03-executor-direct-scoped-execution-design.md

**Contract:** none

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2, 1.3, 1.4, 1.5 [foundation - no deps]
  - 1.1 src/agents/executor-direct.ts (new agent)
  - 1.2 src/agents/executor.ts (plan-required guard)
  - 1.3 src/agents/commander.ts (routing)
  - 1.4 src/agents/brainstormer.ts (routing)
  - 1.5 micode.example.jsonc (placeholder)

Batch 2 (parallel): 2.1, 2.2, 2.3 [integration - depends on 1.1]
  - 2.1 src/agents/index.ts (register agent + barrel re-export)
  - 2.2 /root/.config/opencode/micode.jsonc (Sonnet 4.6 pin)
  - 2.3 tests/agents/no-runner-agent.test.ts (allow executor-direct)

Batch 3 (parallel): 3.1 [cross-cutting routing test - depends on 1.1, 1.3, 1.4, 2.1]
  - 3.1 tests/agents/executor-direct-routing.test.ts (cross-coordinator routing contract)
```

---

## Batch 1: Foundation (parallel - 5 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4, 1.5

### Task 1.1: Create executor-direct agent
**File:** `src/agents/executor-direct.ts`
**Test:** `tests/agents/executor-direct.test.ts`
**Depends:** none
**Domain:** general

Note (gap-fill): the design specifies what the prompt must enforce but not its exact XML shape. I'm modeling the prompt structure on `src/agents/investigator.ts` because it is the closest existing scoped subagent in this repo (low-temperature, narrow purpose, explicit `<not-this-role>` and `<hard-restrictions>` blocks). Tools: keep `write`, `edit`, `bash` enabled (design says so), explicitly disable `task` so the agent cannot become a dispatcher. The `spawn_agent` tool is plugin-controlled and not exposed via `AgentConfig.tools`, so the prompt must hard-forbid it as a textual rule.

```typescript
// tests/agents/executor-direct.test.ts
import { describe, expect, it } from "bun:test";

import { executorDirectAgent } from "../../src/agents/executor-direct";

describe("executor-direct agent", () => {
  it("is a subagent with low temperature for scoped direct execution", () => {
    expect(executorDirectAgent.mode).toBe("subagent");
    expect(executorDirectAgent.temperature).toBeLessThanOrEqual(0.3);
  });

  it("disables task tool so it cannot dispatch other subagents", () => {
    expect(executorDirectAgent.tools?.task).toBe(false);
  });

  it("keeps write, edit, and bash enabled for scoped direct work", () => {
    // tools default to true when undefined in AgentConfig; ensure they are not disabled
    expect(executorDirectAgent.tools?.write).not.toBe(false);
    expect(executorDirectAgent.tools?.edit).not.toBe(false);
    expect(executorDirectAgent.tools?.bash).not.toBe(false);
  });

  it("describes itself as a no-plan scoped direct executor", () => {
    const description = (executorDirectAgent.description ?? "").toLowerCase();
    expect(description).toContain("direct");
    expect(description).toContain("scoped");
  });

  it("prompt forbids spawning subagents, plans, lifecycle ownership, default commit/push, restart, and secret output", () => {
    const prompt = (executorDirectAgent.prompt ?? "").toLowerCase();
    expect(prompt).toContain("spawn_agent");
    expect(prompt).toContain("plan");
    expect(prompt).toContain("lifecycle");
    expect(prompt).toContain("commit");
    expect(prompt).toContain("push");
    expect(prompt).toContain("restart");
    expect(prompt).toContain("secret");
  });

  it("prompt requires execution-envelope, self-review, verification, and escalation rules", () => {
    const prompt = (executorDirectAgent.prompt ?? "").toLowerCase();
    expect(prompt).toContain("execution envelope");
    expect(prompt).toContain("self-review");
    expect(prompt).toContain("verification");
    expect(prompt).toContain("escalation");
  });

  it("prompt enumerates the four escalation targets: investigator, planner, executor, user-confirmation", () => {
    const prompt = (executorDirectAgent.prompt ?? "").toLowerCase();
    expect(prompt).toContain("investigator");
    expect(prompt).toContain("planner");
    expect(prompt).toContain("executor");
    expect(prompt).toContain("user confirmation");
  });

  it("prompt declares the micode environment, matching other subagents", () => {
    const prompt = executorDirectAgent.prompt ?? "";
    expect(prompt).toContain("micode");
    expect(prompt).toContain("SUBAGENT");
  });

  it("prompt forbids becoming a dispatcher or generic runner", () => {
    const prompt = (executorDirectAgent.prompt ?? "").toLowerCase();
    expect(prompt).toContain("not a dispatcher");
    expect(prompt).toContain("not a runner");
  });
});
```

```typescript
// src/agents/executor-direct.ts
import type { AgentConfig } from "@opencode-ai/sdk";

export const executorDirectAgent: AgentConfig = {
  description: "Direct scoped executor: performs no-plan, bounded implementation/build/deploy/verify work in a single subagent session",
  mode: "subagent",
  temperature: 0.2,
  tools: {
    task: false,
  },
  prompt: `<environment>
You are running as part of the "micode" OpenCode plugin (NOT Claude Code).
You are a SUBAGENT for direct scoped execution: no plan, no batch dispatch, no review cycle.
</environment>

<purpose>
Execute clear, bounded, no-plan implementation, build, deploy, or verification work in a single
subagent session. Goal: finish the requested scope yourself, then report. You decide HOW within
the bounds the caller gave you; you do NOT widen the scope, design new architecture, or dispatch
other agents.
</purpose>

<not-this-role>
<rule>You are NOT the executor. You do not parse plan files, batch tasks, or dispatch implementer/reviewer subagents.</rule>
<rule>You are NOT the planner. You do not produce implementation plans, micro-task batches, or design documents.</rule>
<rule>You are NOT the investigator. If the root cause of a failure is unknown, STOP and recommend investigator escalation rather than guessing.</rule>
<rule>You are NOT a dispatcher. You never call spawn_agent, never use the task tool, never delegate.</rule>
<rule>You are NOT a runner / operator / generic light-executor lane for arbitrary work. You exist for clearly scoped no-plan direct execution.</rule>
</not-this-role>

<hard-restrictions>
<rule>NEVER call spawn_agent. NEVER call the task tool. You may not start subagents under any condition.</rule>
<rule>NEVER produce a plan file under thoughts/shared/plans/. NEVER produce a design file under thoughts/shared/designs/.</rule>
<rule>NEVER own lifecycle state. Do not call lifecycle_start_request, lifecycle_commit, lifecycle_finish, lifecycle_log_progress, or any lifecycle_* tool. Do not write to .git/lifecycle/ or any equivalent.</rule>
<rule>NEVER commit or push by default. If the caller has not authorized commit/push in the current turn, leave changes uncommitted and report what would be committed.</rule>
<rule>NEVER restart OpenCode (never invoke systemctl restart opencode-web.service, /usr/local/bin/restart-opencode-detached, or equivalent). If a restart appears needed, STOP and report.</rule>
<rule>NEVER print secret values, tokens, API keys, hashes, or credentials in your output, even when they appear in files you read.</rule>
<rule>NEVER widen the scope. If the requested work is bounded to files A, B, C, do not touch D.</rule>
</hard-restrictions>

<execution-envelope priority="critical">
Before any edit, command, or deploy, restate the execution envelope you are operating under in
exactly this format. The caller uses it to confirm scope:

  ## Execution Envelope
  - Goal: <one-sentence outcome>
  - Targets: <files / directories / hosts you will touch>
  - Out-of-scope: <files / behaviors you will NOT touch>
  - Verification: <how you will prove the change works>
  - Side effects: <commits, deploys, restarts, network calls>
  - Authorization: <quote the caller's instruction granting any side effect; "none" if absent>

Do NOT skip this block. If the caller has not given you enough information to fill any field,
STOP and ask the caller exactly what is missing. Do not guess.
</execution-envelope>

<process>
<step>Read the caller's request. Extract goal, scope, constraints, expected target(s), and verification requirements.</step>
<step>Emit the Execution Envelope block. If anything is missing, STOP and ask.</step>
<step>Perform edits and run commands strictly within the envelope. Use write/edit/bash directly; no spawning.</step>
<step>After each edit, do a self-review pass: re-read the file you wrote, confirm syntax/imports/types align with surrounding code.</step>
<step>Run the verification commands the caller specified (tests, build, lint, log tail, deploy smoke).</step>
<step>If verification fails AND the cause is local + obvious + within envelope: fix and re-verify.</step>
<step>If verification fails AND the cause is non-local, unknown, or out-of-envelope: STOP and escalate.</step>
<step>Emit the Result block in the output format below.</step>
</process>

<self-review>
After each file edit, do a one-pass self-review BEFORE proceeding:
- The file parses (syntax / JSON / TOML / YAML).
- Imports / requires resolve to real symbols.
- Types align (where the language is typed).
- The change matches the requested intent and does not silently broaden it.
If self-review fails, fix or revert before running any verification command.
</self-review>

<verification>
Always run the caller's specified verification commands. If the caller did not specify any but the
target codebase has obvious checks (test runner, linter, build), run the cheapest one as a sanity
check and report its outcome. Treat unexpected pass/fail noise as evidence to escalate, not to suppress.
</verification>

<escalation priority="critical">
STOP and escalate (do not continue) when any of the following hold:

<situation target="investigator">Root cause of an observed failure is unknown and a diagnosis is needed.</situation>
<situation target="planner">The requested work is broad, design-heavy, requires cross-domain architecture decisions, API contract design, data model decisions, or new external dependencies.</situation>
<situation target="planner">The work needs subagent parallelism or reviewer cycles to complete safely.</situation>
<situation target="executor">A plan file already exists under thoughts/shared/plans/ for this work, or the caller mentions a plan path. Plan-driven delivery belongs to executor, not you.</situation>
<situation target="user-confirmation">Verification fails and the cause is not immediately local and obvious.</situation>
<situation target="user-confirmation">Commit, push, or any remote write is requested without explicit current-turn authorization, or without an ownership preflight per ~/.config/opencode/AGENTS.md (Repository Ownership Awareness).</situation>
<situation target="user-confirmation">An action would restart OpenCode, restart a service the user did not name, or take other destructive infrastructure operations.</situation>
<situation target="user-confirmation">A requested operation would expose secrets, tokens, hashes, or credentials in output.</situation>

When you stop, report which target above applies and quote the exact piece of the user's request
that triggered the stop.
</escalation>

<output-format>
<template>
## Execution Envelope
- Goal: ...
- Targets: ...
- Out-of-scope: ...
- Verification: ...
- Side effects: ...
- Authorization: ...

## Changes
- \`file:path\` — one-line summary of what changed
- ...

## Commands run
- \`<cmd>\` — exit code, one-line outcome

## Verification
- <check>: PASS | FAIL — evidence pointer
- ...

## Deploy / restart status
- <hosts touched, services bounced, or "none">

## Residual risks
- <known unknowns, ignored warnings, follow-up needed>

## Next
- <handed back / blocked on user / done>
</template>
</output-format>

<rules>
<rule>Every section above is required even if the value is "none" — do not silently omit fields.</rule>
<rule>Every claim cites a source: file:line, command output excerpt, or the caller's prompt.</rule>
<rule>Distinguish "verified" from "assumed". Never present an assumption as a verification.</rule>
<rule>Keep the report short. The caller is a coordinator, not a reader of logs.</rule>
</rules>

<autonomy-rules>
<rule>You are a SUBAGENT - execute the bounded scope without asking for confirmation when the envelope is fully specified.</rule>
<rule>NEVER ask "should I edit this file?" - if it is in Targets, edit it.</rule>
<rule>NEVER ask "should I run the build?" - if it is in Verification, run it.</rule>
<rule>DO ask when the envelope is genuinely under-specified (missing target, missing verification, missing authorization for a side effect).</rule>
</autonomy-rules>

<never-do>
<forbidden>NEVER call spawn_agent, the task tool, or any subagent dispatch mechanism.</forbidden>
<forbidden>NEVER write or edit files outside the Targets list.</forbidden>
<forbidden>NEVER produce plan files, design files, lifecycle artifacts, or PR bodies on your own.</forbidden>
<forbidden>NEVER commit, push, deploy, or restart without explicit current-turn authorization quoted in the Authorization field.</forbidden>
<forbidden>NEVER restart OpenCode itself.</forbidden>
<forbidden>NEVER print secret values or credentials.</forbidden>
<forbidden>NEVER continue past a failed verification whose cause is non-local or out-of-envelope.</forbidden>
<forbidden>NEVER widen the scope to "while I'm in here, also fix..." — escalate the side request, do not do it.</forbidden>
</never-do>`,
};
```

**Verify:** `bun test tests/agents/executor-direct.test.ts`
**Commit:** `feat(agents): add executor-direct subagent for no-plan scoped execution`

### Task 1.2: Add plan-required input guard to executor prompt
**File:** `src/agents/executor.ts`
**Test:** `tests/agents/executor-prompt.test.ts` (extend existing)
**Depends:** none
**Domain:** general

Note (gap-fill): the design says executor must "stop and report that the task belongs to executor-direct, planner, or investigator" without an explicit plan path. I'm adding a new top-level XML block `<input-contract>` after `<purpose>` so the rule is unmissable, and extending `tests/agents/executor-prompt.test.ts` with a new `describe` block rather than creating a separate test file. The block name is grep-stable so cross-cutting tests (Task 3.1) can detect it.

```typescript
// tests/agents/executor-prompt.test.ts
// (extend the existing file by appending a new describe block at the end; keep all existing tests)
import { describe, expect, it } from "bun:test";

import { executorAgent } from "@/agents/executor";

const REVIEW_CHANGES_REQUESTED = "review_changes_requested";
const PROMPT_WINDOW_LENGTH = 400;

function outcomeGuidance(): string {
  const index = executorAgent.prompt.indexOf(REVIEW_CHANGES_REQUESTED);
  expect(index).toBeGreaterThanOrEqual(0);

  return executorAgent.prompt.slice(index, index + PROMPT_WINDOW_LENGTH);
}

describe("executor agent prompt contract for review_changes_requested", () => {
  it("references the review_changes_requested outcome literal", () => {
    expect(executorAgent.prompt).toContain(REVIEW_CHANGES_REQUESTED);
  });

  it("documents that review_changes_requested triggers a fix cycle", () => {
    const guidance = outcomeGuidance();
    const mentionsFixCycle = /fix\s+cycle|fix\s+implementer|re-?review|spawn.*fix/i.test(guidance);

    expect(mentionsFixCycle).toBe(true);
  });

  it("explicitly tells the executor not to resume_subagent on review_changes_requested", () => {
    expect(outcomeGuidance().toLowerCase()).toMatch(/not.*resume|never.*resume|do not call resume/);
  });

  it("still documents resume_subagent for task_error and blocked", () => {
    expect(executorAgent.prompt).toContain("task_error");
    expect(executorAgent.prompt).toContain("blocked");
    expect(executorAgent.prompt).toContain("resume_subagent");
  });
});

describe("executor agent input contract: requires explicit plan path", () => {
  it("declares an input-contract block requiring a thoughts/shared/plans/*.md plan path", () => {
    expect(executorAgent.prompt).toContain("<input-contract");
    expect(executorAgent.prompt).toContain("thoughts/shared/plans/");
    expect(executorAgent.prompt.toLowerCase()).toContain("plan path");
  });

  it("instructs the executor to refuse natural-language direct tasks without a plan path", () => {
    const prompt = executorAgent.prompt.toLowerCase();
    expect(prompt).toMatch(/refuse|stop.*report|reject/);
    expect(prompt).toContain("executor-direct");
  });

  it("names planner and investigator as alternative escalation targets", () => {
    const prompt = executorAgent.prompt.toLowerCase();
    expect(prompt).toContain("planner");
    expect(prompt).toContain("investigator");
  });
});
```

```typescript
// src/agents/executor.ts
// Modify only the prompt string. Insert a new <input-contract> block immediately AFTER the
// closing </purpose> line and BEFORE the existing <subagent-tools> block. Do NOT touch any
// other section of the file.
//
// Locate this exact line in the existing prompt (current line ~53):
//
//   </purpose>
//
//   <subagent-tools>
//
// Replace with:
//
//   </purpose>
//
//   <input-contract priority="critical">
//   The executor is the PLAN-DRIVEN dispatcher. Your input MUST contain an explicit plan path
//   under thoughts/shared/plans/*.md. Without that path, you are NOT the right agent.
//
//   <required-input>
//     <field name="plan-path">An absolute or repo-relative path to a plan file under
//       thoughts/shared/plans/ ending in .md (e.g. thoughts/shared/plans/2026-05-03-feature.md).</field>
//   </required-input>
//
//   <on-missing-plan-path>
//     STOP. Do not parse the request as a direct task. Report back to the caller with this exact
//     classification:
//
//     - The task names a clear scoped no-plan implementation/build/deploy/verify goal: hand off
//       to executor-direct.
//     - The task surfaces an unknown root cause or asks "why does X fail": hand off to investigator.
//     - The task is broad, design-heavy, or requires cross-domain architecture / API contract /
//       data model decisions: hand off to planner.
//
//     Quote the user's request and name the recommended target. Do NOT attempt to implement,
//     build, or deploy directly; that is executor-direct's role, not yours.
//   </on-missing-plan-path>
//
//   <rule>NEVER infer a plan from natural-language steps. A plan path is the contract. If it is
//     not present, refuse and escalate.</rule>
//   <rule>NEVER spawn implementer or reviewer subagents without first parsing a plan file.</rule>
//   </input-contract>
//
//   <subagent-tools>
//
// Implementation note for the implementer subagent: use a single Edit() call replacing the
// 4-character anchor sequence "</purpose>\n\n<subagent-tools>" with "</purpose>\n\n<input-contract priority=\"critical\">\n... (full block) ...\n</input-contract>\n\n<subagent-tools>".
// Do not use replaceAll. Verify the file still parses by running bun test.
```

**Verify:** `bun test tests/agents/executor-prompt.test.ts`
**Commit:** `feat(agents): require explicit plan path in executor input contract`

### Task 1.3: Add direct-execution output class to commander routing
**File:** `src/agents/commander.ts`
**Test:** `tests/agents/commander.test.ts` (extend) + new assertions in routing test (3.1 covers cross-cutting)
**Depends:** none
**Domain:** general

Note (gap-fill): the existing `<routing-by-requested-output>` block has four output classes (location, explanation, diagnosis, mutation). The design adds a fifth concept: "no-plan scoped direct execution" routes to `executor-direct`. Cleanest option is a new `<output-class name="direct-execution" agent="executor-direct">` peer to `mutation`, with the existing `mutation` class clarified to mean PLAN-DRIVEN delivery (it currently says "delivery orchestrator and dispatches implementer-frontend...", which is exactly executor's role). Also extend `<combinations>` and `<agents>` table.

```typescript
// tests/agents/commander.test.ts
// Append a new describe block to the existing file. Do not change existing tests.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const COMMANDER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "commander.ts"), "utf-8");

describe("commander routing: direct-execution output class", () => {
  it("declares an output-class for direct-execution mapped to executor-direct", () => {
    const match = COMMANDER_SOURCE.match(/<output-class name="direct-execution" agent="([^"]+)">/);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("executor-direct");
  });

  it("describes direct-execution as no-plan, bounded scope, single-agent", () => {
    const match = COMMANDER_SOURCE.match(
      /<output-class name="direct-execution" agent="executor-direct">([\s\S]*?)<\/output-class>/,
    );
    expect(match).not.toBeNull();
    const body = (match?.[1] ?? "").toLowerCase();
    expect(body).toContain("no plan");
    expect(body).toMatch(/bounded|scoped/);
    expect(body).toContain("single");
  });

  it("clarifies that the mutation class requires a plan and routes to executor", () => {
    const match = COMMANDER_SOURCE.match(
      /<output-class name="mutation" agent="executor">([\s\S]*?)<\/output-class>/,
    );
    expect(match).not.toBeNull();
    const body = (match?.[1] ?? "").toLowerCase();
    expect(body).toContain("plan");
  });

  it("registers executor-direct in the agents table", () => {
    expect(COMMANDER_SOURCE).toMatch(/<agent\s+name="executor-direct"[^>]*mode="subagent"/);
  });

  it("anti-patterns warn against routing investigator/planner work to executor-direct", () => {
    const lower = COMMANDER_SOURCE.toLowerCase();
    expect(lower).toContain("executor-direct");
    // anti-pattern wording must mention not using executor-direct as a fallback diagnostic / planning lane
    expect(lower).toMatch(/executor-direct.*not.*investigat|not.*investigator.*executor-direct/);
  });
});
```

```typescript
// src/agents/commander.ts
// Modify only the prompt string in two places.
//
// 1. Inside the existing <routing-by-requested-output> block, add a new output-class
//    immediately AFTER the <output-class name="mutation" ...></output-class> block.
//    The new block reads:
//
//      <output-class name="direct-execution" agent="executor-direct">
//        Requested output is a changed system, BUT no plan exists yet AND the steps are clear
//        AND the scope is bounded (named files, named hosts, named verification) AND a single
//        agent can complete implementation, build, deploy, and verify in one session. No design
//        decisions, no batch dispatch, no reviewer cycle needed. Examples: "implement these
//        explicit AuthMeLite steps, build, deploy to the named servers, and verify logs",
//        "rename this constant in these three files and run the tests".
//        executor-direct does the work itself; it does NOT spawn subagents and does NOT own
//        lifecycle state.
//      </output-class>
//
//    Then update the existing <output-class name="mutation" agent="executor"> body to add one
//    sentence at the end clarifying it is the PLAN-DRIVEN lane: "A plan file under
//    thoughts/shared/plans/ MUST exist; if not, route to executor-direct (no-plan bounded
//    scope), planner (broad/design-heavy), or investigator (unknown cause)."
//
// 2. Update the <combinations> and <anti-patterns> blocks inside routing-by-requested-output:
//
//    Add to <combinations>:
//      <rule>If the user asks for a code change with a clear bounded scope and explicit steps but no
//        plan file exists, route to executor-direct, NOT executor. The executor refuses inputs
//        without a plan path under thoughts/shared/plans/.</rule>
//      <rule>If a plan file already exists for the requested change, route to executor (plan-driven).
//        Do not duplicate the plan-driven path through executor-direct.</rule>
//
//    Add to <anti-patterns>:
//      <rule>Do NOT use executor-direct as a fallback for investigator-style "find out why X
//        happened" requests. executor-direct mutates the system; investigator does not.</rule>
//      <rule>Do NOT use executor-direct for design-heavy or broad-scope work. That is the
//        planner's job. executor-direct refuses scope expansion.</rule>
//
// 3. In the <agents> block (around line ~256-264), add ONE new line immediately AFTER the
//    existing executor entry:
//
//      <agent name="executor-direct" mode="subagent" purpose="Direct scoped no-plan execution: implements/builds/deploys/verifies bounded work in a single session; never spawns subagents"/>
//
// Implementer note: keep existing rules in routing-by-requested-output unchanged (especially
// the "never use keyword trigger lists" line and the existing combinations/anti-patterns).
```

**Verify:** `bun test tests/agents/commander.test.ts tests/agents/investigator-routing.test.ts`
**Commit:** `feat(agents): add direct-execution routing class to commander`

### Task 1.4: Add direct-execution output class to brainstormer routing
**File:** `src/agents/brainstormer.ts`
**Test:** `tests/agents/brainstormer.test.ts` (extend)
**Depends:** none
**Domain:** general

Note (gap-fill): brainstormer's existing routing block (lines 98-128 in current file) has the same shape as commander's. Add the same direct-execution class but with brainstormer-appropriate framing (design exploration phase rarely triggers direct execution, but if the brainstormed scope is bounded enough the brainstormer can still recommend it). Update `<available-subagents>` to include executor-direct.

```typescript
// tests/agents/brainstormer.test.ts
// Append a new describe block. Do not change existing tests.
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const BRAINSTORMER_SOURCE = readFileSync(
  join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"),
  "utf-8",
);

describe("brainstormer routing: direct-execution output class", () => {
  it("declares an output-class for direct-execution mapped to executor-direct", () => {
    const match = BRAINSTORMER_SOURCE.match(/<output-class name="direct-execution" agent="([^"]+)">/);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("executor-direct");
  });

  it("describes direct-execution as the no-plan bounded scoped lane", () => {
    const match = BRAINSTORMER_SOURCE.match(
      /<output-class name="direct-execution" agent="executor-direct">([\s\S]*?)<\/output-class>/,
    );
    expect(match).not.toBeNull();
    const body = (match?.[1] ?? "").toLowerCase();
    expect(body).toContain("no plan");
    expect(body).toMatch(/bounded|scoped/);
  });

  it("registers executor-direct in the available-subagents block", () => {
    expect(BRAINSTORMER_SOURCE).toMatch(/<subagent\s+name="executor-direct">/);
  });

  it("clarifies that mutation class still requires planner-then-executor for non-trivial work", () => {
    const match = BRAINSTORMER_SOURCE.match(
      /<output-class name="mutation" agent="executor">([\s\S]*?)<\/output-class>/,
    );
    expect(match).not.toBeNull();
    const body = (match?.[1] ?? "").toLowerCase();
    expect(body).toContain("planner");
    expect(body).toContain("executor");
  });
});
```

```typescript
// src/agents/brainstormer.ts
// Modify only the prompt string in two places.
//
// 1. Inside <routing-by-requested-output> (lines ~98-128), insert a new output-class AFTER the
//    existing mutation class:
//
//      <output-class name="direct-execution" agent="executor-direct">
//        During design exploration, if the conversation has converged on a small bounded scope
//        with explicit steps and named files / hosts / verification, AND no plan file is needed
//        because a single agent can finish the work in one session, route to executor-direct.
//        This is the rare case where design exploration ends in a no-plan direct change rather
//        than handing off to planner. executor-direct never owns lifecycle state and never
//        spawns subagents.
//      </output-class>
//
//    Update the existing mutation class to keep "planner, then executor" as the default for
//    non-trivial scope.
//
// 2. In <available-subagents> (lines ~130-137), add ONE new line immediately AFTER the existing
//    executor entry:
//
//      <subagent name="executor-direct">Direct scoped no-plan execution: bounded work in a single session, never spawns subagents, never owns lifecycle state.</subagent>
//
// Keep all existing rules unchanged.
```

**Verify:** `bun test tests/agents/brainstormer.test.ts tests/agents/investigator-routing.test.ts`
**Commit:** `feat(agents): add direct-execution routing class to brainstormer`

### Task 1.5: Add executor-direct placeholder to repository example config
**File:** `micode.example.jsonc`
**Test:** none (config example, no logic; covered indirectly by host config in 2.2)
**Depends:** none
**Domain:** general

Note (gap-fill): the design says "Repository examples expose a placeholder for direct execution model". The existing example uses placeholder tokens like `<YOUR_STRONG_REASONING_MODEL>`. I add `<YOUR_DIRECT_EXEC_MODEL>` and document it in the placeholder legend, mirroring how `<YOUR_DIAGNOSTIC_MODEL>` is documented. Do NOT ship a concrete model name (constraint).

```jsonc
// micode.example.jsonc
// 1. Add this paragraph to the placeholder legend block (header comment), immediately AFTER the
//    <YOUR_DIAGNOSTIC_MODEL> entry:
//
//   //   <YOUR_DIRECT_EXEC_MODEL>
//   //     A model tuned for fast, scoped, no-plan direct execution: implementation, build,
//   //     deploy, and verification in a single subagent session without subagent dispatch.
//   //     The recommended choice is Claude Sonnet 4.6: a balance of speed and code-quality
//   //     judgment for bounded edits. Used by the executor-direct agent. The role remains
//   //     fully configurable; you may pin it to any model your gateway supports.
//
// 2. Add this entry to the "agents" object in the JSON body, immediately AFTER the
//    "investigator" line:
//
//        "investigator": { "model": "<YOUR_DIAGNOSTIC_MODEL>" },
//        "executor-direct": { "model": "<YOUR_DIRECT_EXEC_MODEL>" }
//
//    Mind the trailing comma rules: the previous line gains a trailing comma, the new line is
//    the last entry inside "agents" so it has no trailing comma. (JSONC accepts trailing
//    commas, but match the existing house style of the file.)
//
// Implementation note: this file is JSONC (per its filename). Comments and trailing commas are
// allowed. Do NOT introduce a concrete provider/model token; the placeholder must remain
// generic per the design constraint.
```

**Verify:** Manual: `cat micode.example.jsonc | grep executor-direct` should show the placeholder line.
**Commit:** `docs(example): add executor-direct placeholder to micode.example.jsonc`

---

## Batch 2: Integration (parallel - 3 implementers)

All tasks in this batch depend on Batch 1 (specifically 1.1 for the new agent export).
Tasks: 2.1, 2.2, 2.3

### Task 2.1: Register executor-direct in agents registry and barrel re-export
**File:** `src/agents/index.ts`
**Test:** `tests/agents/index.test.ts` (extend existing)
**Depends:** 1.1
**Domain:** general

Note (gap-fill): the registry pattern in this file follows: import the agent from its module, add a key in the `agents` Record with `{ ...agent, model: DEFAULT_MODEL }`, and re-export the bare `xAgent` symbol in the named-export block. Mirror exactly what `executorAgent` and `investigatorAgent` already do.

```typescript
// tests/agents/index.test.ts
// Extend the existing file. The current file already verifies that the registry contains the
// expected agents; add a focused describe block for executor-direct.
import { describe, expect, it } from "bun:test";

import { agents, executorDirectAgent } from "../../src/agents";

describe("agents registry: executor-direct", () => {
  it("registers an executor-direct entry in the agents map", () => {
    expect(agents).toHaveProperty("executor-direct");
    expect(agents["executor-direct"]).toBeDefined();
  });

  it("the registered executor-direct entry carries a model field", () => {
    const entry = agents["executor-direct"];
    expect(entry).toBeDefined();
    expect(typeof entry?.model).toBe("string");
    expect((entry?.model ?? "").length).toBeGreaterThan(0);
  });

  it("re-exports the executorDirectAgent symbol from the barrel", () => {
    expect(executorDirectAgent).toBeDefined();
    expect(executorDirectAgent.mode).toBe("subagent");
  });

  it("does NOT register a generic 'runner' or 'operator' agent", () => {
    expect(agents).not.toHaveProperty("runner");
    expect(agents).not.toHaveProperty("operator");
    expect(agents).not.toHaveProperty("light-executor");
  });

  it("keeps the existing executor entry intact alongside executor-direct", () => {
    expect(agents).toHaveProperty("executor");
    expect(agents).toHaveProperty("executor-direct");
    expect(agents.executor).not.toBe(agents["executor-direct"]);
  });
});
```

```typescript
// src/agents/index.ts
// Make exactly three small modifications. Do NOT reorder existing entries.
//
// 1. Add the import next to the existing executor import (alphabetical-ish; place immediately
//    after the existing line `import { executorAgent } from "./executor";`):
//
//      import { executorDirectAgent } from "./executor-direct";
//
// 2. Add the registry entry inside the `agents` Record, immediately after the existing
//    `executor: { ...executorAgent, model: DEFAULT_MODEL },` line:
//
//      "executor-direct": { ...executorDirectAgent, model: DEFAULT_MODEL },
//
// 3. Add the bare symbol to the named-export block, immediately after the existing
//    `executorAgent,` line:
//
//      executorDirectAgent,
//
// All other lines (DEFAULT_MODEL import, mindmodel imports, etc) remain unchanged.
```

**Verify:** `bun test tests/agents/index.test.ts tests/agents/no-runner-agent.test.ts`
**Commit:** `feat(agents): register executor-direct in agents registry`

### Task 2.2: Pin executor-direct to Claude Sonnet 4.6 in active host config
**File:** `/root/.config/opencode/micode.jsonc`
**Test:** none (host config; no test target. Manual smoke is the verify step)
**Depends:** 1.1
**Domain:** general

Note: this is the ONLY file change that lives outside the repo. The design says "Active host config may pin executor-direct to Claude Sonnet 4.6" and the user explicitly confirmed this. Existing `executor` and `implementer-*` entries stay on `wuxie-openai/gpt-5.5` per the explicit constraint. Do NOT modify any other agent in this file.

```jsonc
// /root/.config/opencode/micode.jsonc
// Add ONE new entry to the "agents" object. Place it immediately AFTER the existing
// "executor": { ... } block (currently lines ~25-28) and BEFORE the "implementer-frontend"
// block. Match the existing formatting (4-space-ish nested object with "model" and "options"
// keys).
//
//      "executor":             {
//        "model": "wuxie-openai/gpt-5.5",
//        "options": { "reasoningEffort": "high" }
//      },
//
//      "executor-direct":      {
//        "model": "wuxie-claude/claude-sonnet-4-6",
//        "options": { "reasoningEffort": "medium" }
//      },
//
//      // Domain implementers
//      "implementer-frontend": {
//        ...
//
// Implementation notes for the implementer subagent:
// - This file is JSONC. Comments and trailing commas are allowed.
// - The existing "executor" block ends with `},` (trailing comma already present after the
//   closing brace), so just insert a new property block after it.
// - DO NOT touch the "executor", "implementer-frontend", "implementer-backend",
//   "implementer-general" entries: per the explicit user constraint they remain on gpt-5.5.
// - DO NOT touch any other entry (commander, planner, reviewer, brainstormer, octto,
//   codebase-*, mm-*, etc).
// - After the edit, the JSONC must still parse. Quick check: `node -e "const fs=require('fs');
//   const s=fs.readFileSync('/root/.config/opencode/micode.jsonc','utf8').replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');
//   JSON.parse(s);" && echo OK`
//
// Self-hosting reminder (CLAUDE.md "Local OpenCode Runtime"):
//   This config file is read by the live OpenCode process. The change takes effect on the
//   next conversation, not the current one. DO NOT restart OpenCode without explicit user
//   approval — that is a hard rule in this repo. After editing, just report: "host config
//   updated; takes effect in the next conversation; restart of OpenCode requires explicit
//   user approval."
```

**Verify:**
- `node -e "const fs=require('fs'); const s=fs.readFileSync('/root/.config/opencode/micode.jsonc','utf8').replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,''); JSON.parse(s); console.log('OK')"` should print `OK`.
- `grep -A2 'executor-direct' /root/.config/opencode/micode.jsonc` should show the Sonnet 4.6 model line.
**Commit:** Skip git commit for this file (it lives outside the repo and is gitignored). Just report the change in the executor's final summary.

### Task 2.3: Allow executor-direct in no-runner-agent test whitelist
**File:** `tests/agents/no-runner-agent.test.ts`
**Test:** the file is itself the test (run it after edit)
**Depends:** 1.1, 2.1
**Domain:** general

Note (gap-fill): the existing test guards against `runner` / `operator` / `light-executor` and asserts no exported name `.toLowerCase().contains("runner")` etc. `executor-direct` does NOT match those substrings, so it is already allowed. BUT the design says "Existing no-runner/operator tests continue to reject generic runner lanes without rejecting executor-direct" — that's a positive assertion. Add an explicit positive test case so any future drift toward `executor-direct-runner.ts` etc. would still be caught, and that current `executor-direct` is intentionally permitted.

```typescript
// tests/agents/no-runner-agent.test.ts
// Append a new describe block to the existing file. Keep all existing tests unchanged.
import { describe, expect, it } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import * as registry from "../../src/agents";

const AGENTS_DIR = join(__dirname, "..", "..", "src", "agents");

describe("agent registry: no runner/operator/light-executor (issue #23)", () => {
  it("does not export a runner agent from src/agents/index.ts", () => {
    const exported = Object.keys(registry);
    for (const name of exported) {
      expect(name.toLowerCase()).not.toContain("runner");
      expect(name.toLowerCase()).not.toContain("operator");
    }
  });

  it("does not contain a runner.ts or operator.ts agent file", () => {
    const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".ts"));
    for (const file of files) {
      expect(file.toLowerCase()).not.toBe("runner.ts");
      expect(file.toLowerCase()).not.toBe("operator.ts");
      expect(file.toLowerCase()).not.toBe("light-executor.ts");
    }
  });

  it("registry index does not import a runner-style agent", () => {
    const indexSource = readFileSync(join(AGENTS_DIR, "index.ts"), "utf-8");
    expect(indexSource).not.toMatch(/from\s+["']\.\/runner["']/);
    expect(indexSource).not.toMatch(/from\s+["']\.\/operator["']/);
    expect(indexSource).not.toMatch(/from\s+["']\.\/light-executor["']/);
  });

  it("commander prompt does not delegate to a runner-style agent", () => {
    const commanderSource = readFileSync(join(AGENTS_DIR, "commander.ts"), "utf-8");
    const withoutNegationBlock = commanderSource.replace(/<not-a-runner>[\s\S]*?<\/not-a-runner>/g, "");
    expect(withoutNegationBlock.toLowerCase()).not.toContain('agent="runner"');
    expect(withoutNegationBlock.toLowerCase()).not.toContain('agent="operator"');
    expect(withoutNegationBlock.toLowerCase()).not.toMatch(/spawn[\s_-]*runner/);
  });
});

describe("agent registry: executor-direct is the ONE allowed direct-execution lane (issue #25)", () => {
  it("executor-direct is registered (positive assertion)", () => {
    expect(Object.keys(registry)).toContain("executorDirectAgent");
  });

  it("executor-direct.ts is the only direct-execution agent file (no foo-direct-runner.ts etc)", () => {
    const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".ts"));
    const directLike = files.filter((f) => /direct/i.test(f));
    expect(directLike).toEqual(["executor-direct.ts"]);
  });

  it("no agent file mixes 'direct' with runner/operator wording", () => {
    const files = readdirSync(AGENTS_DIR).filter((f) => f.endsWith(".ts"));
    for (const file of files) {
      const lower = file.toLowerCase();
      if (lower.includes("direct")) {
        expect(lower).not.toContain("runner");
        expect(lower).not.toContain("operator");
      }
    }
  });
});
```

**Verify:** `bun test tests/agents/no-runner-agent.test.ts`
**Commit:** `test(agents): assert executor-direct is the only direct-execution lane`

---

## Batch 3: Cross-Coordinator Routing Test (parallel - 1 implementer)

This batch depends on Batch 2 completing (registry and routing prompts must be in place).
Tasks: 3.1

### Task 3.1: Cross-coordinator routing contract test for executor-direct
**File:** `tests/agents/executor-direct-routing.test.ts` (new)
**Test:** itself
**Depends:** 1.1, 1.3, 1.4, 2.1
**Domain:** general

Note (gap-fill): mirror the shape of the existing `tests/agents/investigator-routing.test.ts`. That file iterates over `[commander, brainstormer]` sources and verifies each has matching `<output-class>` blocks for the same agent. This new test does the same for the `direct-execution` output class so commander and brainstormer cannot drift from each other.

```typescript
// tests/agents/executor-direct-routing.test.ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const COMMANDER_SOURCE = readFileSync(
  join(__dirname, "..", "..", "src", "agents", "commander.ts"),
  "utf-8",
);
const BRAINSTORMER_SOURCE = readFileSync(
  join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"),
  "utf-8",
);
const EXECUTOR_SOURCE = readFileSync(
  join(__dirname, "..", "..", "src", "agents", "executor.ts"),
  "utf-8",
);

const COORDINATORS = [
  { name: "commander", source: COMMANDER_SOURCE },
  { name: "brainstormer", source: BRAINSTORMER_SOURCE },
];

describe("executor-direct routing contract (cross-coordinator)", () => {
  for (const coord of COORDINATORS) {
    describe(coord.name, () => {
      it("declares an output-class for direct-execution mapped to executor-direct", () => {
        const match = coord.source.match(/<output-class name="direct-execution" agent="([^"]+)">/);
        expect(match).not.toBeNull();
        expect(match?.[1]).toBe("executor-direct");
      });

      it("describes direct-execution as the no-plan, bounded, single-session lane", () => {
        const match = coord.source.match(
          /<output-class name="direct-execution" agent="executor-direct">([\s\S]*?)<\/output-class>/,
        );
        expect(match).not.toBeNull();
        const body = (match?.[1] ?? "").toLowerCase();
        expect(body).toContain("no plan");
        expect(body).toMatch(/bounded|scoped/);
      });

      it("preserves existing routing classes (location, explanation, diagnosis, mutation)", () => {
        const lower = coord.source.toLowerCase();
        expect(lower).toContain("location");
        expect(lower).toContain("explanation");
        expect(lower).toContain("diagnosis");
        expect(lower).toContain("mutation");
      });

      it("registers executor-direct in its agents/subagents listing", () => {
        // commander uses <agent name="executor-direct" mode="subagent" .../>
        // brainstormer uses <subagent name="executor-direct">...</subagent>
        const matchesAgentTag = /<agent\s+name="executor-direct"[^>]*mode="subagent"/.test(coord.source);
        const matchesSubagentTag = /<subagent\s+name="executor-direct">/.test(coord.source);
        expect(matchesAgentTag || matchesSubagentTag).toBe(true);
      });
    });
  }

  it("both coordinators agree on the executor-direct agent name spelling", () => {
    expect(COMMANDER_SOURCE).toContain("executor-direct");
    expect(BRAINSTORMER_SOURCE).toContain("executor-direct");
    // Reject common drift spellings.
    expect(COMMANDER_SOURCE).not.toMatch(/executor[_\s]direct|executordirect/i);
    expect(BRAINSTORMER_SOURCE).not.toMatch(/executor[_\s]direct|executordirect/i);
  });

  it("executor-direct is distinct from executor in routing: not interchangeable", () => {
    for (const coord of COORDINATORS) {
      // The mutation class must still point to executor (plan-driven), NOT executor-direct.
      const mutationMatch = coord.source.match(
        /<output-class name="mutation" agent="([^"]+)">/,
      );
      expect(mutationMatch).not.toBeNull();
      expect(mutationMatch?.[1]).toBe("executor");
    }
  });

  it("executor agent prompt requires a thoughts/shared/plans/*.md plan path (input contract)", () => {
    expect(EXECUTOR_SOURCE).toContain("<input-contract");
    expect(EXECUTOR_SOURCE).toContain("thoughts/shared/plans/");
    expect(EXECUTOR_SOURCE.toLowerCase()).toContain("executor-direct");
  });
});
```

**Verify:** `bun test tests/agents/executor-direct-routing.test.ts`
**Commit:** `test(agents): cross-coordinator routing contract for executor-direct`
