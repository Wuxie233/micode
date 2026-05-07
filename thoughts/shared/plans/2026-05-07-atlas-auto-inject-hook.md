---
date: 2026-05-07
topic: "Atlas Auto Inject Hook"
issue: 52
scope: atlas
contract: none
---

# Atlas Auto Inject Hook Implementation Plan

**Goal:** Auto-inject an `<atlas-context>` block into the system prompt for `brainstormer` and `planner` (and only those) on every `chat.params` call, by reading `getAtlasSummary(ctx.directory)` from #46.

**Architecture:** New `chat.params` hook `createAtlasAutoInjectHook(ctx)` that reads `output.options?.agent`, gates on a small allowlist (`brainstormer`, `planner`), calls `getAtlasSummary(ctx.directory)` from `src/atlas/auto-inject.ts`, wraps the result in an `<atlas-context>` XML block, and prepends it to `output.system`. Hook follows the same shape as `ledger-loader` / `fragment-injector` (existing siblings under `src/hooks/`). Wired into `src/index.ts` chat.params pipeline next to ledger/context injection. `commander` and any other agent are explicit no-ops; missing vault, missing `00-index.md`, or read errors silently leave `output.system` untouched.

**Design:** [thoughts/shared/designs/2026-05-07-atlas-auto-inject-hook-design.md](../designs/2026-05-07-atlas-auto-inject-hook-design.md)

**Contract:** none (single-domain internal plugin runtime change; no FE/BE split)

---

## Dependency Graph

```
Batch 1 (parallel): 1.1 [foundation - hook + test, depends on existing src/atlas/auto-inject.ts which is already on disk]
Batch 2 (parallel): 2.1, 2.2 [registration - depend on 1.1]
```

---

## Batch 1: Foundation (parallel - 1 implementer)

All tasks in this batch have NO dependencies (besides the already-shipped `getAtlasSummary` helper from #46) and run simultaneously.
Tasks: 1.1

### Task 1.1: Atlas auto-inject chat.params hook
**File:** `src/hooks/atlas-auto-inject.ts`
**Test:** `tests/hooks/atlas-auto-inject.test.ts`
**Depends:** none
**Domain:** backend

This task introduces meaningful behavioral risk (allowlist gating, error swallowing, prompt-mutation contract), so a real test is required.

Write the test FIRST, run it and confirm it fails (module does not exist), then write the implementation, and confirm the test passes.

```typescript
// tests/hooks/atlas-auto-inject.test.ts
import { afterEach, beforeEach, describe, expect, it } from "bun:test";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { createAtlasAutoInjectHook } from "@/hooks/atlas-auto-inject";

const writeAtlasIndex = (root: string, body: string): void => {
  mkdirSync(join(root, "atlas"), { recursive: true });
  writeFileSync(join(root, "atlas", "00-index.md"), body);
};

const makeCtx = (directory: string) => ({ directory }) as unknown as Parameters<typeof createAtlasAutoInjectHook>[0];

describe("createAtlasAutoInjectHook", () => {
  let testDir: string;

  beforeEach(() => {
    testDir = mkdtempSync(join(tmpdir(), "atlas-auto-inject-hook-"));
  });

  afterEach(() => {
    rmSync(testDir, { recursive: true, force: true });
  });

  it("injects <atlas-context> into system prompt for brainstormer when atlas exists", async () => {
    writeAtlasIndex(testDir, "# micode Atlas Index\n\nProject map root.\n");
    const hook = createAtlasAutoInjectHook(makeCtx(testDir));
    const output: { options?: Record<string, unknown>; system?: string } = {
      options: { agent: "brainstormer" },
      system: "EXISTING_SYSTEM",
    };

    await hook["chat.params"]({ sessionID: "s1" }, output);

    expect(output.system).toContain("<atlas-context>");
    expect(output.system).toContain("</atlas-context>");
    expect(output.system).toContain("# micode Atlas Index");
    expect(output.system).toContain("EXISTING_SYSTEM");
    // injected block should be prepended (visible before existing content)
    expect((output.system ?? "").indexOf("<atlas-context>")).toBeLessThan(
      (output.system ?? "").indexOf("EXISTING_SYSTEM"),
    );
  });

  it("injects for planner agent", async () => {
    writeAtlasIndex(testDir, "# micode Atlas Index\n\nProject map root.\n");
    const hook = createAtlasAutoInjectHook(makeCtx(testDir));
    const output: { options?: Record<string, unknown>; system?: string } = {
      options: { agent: "planner" },
    };

    await hook["chat.params"]({ sessionID: "s2" }, output);

    expect(output.system).toBeDefined();
    expect(output.system).toContain("<atlas-context>");
    expect(output.system).toContain("# micode Atlas Index");
  });

  it("does NOT inject for commander", async () => {
    writeAtlasIndex(testDir, "# micode Atlas Index\n\nProject map root.\n");
    const hook = createAtlasAutoInjectHook(makeCtx(testDir));
    const output: { options?: Record<string, unknown>; system?: string } = {
      options: { agent: "commander" },
      system: "EXISTING_SYSTEM",
    };

    await hook["chat.params"]({ sessionID: "s3" }, output);

    expect(output.system).toBe("EXISTING_SYSTEM");
  });

  it("does NOT inject when agent is unset", async () => {
    writeAtlasIndex(testDir, "# micode Atlas Index\n\nProject map root.\n");
    const hook = createAtlasAutoInjectHook(makeCtx(testDir));
    const output: { options?: Record<string, unknown>; system?: string } = {
      system: "EXISTING_SYSTEM",
    };

    await hook["chat.params"]({ sessionID: "s4" }, output);

    expect(output.system).toBe("EXISTING_SYSTEM");
  });

  it("does NOT inject for unknown subagent (e.g. executor, reviewer)", async () => {
    writeAtlasIndex(testDir, "# micode Atlas Index\n\nProject map root.\n");
    const hook = createAtlasAutoInjectHook(makeCtx(testDir));
    const output: { options?: Record<string, unknown>; system?: string } = {
      options: { agent: "executor" },
      system: "EXISTING_SYSTEM",
    };

    await hook["chat.params"]({ sessionID: "s5" }, output);

    expect(output.system).toBe("EXISTING_SYSTEM");
  });

  it("leaves system prompt untouched when atlas vault is missing", async () => {
    // no atlas/ directory created
    const hook = createAtlasAutoInjectHook(makeCtx(testDir));
    const output: { options?: Record<string, unknown>; system?: string } = {
      options: { agent: "brainstormer" },
      system: "EXISTING_SYSTEM",
    };

    await hook["chat.params"]({ sessionID: "s6" }, output);

    expect(output.system).toBe("EXISTING_SYSTEM");
  });

  it("leaves system prompt untouched when atlas/00-index.md is missing", async () => {
    mkdirSync(join(testDir, "atlas"), { recursive: true });
    const hook = createAtlasAutoInjectHook(makeCtx(testDir));
    const output: { options?: Record<string, unknown>; system?: string } = {
      options: { agent: "brainstormer" },
      system: "EXISTING_SYSTEM",
    };

    await hook["chat.params"]({ sessionID: "s7" }, output);

    expect(output.system).toBe("EXISTING_SYSTEM");
  });

  it("creates output.system when none was set originally", async () => {
    writeAtlasIndex(testDir, "# micode Atlas Index\n\nProject map root.\n");
    const hook = createAtlasAutoInjectHook(makeCtx(testDir));
    const output: { options?: Record<string, unknown>; system?: string } = {
      options: { agent: "brainstormer" },
    };

    await hook["chat.params"]({ sessionID: "s8" }, output);

    expect(output.system).toBeDefined();
    expect(output.system).toContain("<atlas-context>");
  });

  it("does not throw and does not mutate system when getAtlasSummary throws", async () => {
    // Create a vault with index, but make the index a directory to provoke read failure.
    mkdirSync(join(testDir, "atlas", "00-index.md"), { recursive: true });
    const hook = createAtlasAutoInjectHook(makeCtx(testDir));
    const output: { options?: Record<string, unknown>; system?: string } = {
      options: { agent: "brainstormer" },
      system: "EXISTING_SYSTEM",
    };

    await hook["chat.params"]({ sessionID: "s9" }, output);

    expect(output.system).toBe("EXISTING_SYSTEM");
  });
});
```

```typescript
// src/hooks/atlas-auto-inject.ts
import type { PluginInput } from "@opencode-ai/plugin";

import { getAtlasSummary } from "@/atlas/auto-inject";

/**
 * Agents that get atlas context auto-injected into their system prompt.
 *
 * commander is intentionally excluded: it is a triage / routing agent that
 * frequently handles quick-op or no-op classification work, where pre-loading
 * the atlas summary wastes tokens. commander can still call the `atlas_lookup`
 * tool on demand when its routing decision actually needs project map context.
 *
 * Other subagents (executor, reviewer, implementer-*, etc.) are also excluded
 * for the same token-budget reason: they receive task-scoped instructions from
 * their parent agent and do not need the global atlas summary.
 */
const ATLAS_AUTO_INJECT_AGENTS: ReadonlySet<string> = new Set(["brainstormer", "planner"]);

const ATLAS_CONTEXT_HEADER =
  "The following is an auto-injected summary of the project's Atlas knowledge graph. " +
  "Use it as your starting map of the project. " +
  "When you need a deeper view of any node, call the `atlas_lookup` tool.";

interface AtlasAutoInjectHook {
  readonly "chat.params": (
    _input: { readonly sessionID: string },
    output: { options?: Record<string, unknown>; system?: string },
  ) => Promise<void>;
}

const wrapAtlasContext = (summary: string): string =>
  `<atlas-context>\n${ATLAS_CONTEXT_HEADER}\n\n${summary}\n</atlas-context>`;

const safeGetSummary = async (projectRoot: string): Promise<string | null> => {
  try {
    return await getAtlasSummary(projectRoot);
  } catch {
    // Atlas read failure must never block the main agent flow.
    return null;
  }
};

export function createAtlasAutoInjectHook(ctx: PluginInput): AtlasAutoInjectHook {
  return {
    "chat.params": async (_input, output) => {
      const agent = output.options?.agent as string | undefined;
      if (!agent || !ATLAS_AUTO_INJECT_AGENTS.has(agent)) return;

      const summary = await safeGetSummary(ctx.directory);
      if (summary === null || summary.trim().length === 0) return;

      const block = wrapAtlasContext(summary);
      output.system = output.system ? `${block}\n\n${output.system}` : block;
    },
  };
}
```

**Verify:**
1. Negative-first TDD:
   - Write the test file above before the implementation file exists.
   - Run `bun test tests/hooks/atlas-auto-inject.test.ts`. Expect failure (module not found).
2. Write the implementation file above.
3. Run `bun test tests/hooks/atlas-auto-inject.test.ts`. Expect all 9 cases pass.
4. Run `bun test tests/atlas/auto-inject.test.ts`. Expect existing #46 tests still pass (no regression).
5. Run `bun run typecheck`. Expect no new TS errors.

**Commit:** `feat(atlas): add atlas auto-inject chat.params hook for brainstormer/planner`

---

## Batch 2: Registration (parallel - 2 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2

### Task 2.1: Export new hook from hooks barrel
**File:** `src/hooks/index.ts`
**Test:** none (pure re-export change; covered transitively by Task 2.2 wiring + the hook's own test in 1.1; no behavior change worth a dedicated test)
**Depends:** 1.1
**Domain:** general

This is a pure barrel re-export edit. Insert one new export statement in alphabetical order (between `artifact-auto-index` and `auto-compact`) to keep the file's existing convention.

**Edit instructions for the implementer:**

In `src/hooks/index.ts`, locate the existing first export line:

```typescript
export { createArtifactAutoIndexHook, parseLedger } from "./artifact-auto-index";
```

Immediately AFTER that line, add:

```typescript
export { createAtlasAutoInjectHook } from "./atlas-auto-inject";
```

Do not modify any other line in this file.

After the edit, the top of the file MUST look like:

```typescript
export { createArtifactAutoIndexHook, parseLedger } from "./artifact-auto-index";
export { createAtlasAutoInjectHook } from "./atlas-auto-inject";
export { type AutoCompactConfig, createAutoCompactHook } from "./auto-compact";
// ... rest of file unchanged ...
```

**Verify:**
1. Run `bun run typecheck`. Expect no errors; the new export must resolve.
2. Run `bun test tests/hooks/atlas-auto-inject.test.ts`. Expect pass (already passing from 1.1; this just confirms barrel re-export is consistent).

**Commit:** Folded into Task 2.2's commit (the registration commit), since 2.1 alone is meaningless without 2.2 wiring it in. Implementer may stage 2.1's change and commit together with 2.2.

---

### Task 2.2: Register atlas auto-inject hook in plugin chat.params pipeline
**File:** `src/index.ts`
**Test:** none (plugin wiring is glue code; the hook itself is fully covered by Task 1.1's tests, and there is no project-wide integration test harness for `chat.params` ordering. A dedicated test would duplicate 1.1 with mock plumbing without buying real risk coverage.)
**Depends:** 1.1, 2.1
**Domain:** backend

Wire the new hook into the existing `chat.params` pipeline alongside the other system-prompt injectors. Recommended position: AFTER `ledgerLoaderHook` and BEFORE `contextInjectorHook`. Rationale: ledger is the highest-priority resume context (must come first); atlas is the second most important "what is this project" framing; project-context files come after.

**Edit instructions for the implementer:**

There are exactly THREE edits to make in `src/index.ts`. Apply them in order.

#### Edit A — add `createAtlasAutoInjectHook` to the existing barrel import

Locate the existing import block (around lines 15-32):

```typescript
import {
  createArtifactAutoIndexHook,
  createAutoCompactHook,
  createCommentCheckerHook,
  createConstraintReviewerHook,
  createContextInjectorHook,
  createContextWindowMonitorHook,
  createConversationTitleHook,
  createFetchTrackerHook,
  createFileOpsTrackerHook,
  createFragmentInjectorHook,
  createLedgerLoaderHook,
  createMindmodelInjectorHook,
  createSessionRecoveryHook,
  createTokenAwareTruncationHook,
  getFileOps,
  warnUnknownAgents,
} from "@/hooks";
```

Insert `createAtlasAutoInjectHook,` in alphabetical position, immediately after `createArtifactAutoIndexHook,`. The block must become:

```typescript
import {
  createArtifactAutoIndexHook,
  createAtlasAutoInjectHook,
  createAutoCompactHook,
  createCommentCheckerHook,
  createConstraintReviewerHook,
  createContextInjectorHook,
  createContextWindowMonitorHook,
  createConversationTitleHook,
  createFetchTrackerHook,
  createFileOpsTrackerHook,
  createFragmentInjectorHook,
  createLedgerLoaderHook,
  createMindmodelInjectorHook,
  createSessionRecoveryHook,
  createTokenAwareTruncationHook,
  getFileOps,
  warnUnknownAgents,
} from "@/hooks";
```

#### Edit B — instantiate the hook alongside the other hooks

Inside `OpenCodeConfigPlugin`, locate this block (around lines 759-762):

```typescript
  const contextInjectorHook = createContextInjectorHook(ctx);
  const ledgerLoaderHook = createLedgerLoaderHook(ctx);
  const sessionRecoveryHook = createSessionRecoveryHook(ctx);
  const tokenAwareTruncationHook = createTokenAwareTruncationHook(ctx);
```

Add the new instantiation immediately after `ledgerLoaderHook` so the declaration order matches the eventual call order in `chat.params`. The block becomes:

```typescript
  const contextInjectorHook = createContextInjectorHook(ctx);
  const ledgerLoaderHook = createLedgerLoaderHook(ctx);
  const atlasAutoInjectHook = createAtlasAutoInjectHook(ctx);
  const sessionRecoveryHook = createSessionRecoveryHook(ctx);
  const tokenAwareTruncationHook = createTokenAwareTruncationHook(ctx);
```

#### Edit C — call the hook inside the `chat.params` pipeline

Locate the existing `"chat.params"` handler (around lines 1051-1074). The current body is:

```typescript
    "chat.params": async (input, output) => {
      // Inject user-defined fragments FIRST (highest priority, beginning of prompt)
      await fragmentInjectorHook["chat.params"](input, output);

      // Inject ledger context (high priority)
      await ledgerLoaderHook["chat.params"](input, output);

      // Inject project context files
      await contextInjectorHook["chat.params"](input, output);

      // Inject context window status
      await contextWindowMonitorHook["chat.params"](input, output);
```

Insert the atlas auto-inject call between the ledger call and the context-injector call. The block must become:

```typescript
    "chat.params": async (input, output) => {
      // Inject user-defined fragments FIRST (highest priority, beginning of prompt)
      await fragmentInjectorHook["chat.params"](input, output);

      // Inject ledger context (high priority)
      await ledgerLoaderHook["chat.params"](input, output);

      // Inject atlas summary for brainstormer/planner (no-op for other agents)
      await atlasAutoInjectHook["chat.params"](input, output);

      // Inject project context files
      await contextInjectorHook["chat.params"](input, output);

      // Inject context window status
      await contextWindowMonitorHook["chat.params"](input, output);
```

Do not modify any other section of the file (think-mode handling, the rest of the handlers, etc. all stay as-is).

**Verify:**
1. `bun run typecheck` — must pass; the new identifier `createAtlasAutoInjectHook` and `atlasAutoInjectHook` must resolve.
2. `bun run lint` (or `bun run check` / repo-equivalent) — must pass; no new lint warnings.
3. `bun test tests/hooks/atlas-auto-inject.test.ts` — pass.
4. `bun test tests/hooks/ledger-loader.test.ts tests/hooks/fragment-injector.test.ts tests/hooks/context-injector.test.ts` — must still pass (regression check on neighbouring chat.params hooks).
5. `bun test tests/atlas/auto-inject.test.ts` — must still pass (regression on the #46 helper).
6. Smoke check (manual, not blocking): grep `src/index.ts` for `atlasAutoInjectHook` — expect exactly two occurrences (one declaration, one call site).

**Commit:** `feat(atlas): wire atlas auto-inject hook into chat.params for brainstormer/planner`

This commit may bundle Task 2.1's barrel edit, since 2.1 alone is dead code without 2.2.
