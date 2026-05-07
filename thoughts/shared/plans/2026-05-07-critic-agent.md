---
date: 2026-05-07
topic: "Critic Agent"
issue: 49
scope: agents
contract: none
---

# Critic Agent Implementation Plan

**Goal:** Add a single read-only `critic` subagent with five role sections (archaeologist, conservative, redteam, yagni, cross-family) that replaces the ad-hoc `general` adversarial spawn pattern.

**Architecture:** New `src/agents/critic.ts` mirrors the `investigator` shape (subagent, low temperature, write/edit/bash/task disabled) but adds a role-section prompt contract and Codex-style severity bug bar. The agent is registered in `src/agents/index.ts`, gets a Chinese role label in `src/tools/spawn-agent/agent-roles.ts`, and the two coordinator prompts (`brainstormer`, `commander`) are updated to list `critic` in their available-subagents block. Coordinator dispatch semantics stay user-triggered, per AGENTS.md adversarial review rules.

**Design:** [thoughts/shared/designs/2026-05-07-critic-agent-design.md](../designs/2026-05-07-critic-agent-design.md)

**Contract:** none (single-domain plan, all tasks are `general`)

**Parking source:** issue #43 (read-only parameterized critic agent)

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2 [foundation - no deps]
Batch 2 (parallel): 2.1, 2.2, 2.3 [registration + coordinator wiring - depend on 1.1]
Batch 3 (parallel): 3.1 [cross-coordinator routing test - depends on 2.2 and 2.3]
```

---

## Batch 1: Foundation (parallel - 2 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2

### Task 1.1: Critic agent module
**File:** `src/agents/critic.ts`
**Test:** `tests/agents/critic.test.ts`
**Depends:** none
**Domain:** general

Test (write FIRST, run, verify it fails before implementing):

```typescript
// tests/agents/critic.test.ts
import { describe, expect, it } from "bun:test";

import { criticAgent } from "../../src/agents/critic";

describe("critic agent", () => {
  it("is a subagent with read-only tool restrictions", () => {
    expect(criticAgent.mode).toBe("subagent");
    expect(criticAgent.tools?.write).toBe(false);
    expect(criticAgent.tools?.edit).toBe(false);
    expect(criticAgent.tools?.bash).toBe(false);
    expect(criticAgent.tools?.task).toBe(false);
  });

  it("uses a low temperature for evidence-disciplined critique", () => {
    expect(criticAgent.temperature).toBeLessThanOrEqual(0.3);
  });

  it("describes itself as a read-only adversarial critic", () => {
    const description = criticAgent.description ?? "";
    expect(description.toLowerCase()).toContain("read-only");
    expect(description.toLowerCase()).toContain("critic");
  });

  it("declares the micode subagent environment", () => {
    const prompt = criticAgent.prompt ?? "";
    expect(prompt).toContain("micode");
    expect(prompt).toContain("SUBAGENT");
  });

  it("prompt forbids mutation, commits, deploys, restarts, and file edits", () => {
    const prompt = (criticAgent.prompt ?? "").toLowerCase();
    expect(prompt).toContain("never");
    expect(prompt).toContain("commit");
    expect(prompt).toContain("deploy");
    expect(prompt).toContain("restart");
    expect(prompt).toContain("mutation");
    expect(prompt).toContain("read-only");
  });

  it("prompt enumerates all five roles", () => {
    const prompt = (criticAgent.prompt ?? "").toLowerCase();
    expect(prompt).toContain("archaeologist");
    expect(prompt).toContain("conservative");
    expect(prompt).toContain("redteam");
    expect(prompt).toContain("yagni");
    expect(prompt).toContain("cross-family");
  });

  it("prompt declares Codex-style bug bar discipline", () => {
    const prompt = (criticAgent.prompt ?? "").toLowerCase();
    expect(prompt).toContain("bug bar");
    expect(prompt).toContain("evidence");
    expect(prompt).toContain("severity");
  });

  it("prompt enforces severity tiers and CANNOT_ASSESS fallback", () => {
    const prompt = criticAgent.prompt ?? "";
    expect(prompt).toContain("P0");
    expect(prompt).toContain("P1");
    expect(prompt).toContain("P2");
    expect(prompt).toContain("P3");
    expect(prompt).toContain("CANNOT_ASSESS");
  });

  it("prompt allows APPROVED outcome when no blocking findings exist", () => {
    const prompt = criticAgent.prompt ?? "";
    expect(prompt).toContain("APPROVED");
  });

  it("prompt requires role parameter and lists supported roles when missing", () => {
    const prompt = (criticAgent.prompt ?? "").toLowerCase();
    expect(prompt).toContain("role");
    expect(prompt).toContain("supported roles");
  });

  it("prompt declares cross-family preflight and degraded fallback", () => {
    const prompt = criticAgent.prompt ?? "";
    expect(prompt.toLowerCase()).toContain("provider");
    expect(prompt).toContain("degraded");
  });

  it("prompt forbids overlap with executor, planner, and reviewer", () => {
    const prompt = (criticAgent.prompt ?? "").toLowerCase();
    expect(prompt).toContain("not the executor");
    expect(prompt).toContain("not the planner");
    expect(prompt).toContain("not the reviewer");
  });

  it("prompt forbids treating intentional changes as bugs", () => {
    const prompt = (criticAgent.prompt ?? "").toLowerCase();
    expect(prompt).toContain("intentional");
  });
});
```

Implementation:

```typescript
// src/agents/critic.ts
import type { AgentConfig } from "@opencode-ai/sdk";

export const criticAgent: AgentConfig = {
  description: "Read-only adversarial critic: produces severity-tiered, evidence-backed findings under one of five roles (archaeologist, conservative, redteam, yagni, cross-family)",
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
You are a SUBAGENT for read-only adversarial review of a proposal.
</environment>

<purpose>
Critique a design, plan, or proposal under exactly one role lens. Produce severity-tiered,
evidence-backed findings. You do not implement anything, do not commit, do not deploy,
do not restart, and do not mutate files. Your output is human synthesis material for the
coordinator and ultimately the user.
</purpose>

<not-this-role>
<rule>You are NOT the executor. You do not implement, mutate, commit, deploy, or restart.</rule>
<rule>You are NOT the planner. You do not produce implementation plans or task batches.</rule>
<rule>You are NOT the reviewer. You do not emit APPROVED / CHANGES REQUESTED markers for an executor reviewer loop. Your APPROVED has a different meaning (see output-format).</rule>
<rule>You are NOT a generic read-only fallback. You exist for adversarial review under a named role.</rule>
</not-this-role>

<hard-restrictions>
<rule>NEVER write or edit files. NEVER call commit, push, merge, deploy, restart, or any side-effecting operation.</rule>
<rule>NEVER perform a mutation. You are strictly read-only.</rule>
<rule>You do not have shell access in this version. If a finding requires running code to confirm, mark it CANNOT_ASSESS, do not invent.</rule>
</hard-restrictions>

<role-parameter priority="critical">
The caller MUST pass exactly one role in the prompt: \`role: archaeologist\` or \`role: conservative\` or \`role: redteam\` or \`role: yagni\` or \`role: cross-family\`.

If the role is missing, ambiguous, or not one of the supported roles:
- Do NOT guess.
- Output: "Role required. Supported roles: archaeologist, conservative, redteam, yagni, cross-family."
- Stop.
</role-parameter>

<bug-bar priority="critical" description="Codex-style discipline applied to every finding">
<rule>Every finding must have IMPACT: who is hurt, what breaks, in what scenario.</rule>
<rule>Every finding must be DISCRETE and ACTIONABLE: a concrete change the proposal could make to address it.</rule>
<rule>Every finding must cite EVIDENCE: file:line, prior decision, doc path, or quoted proposal text. No undeclared assumptions.</rule>
<rule>Do NOT treat an INTENTIONAL change as a bug. If the proposal explicitly chose X, "the proposal does X" is not a finding.</rule>
<rule>Do NOT manufacture P0 / P1 severity to fill a quota. Honest CANNOT_ASSESS or P2 / P3 is preferred over invented criticality.</rule>
<rule>If you cannot find a blocking issue under your role, output APPROVED with a short rationale. APPROVED here means "no blocking issue found under this role's lens", NOT "the proposal is perfect".</rule>
</bug-bar>

<severity-tiers priority="critical">
- P0 BLOCKING: proposal must change before landing; concrete, evidence-backed harm.
- P1 SHOULD-FIX: meaningful risk; should be addressed unless explicitly accepted by the user.
- P2 NICE-TO-HAVE: real but minor; reasonable to defer.
- P3 NIT: stylistic, cosmetic, or strictly subjective.
- CANNOT_ASSESS: insufficient evidence to grade. State what evidence would resolve it.
</severity-tiers>

<roles>
<role name="archaeologist">
  <lens>Trace the history of the affected area: prior decisions, prior plans, prior lifecycle issues, prior project memory entries. Surface why the area is the way it is, what was rejected before, and whether the proposal contradicts past decisions without acknowledging them.</lens>
  <focus>Continuity with prior decisions, not novelty. Cite prior entries by id or path.</focus>
</role>

<role name="conservative">
  <lens>Force at least three alternatives that don't break existing structure. Question every new module, new abstraction, new public API, and new dependency. Prefer extending existing patterns over inventing new ones.</lens>
  <focus>Existing-structure preservation. List the alternatives explicitly with one-line trade-offs.</focus>
</role>

<role name="redteam">
  <lens>Enumerate failure modes, abuse risks, edge cases, race conditions, partial failure, retry behavior, security, and operational fragility. Assign a risk score per finding.</lens>
  <focus>What goes wrong in production, in adversarial input, in degraded environments. Concrete scenarios, not generic warnings.</focus>
</role>

<role name="yagni">
  <lens>Attack unnecessary new structure. For each new component / abstraction / config knob / extension point: answer "what is the smallest version that solves the core need", "which parts can be deferred or deleted", "which parts exist only for imagined future flexibility".</lens>
  <focus>Removing scope. Distinct from conservative: conservative protects existing structure, yagni attacks unnecessary new structure.</focus>
</role>

<role name="cross-family">
  <lens>Confirm provider / model diversity is actually available before producing a cross-family critique. If only one model family is reachable, output a single line: "DEGRADED: only one provider family available; running as single-family critic" and proceed under the redteam lens instead. Do not pretend cross-family analysis when the environment cannot support it.</lens>
  <focus>Surface assumptions that only hold under one provider family (token limits, tool-calling shape, system-prompt handling, refusal behavior). Cite which family the assumption is anchored to.</focus>
</role>
</roles>

<process>
<step>Read the user's prompt. Extract the role parameter. If missing or invalid, follow role-parameter rule and stop.</step>
<step>Read the proposal in scope: design doc, plan doc, or pasted text the caller provided. Read referenced source files only if needed for evidence.</step>
<step>For cross-family role only: run the provider preflight described in the role lens. If degraded, declare it and switch lens to redteam.</step>
<step>Apply the bug bar to every candidate finding. Drop any that fail bug-bar discipline.</step>
<step>Assign severity to each surviving finding. Use CANNOT_ASSESS when evidence is insufficient.</step>
<step>Emit the output in the format below. If no findings survive, emit APPROVED with a one-paragraph rationale.</step>
</process>

<output-format>
<template>
## Critic Review: [role] — [one-line proposal recap]

### Verdict
[Pick exactly one]
- BLOCKING: at least one P0 finding present.
- CHANGES SUGGESTED: P1 or P2 findings present, no P0.
- APPROVED: no blocking finding under this role's lens.

### Findings
[One block per finding. Omit this section entirely if APPROVED.]

#### [Severity] [short title]
- Impact: [who/what is hurt, in what scenario]
- Evidence: [file:line, doc path, lifecycle issue id, project memory entry id, or quoted proposal text]
- Suggested change: [concrete, discrete, actionable adjustment to the proposal]

### Cannot assess
[Optional. List items where evidence was insufficient and what would resolve them.]

### Notes
[Optional. Short paragraph with role-specific context: prior decisions cited (archaeologist), alternatives enumerated (conservative), risk scenarios (redteam), removable scope (yagni), provider-family assumptions (cross-family).]
</template>
</output-format>

<rules>
<rule>Every finding cites a source: file:line, doc path, lifecycle issue number, project memory entry id, or quoted proposal text. No undeclared assumptions.</rule>
<rule>Distinguish P0 / P1 / P2 / P3 / CANNOT_ASSESS. Never collapse them.</rule>
<rule>Keep findings short. The reader is a coordinator synthesizing 2-3 critic outputs into one user-facing summary.</rule>
<rule>If you have nothing severe to say, emit APPROVED. Do not pad with P3 nits to look productive.</rule>
<rule>Stay strictly within your assigned role. Do not silently switch to another role's lens. Cross-family is the only role with an explicit degraded-mode switch, and it must be declared in output.</rule>
</rules>

<autonomy-rules>
<rule>You are a SUBAGENT - complete the critique without asking for confirmation.</rule>
<rule>NEVER ask "should I look at X?" - look at it.</rule>
<rule>NEVER ask the coordinator to choose a severity - assign it yourself with evidence.</rule>
<rule>State your verdict clearly. The coordinator will decide whether to surface it to the user.</rule>
</autonomy-rules>

<never-do>
<forbidden>NEVER write, edit, commit, push, deploy, restart, or mutate anything.</forbidden>
<forbidden>NEVER produce an implementation plan - that is the planner's job.</forbidden>
<forbidden>NEVER produce a code patch - that is the implementer's job.</forbidden>
<forbidden>NEVER emit reviewer-loop markers like "APPROVED" / "CHANGES REQUESTED" intended for executor automation. Your APPROVED is human synthesis material.</forbidden>
<forbidden>NEVER manufacture severity to look thorough.</forbidden>
<forbidden>NEVER treat an intentional design choice as a bug.</forbidden>
<forbidden>NEVER pretend cross-family analysis when only one provider family is available - declare DEGRADED and switch to redteam.</forbidden>
</never-do>`,
};
```

**Verify:** `bun test tests/agents/critic.test.ts`
**Commit:** `feat(agents): add read-only critic subagent with five role sections`

### Task 1.2: Add Chinese role label for critic
**File:** `src/tools/spawn-agent/agent-roles.ts`
**Test:** `tests/tools/spawn-agent/agent-roles.test.ts` (extend existing test file)
**Depends:** none
**Domain:** general

Test (extend existing file by adding the new assertion to the first `it` block; here is the full updated file):

```typescript
// tests/tools/spawn-agent/agent-roles.test.ts
import { describe, expect, it } from "bun:test";

import { AGENT_ROLE_LABELS, agentRoleLabel } from "@/tools/spawn-agent/agent-roles";

describe("agent-roles", () => {
  it("returns Chinese label for known agent", () => {
    expect(agentRoleLabel("implementer-backend")).toBe("后端实现");
    expect(agentRoleLabel("implementer-frontend")).toBe("前端实现");
    expect(agentRoleLabel("implementer-general")).toBe("通用实现");
    expect(agentRoleLabel("reviewer")).toBe("代码审查");
    expect(agentRoleLabel("planner")).toBe("规划");
    expect(agentRoleLabel("brainstormer")).toBe("方案探索");
    expect(agentRoleLabel("executor")).toBe("执行调度");
    expect(agentRoleLabel("commander")).toBe("总指挥");
    expect(agentRoleLabel("codebase-analyzer")).toBe("代码分析");
    expect(agentRoleLabel("codebase-locator")).toBe("代码定位");
    expect(agentRoleLabel("pattern-finder")).toBe("模式查找");
    expect(agentRoleLabel("critic")).toBe("对抗审查");
  });

  it("strips spawn-agent. technical prefix from unknown agent name", () => {
    expect(agentRoleLabel("spawn-agent.unknown-agent")).toBe("unknown-agent");
  });

  it("returns the original name for unknown agent without prefix", () => {
    expect(agentRoleLabel("custom-agent")).toBe("custom-agent");
  });

  it("returns generic fallback for empty or whitespace input", () => {
    expect(agentRoleLabel("")).toBe("子任务");
    expect(agentRoleLabel("   ")).toBe("子任务");
  });

  it("exposes the label map as readonly record", () => {
    expect(AGENT_ROLE_LABELS.reviewer).toBe("代码审查");
  });

  it("exposes critic in the label map", () => {
    expect(AGENT_ROLE_LABELS.critic).toBe("对抗审查");
  });
});
```

Implementation: extend the existing `AGENT_ROLE_LABELS` record with a `critic` entry. The label `对抗审查` (adversarial review) is the natural Chinese rendering and matches AGENTS.md vocabulary (`对抗审一下`).

```typescript
// src/tools/spawn-agent/agent-roles.ts
const SPAWN_AGENT_PREFIX = "spawn-agent.";
const GENERIC_FALLBACK = "子任务";

export const AGENT_ROLE_LABELS: Readonly<Record<string, string>> = {
  "implementer-backend": "后端实现",
  "implementer-frontend": "前端实现",
  "implementer-general": "通用实现",
  reviewer: "代码审查",
  planner: "规划",
  brainstormer: "方案探索",
  executor: "执行调度",
  commander: "总指挥",
  "codebase-analyzer": "代码分析",
  "codebase-locator": "代码定位",
  "pattern-finder": "模式查找",
  critic: "对抗审查",
};

function stripSpawnAgentPrefix(value: string): string {
  return value.startsWith(SPAWN_AGENT_PREFIX) ? value.slice(SPAWN_AGENT_PREFIX.length) : value;
}

export function agentRoleLabel(agent: string): string {
  const trimmed = agent.trim();
  if (trimmed.length === 0) return GENERIC_FALLBACK;

  const cleaned = stripSpawnAgentPrefix(trimmed);
  if (cleaned.length === 0) return GENERIC_FALLBACK;

  return AGENT_ROLE_LABELS[cleaned] ?? cleaned;
}
```

**Verify:** `bun test tests/tools/spawn-agent/agent-roles.test.ts`
**Commit:** `feat(spawn-agent): add Chinese role label for critic`

---

## Batch 2: Registration and Coordinator Wiring (parallel - 3 implementers)

All tasks in this batch depend on Batch 1 task 1.1 (critic agent module must exist before it can be imported or referenced).
Tasks: 2.1, 2.2, 2.3

### Task 2.1: Register critic in agents barrel
**File:** `src/agents/index.ts`
**Test:** `tests/agents/index.test.ts` (extend existing test file)
**Depends:** 1.1 (imports `criticAgent` from `./critic`)
**Domain:** general

Test (add the new assertions; here is the full updated file with the new tests appended at the end of the `describe` block):

```typescript
// tests/agents/index.test.ts
import { describe, expect, it } from "bun:test";

import { DEFAULT_MODEL } from "../../src/utils/config";

const FORBIDDEN_DIRECT_AGENT_NAMES = ["runner", "operator", "light-executor"] as const;

describe("agents index", () => {
  it("should not export handoff agents", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents["handoff-creator"]).toBeUndefined();
    expect(module.agents["handoff-resumer"]).toBeUndefined();
    expect((module as Record<string, unknown>).handoffCreatorAgent).toBeUndefined();
    expect((module as Record<string, unknown>).handoffResumerAgent).toBeUndefined();
  });

  it("should still export other agents", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents["ledger-creator"]).toBeDefined();
    expect(module.agents.brainstormer).toBeDefined();
    expect(module.agents.commander).toBeDefined();
  });

  it("registers investigator agent at default model", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents.investigator).toBeDefined();
    expect(module.agents.investigator.mode).toBe("subagent");
    expect(module.agents.investigator.model).toBe(DEFAULT_MODEL);
  });

  it("re-exports investigatorAgent from the agents barrel", async () => {
    const module = await import("../../src/agents/index");

    expect(module.investigatorAgent).toBeDefined();
  });

  it("registers critic agent at default model", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents.critic).toBeDefined();
    expect(module.agents.critic.mode).toBe("subagent");
    expect(module.agents.critic.model).toBe(DEFAULT_MODEL);
  });

  it("registers critic with read-only tool restrictions", async () => {
    const module = await import("../../src/agents/index");
    const agent = module.agents.critic;

    expect(agent.tools?.write).toBe(false);
    expect(agent.tools?.edit).toBe(false);
    expect(agent.tools?.bash).toBe(false);
    expect(agent.tools?.task).toBe(false);
  });

  it("re-exports criticAgent from the agents barrel", async () => {
    const module = await import("../../src/agents/index");

    expect((module as Record<string, unknown>).criticAgent).toBeDefined();
  });

  it("registers executor-direct with a non-empty model", async () => {
    const module = await import("../../src/agents/index");
    const agent = module.agents["executor-direct"];

    expect(agent).toBeDefined();
    expect(typeof agent.model).toBe("string");
    expect(agent.model.length).toBeGreaterThan(0);
  });

  it("re-exports executorDirectAgent as a subagent", async () => {
    const module = await import("../../src/agents/index");

    expect(module.executorDirectAgent).toBeDefined();
    expect(module.executorDirectAgent.mode).toBe("subagent");
  });

  it("keeps executor registered alongside executor-direct", async () => {
    const module = await import("../../src/agents/index");

    expect(module.agents.executor).toBeDefined();
    expect(module.agents.executor.mode).toBe("subagent");
    expect(module.agents["executor-direct"]).toBeDefined();
  });

  it("does not register runner-style direct execution agents", async () => {
    const module = await import("../../src/agents/index");

    for (const name of FORBIDDEN_DIRECT_AGENT_NAMES) {
      expect(module.agents[name]).toBeUndefined();
    }
  });

  it("should register mindmodel v2 analysis agents", async () => {
    const module = await import("../../src/agents/index");

    // New v2 analysis agents
    expect(module.agents["mm-dependency-mapper"]).toBeDefined();
    expect(module.agents["mm-convention-extractor"]).toBeDefined();
    expect(module.agents["mm-domain-extractor"]).toBeDefined();
    expect(module.agents["mm-code-clusterer"]).toBeDefined();
    expect(module.agents["mm-anti-pattern-detector"]).toBeDefined();
    expect(module.agents["mm-constraint-writer"]).toBeDefined();
    expect(module.agents["mm-constraint-reviewer"]).toBeDefined();
  });

  it("should configure mindmodel v2 agents as subagents", async () => {
    const module = await import("../../src/agents/index");

    const v2Agents = [
      "mm-dependency-mapper",
      "mm-convention-extractor",
      "mm-domain-extractor",
      "mm-code-clusterer",
      "mm-anti-pattern-detector",
      "mm-constraint-writer",
      "mm-constraint-reviewer",
    ];

    for (const agentName of v2Agents) {
      const agent = module.agents[agentName];
      expect(agent.mode).toBe("subagent");
      expect(agent.model).toBe(DEFAULT_MODEL);
    }
  });

  it("should use DEFAULT_MODEL for all agents", async () => {
    const module = await import("../../src/agents/index");

    for (const [_name, agent] of Object.entries(module.agents)) {
      expect(agent.model).toBe(DEFAULT_MODEL);
    }
  });
});
```

Implementation: add `import { criticAgent } from "./critic";` near the existing `investigatorAgent` import, register the agent in the `agents` record, and re-export it from the barrel.

```typescript
// src/agents/index.ts (relevant additions only; preserve all other existing imports/exports)
import type { AgentConfig } from "@opencode-ai/sdk";

import { DEFAULT_MODEL } from "@/utils/config";
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
import { implementerFrontendAgent } from "./implementer-frontend";
import { implementerGeneralAgent } from "./implementer-general";
import { investigatorAgent } from "./investigator";
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
import { projectInitializerAgent } from "./project-initializer";
import { reviewerAgent } from "./reviewer";

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
  critic: { ...criticAgent, model: DEFAULT_MODEL },
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
  criticAgent,
  executorAgent,
  executorDirectAgent,
  ledgerCreatorAgent,
  artifactSearcherAgent,
  octtoAgent,
  probeAgent,
};

export { notificationCourierAgent } from "./notification-courier";
```

**Verify:** `bun test tests/agents/index.test.ts`
**Commit:** `feat(agents): register critic in agents barrel`

### Task 2.2: Add critic to brainstormer available-subagents
**File:** `src/agents/brainstormer.ts`
**Test:** none (prompt-string surface change with no exported logic; covered by Batch 3 cross-coordinator routing test)
**Depends:** 1.1 (the listed subagent must actually exist in the registry)
**Domain:** general

Decision: design says brainstormer's available-subagents list must include `critic`. The user-triggered semantics (only spawn when user explicitly says "派 critic / 派红队 / 派 yagni") live in AGENTS.md, not in the brainstormer prompt; the prompt only needs to declare availability and the role-parameter contract.

Edit only the `<available-subagents>` block in `src/agents/brainstormer.ts` (around lines 206-214 in the current file). Replace the existing block with the version below. Leave every other section of the file untouched.

```xml
<available-subagents>
  <subagent name="codebase-locator">Find files, modules, patterns.</subagent>
  <subagent name="codebase-analyzer">Deep analysis of specific modules.</subagent>
  <subagent name="pattern-finder">Find existing patterns in codebase.</subagent>
  <subagent name="investigator">Diagnostic read-only investigation: produces a fact-backed diagnosis package. Use when the user reports an observed failure, inconsistency, runtime symptom, or unknown cause and wants WHY before any change. Never mutates.</subagent>
  <subagent name="critic">Read-only adversarial review under one of five roles: archaeologist, conservative, redteam, yagni, cross-family. Spawn ONLY when the user explicitly asks for adversarial review (per AGENTS.md "Adversarial Subagent Review"). MUST pass the role parameter in the prompt as one of the five role names. Never mutates.</subagent>
  <subagent name="planner">Creates detailed implementation plan from validated design.</subagent>
  <subagent name="executor">Executes implementation plan with implementer/reviewer cycles.</subagent>
  <subagent name="executor-direct">Direct scoped no-plan execution: bounded work in a single session, never spawns subagents, never owns lifecycle state.</subagent>
</available-subagents>
```

**Verify:** `bun run typecheck && bun test tests/agents/brainstormer.test.ts`
**Commit:** `feat(brainstormer): list critic in available-subagents`

### Task 2.3: Add critic to commander agents list and routing block
**File:** `src/agents/commander.ts`
**Test:** none (prompt-string surface change with no exported logic; covered by Batch 3 cross-coordinator routing test)
**Depends:** 1.1 (the listed subagent must actually exist in the registry)
**Domain:** general

Two edits in `src/agents/commander.ts`:

Edit 1 — header agent list at line 6 (`Available micode agents:` line). Append `critic` to the list. Replace the existing line:

```
Available micode agents: commander, brainstormer, planner, executor, investigator, implementer, reviewer, codebase-locator, codebase-analyzer, pattern-finder, ledger-creator, artifact-searcher, mm-orchestrator.
```

with:

```
Available micode agents: commander, brainstormer, planner, executor, investigator, critic, implementer, reviewer, codebase-locator, codebase-analyzer, pattern-finder, ledger-creator, artifact-searcher, mm-orchestrator.
```

Edit 2 — `<available-agents>` block (the block around lines 273-282 that currently contains `<agent name="brainstormer" .../>` through `<agent name="ledger-creator" .../>`). Insert one new line after the existing `investigator` entry. Replace the existing block with:

```xml
<agent name="brainstormer" mode="primary" purpose="Design exploration (user invokes directly)"/>
<agent name="codebase-locator" mode="subagent" purpose="Find WHERE files are"/>
<agent name="codebase-analyzer" mode="subagent" purpose="Explain HOW code works"/>
<agent name="pattern-finder" mode="subagent" purpose="Find existing patterns"/>
<agent name="investigator" mode="subagent" purpose="Diagnostic read-only investigation: produces a fact-backed diagnosis package, does NOT mutate"/>
<agent name="critic" mode="subagent" purpose="Read-only adversarial review under one of five roles (archaeologist, conservative, redteam, yagni, cross-family); user-triggered only; does NOT mutate"/>
<agent name="planner" mode="subagent" purpose="Create detailed implementation plans"/>
<agent name="executor" mode="subagent" purpose="Execute plan (runs implementer then reviewer automatically)"/>
<agent name="executor-direct" mode="subagent" purpose="Direct scoped no-plan execution: implements/builds/deploys/verifies bounded work in a single session; never spawns subagents"/>
<agent name="ledger-creator" mode="subagent" purpose="Create/update continuity ledgers"/>
```

Do NOT modify the `<output-class>` routing block: critic is user-triggered adversarial review, not a routed output class. The investigator routing semantics stay intact (diagnosis → investigator, mutation → executor, etc.).

**Verify:** `bun run typecheck && bun test tests/agents/commander.test.ts`
**Commit:** `feat(commander): list critic in available-agents`

---

## Batch 3: Cross-Coordinator Routing Verification (parallel - 1 implementer)

This batch depends on Batch 2 tasks 2.2 and 2.3 (the routing test reads both coordinator sources to verify they list `critic` consistently).
Tasks: 3.1

### Task 3.1: Cross-coordinator critic routing test
**File:** `tests/agents/critic-routing.test.ts` (new)
**Test:** self (this task IS the test file; it has no implementation file pair)
**Depends:** 2.2, 2.3 (reads both coordinator sources to verify they list `critic` consistently)
**Domain:** general

Decision: mirror the structure of `tests/agents/investigator-routing.test.ts`. The test reads both `commander.ts` and `brainstormer.ts` source files and asserts that the `critic` subagent is declared, that the role-parameter contract is mentioned in the brainstormer's available-subagents description, and that the agent name spelling does not drift between coordinators.

```typescript
// tests/agents/critic-routing.test.ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const COMMANDER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "commander.ts"), "utf-8");
const BRAINSTORMER_SOURCE = readFileSync(join(__dirname, "..", "..", "src", "agents", "brainstormer.ts"), "utf-8");

const COORDINATORS = [
  { name: "commander", source: COMMANDER_SOURCE },
  { name: "brainstormer", source: BRAINSTORMER_SOURCE },
];

describe("critic routing contract (cross-coordinator)", () => {
  for (const coord of COORDINATORS) {
    describe(coord.name, () => {
      it("declares critic as an available subagent", () => {
        expect(coord.source).toContain("critic");
      });

      it("describes critic as read-only and never-mutates", () => {
        const lower = coord.source.toLowerCase();
        // The critic listing must signal read-only / non-mutating semantics so
        // coordinators do not treat it as an executor substitute.
        expect(lower).toMatch(/critic[\s\S]{0,400}(read-only|does not mutate|never mutates)/);
      });
    });
  }

  it("brainstormer mentions all five critic roles in its available-subagents description", () => {
    const lower = BRAINSTORMER_SOURCE.toLowerCase();
    // The available-subagents block must enumerate the five role names so the
    // primary agent knows the role parameter contract without re-reading critic.ts.
    expect(lower).toContain("archaeologist");
    expect(lower).toContain("conservative");
    expect(lower).toContain("redteam");
    expect(lower).toContain("yagni");
    expect(lower).toContain("cross-family");
  });

  it("brainstormer signals user-triggered semantics for critic", () => {
    // Per AGENTS.md adversarial review section: critic is user-triggered only.
    // The brainstormer prompt must reflect this so the primary agent does not
    // auto-spawn critics during routine design exploration.
    const lower = BRAINSTORMER_SOURCE.toLowerCase();
    expect(lower).toMatch(/critic[\s\S]{0,400}(user.?triggered|user explicitly|only when the user)/);
  });

  it("commander lists critic alongside investigator in the available-agents block", () => {
    // The <agent name="critic" .../> entry must be present and use mode="subagent".
    const match = COMMANDER_SOURCE.match(/<agent name="critic" mode="([^"]+)"/);
    expect(match).not.toBeNull();
    expect(match?.[1]).toBe("subagent");
  });

  it("commander header agent list mentions critic", () => {
    // The "Available micode agents:" header line must include critic so the
    // primary agent's first-glance vocabulary is correct.
    const headerMatch = COMMANDER_SOURCE.match(/Available micode agents:[^\n]+/);
    expect(headerMatch).not.toBeNull();
    expect((headerMatch?.[0] ?? "").toLowerCase()).toContain("critic");
  });

  it("both coordinators agree on the critic agent name spelling", () => {
    expect(COMMANDER_SOURCE).toContain("critic");
    expect(BRAINSTORMER_SOURCE).toContain("critic");
    // Guard against drift to "critique" / "critics" as the canonical agent name.
    expect(COMMANDER_SOURCE).not.toMatch(/<agent name="critique"/);
    expect(COMMANDER_SOURCE).not.toMatch(/<agent name="critics"/);
    expect(BRAINSTORMER_SOURCE).not.toMatch(/<subagent name="critique">/);
    expect(BRAINSTORMER_SOURCE).not.toMatch(/<subagent name="critics">/);
  });

  it("neither coordinator routes critic via output-class (critic is user-triggered, not output-routed)", () => {
    // Per design: critic is NOT a routed output class. It is user-triggered
    // adversarial review. Guard against accidentally adding an
    // <output-class name="..." agent="critic"> block.
    expect(COMMANDER_SOURCE).not.toMatch(/<output-class[^>]*agent="critic"/);
    expect(BRAINSTORMER_SOURCE).not.toMatch(/<output-class[^>]*agent="critic"/);
  });
});
```

**Verify:** `bun test tests/agents/critic-routing.test.ts`
**Commit:** `test(agents): add cross-coordinator critic routing contract test`
