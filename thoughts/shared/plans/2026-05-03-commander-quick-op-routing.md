---
date: 2026-05-03
topic: "Commander Quick-Op Routing and Model Strategy"
issue: 23
scope: agents
contract: none
---

# Commander Quick-Op Routing and Model Strategy Implementation Plan

**Goal:** Strengthen commander's quick-op lane with explicit scope/anti-expansion/escalation rules, and route commander to Claude Sonnet 4.6 in the active config while keeping executor and implementer-* on GPT-5.5.

**Architecture:** Two production edits (commander prompt + active model config) plus three focused regression tests. No new agent is introduced. The investigator/executor boundary is preserved verbatim. Routing remains by requested-output, not by keyword triggers.

**Design:** [thoughts/shared/designs/2026-05-03-commander-quick-op-routing-design.md](../designs/2026-05-03-commander-quick-op-routing-design.md)

**Contract:** none (single-domain plan, all tasks are `general`)

**Gap-filling decisions made by planner (documented for executor):**

- Design says "add a quick-op lane section" but does not specify exact XML structure. Decision: introduce a new top-level `<quick-op-lane priority="high">` block placed AFTER the existing `<quick-mode>` block and BEFORE `<lifecycle>`. The existing `<quick-mode>` block stays (it lists trivial vs small vs complex tasks); the new `<quick-op-lane>` block adds explicit scope, anti-expansion, and escalation rules required by the design's Components section. Reason: keeps prompt diff localized, preserves all existing tests that match `<quick-mode>`, and the two blocks compose naturally (quick-mode is the trigger for entering the lane; quick-op-lane is the in-lane discipline).
- Design says "Active config maps `commander` to Claude Sonnet 4.6" but the active config currently has no `commander` entry (commander inherits the opencode default GPT-5.5). Decision: ADD a new `"commander"` entry under `agents` in `/root/.config/opencode/micode.jsonc` set to `wuxie-claude/claude-sonnet-4-6` with `options.reasoningEffort: "medium"`. Reason: matches the existing investigator/codebase-analyzer pattern in the same file and gives commander Sonnet 4.6's faster lane without inheriting the heavy GPT-5.5 default.
- Design's "Regression tests" list five assertions but does not specify file layout. Decision: add ONE new test file `tests/agents/commander-quick-op.test.ts` for the prompt assertions (assertions 1, 2, 3) and ONE new test file `tests/config/active-commander-model.test.ts` for the active-config assertions (assertions 4, 5). Reason: keeps test files scoped to a single subject under test, matches the existing `tests/agents/*.test.ts` pattern, and isolates the active-config test (which reads a non-checked-in user file) from the agent prompt tests.
- Active config file lives OUTSIDE the repo (`/root/.config/opencode/micode.jsonc`). Decision: the active-config test reads via `node:fs` with `process.env.HOME` and SKIPS gracefully when the file is absent (CI / fresh checkout). Reason: this test guards a deployment invariant on this host without breaking portable test runs.
- Design constraint "Do not add a runner/operator agent". Decision: add an explicit negative assertion to the prompt-test file that scans the agents registry for the strings `runner` and `operator` and asserts neither appears as an agent name. Reason: the design lists this as a regression risk; a static check is cheap and locks the constraint.

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2 [foundation - independent edits to two different files, no deps]
Batch 2 (parallel): 2.1, 2.2, 2.3 [tests - depend on Batch 1]
```

---

## Batch 1: Foundation (parallel - 2 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2

### Task 1.1: Add quick-op lane section to commander prompt
**File:** `src/agents/commander.ts`
**Test:** `tests/agents/commander-quick-op.test.ts` (created in Task 2.1)
**Depends:** none
**Domain:** general

This task INSERTS a new `<quick-op-lane priority="high">` XML block into the commander prompt string. The block is inserted on a new line immediately AFTER the closing `</quick-mode>` tag and BEFORE the opening `<lifecycle>` tag. Do NOT modify any other section. Do NOT remove or restructure the existing `<quick-mode>` block.

Locate the existing block in `src/agents/commander.ts`:

```typescript
</quick-mode>

<lifecycle>
```

Replace it with:

```typescript
</quick-mode>

<quick-op-lane priority="high" description="Narrow lane for scoped low-risk operational work that commander handles directly">
<purpose>
Commander's quick-op lane handles requested actions that are local, low-risk, scoped, and can be completed without
planner, executor, implementer, or reviewer. The lane exists so simple operational work does not get pushed into
the heavy GPT-5.5 executor path. The lane is NOT a second executor.
</purpose>

<in-scope description="Examples of work that fits the lane">
<work>Read and report a small status (file content, ledger entry, lifecycle issue body, project memory snippet).</work>
<work>Run a single read-only check the user explicitly asked for and return the result.</work>
<work>Apply a single trivial scoped edit when the change is obvious, local, and reversible (typo, version bump, single-line patch already covered by quick-mode).</work>
<work>Look up or summarize an artifact the user just pointed at.</work>
</in-scope>

<out-of-scope description="Work that MUST leave the lane">
<work>Anything that needs root-cause evidence or a why-did-this-fail answer. Route to investigator.</work>
<work>Anything that delivers a multi-step change, a commit, a push, a deploy, a restart, or a lifecycle action. Route to executor.</work>
<work>Anything spanning multiple files, multiple components, or unclear scope. Route through brainstormer or planner.</work>
<work>Anything touching secrets, permissions, production data, destructive filesystem commands, or irreversible git operations. Stop and confirm with the user.</work>
</out-of-scope>

<anti-expansion>
<rule>Do NOT expand a quick-op into a multi-step delivery. If scope grows, STOP and escalate.</rule>
<rule>Do NOT chain a quick-op into a fix when the first attempt reveals an unknown cause. STOP and escalate to investigator.</rule>
<rule>Do NOT bundle a "while I'm here" change. One requested output per quick-op turn.</rule>
<rule>Do NOT use the lane as a fallback for "I am not sure where this should go". If routing is unclear, classify by requested output (location, explanation, diagnosis, mutation).</rule>
</anti-expansion>

<hard-escalation-triggers description="Conditions that MUST stop the lane and route elsewhere">
<trigger>Unknown root cause or evidence chain is required to proceed → investigator.</trigger>
<trigger>The first quick attempt fails in a way that needs diagnosis → investigator.</trigger>
<trigger>The work requires lifecycle, planner, executor, implementer, reviewer, commit, push, deploy, restart, or remote write → executor.</trigger>
<trigger>The task touches secrets, permissions, production data, destructive filesystem commands, or irreversible git operations → user confirmation required before any agent proceeds.</trigger>
</hard-escalation-triggers>

<not-a-runner>
<rule>This lane is NOT a "runner" or "operator" agent. There is no separate runner agent in micode and one MUST NOT be added.</rule>
<rule>The lane is a discipline section inside commander, not a delegation target. Commander remains the entry point.</rule>
<rule>If a request feels like it needs a runner, it is either a quick-op (handle directly), a diagnosis (route to investigator), or a delivery (route to executor). There is no fourth lane.</rule>
</not-a-runner>
</quick-op-lane>

<lifecycle>
```

**Verify:** `bun test tests/agents/commander-quick-op.test.ts` (this test is added in Task 2.1; before Task 2.1 lands, sanity-check by running `bun run typecheck` and `bun test tests/agents/commander.test.ts` to ensure existing tests still pass).
**Commit:** `feat(agents): add commander quick-op lane with anti-expansion and escalation triggers`

---

### Task 1.2: Route commander to Claude Sonnet 4.6 in active config
**File:** `/root/.config/opencode/micode.jsonc`
**Test:** `tests/config/active-commander-model.test.ts` (created in Task 2.2)
**Depends:** none
**Domain:** general

This task ADDS a new `"commander"` entry to the `agents` section of the active host config. The active config is OUTSIDE the repo (this is a runtime-host file, not a checked-in artifact). Locate the existing `agents` block in `/root/.config/opencode/micode.jsonc`. Find the comment `// Design surface — open-ended tradeoffs, gap-filling, creative scoping` and the `"brainstormer"` entry directly below it.

Find this exact existing block:

```jsonc
  "agents": {
    // Design surface — open-ended tradeoffs, gap-filling, creative scoping
    "brainstormer":         { "model": "wuxie-claude/claude-opus-4-7" },
    "octto":                { "model": "wuxie-claude/claude-opus-4-7" },
```

Replace it with this block (adds the `commander` entry as the first item under `agents` to make the routing intent obvious to anyone reading the file):

```jsonc
  "agents": {
    // Quick-op routing brain — fast narrow lane, escalates to investigator/executor
    "commander":            {
      "model": "wuxie-claude/claude-sonnet-4-6",
      "options": { "reasoningEffort": "medium" }
    },

    // Design surface — open-ended tradeoffs, gap-filling, creative scoping
    "brainstormer":         { "model": "wuxie-claude/claude-opus-4-7" },
    "octto":                { "model": "wuxie-claude/claude-opus-4-7" },
```

Do NOT modify any other entry. In particular:
- `"executor"` MUST remain `wuxie-openai/gpt-5.5`.
- `"implementer-frontend"` MUST remain `wuxie-openai/gpt-5.5`.
- `"implementer-backend"` MUST remain `wuxie-openai/gpt-5.5`.
- `"implementer-general"` MUST remain `wuxie-openai/gpt-5.5`.

After editing, verify the file is still valid JSONC by running:

```sh
node -e "const fs=require('node:fs');const s=fs.readFileSync('/root/.config/opencode/micode.jsonc','utf-8');const stripped=s.replace(/\/\/.*$/gm,'').replace(/\/\*[\s\S]*?\*\//g,'');JSON.parse(stripped);console.log('ok');"
```

Expected output: `ok`. If the parse fails, the edit broke JSONC syntax — restore from `/root/.config/opencode/micode.jsonc.bak-*` and retry.

**Verify:** the `node -e` command above prints `ok`, AND `bun test tests/config/active-commander-model.test.ts` passes after Task 2.2 lands.
**Commit:** This file is NOT in the git repo. Do NOT attempt to `git add` it. The lifecycle commit step skips this file. Note the change in the lifecycle progress log via `lifecycle_log_progress(kind=status, summary="Active config: commander -> wuxie-claude/claude-sonnet-4-6")`.

---

## Batch 2: Regression Tests (parallel - 3 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2, 2.3

### Task 2.1: Add commander quick-op lane prompt regression test
**File:** `tests/agents/commander-quick-op.test.ts`
**Test:** self
**Depends:** 1.1 (asserts content of the prompt updated in Task 1.1)
**Domain:** general

Create the file with this exact content:

```typescript
// tests/agents/commander-quick-op.test.ts
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { primaryAgent } from "../../src/agents/commander";

const COMMANDER_SOURCE = readFileSync(
  join(__dirname, "..", "..", "src", "agents", "commander.ts"),
  "utf-8",
);

describe("commander quick-op lane (issue #23)", () => {
  it("declares a quick-op lane block in the prompt", () => {
    expect(primaryAgent.prompt).toContain("<quick-op-lane");
    expect(primaryAgent.prompt).toContain("</quick-op-lane>");
  });

  it("documents in-scope and out-of-scope sections inside the quick-op lane", () => {
    const match = primaryAgent.prompt.match(/<quick-op-lane[\s\S]*?<\/quick-op-lane>/);
    expect(match).not.toBeNull();
    const body = match?.[0] ?? "";
    expect(body).toContain("<in-scope");
    expect(body).toContain("<out-of-scope");
  });

  it("declares anti-expansion rules for the quick-op lane", () => {
    const match = primaryAgent.prompt.match(/<quick-op-lane[\s\S]*?<\/quick-op-lane>/);
    expect(match).not.toBeNull();
    const body = match?.[0] ?? "";
    expect(body).toContain("<anti-expansion>");
  });

  it("lists hard escalation triggers that route to investigator and executor", () => {
    const match = primaryAgent.prompt.match(/<quick-op-lane[\s\S]*?<\/quick-op-lane>/);
    expect(match).not.toBeNull();
    const body = match?.[0] ?? "";
    expect(body).toContain("<hard-escalation-triggers");
    // The lane must name both escalation targets explicitly.
    expect(body.toLowerCase()).toContain("investigator");
    expect(body.toLowerCase()).toContain("executor");
  });

  it("preserves the existing routing-by-requested-output contract", () => {
    // Quick-op lane is additive, not replacement. The four-class routing must still exist.
    expect(COMMANDER_SOURCE).toContain("routing-by-requested-output");
    const lower = COMMANDER_SOURCE.toLowerCase();
    expect(lower).toContain("location");
    expect(lower).toContain("explanation");
    expect(lower).toContain("diagnosis");
    expect(lower).toContain("mutation");
  });

  it("preserves the investigator/executor side-effect boundary", () => {
    // Investigator stays read-only; executor stays the delivery/mutation owner.
    expect(COMMANDER_SOURCE).toContain('<output-class name="diagnosis" agent="investigator">');
    expect(COMMANDER_SOURCE).toContain('<output-class name="mutation" agent="executor">');
  });

  it("does NOT introduce a runner or operator agent or lane", () => {
    // Design constraint: do not add a runner/operator agent or light executor lane.
    const block = COMMANDER_SOURCE.match(/<quick-op-lane[\s\S]*?<\/quick-op-lane>/)?.[0] ?? "";
    // The lane MUST explicitly call out that it is not a runner.
    expect(block).toContain("<not-a-runner>");
    // No agent= attribute pointing at runner / operator / light-executor anywhere in the prompt.
    expect(COMMANDER_SOURCE).not.toMatch(/agent="runner"/);
    expect(COMMANDER_SOURCE).not.toMatch(/agent="operator"/);
    expect(COMMANDER_SOURCE).not.toMatch(/agent="light-executor"/);
  });

  it("uses requested-output classification, not keyword trigger lists", () => {
    const block = COMMANDER_SOURCE.match(/<quick-op-lane[\s\S]*?<\/quick-op-lane>/)?.[0] ?? "";
    expect(block).not.toMatch(/trigger\s+keywords?\s*:/i);
    expect(block).not.toMatch(/keyword\s+list/i);
  });
});
```

**Verify:** `bun test tests/agents/commander-quick-op.test.ts`
**Commit:** `test(agents): assert commander quick-op lane scope, anti-expansion, escalation, no runner`

---

### Task 2.2: Add active-config commander model regression test
**File:** `tests/config/active-commander-model.test.ts`
**Test:** self
**Depends:** 1.2 (asserts content of `/root/.config/opencode/micode.jsonc`)
**Domain:** general

The `tests/config/` directory may not exist yet. Create the file with this exact content (the `mkdir`-then-write is handled by the editor / `bun test` runner picks up new files automatically):

```typescript
// tests/config/active-commander-model.test.ts
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

const HOME = process.env.HOME ?? "/root";
const ACTIVE_CONFIG_PATH = join(HOME, ".config", "opencode", "micode.jsonc");

function readActiveConfig(): string | null {
  if (!existsSync(ACTIVE_CONFIG_PATH)) {
    return null;
  }
  return readFileSync(ACTIVE_CONFIG_PATH, "utf-8");
}

function stripJsonc(source: string): string {
  // Remove // line comments and /* block */ comments, then JSON.parse handles trailing-comma-free JSONC.
  return source.replace(/\/\/.*$/gm, "").replace(/\/\*[\s\S]*?\*\//g, "");
}

describe("active host config: commander model strategy (issue #23)", () => {
  const source = readActiveConfig();

  if (source === null) {
    it.skip("active config not present on this host (skipped)", () => {
      // Intentional skip: this test guards a host-local invariant. CI / fresh checkouts
      // do not have /root/.config/opencode/micode.jsonc and should not fail.
    });
    return;
  }

  // Parse once for structural assertions.
  const stripped = stripJsonc(source);
  const config = JSON.parse(stripped) as {
    agents?: Record<string, { model?: string; options?: { reasoningEffort?: string } }>;
  };
  const agents = config.agents ?? {};

  it("routes commander to wuxie-claude/claude-sonnet-4-6", () => {
    expect(agents.commander).toBeDefined();
    expect(agents.commander?.model).toBe("wuxie-claude/claude-sonnet-4-6");
  });

  it("keeps executor on wuxie-openai/gpt-5.5", () => {
    expect(agents.executor).toBeDefined();
    expect(agents.executor?.model).toBe("wuxie-openai/gpt-5.5");
  });

  it("keeps implementer-frontend on wuxie-openai/gpt-5.5", () => {
    expect(agents["implementer-frontend"]).toBeDefined();
    expect(agents["implementer-frontend"]?.model).toBe("wuxie-openai/gpt-5.5");
  });

  it("keeps implementer-backend on wuxie-openai/gpt-5.5", () => {
    expect(agents["implementer-backend"]).toBeDefined();
    expect(agents["implementer-backend"]?.model).toBe("wuxie-openai/gpt-5.5");
  });

  it("keeps implementer-general on wuxie-openai/gpt-5.5", () => {
    expect(agents["implementer-general"]).toBeDefined();
    expect(agents["implementer-general"]?.model).toBe("wuxie-openai/gpt-5.5");
  });

  it("does not route commander to any GPT model (regression: design says Sonnet 4.6)", () => {
    expect(agents.commander?.model ?? "").not.toMatch(/gpt-/i);
  });
});
```

**Verify:** `bun test tests/config/active-commander-model.test.ts` (passes on this host; skips on hosts without the active config file)
**Commit:** `test(config): assert active commander=sonnet-4.6 and executor/implementer-*=gpt-5.5`

---

### Task 2.3: Add registry regression test asserting no runner/operator agent
**File:** `tests/agents/no-runner-agent.test.ts`
**Test:** self
**Depends:** 1.1 (registry content unchanged, but logically scoped to issue #23)
**Domain:** general

Create the file with this exact content:

```typescript
// tests/agents/no-runner-agent.test.ts
import { describe, expect, it } from "bun:test";
import { readFileSync, readdirSync } from "node:fs";
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
    // Allow the literal word "runner" only inside the explicit <not-a-runner> negation block.
    const withoutNegationBlock = commanderSource.replace(
      /<not-a-runner>[\s\S]*?<\/not-a-runner>/g,
      "",
    );
    expect(withoutNegationBlock.toLowerCase()).not.toContain('agent="runner"');
    expect(withoutNegationBlock.toLowerCase()).not.toContain('agent="operator"');
    expect(withoutNegationBlock.toLowerCase()).not.toMatch(/spawn[\s_-]*runner/);
  });
});
```

**Verify:** `bun test tests/agents/no-runner-agent.test.ts`
**Commit:** `test(agents): assert no runner/operator agent is added per issue #23 constraint`
