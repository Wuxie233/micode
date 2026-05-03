---
date: 2026-05-03
topic: "Investigator Agent for Read-Only Diagnostic Routing"
issue: 22
scope: agents
contract: none
---

# Investigator Read-Only Routing Implementation Plan

**Goal:** Add an `investigator` subagent for diagnostic read-only investigation, configure it to Claude Sonnet 4.6 in `micode.example.jsonc`, register it in the agent registry, and update coordinator (commander, brainstormer) routing guidance to dispatch by requested output and side-effect boundary, not keyword triggers, without weakening executor or implementers.

**Architecture:** A new subagent file `src/agents/investigator.ts` mirroring the structure of existing read-only specialists (`codebase-locator`, `codebase-analyzer`, `reviewer`): hard tool restrictions (`write: false`, `edit: false`, `bash: false`, `task: false`), low temperature, prompt that forbids mutation/commits/deploys/restarts and requires a structured diagnosis output (facts, evidence, likely cause, uncertainty, escalation). Registry entry uses `DEFAULT_MODEL` (per the existing convention; per-agent override happens at runtime via `micode.json` merge). The example jsonc adds a placeholder pinning `investigator` to `<YOUR_DIAGNOSTIC_MODEL>` with documentation that Claude Sonnet 4.6 is the recommended choice. Coordinator prompts add a routing block keyed on requested output: location → locator, code-explanation → analyzer, diagnosis-package → investigator, mutation/delivery → executor.

**Design:** [thoughts/shared/designs/2026-05-03-investigator-read-only-routing-design.md](../designs/2026-05-03-investigator-read-only-routing-design.md)

**Contract:** none (single-domain plan: every task is `general`, no frontend/backend split)

---

## Decisions and Gap-Filling

The design leaves several implementation details to the planner. Decisions made here, with reasoning:

- **Tool restrictions (design open question 1):** Apply hard restrictions matching `reviewer` and `codebase-analyzer` patterns: `write: false, edit: false, bash: false, task: false`. The design's third constraint says investigator must not become a lightweight executor; hard tool gates are the structural way to enforce that, prompt-only constraints are bypassable.
- **Read-only shell (design open question 2):** No `bash` access at all in v1. The design says investigator "may run safe read-only diagnostics" but does not require shell. Since investigation in this codebase mostly means reading files, prior plans, lifecycle issues, project memory, and design docs, the available read tools cover the v1 surface. If a future task needs `git log` / `cat /var/log`, that is a v2 follow-up; we do not pre-build an allowlist for a need we have not measured.
- **Model placeholder name in example jsonc:** Use a new placeholder `<YOUR_DIAGNOSTIC_MODEL>` with a comment recommending Claude Sonnet 4.6, rather than reusing `<YOUR_STRONG_REASONING_MODEL>`. This matches the example file's existing pattern of one placeholder per role and lets users opt for a different fast-correlation model.
- **Registry model field:** `investigator` uses `DEFAULT_MODEL` in `src/agents/index.ts` like every other agent. Per-agent overrides (including the recommended Claude Sonnet 4.6) come from the user's `micode.json` via `mergeAgentConfigs`. This matches how `implementer-frontend` and friends are wired.
- **Routing guidance shape (design constraint: no keyword triggers):** Coordinator prompts get a new `<routing-by-requested-output>` block describing four mutually exclusive output classes (location, explanation, diagnosis, mutation) and which agent owns each. No keyword lists. The classifier in the prompt is the requested output type plus side-effect requirement.
- **Coordinator scope:** Both `commander` and `brainstormer` get the routing block. `octto` is a brainstormer twin; per the design and existing convention, octto stays at upstream defaults and is out of scope for this plan.
- **Test surface:** Each agent file has its own test file. Routing guidance is verified by string-presence assertions in `commander.test.ts` and `brainstormer.test.ts` (the existing pattern for that file). One additional cross-cutting test file `tests/agents/investigator-routing.test.ts` asserts both coordinators reference the investigator agent name and the four-class routing distinction.

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2 [foundation - investigator agent file + example jsonc, no deps]
Batch 2 (parallel): 2.1, 2.2 [registry - depends on 1.1]
Batch 3 (parallel): 3.1, 3.2, 3.3 [coordinator routing - depends on 2.1]
```

---

## Batch 1: Foundation (parallel - 2 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2

### Task 1.1: investigator agent file
**File:** `src/agents/investigator.ts`
**Test:** `tests/agents/investigator.test.ts`
**Depends:** none
**Domain:** general

```typescript
// tests/agents/investigator.test.ts
import { describe, expect, it } from "bun:test";

import { investigatorAgent } from "../../src/agents/investigator";

describe("investigator agent", () => {
  it("is a subagent with read-only tool restrictions", () => {
    expect(investigatorAgent.mode).toBe("subagent");
    expect(investigatorAgent.tools?.write).toBe(false);
    expect(investigatorAgent.tools?.edit).toBe(false);
    expect(investigatorAgent.tools?.bash).toBe(false);
    expect(investigatorAgent.tools?.task).toBe(false);
  });

  it("uses a low temperature for evidence-gathering work", () => {
    expect(investigatorAgent.temperature).toBeLessThanOrEqual(0.3);
  });

  it("describes itself as a diagnostic read-only investigator", () => {
    const description = investigatorAgent.description ?? "";
    expect(description.toLowerCase()).toContain("diagnostic");
    expect(description.toLowerCase()).toContain("read-only");
  });

  it("prompt forbids mutation, commits, deploys, restarts, and implementation work", () => {
    const prompt = investigatorAgent.prompt ?? "";
    expect(prompt).toContain("never");
    // Forbidden actions per design Error Handling section
    expect(prompt.toLowerCase()).toContain("commit");
    expect(prompt.toLowerCase()).toContain("deploy");
    expect(prompt.toLowerCase()).toContain("restart");
    expect(prompt.toLowerCase()).toContain("mutation");
  });

  it("prompt requires the diagnosis output contract: facts, evidence, likely cause, uncertainty, escalation", () => {
    const prompt = investigatorAgent.prompt ?? "";
    expect(prompt.toLowerCase()).toContain("facts");
    expect(prompt.toLowerCase()).toContain("evidence");
    expect(prompt.toLowerCase()).toContain("likely cause");
    expect(prompt.toLowerCase()).toContain("uncertainty");
    expect(prompt.toLowerCase()).toContain("escalation");
  });

  it("prompt enumerates the three escalation outcomes", () => {
    const prompt = investigatorAgent.prompt ?? "";
    // Per design Components > Escalation protocol
    expect(prompt.toLowerCase()).toContain("no escalation");
    expect(prompt.toLowerCase()).toContain("executor");
    expect(prompt.toLowerCase()).toContain("user confirmation");
  });

  it("prompt forbids the executor / planner / locator / analyzer overlap", () => {
    const prompt = investigatorAgent.prompt ?? "";
    // Per design constraints: must not become a lightweight executor / generic read-only fallback
    expect(prompt.toLowerCase()).toContain("not a");
    expect(prompt.toLowerCase()).toContain("locator");
    expect(prompt.toLowerCase()).toContain("analyzer");
  });

  it("prompt declares the micode environment, matching other subagents", () => {
    const prompt = investigatorAgent.prompt ?? "";
    expect(prompt).toContain("micode");
    expect(prompt).toContain("SUBAGENT");
  });
});
```

```typescript
// src/agents/investigator.ts
import type { AgentConfig } from "@opencode-ai/sdk";

export const investigatorAgent: AgentConfig = {
  description: "Diagnostic read-only investigator: gathers evidence, proposes root cause, recommends escalation",
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
You are a SUBAGENT for diagnostic read-only investigation.
</environment>

<purpose>
Investigate observed failures, inconsistent behavior, unknown causes, runtime symptoms, and evidence
fragments. Produce a fact-backed diagnosis package, not a code change.
</purpose>

<not-this-role>
<rule>You are NOT the executor. You do not implement, mutate, commit, deploy, or restart anything.</rule>
<rule>You are NOT the planner. You do not produce implementation plans or task batches.</rule>
<rule>You are NOT the codebase-locator. If the user only wants file locations, hand back to the coordinator.</rule>
<rule>You are NOT the codebase-analyzer. If the user only wants a how-it-works walkthrough of code, hand back to the coordinator.</rule>
<rule>You are NOT a generic read-only fallback. You exist for diagnostic questions: an observed failure, a symptom, an inconsistency, an unknown cause.</rule>
</not-this-role>

<hard-restrictions>
<rule>NEVER write or edit files. NEVER call commit, push, merge, deploy, restart, or any side-effecting operation.</rule>
<rule>NEVER perform a mutation. NEVER request the user perform one without first finishing the diagnosis package.</rule>
<rule>NEVER attempt destructive shell commands. You do not have shell access in this version.</rule>
<rule>If investigation cannot proceed without a side effect, STOP and report what is needed.</rule>
</hard-restrictions>

<process>
<step>Read the user's request. Identify the symptom, the observed failure, and the boundary of the system in question.</step>
<step>Gather evidence: read relevant source files, prior plans, lifecycle issue bodies, project memory entries, ledgers, and design docs. Cite file:line for every claim.</step>
<step>Build the evidence chain: how does the symptom flow from inputs through code paths to the failing observation?</step>
<step>Form one or more root-cause hypotheses. Mark each as confirmed, likely, or speculative based on the evidence.</step>
<step>Identify what is still unknown and what would be needed to resolve it.</step>
<step>Decide the escalation recommendation.</step>
<step>Emit the diagnosis package in the output format below.</step>
</process>

<output-format>
<template>
## Diagnosis: [one-line symptom]

### Confirmed facts
- [fact] — \`file:line\` or [evidence pointer]
- [fact] — \`file:line\` or [evidence pointer]

### Evidence chain
1. [step in causal chain] — \`file:line\`
2. [step] — \`file:line\`
3. [step] — \`file:line\`

### Likely cause
[One paragraph naming the most probable root cause and the evidence supporting it.]

### Uncertainty
- [What is not yet confirmed] — [what would confirm or refute it]
- [Alternative hypothesis still consistent with evidence]

### Escalation recommendation
[Pick exactly one]
- No escalation needed: investigation resolved the question; no fix required.
- Executor should fix a scoped issue: [narrowest confirmed scope] at \`file:line\`.
- User confirmation needed: [side-effecting action] requires user approval before any agent proceeds.
</template>
</output-format>

<rules>
<rule>Every claim cites a source: file:line, doc path, lifecycle issue number, or project memory entry id.</rule>
<rule>Distinguish "confirmed" from "likely" from "speculative". Never present a hypothesis as fact.</rule>
<rule>Keep the package short. The reader is the coordinator deciding whether to route to executor.</rule>
<rule>If evidence is insufficient, report uncertainty and the minimum next action. Do not invent.</rule>
</rules>

<autonomy-rules>
<rule>You are a SUBAGENT - complete the investigation without asking for confirmation.</rule>
<rule>NEVER ask "should I look at X?" - look at it.</rule>
<rule>NEVER ask the coordinator to choose a hypothesis - rank them yourself with evidence.</rule>
<rule>State your escalation recommendation clearly. The coordinator will decide whether to act on it.</rule>
</autonomy-rules>

<never-do>
<forbidden>NEVER write, edit, commit, push, deploy, or restart anything.</forbidden>
<forbidden>NEVER produce an implementation plan - that is the planner's job.</forbidden>
<forbidden>NEVER produce a code patch - that is the implementer's job.</forbidden>
<forbidden>NEVER take over a code-explanation request that does not involve a diagnostic question - hand back to the coordinator.</forbidden>
<forbidden>NEVER hide uncertainty by overstating a hypothesis.</forbidden>
</never-do>`,
};
```

**Verify:** `bun test tests/agents/investigator.test.ts`
**Commit:** `feat(agents): add investigator agent for read-only diagnostic investigation`

### Task 1.2: investigator placeholder in example jsonc
**File:** `micode.example.jsonc`
**Test:** none (jsonc config file, no behavior to test in isolation; investigator placeholder is exercised indirectly by the config-loader integration test in Task 2.2)
**Depends:** none
**Domain:** general

```jsonc
// Edit operation, not file rewrite. Replace the legend block and add an investigator entry.
// Below is the full replacement content showing the two regions that change.
//
// Region A: legend (between the existing <YOUR_BACKEND_MODEL> block and the closing comment header)
// Add a new placeholder entry after <YOUR_BACKEND_MODEL>:
//
//   <YOUR_DIAGNOSTIC_MODEL>
//     A model tuned for fast evidence correlation across files, configs, logs,
//     and prior facts. The recommended choice is Claude Sonnet 4.6: fast enough
//     for read-only investigation and strong enough to build evidence chains.
//     Used by the investigator agent.
//
// Region B: agents block (after "implementer-general")
// Add a new line:
//
//     // --- Diagnostic read-only investigator ---
//     "investigator": { "model": "<YOUR_DIAGNOSTIC_MODEL>" }
```

The exact final shape of `micode.example.jsonc` after this task:

```jsonc
// micode.example.jsonc
//
// Copy this file to `~/.config/opencode/micode.jsonc` and replace every placeholder
// with a real model string. This repository will NEVER ship concrete provider or model
// names: those belong to the user's own gateway configuration.
//
// Placeholder legend:
//
//   <YOUR_STRONG_REASONING_MODEL>
//     A flagship reasoning model (think Claude Opus tier). Drives orchestration,
//     planning, review, and brainstorm surfaces. Pay extra here; the downstream
//     implementers amplify its decisions.
//
//   <YOUR_FRONTEND_MODEL>
//     A model that is strong at UI, styling, component design, and modern
//     frontend framework idioms (React / Vue / Svelte, CSS-in-JS, etc).
//
//   <YOUR_BACKEND_MODEL>
//     A model that is strong at server-side code, APIs, databases, type systems,
//     and general-purpose programming. Also a reasonable default for shared
//     tooling and config tasks.
//
//   <YOUR_DIAGNOSTIC_MODEL>
//     A model tuned for fast evidence correlation across files, configs, logs,
//     and prior facts. The recommended choice is Claude Sonnet 4.6: fast enough
//     for read-only investigation and strong enough to build evidence chains.
//     Used by the investigator agent.
//
// Model string format: "provider_id/model_id". The provider_id must already be
// registered in your opencode.json under the \`provider\` object.
//
// All fields below are optional. Micode merges this file with opencode.json
// defaults and with its own plugin fallback (src/utils/config.ts:DEFAULT_MODEL),
// so agents you omit here simply use the opencode default.
{
  "agents": {
    // --- Orchestration and review (strong reasoning) ---
    "commander": { "model": "<YOUR_STRONG_REASONING_MODEL>" },
    "planner": { "model": "<YOUR_STRONG_REASONING_MODEL>" },
    "executor": { "model": "<YOUR_STRONG_REASONING_MODEL>" },
    "reviewer": { "model": "<YOUR_STRONG_REASONING_MODEL>" },

    // --- Brainstorm entry points (both primary-mode, user picks per session) ---
    "brainstormer": { "model": "<YOUR_STRONG_REASONING_MODEL>" },
    "octto": { "model": "<YOUR_STRONG_REASONING_MODEL>" },

    // --- Domain-specialist implementers (the point of this fork) ---
    "implementer-frontend": { "model": "<YOUR_FRONTEND_MODEL>" },
    "implementer-backend": { "model": "<YOUR_BACKEND_MODEL>" },
    "implementer-general": { "model": "<YOUR_BACKEND_MODEL>" },

    // --- Diagnostic read-only investigator ---
    "investigator": { "model": "<YOUR_DIAGNOSTIC_MODEL>" }
  }

  // Other top-level keys you MAY add:
  //
  // "compactionThreshold": 0.7,
  //
  // "features": {
  //   "mindmodelInjection": true,
  //   // Re-enable the legacy chat-message title fallback. Off by default in
  //   // micode v9: ordinary chat messages no longer rename the conversation;
  //   // titles come from lifecycle and tool milestones (lifecycle_start_request,
  //   // lifecycle_commit, lifecycle_finish, plan/design writes). Set to true
  //   // only if you want the pre-v9 behavior where the first user message
  //   // sets the title.
  //   "conversationTitleChatFallback": false
  // },
  //
  // "fragments": {
  //   "commander": ["Prefer TypeScript over plain JavaScript in examples"],
  //   "implementer-frontend": ["This project uses Tailwind; no CSS modules"]
  // }
}
```

The implementer should produce this exact file. Two changes from the current state:
1. New legend entry `<YOUR_DIAGNOSTIC_MODEL>` inserted after the `<YOUR_BACKEND_MODEL>` block.
2. New agent entry `"investigator": { "model": "<YOUR_DIAGNOSTIC_MODEL>" }` inserted after `"implementer-general"`. Note the trailing comma added to the previous `"implementer-general"` line so the new line is well-formed JSONC.

**Verify:** `bun run check` (Biome will accept JSONC; no test runs for this file directly, but `bun test tests/config-loader-integration.test.ts` after Task 2.2 will exercise the investigator agent registration.)
**Commit:** `feat(config): document investigator placeholder in micode.example.jsonc`

---

## Batch 2: Registry (parallel - 2 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2

### Task 2.1: register investigator in agent registry
**File:** `src/agents/index.ts`
**Test:** `tests/agents/index.test.ts` (extend existing test file)
**Depends:** 1.1 (imports `investigatorAgent` from the file created in 1.1)
**Domain:** general

The implementer makes two surgical edits in each file. No rewrite of the rest.

```typescript
// tests/agents/index.test.ts — append the following test inside the existing
// `describe("agents index", ...)` block, after the existing tests. Do not modify
// existing tests.

  it("registers investigator agent at default model", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents.investigator).toBeDefined();
    expect(module.agents.investigator.mode).toBe("subagent");
    // The shared assertion in "should use DEFAULT_MODEL for all agents" already
    // covers the model field, but we re-assert here so an investigator-specific
    // regression surfaces in the dedicated test.
    expect(module.agents.investigator.model).toBe(DEFAULT_MODEL);
  });

  it("re-exports investigatorAgent from the agents barrel", async () => {
    const module = await import("../../src/agents/index");

    expect((module as Record<string, unknown>).investigatorAgent).toBeDefined();
  });
```

```typescript
// src/agents/index.ts — two edits:
//
// Edit A: add an import. Insert this line in alphabetical order among the existing
// agent imports, between `./implementer-general` and `./ledger-creator`:
import { investigatorAgent } from "./investigator";

// Edit B: add a registry entry. Insert this line inside the `agents` Record literal,
// immediately after the `reviewer:` entry and before the `executor:` entry, so it
// sits next to the other read-only specialists:
  investigator: { ...investigatorAgent, model: DEFAULT_MODEL },

// Edit C: add to the named exports list. Insert `investigatorAgent` in the
// re-export block at the bottom of the file, between `reviewerAgent` and
// `executorAgent`:
//
// export {
//   ...,
//   reviewerAgent,
//   investigatorAgent,
//   executorAgent,
//   ...,
// };
```

The full updated `agents` registry literal in `src/agents/index.ts` after this task should look like:

```typescript
export const agents: Record<string, AgentConfig> = {
  [PRIMARY_AGENT_NAME]: { ...primaryAgent, model: DEFAULT_MODEL },
  brainstormer: { ...brainstormerAgent, model: DEFAULT_MODEL },
  bootstrapper: { ...bootstrapperAgent, model: DEFAULT_MODEL },
  "codebase-locator": { ...codebaseLocatorAgent, model: DEFAULT_MODEL },
  "codebase-analyzer": { ...codebaseAnalyzerAgent, model: DEFAULT_MODEL },
  "pattern-finder": { ...patternFinderAgent, model: DEFAULT_MODEL },
  planner: { ...plannerAgent, model: DEFAULT_MODEL },
  "implementer-frontend": { ...implementerFrontendAgent, model: DEFAULT_MODEL },
  "implementer-backend": { ...implementerBackendAgent, model: DEFAULT_MODEL },
  "implementer-general": { ...implementerGeneralAgent, model: DEFAULT_MODEL },
  reviewer: { ...reviewerAgent, model: DEFAULT_MODEL },
  investigator: { ...investigatorAgent, model: DEFAULT_MODEL },
  executor: { ...executorAgent, model: DEFAULT_MODEL },
  "ledger-creator": { ...ledgerCreatorAgent, model: DEFAULT_MODEL },
  "artifact-searcher": { ...artifactSearcherAgent, model: DEFAULT_MODEL },
  "notification-courier": { ...notificationCourierAgent, model: DEFAULT_MODEL },
  "project-initializer": { ...projectInitializerAgent, model: DEFAULT_MODEL },
  octto: { ...octtoAgent, model: DEFAULT_MODEL },
  probe: { ...probeAgent, model: DEFAULT_MODEL },
  // Mindmodel generation agents
  "mm-stack-detector": { ...stackDetectorAgent, model: DEFAULT_MODEL },
  "mm-pattern-discoverer": { ...mindmodelPatternDiscovererAgent, model: DEFAULT_MODEL },
  "mm-example-extractor": { ...exampleExtractorAgent, model: DEFAULT_MODEL },
  "mm-orchestrator": { ...mindmodelOrchestratorAgent, model: DEFAULT_MODEL },
  // Mindmodel v2 analysis agents
  "mm-dependency-mapper": { ...dependencyMapperAgent, model: DEFAULT_MODEL },
  "mm-convention-extractor": { ...conventionExtractorAgent, model: DEFAULT_MODEL },
  "mm-domain-extractor": { ...domainExtractorAgent, model: DEFAULT_MODEL },
  "mm-code-clusterer": { ...codeClustererAgent, model: DEFAULT_MODEL },
  "mm-anti-pattern-detector": { ...antiPatternDetectorAgent, model: DEFAULT_MODEL },
  "mm-constraint-writer": { ...constraintWriterAgent, model: DEFAULT_MODEL },
  "mm-constraint-reviewer": { ...constraintReviewerAgent, model: DEFAULT_MODEL },
};
```

And the named-export block:

```typescript
export {
  primaryAgent,
  PRIMARY_AGENT_NAME,
  brainstormerAgent,
  bootstrapperAgent,
  codebaseLocatorAgent,
  codebaseAnalyzerAgent,
  patternFinderAgent,
  plannerAgent,
  implementerAgent,
  implementerFrontendAgent,
  implementerBackendAgent,
  implementerGeneralAgent,
  reviewerAgent,
  investigatorAgent,
  executorAgent,
  ledgerCreatorAgent,
  artifactSearcherAgent,
  octtoAgent,
  probeAgent,
};
```

The existing universal assertion at the bottom of `tests/agents/index.test.ts`, `it("should use DEFAULT_MODEL for all agents", ...)`, will automatically cover `investigator` because it iterates `Object.entries(module.agents)`. No edit to that test is required.

**Verify:** `bun test tests/agents/index.test.ts`
**Commit:** `feat(agents): register investigator agent in registry`

### Task 2.2: extend config-loader integration test for investigator
**File:** `tests/config-loader-integration.test.ts`
**Test:** the file is the test
**Depends:** 2.1 (the integration test imports the registry; investigator must be present)
**Domain:** general

Two edits inside the existing `describe("config-loader integration", ...)` block. Do not modify the existing tests.

```typescript
// Edit A: extend the `expectedAgents` array in the first `it(...)` test. Add
// "investigator" between "reviewer" and "executor" so the diagnostic specialist
// sits next to the other read-only specialist:

    const expectedAgents = [
      "commander",
      "brainstormer",
      "codebase-locator",
      "codebase-analyzer",
      "pattern-finder",
      "planner",
      "implementer-frontend",
      "implementer-backend",
      "implementer-general",
      "reviewer",
      "investigator",
      "executor",
      "ledger-creator",
      "artifact-searcher",
      "mm-orchestrator",
    ];
```

```typescript
// Edit B: append a new test at the end of the describe block to cover the
// per-agent model override scenario specifically for investigator. This is the
// concrete regression test for the design's "Active config maps investigator
// to Claude Sonnet 4.6" check.

  it("merges a user override that pins investigator to a Sonnet-class model", () => {
    const userConfig = {
      agents: {
        investigator: { model: "anthropic/claude-sonnet-4-6" },
      },
    };

    const availableModels = new Set(["anthropic/claude-sonnet-4-6", DEFAULT_MODEL]);

    const merged = mergeAgentConfigs(agents, userConfig, availableModels);

    expect(merged.investigator).toBeDefined();
    expect(merged.investigator.model).toBe("anthropic/claude-sonnet-4-6");
    expect(merged.investigator.mode).toBe("subagent");
    // Original prompt and tool restrictions must be preserved by the merge.
    expect(merged.investigator.prompt).toBeDefined();
    expect(merged.investigator.tools?.write).toBe(false);
    expect(merged.investigator.tools?.edit).toBe(false);
  });
```

The model string `anthropic/claude-sonnet-4-6` is illustrative for the test only. It does not commit the repo to that exact provider key. The test asserts the merge mechanism, not the provider naming. The user is free to pick any provider/model in their own `micode.json`.

**Verify:** `bun test tests/config-loader-integration.test.ts`
**Commit:** `test(config-loader): cover investigator agent in integration test`

---

## Batch 3: Coordinator Routing Guidance (parallel - 3 implementers)

All tasks in this batch depend on Batch 2 completing.
Tasks: 3.1, 3.2, 3.3

### Task 3.1: commander routing-by-requested-output guidance
**File:** `src/agents/commander.ts`
**Test:** `tests/agents/commander.test.ts` (extend existing test file)
**Depends:** 2.1 (the registry must contain investigator before commander references it)
**Domain:** general

Two surgical edits in `src/agents/commander.ts` and three test additions. Do NOT rewrite the prompt; only insert.

```typescript
// tests/agents/commander.test.ts — append the following tests inside the existing
// `describe("commander agent", ...)` block.

  it("documents routing by requested output, not by keyword triggers", () => {
    const source = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "..", "src", "agents", "commander.ts"),
      "utf-8",
    );

    expect(source).toContain("routing-by-requested-output");
    // The four output classes must each be named.
    expect(source.toLowerCase()).toContain("location");
    expect(source.toLowerCase()).toContain("explanation");
    expect(source.toLowerCase()).toContain("diagnosis");
    expect(source.toLowerCase()).toContain("mutation");
    // No keyword trigger lists.
    expect(source).not.toMatch(/trigger\s+keywords?\s*:/i);
  });

  it("references investigator as the diagnostic read-only specialist", () => {
    const source = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "..", "src", "agents", "commander.ts"),
      "utf-8",
    );

    expect(source).toContain("investigator");
    // Must distinguish investigator from executor on side effects.
    expect(source.toLowerCase()).toContain("read-only");
    expect(source.toLowerCase()).toContain("side effect");
  });

  it("does not weaken executor by routing implementation work elsewhere", () => {
    const source = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "..", "src", "agents", "commander.ts"),
      "utf-8",
    );

    // executor must still own delivery/mutation/commits per the design constraints.
    expect(source).toMatch(/executor[^]{0,200}delivery|mutation|commit/i);
  });
```

```typescript
// src/agents/commander.ts — Edit A: add a new <agent> line in the existing
// <agents> block, between the "pattern-finder" line and the "planner" line:

<agent name="investigator" mode="subagent" purpose="Diagnostic read-only investigation: produces a fact-backed diagnosis package, does NOT mutate"/>
```

```typescript
// src/agents/commander.ts — Edit B: insert a new top-level block just BEFORE the
// existing <agents> block (around line 169, after </completion-notify>). The new
// block defines routing by requested output. Use this exact content so the test
// assertions in tests/agents/commander.test.ts match. Do not edit any existing
// block.

<routing-by-requested-output priority="critical" description="Pick the subagent by what the user wants as output, not by keywords">
<rule>Decide routing by two questions only: (1) what is the requested output, and (2) does the user want a side effect (mutation, commit, deploy) or just information.</rule>
<rule>Never use keyword trigger lists. The user's vocabulary is unreliable; the requested output is the contract.</rule>

<output-class name="location" agent="codebase-locator">
  Requested output is "where does X live", a list of file paths or modules.
  No code explanation, no diagnosis, no fix.
</output-class>

<output-class name="explanation" agent="codebase-analyzer">
  Requested output is "how does X work", an annotated walkthrough of code paths,
  data flow, or architecture. No symptom-driven hypothesis, no fix.
</output-class>

<output-class name="diagnosis" agent="investigator">
  Requested output is a fact-backed diagnosis package: confirmed facts, evidence
  chain, likely cause, uncertainty, escalation recommendation. The user has
  observed a failure, an inconsistency, an unknown cause, or a runtime symptom
  and wants to know WHY before deciding what to change. The user has NOT asked
  for a code change in the same turn, or has explicitly said "just investigate,
  don't change anything yet". The investigator never mutates anything; if a fix
  is required, the investigator escalates and YOU then route to executor.
</output-class>

<output-class name="mutation" agent="executor">
  Requested output is a changed system: applied code, applied config, deployed
  artifact, completed lifecycle task. Anything that requires writing files,
  committing, pushing, restarting, or deploying. The executor remains the sole
  delivery orchestrator and dispatches implementer-frontend / implementer-backend
  / implementer-general / reviewer per the existing workflow.
</output-class>

<combinations>
<rule>If the user asks for diagnosis AND a fix in the same turn, run investigator first, then route the evidence package to executor for the fix. Do not skip the investigation.</rule>
<rule>If the user asks "find out why X happens and decide what to do", that is diagnosis: route to investigator and let it recommend escalation.</rule>
<rule>If the user only wants a code-location or how-it-works walkthrough with no symptom and no requested change, do NOT route to investigator. Use locator or analyzer.</rule>
</combinations>

<anti-patterns>
<rule>Do NOT route to executor just because executor is the strongest model. Executor is for delivery and mutation, not for "go find out what happened".</rule>
<rule>Do NOT downgrade investigator into a generic read-only fallback. It exists for diagnostic questions, not for every read.</rule>
<rule>Do NOT enumerate trigger words ("error", "bug", "logs", "diagnose"). Those words appear in non-diagnostic requests too. Classify by requested output and side-effect requirement instead.</rule>
</anti-patterns>
</routing-by-requested-output>
```

```typescript
// src/agents/commander.ts — Edit C: in the <environment> block at the top of
// PROMPT, the comma-separated agent list mentions specific agents. Add
// "investigator" between "executor" and "implementer". The full updated line:

Available micode agents: commander, brainstormer, planner, executor, investigator, implementer, reviewer, codebase-locator, codebase-analyzer, pattern-finder, ledger-creator, artifact-searcher, mm-orchestrator.
```

**Verify:** `bun test tests/agents/commander.test.ts`
**Commit:** `feat(commander): route by requested output and add investigator lane`

### Task 3.2: brainstormer routing-by-requested-output guidance
**File:** `src/agents/brainstormer.ts`
**Test:** `tests/agents/brainstormer.test.ts` (extend existing test file)
**Depends:** 2.1
**Domain:** general

Three surgical edits in `src/agents/brainstormer.ts` mirroring 3.1, plus tests.

```typescript
// tests/agents/brainstormer.test.ts — append the following tests inside the
// existing describe block.

  it("references investigator as a subagent for diagnostic read-only work", () => {
    const source = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"),
      "utf-8",
    );

    expect(source).toContain('name="investigator"');
    expect(source.toLowerCase()).toContain("diagnostic");
    expect(source.toLowerCase()).toContain("read-only");
  });

  it("documents the same four-class routing rule as the commander", () => {
    const source = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"),
      "utf-8",
    );

    expect(source).toContain("routing-by-requested-output");
    expect(source.toLowerCase()).toContain("location");
    expect(source.toLowerCase()).toContain("explanation");
    expect(source.toLowerCase()).toContain("diagnosis");
    expect(source.toLowerCase()).toContain("mutation");
  });

  it("does not introduce keyword trigger lists", () => {
    const source = require("node:fs").readFileSync(
      require("node:path").join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"),
      "utf-8",
    );

    expect(source).not.toMatch(/trigger\s+keywords?\s*:/i);
  });
```

```typescript
// src/agents/brainstormer.ts — Edit A: in the <environment> block, the
// comma-separated agent list. Add "investigator" between "executor" and
// "implementer":

Available micode agents: commander, brainstormer, planner, executor, investigator, implementer, reviewer, codebase-locator, codebase-analyzer, pattern-finder, ledger-creator, artifact-searcher, mm-orchestrator.
```

```typescript
// src/agents/brainstormer.ts — Edit B: in the existing <available-subagents>
// block (around line 98-104), add a new <subagent> entry between
// "pattern-finder" and "planner":

  <subagent name="investigator">Diagnostic read-only investigation: produces a fact-backed diagnosis package. Use when the user reports an observed failure, inconsistency, runtime symptom, or unknown cause and wants WHY before any change. Never mutates.</subagent>
```

```typescript
// src/agents/brainstormer.ts — Edit C: insert a new top-level block just BEFORE
// the existing <available-subagents> block. Use the same content shape as the
// commander's <routing-by-requested-output> block in Task 3.1, adapted for
// brainstormer's voice (brainstormer dispatches research subagents during the
// design phase). The four output classes are identical: location, explanation,
// diagnosis, mutation. Do not introduce keyword trigger lists.

<routing-by-requested-output priority="critical" description="During design exploration, pick the subagent by what the user wants as output, not by keywords">
<rule>Decide routing by two questions only: (1) what is the requested output, and (2) does the user want a side effect (mutation, commit, deploy) or just information.</rule>
<rule>Never use keyword trigger lists. The user's vocabulary is unreliable; the requested output is the contract.</rule>

<output-class name="location" agent="codebase-locator">
  Requested output is "where does X live". File paths only.
</output-class>

<output-class name="explanation" agent="codebase-analyzer">
  Requested output is "how does X work". Code walkthrough, no symptom-driven diagnosis.
</output-class>

<output-class name="diagnosis" agent="investigator">
  Requested output is a fact-backed diagnosis package for an observed failure,
  inconsistency, runtime symptom, or unknown cause. Use during design phase when
  the user surfaces a real-world incident and you need to understand WHY before
  proposing an architectural change. The investigator never mutates and recommends
  escalation; you then decide whether the design needs to absorb the finding.
</output-class>

<output-class name="mutation" agent="executor">
  Brainstormer does not perform mutations during design exploration. If the
  conversation has reached a point where mutation is the requested output, the
  next step is the planner, then the executor, not a brainstormer subagent.
</output-class>

<combinations>
<rule>During design phase, parallel-fan-out across locator + analyzer + investigator is valid when the user describes a feature whose surface area includes a real bug or symptom that must be understood first.</rule>
<rule>If the user only wants design exploration with no failing system in the loop, do NOT spawn investigator.</rule>
</combinations>
</routing-by-requested-output>
```

**Verify:** `bun test tests/agents/brainstormer.test.ts`
**Commit:** `feat(brainstormer): route by requested output and add investigator lane`

### Task 3.3: cross-cutting routing test
**File:** `tests/agents/investigator-routing.test.ts`
**Test:** the file is the test (new file)
**Depends:** 3.1, 3.2 (both coordinator prompts must be in their final shape)
**Domain:** general

A single new test file that asserts the routing contract across both coordinators. This is the regression net for the design's "Coordinator prompt guidance differentiates locator, analyzer, investigator, and executor by requested output" check.

```typescript
// tests/agents/investigator-routing.test.ts
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

const COORDINATORS = [
  { name: "commander", source: COMMANDER_SOURCE },
  { name: "brainstormer", source: BRAINSTORMER_SOURCE },
];

describe("investigator routing contract (cross-coordinator)", () => {
  for (const coord of COORDINATORS) {
    describe(coord.name, () => {
      it("declares routing by requested output, not by keywords", () => {
        expect(coord.source).toContain("routing-by-requested-output");
        expect(coord.source).not.toMatch(/trigger\s+keywords?\s*:/i);
        expect(coord.source).not.toMatch(/keyword\s+list/i);
      });

      it("names all four output classes: location, explanation, diagnosis, mutation", () => {
        const lower = coord.source.toLowerCase();
        expect(lower).toContain("location");
        expect(lower).toContain("explanation");
        expect(lower).toContain("diagnosis");
        expect(lower).toContain("mutation");
      });

      it("maps diagnosis to investigator and mutation to executor", () => {
        // Diagnosis class declaration must mention agent="investigator".
        const diagnosisBlock = coord.source.match(
          /<output-class name="diagnosis" agent="([^"]+)">/,
        );
        expect(diagnosisBlock).not.toBeNull();
        expect(diagnosisBlock?.[1]).toBe("investigator");

        // Mutation class declaration must reference executor as the agent.
        const mutationBlock = coord.source.match(
          /<output-class name="mutation" agent="([^"]+)">/,
        );
        expect(mutationBlock).not.toBeNull();
        expect(mutationBlock?.[1]).toBe("executor");
      });

      it("preserves locator and analyzer responsibilities", () => {
        // Per design: "Preserve existing responsibilities for codebase-locator,
        // codebase-analyzer, pattern-finder, executor, and reviewer."
        expect(coord.source).toMatch(/<output-class name="location" agent="codebase-locator">/);
        expect(coord.source).toMatch(/<output-class name="explanation" agent="codebase-analyzer">/);
      });

      it("describes investigator as read-only, side-effect-free", () => {
        // The investigator output-class block must mention that the agent never
        // mutates. Read the diagnosis block and assert content.
        const diagnosisMatch = coord.source.match(
          /<output-class name="diagnosis" agent="investigator">([\s\S]*?)<\/output-class>/,
        );
        expect(diagnosisMatch).not.toBeNull();
        const body = (diagnosisMatch?.[1] ?? "").toLowerCase();
        expect(body).toMatch(/never mutates|read-only|does not mutate/);
      });
    });
  }

  it("both coordinators agree on the investigator agent name spelling", () => {
    expect(COMMANDER_SOURCE).toContain("investigator");
    expect(BRAINSTORMER_SOURCE).toContain("investigator");
    // No drift to "investagator" / "investagor" / camelCase variants in prompt strings.
    expect(COMMANDER_SOURCE).not.toMatch(/investagator|investagor/i);
    expect(BRAINSTORMER_SOURCE).not.toMatch(/investagator|investagor/i);
  });
});
```

**Verify:** `bun test tests/agents/investigator-routing.test.ts`
**Commit:** `test(agents): assert investigator routing contract across coordinators`
