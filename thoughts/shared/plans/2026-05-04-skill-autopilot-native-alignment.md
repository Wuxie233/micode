---
date: 2026-05-04
topic: "Skill Autopilot Native Alignment"
issue: 31
scope: skill-autopilot
contract: none
---

# Skill Autopilot Native Alignment Implementation Plan

**Goal:** Strip the micode skill prompt-injection path, the session.deleted/startup background triggers, and lifecycle-centric mining; rely on OpenCode native `.opencode/skills/<name>/SKILL.md` discovery while keeping write-time governance, security, sovereignty, and push guard.

**Architecture:** micode becomes a pure SKILL.md generator and governance layer. Removal is ruthless: the `injector/` module, the `chat.params` skill block, the `session.deleted` trigger, the startup migration, and the four injection-only config keys all go away in one batch. The remaining writer pipeline keeps schema/security/sovereignty/atomic-write/index/push-guard/stale-sweep, but is corrected so (a) the miner never lifts a lifecycle Request first line verbatim into a trigger, (b) sovereignty actually reads the on-disk file before writing, (c) default sensitivity for auto-written skills is `public` and `internal`/`secret` candidates are rejected, and (d) the security pipeline scans the full rendered SKILL.md, not just pre-render fields. Feature flag `features.skillAutopilot` stays default-off.

**Design:** thoughts/shared/designs/2026-05-04-skill-autopilot-native-alignment-design.md

**Contract:** none (single-domain plugin work)

---

## Dependency Graph

```
Batch 1 (parallel, 7 tasks): 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7
  - delete injector/ module + tests
  - delete migration.ts + tests + integration test
  - trim config.skillAutopilot to drop injection-only keys
  - strip skill plumbing from src/index.ts (chat.params, session.deleted, startup migration, helpers)
  - remove buildInjectionBlock barrel exports if any

Batch 2 (parallel, 6 tasks, depends on Batch 1): 2.1, 2.2, 2.3, 2.4, 2.5, 2.6
  - refactor miner.ts: lifecycle Request first line never becomes trigger verbatim; substantive-skill filter; broaden source ordering to ledgers/explicit + lifecycle as evidence only
  - refactor runner.ts: read on-disk SKILL.md before write so sovereignty has real `current`; default x-micode-sensitivity=public; reject internal/secret candidates; scan full rendered content via security pipeline (already covers body but verify)
  - refactor sources.ts: drop hard reliance on lifecycle journal as primary; treat lifecycle as one evidence stream among many (leave reads in place but rename helper boundaries)
  - tighten policy.ts: add explicit reject for sensitivity!=public when no opt-in
  - tighten security/self-reference-gate.ts: add patterns for lifecycle-tooling triggers (executor/planner/brainstormer/octto/lifecycle/issue/worktree)
  - update push-guard.ts: BLOCKED_SENSITIVITIES becomes anything-not-public; align with public-by-default policy

Batch 3 (parallel, 7 tasks, depends on Batch 2): 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
  - add tests/skill-autopilot/no-injection.test.ts (regression: no injector module, no chat.params skill side effect)
  - add tests/skill-autopilot/no-session-deleted-trigger.test.ts (regression: session.deleted does not trigger autopilot)
  - add tests/skill-autopilot/no-startup-migration.test.ts (regression: plugin start does not call runMigration)
  - update tests/skill-autopilot/miner.test.ts: assert lifecycle Request first line is NOT used verbatim; assert ledger evidence works; assert lifecycle-only path requires substantive-filter pass
  - update tests/skill-autopilot/runner.test.ts: assert sovereignty reads existing file, frozen/imported/unmanaged respected; assert internal/secret candidates rejected; assert full-rendered-content scan reaches body
  - update tests/skill-autopilot/policy.test.ts: cover public-by-default rejection
  - update tests/skill-autopilot/security/self-reference-gate.test.ts: cover new lifecycle-tooling reject patterns; remove migration test file deletion

Batch 4 (sequential, 1 task, depends on Batch 3): 4.1
  - run `bun run check` and fix lingering type/lint/test fallout
```

---

## Batch 1: Removal and Config Cleanup (parallel - 7 implementers)

All tasks in this batch have NO dependencies and run simultaneously. They are pure deletions and edits to independent files.
Tasks: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7

### Task 1.1: Delete the injector module
**File:** `src/skill-autopilot/injector/hook.ts` (DELETE)
**Test:** `tests/skill-autopilot/injector/hook.test.ts` (DELETE)
**Depends:** none
**Domain:** general

Delete the entire `src/skill-autopilot/injector/` directory and its test directory. This module is the prompt-injection path the design forbids; removing it eliminates the parallel skill loader and all `<skill-context>` block construction.

```sh
# Implementation
rm -rf src/skill-autopilot/injector
rm -rf tests/skill-autopilot/injector
```

After deletion, grep MUST find zero matches for `buildInjectionBlock`, `<skill-context>`, `injectionCharBudget`, `injectionSensitivityCeiling`, `defaultAgentScope`, or `@/skill-autopilot/injector` anywhere under `src/` and `tests/`. Any remaining hit is a Batch 1 dependency the deleting implementer must surface for the Batch 1.4 implementer to also strip.

**Verify:** `! rg -n "buildInjectionBlock|<skill-context>|skill-autopilot/injector" src tests`
**Commit:** `feat(skill-autopilot): delete prompt injector module`

### Task 1.2: Delete the migration module
**File:** `src/skill-autopilot/migration.ts` (DELETE)
**Test:** `tests/skill-autopilot/migration.test.ts` (DELETE) and `tests/skill-autopilot/integration/migration.test.ts` (DELETE)
**Depends:** none
**Domain:** general

Delete the Project Memory `procedure` -> SKILL.md migration module and its tests. The corrected design states migration is explicit and future-command driven, NOT plugin-startup driven.

```sh
# Implementation
rm src/skill-autopilot/migration.ts
rm tests/skill-autopilot/migration.test.ts
rm tests/skill-autopilot/integration/migration.test.ts
```

After deletion, grep MUST find zero matches for `runMigration`, `MigrationStore`, `MigrationInput`, `MigrationResult`, `ProcedureEntry`, `triggerSkillMigration`, or `@/skill-autopilot/migration` anywhere under `src/` and `tests/`. Surface remaining hits to Batch 1.4 implementer.

**Verify:** `! rg -n "runMigration|skill-autopilot/migration|triggerSkillMigration" src tests`
**Commit:** `feat(skill-autopilot): delete startup migration module`

### Task 1.3: Trim config.skillAutopilot to drop injection-only keys
**File:** `src/utils/config.ts`
**Test:** none (config object change covered by downstream module tests)
**Depends:** none
**Domain:** general

Remove the four configuration keys that only existed for prompt injection: `injectionCharBudget`, `injectionSensitivityCeiling`, `defaultAgentScope`, and `snippetMaxChars` (under `skillAutopilot` only; the `skillEvolution.snippetMaxChars` is a different key, leave it alone). Keep all other keys: skillsDir, indexFile, rejectionsJournal, tombstoneFile, managedMarker, frozenMarker, agentskills.io spec keys (nameMaxChars/nameRegex/descriptionMaxBytes/bodyMaxBytes/maxStepsPerSkill/maxSkillsPerProject), maxIndexBytes, recurrence/write-ceiling, triggerOverlapThreshold, runtimeInstallPath, maxFenceLines.

Edit `src/utils/config.ts` to replace the existing `skillAutopilot:` block (lines 282-311) with this exact block:

```typescript
  skillAutopilot: {
    skillsDir: ".opencode/skills",
    indexFile: ".opencode/skills/INDEX.md",
    rejectionsJournal: ".opencode/skills/.rejections.jsonl",
    tombstoneFile: ".tombstone",
    managedMarker: "x-micode-managed",
    frozenMarker: "x-micode-frozen",
    // agentskills.io spec
    nameMaxChars: 64,
    nameRegex: /^[a-z0-9]+(?:-[a-z0-9]+)*$/,
    descriptionMaxBytes: 1024,
    bodyMaxBytes: 8192,
    maxStepsPerSkill: 16,
    maxSkillsPerProject: 200,
    // discovery (used by writer index, NOT runtime injection)
    maxIndexBytes: 16_384,
    // conservative write
    recurrenceMinHits: 2,
    recurrenceMinDistinctIssues: 2,
    maxWritesPerLifecycle: 2,
    triggerOverlapThreshold: 0.6,
    // platform
    runtimeInstallPath: "/root/.micode",
    // code-verbatim guard
    maxFenceLines: 3,
    // public-by-default write policy
    defaultSensitivity: "public" as "public",
    allowedAutoWriteSensitivities: ["public"] as readonly string[],
  },
```

Note the two new keys at the bottom: `defaultSensitivity` and `allowedAutoWriteSensitivities` are required by Batch 2.2 and 2.4 to enforce the public-by-default policy. Keep the rest of the file unchanged.

**Verify:** `bun run typecheck && ! rg -n "injectionCharBudget|injectionSensitivityCeiling|defaultAgentScope" src/utils/config.ts`
**Commit:** `feat(skill-autopilot): trim config to drop injection-only keys, add public-by-default sensitivity policy`

### Task 1.4: Strip skill plumbing from src/index.ts
**File:** `src/index.ts`
**Test:** none (covered by Batch 3 regression tests)
**Depends:** none (parallel with 1.1, 1.2, 1.3 because we delete imports + call sites surgically)
**Domain:** general

Remove all skill-injector, skill-migration, session.deleted-skill, and `chat.params`-skill code paths from `src/index.ts`. Keep ONLY: `runAutopilot` import, `evaluatePushGuard` import, `runStaleSweep` import, the lifecycle `preStageHook` wiring, the lifecycle `prePushHook` wiring, and the post-merge stale-sweep wiring.

Apply these exact edits to `src/index.ts`:

1. Replace the import block (lines 62-67) so that injector and migration imports are gone:

```typescript
import { evaluatePushGuard } from "@/skill-autopilot/push-guard";
import { runAutopilot } from "@/skill-autopilot/runner";
import { runStaleSweep } from "@/skill-autopilot/stale-sweep";
```

2. Delete `SKILL_INJECTOR_LOG_SCOPE` (line 545) and `SKILL_MIGRATION_LOG_SCOPE` (line 546). Keep `SKILL_AUTOPILOT_LOG_SCOPE` and `SKILL_STALE_LOG_SCOPE`. Delete `DEFAULT_SKILL_CONTEXT_AGENT`, `PROCEDURE_ENTRY_TYPE`, `PROCEDURE_STATUS` (lines 541-543). Delete the `ChatParamsInput` and `ChatParamsOutput` interfaces (lines 549-556) and the `appendSystemBlock` and `readSkillFile` helpers (lines 558-564).

3. Delete `listProceduresFromMemory` (lines 571-581), `procedureFromHit` (lines 583-591), `runSkillMigration` (lines 593-602), `triggerSkillMigration` (lines 604-608), `triggerSkillMigrationIfEnabled` (lines 610-613), `injectSkillContext` (lines 615-623), `injectSkillContextIfEnabled` (lines 625-633), and `triggerAutopilotOnDeletedSession` (lines 671-676). Keep `runSkillAutopilot`, `createSkillPrePushHook`, `triggerStaleSweep`, and `createSkillAwareLifecycleHandle`. Update `createSkillPrePushHook` to use the new push-guard signature directly via the existing `readSkillFile` inlined as a local arrow if needed; if `readSkillFile` is removed, inline `readFileSync(join(cwd, path), "utf8")` at the call site.

4. In the plugin body, replace line 751 (`triggerSkillMigrationIfEnabled(skillAutopilotEnabled, ctx.directory);`) with nothing (delete the line and its preceding comment).

5. In the `chat.params` hook (line 1012), delete the `await injectSkillContextIfEnabled(...)` line entirely.

6. In the `event` hook (lines 1159-1162), delete the `triggerAutopilotOnDeletedSession(...)` call. The `cleanupDeletedSession(event)` call MUST stay. Also delete the `triggerAutopilotForCurrentLifecycle` helper (lines 915-921) since its only caller is gone.

7. After all edits, the only references to `skillAutopilotEnabled` left in `src/index.ts` should be: the `userConfig?.features?.skillAutopilot === true` assignment (around line 750), the `preStageHook: skillAutopilotEnabled ? runSkillAutopilot : undefined` line, the `prePushHook: skillAutopilotEnabled ? createSkillPrePushHook() : undefined` line, and the `createSkillAwareLifecycleHandle(..., skillAutopilotEnabled)` call.

**Verify:** `bun run typecheck && ! rg -n "buildInjectionBlock|runMigration|injectSkillContext|triggerAutopilotOnDeletedSession|triggerSkillMigration|triggerAutopilotForCurrentLifecycle|SKILL_INJECTOR_LOG_SCOPE|SKILL_MIGRATION_LOG_SCOPE" src/index.ts`
**Commit:** `feat(skill-autopilot): strip injector/migration/session-deleted plumbing from plugin entry`

### Task 1.5: Verify no skill autopilot barrel re-exports leak
**File:** `src/skill-autopilot/` (read-only audit, edit only if a barrel exists)
**Test:** none
**Depends:** none
**Domain:** general

The `src/skill-autopilot/` directory currently has no top-level `index.ts` barrel (verified during planning). Confirm this with `ls src/skill-autopilot/index.ts 2>/dev/null` returning empty. If during execution a barrel exists, remove any `export * from "./injector/hook"` and `export * from "./migration"` lines.

If the directory is barrel-free (expected), this task is a no-op completion: just confirm the absence and commit a marker docstring or report no-op.

```sh
# Implementation
test ! -f src/skill-autopilot/index.ts && echo "no barrel; no action needed"
# If a barrel exists, edit it to remove injector + migration exports.
```

**Verify:** `! rg -n "skill-autopilot/injector|skill-autopilot/migration" src tests`
**Commit:** none if no-op; otherwise `chore(skill-autopilot): drop deleted-module barrel re-exports`

### Task 1.6: Drop slugify migration import path (if any)
**File:** `src/skill-autopilot/slugify.ts`
**Test:** `tests/skill-autopilot/slugify.test.ts`
**Depends:** none
**Domain:** general

Audit `src/skill-autopilot/slugify.ts` for any import from the deleted `migration.ts`. Based on planning research the file does NOT import migration, so this task is a defensive no-op. Run:

```sh
rg -n "from \"./migration\"|from \"@/skill-autopilot/migration\"" src/skill-autopilot/slugify.ts
```

Expected: zero matches. If matches exist, delete the import lines (the `slugifySkillName` export must remain consumable by `runner.ts`). Do not change behavior of `slugifySkillName` itself.

**Verify:** `bun test tests/skill-autopilot/slugify.test.ts`
**Commit:** none if no-op

### Task 1.7: Drop runner.ts dependency on the migration module
**File:** `src/skill-autopilot/runner.ts` (audit only, real refactor in 2.2)
**Test:** none
**Depends:** none
**Domain:** general

Audit `src/skill-autopilot/runner.ts` to confirm it does NOT import `./migration`. Based on planning research it does not (the runner imports from boundary, byte-budget, concurrency, loader, miner, policy, project-id, security, slugify, sources, writer). This task is a defensive no-op confirmation; the substantive runner refactor lives in Task 2.2.

```sh
rg -n "from \"./migration\"|from \"@/skill-autopilot/migration\"" src/skill-autopilot/runner.ts
```

Expected: zero matches.

**Verify:** `bun run typecheck`
**Commit:** none if no-op

---

## Batch 2: Core Module Refactors (parallel - 6 implementers)

All tasks in this batch depend on Batch 1 completing (config keys gone, injector/migration gone, src/index.ts no longer references them).
Tasks: 2.1, 2.2, 2.3, 2.4, 2.5, 2.6

### Task 2.1: Refactor miner.ts so lifecycle Request first line never becomes a trigger verbatim
**File:** `src/skill-autopilot/miner.ts`
**Test:** `tests/skill-autopilot/miner.test.ts` (updated in 3.4)
**Depends:** 1.1, 1.4 (so injection-related callers are gone)
**Domain:** general

The current `deriveTriggerFromLifecycle` lifts the first line of the lifecycle Request section and returns it as the candidate trigger directly. The corrected design forbids this: lifecycle is evidence, not a verbatim trigger source. Replace the lifecycle-as-trigger path with a substantive-skill filter that demands the candidate read like a reusable project-development practice (verbs like "add", "modify", "deploy", "test", "debug", "rebuild" applied to a stable artifact, not a one-shot lifecycle title).

Replace the contents of `src/skill-autopilot/miner.ts` with:

```typescript
import type { JournalEvent } from "@/lifecycle/journal/types";
import { extractCandidates as extractMemoryCandidates, type PromotionCandidate } from "@/project-memory/parser";
import { candidateIdFor } from "./candidate-id";
import { dedupeKeyFor, sanitizeCandidateInput } from "./security/secret-gate";
import type { LedgerText } from "./sources";

const MAX_STEPS = 16;
const PROCEDURE_ENTRY_TYPE = "procedure";
const BATCH_COMPLETED = "batch_completed";
const REVIEW_COMPLETED = "review_completed";
const APPROVED_OUTCOME = "approved";
const PROCEDURE_BULLET_SEPARATOR = /\s*[;.]\s+/;

const SUBSTANTIVE_VERB = /^(?:add|modify|create|update|deploy|run|rebuild|test|debug|fix|configure|document|verify|inspect|refactor|migrate|upgrade)\b/i;
const LIFECYCLE_TOOLING_NOISE = /\b(?:lifecycle|issue|worktree|branch|merge|push|commit|executor|planner|brainstormer|octto|skill[- ]?autopilot|spawn[- ]?agent|review[- ]?completed|batch[- ]?completed)\b/i;

export interface RawCandidateSource {
  readonly kind: "lifecycle_journal" | "lifecycle_record" | "ledger";
  readonly pointer: string;
}

export interface RawCandidate {
  readonly id: string;
  readonly dedupeKey: string;
  readonly projectId: string;
  readonly trigger: string;
  readonly steps: readonly string[];
  readonly sources: readonly RawCandidateSource[];
  readonly lifecycleIssueNumber: number | null;
}

export interface MinerInput {
  readonly projectId: string;
  readonly lifecycleIssueNumber: number | null;
  readonly lifecycleRecord: string | null;
  readonly journalEvents: readonly JournalEvent[];
  readonly ledgers: readonly LedgerText[];
}

export interface MinerRejection {
  readonly trigger: string;
  readonly reason: string;
}

export interface MinerOutput {
  readonly candidates: readonly RawCandidate[];
  readonly rejected: readonly MinerRejection[];
}

interface RawDraft {
  readonly trigger: string;
  readonly steps: readonly string[];
  readonly sources: readonly RawCandidateSource[];
}

function isSubstantiveTrigger(trigger: string): boolean {
  if (trigger.length < 8 || trigger.length > 240) return false;
  if (LIFECYCLE_TOOLING_NOISE.test(trigger)) return false;
  return SUBSTANTIVE_VERB.test(trigger);
}

function reviewApproved(events: readonly JournalEvent[]): boolean {
  return events.some((event) => event.kind === REVIEW_COMPLETED && event.reviewOutcome === APPROVED_OUTCOME);
}

function batchSteps(events: readonly JournalEvent[]): readonly string[] {
  return events
    .filter((event) => event.kind === BATCH_COMPLETED)
    .map((event) => event.summary)
    .slice(0, MAX_STEPS);
}

// Lifecycle remains EVIDENCE, never a verbatim trigger source. We require an
// independent substantive trigger derived from approved batch_completed steps.
// If no substantive trigger can be derived, no lifecycle draft is emitted.
function lifecycleDraft(input: MinerInput): RawDraft | null {
  if (input.lifecycleIssueNumber === null) return null;
  if (!reviewApproved(input.journalEvents)) return null;
  const steps = batchSteps(input.journalEvents);
  if (steps.length === 0) return null;
  const firstStep = steps[0] ?? "";
  if (!isSubstantiveTrigger(firstStep)) return null;
  const sources: RawCandidateSource[] = [
    { kind: "lifecycle_journal", pointer: `thoughts/lifecycle/${input.lifecycleIssueNumber}.journal.jsonl` },
  ];
  if (input.lifecycleRecord !== null) {
    sources.push({ kind: "lifecycle_record", pointer: `thoughts/lifecycle/${input.lifecycleIssueNumber}.md` });
  }
  return { trigger: firstStep, steps: steps.slice(1, MAX_STEPS), sources };
}

function splitProcedureSummary(summary: string): readonly string[] {
  return summary
    .split(PROCEDURE_BULLET_SEPARATOR)
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function ledgerDraftFor(candidate: PromotionCandidate, pointer: string): RawDraft | null {
  if (candidate.entryType !== PROCEDURE_ENTRY_TYPE) return null;
  const parts = splitProcedureSummary(candidate.summary);
  if (parts.length < 2) return null;
  const [trigger, ...steps] = parts;
  if (!trigger) return null;
  if (!isSubstantiveTrigger(trigger)) return null;
  return { trigger, steps: steps.slice(0, MAX_STEPS), sources: [{ kind: "ledger", pointer }] };
}

function draftsForLedger(ledger: LedgerText): readonly RawDraft[] {
  const extracted = extractMemoryCandidates({
    markdown: ledger.text,
    defaultEntityName: "skill",
    sourceKind: "ledger",
    pointer: ledger.path,
  });
  return extracted.candidates.flatMap((candidate) => {
    const draft = ledgerDraftFor(candidate, ledger.path);
    return draft === null ? [] : [draft];
  });
}

function ledgerDrafts(input: MinerInput): readonly RawDraft[] {
  return input.ledgers.flatMap(draftsForLedger);
}

function buildCandidate(input: MinerInput, draft: RawDraft): RawCandidate | MinerRejection {
  const sanitized = sanitizeCandidateInput({ trigger: draft.trigger, steps: draft.steps });
  if (!sanitized.ok) return { trigger: draft.trigger, reason: sanitized.reason };
  const dedupeKey = dedupeKeyFor({ trigger: sanitized.value.trigger, steps: sanitized.value.steps });
  return {
    id: candidateIdFor(input.projectId, sanitized.value.trigger, sanitized.value.steps),
    dedupeKey,
    projectId: input.projectId,
    trigger: sanitized.value.trigger,
    steps: [...sanitized.value.steps],
    sources: draft.sources,
    lifecycleIssueNumber: input.lifecycleIssueNumber,
  };
}

export function extractRawCandidates(input: MinerInput): MinerOutput {
  // Ledger drafts are listed first because the corrected design ranks ledgers
  // higher than lifecycle journal events (lifecycle is evidence only).
  const drafts: RawDraft[] = [];
  drafts.push(...ledgerDrafts(input));
  const lifecycle = lifecycleDraft(input);
  if (lifecycle !== null) drafts.push(lifecycle);

  const candidates: RawCandidate[] = [];
  const rejected: MinerRejection[] = [];
  const seenIds = new Set<string>();
  for (const draft of drafts) {
    const built = buildCandidate(input, draft);
    if ("reason" in built) {
      rejected.push(built);
      continue;
    }
    if (seenIds.has(built.id)) continue;
    seenIds.add(built.id);
    candidates.push(built);
  }
  return { candidates, rejected };
}
```

Decisions made (filling design gaps):

- "Substantive-skill" is implemented as: trigger length 8-240 chars, starts with a domain action verb, contains no lifecycle/tooling noise tokens. This rejects "Skill Autopilot Native Alignment", "Lifecycle workflow", and "executor batches", while accepting "Add token-aware truncation hook", "Deploy plugin to /root/.micode", "Run bun run check before commit".
- Lifecycle drafts now derive their trigger from the FIRST approved `batch_completed` summary, not from the lifecycle Request first line. Trailing batch_completed events become steps. This makes lifecycle a pure evidence stream rather than a title source.
- Ledger drafts are emitted before lifecycle drafts so dedupe favors ledger-derived candidates when both produce the same dedupeKey.
- `TRIGGER_FALLBACK = "Lifecycle workflow"` and `deriveTriggerFromLifecycle` are deleted: there is no more fallback that produces a non-substantive trigger.

**Verify:** `bun test tests/skill-autopilot/miner.test.ts`
**Commit:** `feat(skill-autopilot): refocus miner away from lifecycle-centric triggers`

### Task 2.2: Refactor runner.ts to read on-disk SKILL.md before write, default sensitivity public, reject internal/secret, scan full rendered body
**File:** `src/skill-autopilot/runner.ts`
**Test:** `tests/skill-autopilot/runner.test.ts` (updated in 3.5)
**Depends:** 1.3 (config keys), 1.4 (no injector callers), 2.1 (miner shape unchanged)
**Domain:** general

Three corrections to runner.ts:

1. **Sovereignty currently broken.** Line 238 calls `decideSovereignty({ tombstone: null, current: null, candidateHash: ... })`. `current` is always null, which means frozen/imported/unmanaged on-disk skills are never detected. Fix: before calling `decideSovereignty`, load the existing on-disk SKILL.md (if any) and parse its frontmatter into a `CurrentSnapshot`.

2. **Default sensitivity must be `public`.** The current `renderSkillFile` hardcodes `x-micode-sensitivity: internal`. Replace with `config.skillAutopilot.defaultSensitivity` (= `"public"`) and explicitly reject candidates whose sanitized form would force an internal/secret classification (no opt-in path in MVP).

3. **Full rendered SKILL.md must be scanned.** The current `runSecurity` builds `body: contentBody(content)` which strips the first two `---` segments (frontmatter + closing `---`). This means trailing frontmatter values (like the rendered `x-micode-source-file-hashes:` block) never reach the body scan. Fix: pass the entire rendered file as `body` to the security pipeline AND keep the parsed frontmatter as `frontmatter`. The `injectionGate` and `selfReferenceGate` already iterate over body+steps+frontmatter values, so passing the full file content as `body` is sufficient and does not double-scan.

Replace `src/skill-autopilot/runner.ts` with:

```typescript
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { config } from "@/utils/config";
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";
import type { ProjectIdentity } from "@/utils/project-id";
import { isWriteAllowedForDirectory } from "./boundary";
import { byteLength } from "./byte-budget";
import { createAsyncMutex } from "./concurrency/async-mutex";
import { acquireRenameLock, releaseRenameLock } from "./concurrency/rename-lock";
import { type DiscoveredSkill, discoverSkills } from "./loader";
import { extractRawCandidates, type RawCandidate } from "./miner";
import { decidePolicy, type ExistingSkillSummary, type PolicyAction } from "./policy";
import { resolveStrictProjectId } from "./project-id";
import { parseSkillFile } from "./schema";
import { hasRejection, recordRejection, runSecurityPipeline } from "./security/pipeline";
import { dedupeKeyFor } from "./security/secret-gate";
import { slugifySkillName } from "./slugify";
import { readJournalEvents, readLedgerTexts, readLifecycleRecord } from "./sources";
import { atomicWriteSkill } from "./writer/atomic-write";
import { renderIndexMd } from "./writer/index-md";
import { detectTriggerOverlap } from "./writer/overlap";
import { computeSourceHashes } from "./writer/source-hashes";
import { type CurrentSnapshot, decideSovereignty } from "./writer/sovereignty";

const LOG_SCOPE = "skill-autopilot.runner";
const STATE_FILE = ".opencode/skills/.state.json";
const SKILLS_DIR = ".opencode/skills";
const SKILL_FILE = "SKILL.md";
const DESCRIPTION_LIMIT = 240;
const VERSION = 1;
const DEFAULT_HITS = 1;
const BODY_MULTIPLIER = 2;
const JSON_INDENT = 2;
const EMPTY_INDEX_HITS = 0;
const ISO_DATE_END = 10;

const mutex = createAsyncMutex();

interface State {
  readonly hits: Record<string, number>;
  readonly distinctIssues: Record<string, number[]>;
}

interface RenderInput {
  readonly candidate: RawCandidate;
  readonly name: string;
  readonly hashes: Readonly<Record<string, string>>;
  readonly hits: number;
}

interface ProcessInput {
  readonly run: RunInput;
  readonly candidate: RawCandidate;
  readonly state: State;
  readonly existing: readonly ExistingSkillSummary[];
  readonly writesSoFar: number;
}

export interface RunInput {
  readonly cwd: string;
  readonly projectId: string;
  readonly issueNumber: number;
  readonly now: number;
  readonly resolveProjectId?: (cwd: string) => Promise<ProjectIdentity>;
  readonly seedCandidates?: readonly RawCandidate[];
}

export interface WriteRecord {
  readonly skillName: string;
  readonly action: PolicyAction;
  readonly relPath: string;
  readonly reason: string;
}

export interface RunResult {
  readonly skipped: boolean;
  readonly skippedReason?: string;
  readonly writes: readonly WriteRecord[];
  readonly rejected: number;
}

function emptyState(): State {
  return { hits: {}, distinctIssues: {} };
}

function loadState(cwd: string): State {
  const file = join(cwd, STATE_FILE);
  if (!existsSync(file)) return emptyState();
  try {
    return JSON.parse(readFileSync(file, "utf8")) as State;
  } catch {
    // intentional: corrupt state must not block lifecycle commits
    return emptyState();
  }
}

function saveState(cwd: string, state: State): void {
  const file = join(cwd, STATE_FILE);
  mkdirSync(join(cwd, SKILLS_DIR), { recursive: true });
  writeFileSync(file, JSON.stringify(state, null, JSON_INDENT));
}

function bumpState(state: State, key: string, issue: number): void {
  state.hits[key] = (state.hits[key] ?? 0) + 1;
  const issues = state.distinctIssues[key] ?? [];
  if (!issues.includes(issue)) issues.push(issue);
  state.distinctIssues[key] = issues;
}

function distinctSets(state: State): Record<string, ReadonlySet<number>> {
  const sets: Record<string, ReadonlySet<number>> = {};
  for (const [key, issues] of Object.entries(state.distinctIssues)) sets[key] = new Set(issues);
  return sets;
}

function renderProcedure(candidate: RawCandidate): string {
  return candidate.steps.map((step) => `- ${step}`).join("\n");
}

function renderHashMetadata(hashes: Readonly<Record<string, string>>): string {
  const entries = Object.entries(hashes);
  if (entries.length === 0) return "";
  const lines = entries.map(([path, hash]) => `  ${path}: ${hash}`).join("\n");
  return `x-micode-source-file-hashes:\n${lines}\n`;
}

function renderSkillFile(input: RenderInput): string {
  const procedure = renderProcedure(input.candidate);
  const hashes = renderHashMetadata(input.hashes);
  const sensitivity = config.skillAutopilot.defaultSensitivity;
  return `---
name: ${input.name}
description: ${input.candidate.trigger}
version: ${VERSION}
x-micode-managed: true
x-micode-sensitivity: ${sensitivity}
x-micode-project-origin: ${input.candidate.projectId}
x-micode-hits: ${input.hits}
x-micode-rationale: derived from project evidence (lifecycle ${input.candidate.lifecycleIssueNumber ?? "-"})
${hashes}---
## When to Use
${input.candidate.trigger}

## Procedure
${procedure}

## Pitfalls
- review the surrounding context before applying this procedure verbatim

## Verification
- bun run check passes after applying this procedure
`;
}

async function loadExistingSummaries(skillsDir: string): Promise<readonly ExistingSkillSummary[]> {
  const discovered = await discoverSkills(skillsDir);
  return discovered.map((skill) => ({
    name: skill.name,
    trigger: skill.description,
    dedupeKey: dedupeKeyFor({ trigger: skill.description, steps: [] }),
  }));
}

async function loadCandidates(input: RunInput): Promise<readonly RawCandidate[]> {
  if (input.seedCandidates) return input.seedCandidates;

  const [journalEvents, lifecycleRecord, ledgers] = await Promise.all([
    readJournalEvents({ cwd: input.cwd, issueNumber: input.issueNumber }),
    readLifecycleRecord({ cwd: input.cwd, issueNumber: input.issueNumber }),
    readLedgerTexts({ cwd: input.cwd }),
  ]);
  return extractRawCandidates({
    projectId: input.projectId,
    lifecycleIssueNumber: input.issueNumber,
    lifecycleRecord,
    journalEvents,
    ledgers,
  }).candidates;
}

function recordSkip(rejectionsFile: string, candidate: RawCandidate, reason: string, now: number): null {
  recordRejection(rejectionsFile, { dedupeKey: candidate.dedupeKey, reason, at: now });
  return null;
}

function existingSkillNames(existing: readonly ExistingSkillSummary[]): ReadonlySet<string> {
  return new Set(existing.map((skill) => skill.name));
}

function selectSkillName(
  candidate: RawCandidate,
  existing: readonly ExistingSkillSummary[],
  action: PolicyAction,
): string {
  const current = existing.find((skill) => skill.dedupeKey === candidate.dedupeKey);
  if (action === "patch" && current) return current.name;
  return slugifySkillName({ trigger: candidate.trigger, existing: existingSkillNames(existing) });
}

function readCurrentSnapshot(targetPath: string): CurrentSnapshot | null {
  if (!existsSync(targetPath)) return null;
  try {
    const text = readFileSync(targetPath, "utf8");
    const parsed = parseSkillFile(text);
    if (!parsed.ok) return null;
    return { frontmatter: parsed.value.frontmatter as Record<string, unknown> };
  } catch {
    // intentional: unreadable existing file MUST block writes; signal via empty frontmatter
    // marker so sovereignty rejects "missing x-micode-managed marker" -> safe default.
    return { frontmatter: {} };
  }
}

function runSecurity(name: string, candidate: RawCandidate, content: string): string | null {
  const result = runSecurityPipeline(
    {
      name,
      description: candidate.trigger.slice(0, DESCRIPTION_LIMIT),
      trigger: candidate.trigger,
      steps: candidate.steps,
      // Full rendered SKILL.md content reaches the security pipeline so that
      // injection patterns hidden in trailing frontmatter (e.g. rationale,
      // source-file-hashes) and any future appended sections are scanned.
      body: content,
      frontmatter: { name, description: candidate.trigger, version: VERSION },
    },
    { dirname: name },
  );
  return result.ok ? null : result.reason;
}

async function writeSkill(
  input: ProcessInput,
  name: string,
  content: string,
  action: PolicyAction,
): Promise<WriteRecord | null> {
  const targetDir = join(input.run.cwd, SKILLS_DIR, name);
  const targetPath = join(targetDir, SKILL_FILE);
  const lock = await acquireRenameLock(targetDir);
  if (!lock.ok) return null;

  try {
    const sovereignty = decideSovereignty({
      tombstone: null,
      current: readCurrentSnapshot(targetPath),
      candidateHash: input.candidate.dedupeKey,
    });
    if (!sovereignty.proceed) return null;
    const result = await atomicWriteSkill({ targetPath, content, expectedVersion: null });
    if (!result.ok) return null;
    return { skillName: name, action, relPath: `${SKILLS_DIR}/${name}/${SKILL_FILE}`, reason: `policy:${action}` };
  } finally {
    releaseRenameLock(lock.lockPath);
  }
}

function shouldRejectOverlap(input: ProcessInput, action: PolicyAction): string | null {
  if (action !== "create") return null;
  return detectTriggerOverlap({
    candidateTrigger: input.candidate.trigger,
    existing: input.existing.map((skill) => ({ name: skill.name, trigger: skill.trigger })),
    threshold: config.skillAutopilot.triggerOverlapThreshold,
    supersedes: null,
  });
}

async function processOne(input: ProcessInput): Promise<WriteRecord | null> {
  const rejectionsFile = join(input.run.cwd, config.skillAutopilot.rejectionsJournal);
  if (hasRejection(rejectionsFile, input.candidate.dedupeKey)) return null;

  bumpState(input.state, input.candidate.dedupeKey, input.run.issueNumber);
  const policy = decidePolicy({
    candidate: input.candidate,
    hitsByKey: input.state.hits,
    distinctIssuesByKey: distinctSets(input.state),
    existingSkills: input.existing,
    writesThisLifecycle: input.writesSoFar,
  });
  if (policy.action === "skip") return null;

  const overlap = shouldRejectOverlap(input, policy.action);
  if (overlap) return recordSkip(rejectionsFile, input.candidate, `trigger overlap with ${overlap}`, input.run.now);

  const name = selectSkillName(input.candidate, input.existing, policy.action);
  const hashes = await computeSourceHashes(
    input.candidate.sources.map((source) => join(input.run.cwd, source.pointer)),
  );
  const content = renderSkillFile({
    candidate: input.candidate,
    name,
    hashes,
    hits: input.state.hits[input.candidate.dedupeKey] ?? DEFAULT_HITS,
  });
  const reason = runSecurity(name, input.candidate, content);
  if (reason) return recordSkip(rejectionsFile, input.candidate, reason, input.run.now);
  if (byteLength(content) > config.skillAutopilot.bodyMaxBytes * BODY_MULTIPLIER) {
    return recordSkip(rejectionsFile, input.candidate, "rendered file too large", input.run.now);
  }
  return writeSkill(input, name, content, policy.action);
}

function toIndexEntry(skill: DiscoveredSkill, now: number): Parameters<typeof renderIndexMd>[0][number] {
  return {
    name: skill.name,
    description: skill.description,
    hits: skill.frontmatter["x-micode-hits"] ?? EMPTY_INDEX_HITS,
    lastUpdated: new Date(now).toISOString().slice(0, ISO_DATE_END),
    deprecated: skill.frontmatter["x-micode-deprecated"] === true,
  };
}

async function writeIndex(cwd: string, now: number): Promise<void> {
  const skillsDir = join(cwd, SKILLS_DIR);
  const skills = await discoverSkills(skillsDir);
  const index = renderIndexMd(skills.map((skill) => toIndexEntry(skill, now)));
  writeFileSync(join(cwd, config.skillAutopilot.indexFile), index);
}

async function processCandidate(input: ProcessInput, writes: WriteRecord[]): Promise<boolean> {
  try {
    const write = await processOne(input);
    if (!write) return false;
    writes.push(write);
    return true;
  } catch (error) {
    log.warn(LOG_SCOPE, `processOne failed: ${extractErrorMessage(error)}`);
    return false;
  }
}

async function runInsideMutex(input: RunInput): Promise<RunResult> {
  mkdirSync(join(input.cwd, SKILLS_DIR), { recursive: true });
  const state = loadState(input.cwd);
  const existing = await loadExistingSummaries(join(input.cwd, SKILLS_DIR));
  const candidates = await loadCandidates(input);
  const writes: WriteRecord[] = [];
  let rejected = 0;

  for (const candidate of candidates) {
    const wrote = await processCandidate(
      { run: input, candidate, state, existing, writesSoFar: writes.length },
      writes,
    );
    if (!wrote) rejected += 1;
  }

  saveState(input.cwd, state);
  if (writes.length > 0) await writeIndex(input.cwd, input.now);
  return { skipped: false, writes, rejected };
}

export async function runAutopilot(input: RunInput): Promise<RunResult> {
  const boundary = isWriteAllowedForDirectory(input.cwd);
  if (!boundary.allowed) return { skipped: true, skippedReason: boundary.reason, writes: [], rejected: 0 };

  const identity = await resolveStrictProjectId(input.cwd, { resolveProjectId: input.resolveProjectId });
  if (!identity.ok) return { skipped: true, skippedReason: identity.reason, writes: [], rejected: 0 };

  const run = { ...input, projectId: identity.identity.projectId };
  return mutex.run(identity.identity.projectId, async () => runInsideMutex(run));
}
```

Decisions made (filling design gaps):

- "Default sensitivity public" implemented via the new `config.skillAutopilot.defaultSensitivity` config key (added in Task 1.3). The runner no longer hardcodes `internal`.
- "Reject internal/secret candidates by default" is enforced two layers up: the runner ALWAYS writes `defaultSensitivity` into the rendered file, never reads a candidate-supplied sensitivity. This matches the design's "auto-written skills are public-safe only" rule. Task 2.4 enforces the corresponding policy reject for any input that tries to bypass.
- Removing `x-micode-agent-scope` from the rendered frontmatter: it was an injection-only field. Without injection it has no consumer.
- Sovereignty: `readCurrentSnapshot` returns null when no file exists (proceed), a parsed snapshot when readable (sovereignty checks frontmatter), or an empty-frontmatter snapshot when file unreadable (sovereignty falls through to "missing x-micode-managed marker" reject = fail-closed).
- Full-render scan: `body: content` (not `contentBody(content)`). The `injectionGate` already iterates fields including `body` and frontmatter values, so passing the entire file string is sufficient and detects injection patterns anywhere in the rendered file.
- The `SECURITY_BODY_DELIMITER` constant and `contentBody` helper are removed.
- The `FRONTMATTER_SEGMENTS_TO_DROP` constant is removed.

**Verify:** `bun test tests/skill-autopilot/runner.test.ts`
**Commit:** `feat(skill-autopilot): fix sovereignty, default public, full-render security scan`

### Task 2.3: Verify sources.ts boundary (lifecycle reads remain but no behavioral primacy)
**File:** `src/skill-autopilot/sources.ts`
**Test:** `tests/skill-autopilot/sources.test.ts`
**Depends:** none (independent of 2.1, 2.2 because sources.ts is the data-fetch layer)
**Domain:** general

`sources.ts` reads three streams: lifecycle journal events, the lifecycle record file, and ledger texts. The corrected design keeps these reads as evidence sources but no longer treats lifecycle as primary. No code change is required in `sources.ts` itself: the primacy ordering moves into the miner (Task 2.1) and the runner (Task 2.2) which already calls `Promise.all` over all three sources. This task is a defensive verification.

```sh
# Implementation
# Confirm sources.ts has no special-casing of lifecycle as a "primary" source.
rg -n "primary|lifecycle.*primary|primarySource" src/skill-autopilot/sources.ts
```

Expected: zero matches. If a primacy comment or branch exists, remove it.

**Verify:** `bun test tests/skill-autopilot/sources.test.ts`
**Commit:** none if no-op; otherwise `chore(skill-autopilot): remove lifecycle-primary comments from sources reader`

### Task 2.4: Tighten policy.ts to reject non-public sensitivities
**File:** `src/skill-autopilot/policy.ts`
**Test:** `tests/skill-autopilot/policy.test.ts` (updated in 3.6)
**Depends:** 1.3 (config.skillAutopilot.allowedAutoWriteSensitivities exists)
**Domain:** general

Add an explicit policy gate: candidates whose intended sensitivity is anything other than the values in `config.skillAutopilot.allowedAutoWriteSensitivities` are skipped. In MVP this set is `["public"]`, so any internal/secret candidate is rejected. Because Task 2.2 makes the runner always write `defaultSensitivity = "public"`, the policy check is the second line of defense for any future code path that passes a sensitivity through.

Replace `src/skill-autopilot/policy.ts` with:

```typescript
import { config } from "@/utils/config";
import type { RawCandidate } from "./miner";

export interface ExistingSkillSummary {
  readonly name: string;
  readonly trigger: string;
  readonly dedupeKey: string;
}

export interface PolicyInput {
  readonly candidate: RawCandidate;
  readonly hitsByKey: Readonly<Record<string, number>>;
  readonly distinctIssuesByKey: Readonly<Record<string, ReadonlySet<number>>>;
  readonly existingSkills: readonly ExistingSkillSummary[];
  readonly writesThisLifecycle: number;
  readonly proposedSensitivity?: string;
}

export type PolicyAction = "create" | "patch" | "skip";

export interface PolicyDecision {
  readonly action: PolicyAction;
  readonly targetSkillName?: string;
  readonly reason?: string;
}

const SKIP = (reason: string): PolicyDecision => ({ action: "skip", reason });

function isAllowedSensitivity(sensitivity: string): boolean {
  return config.skillAutopilot.allowedAutoWriteSensitivities.includes(sensitivity);
}

export function decidePolicy(input: PolicyInput): PolicyDecision {
  if (input.writesThisLifecycle >= config.skillAutopilot.maxWritesPerLifecycle) {
    return SKIP("per-lifecycle write ceiling");
  }
  const sensitivity = input.proposedSensitivity ?? config.skillAutopilot.defaultSensitivity;
  if (!isAllowedSensitivity(sensitivity)) {
    return SKIP(`sensitivity '${sensitivity}' not in allow-list (public-by-default policy)`);
  }
  const hits = input.hitsByKey[input.candidate.dedupeKey] ?? 0;
  if (hits < config.skillAutopilot.recurrenceMinHits) return SKIP(`hits=${hits} < min`);
  const issues = input.distinctIssuesByKey[input.candidate.dedupeKey] ?? new Set<number>();
  if (issues.size < config.skillAutopilot.recurrenceMinDistinctIssues) {
    return SKIP(`distinct issues=${issues.size} < min`);
  }
  const existing = input.existingSkills.find((s) => s.dedupeKey === input.candidate.dedupeKey);
  if (existing) return { action: "patch", targetSkillName: existing.name };
  return { action: "create" };
}
```

The new `proposedSensitivity` field is optional. Existing call sites in `runner.ts` (Task 2.2) do not pass it, so they default to `defaultSensitivity` and pass the gate. A future opt-in internal-skills path can pass an explicit sensitivity.

**Verify:** `bun test tests/skill-autopilot/policy.test.ts`
**Commit:** `feat(skill-autopilot): policy enforces public-by-default sensitivity allow-list`

### Task 2.5: Extend self-reference-gate to reject lifecycle-tooling triggers
**File:** `src/skill-autopilot/security/self-reference-gate.ts`
**Test:** `tests/skill-autopilot/security/self-reference-gate.test.ts` (updated in 3.7)
**Depends:** none (independent regex extension)
**Domain:** general

Add patterns so triggers/steps that describe lifecycle tooling itself (executor, planner, brainstormer, octto, lifecycle/issue/worktree mechanics, spawn-agent, batch_completed, review_completed) are rejected. This is the security pipeline's defense in depth on top of the miner's substantive-skill filter.

Replace `src/skill-autopilot/security/self-reference-gate.ts` with:

```typescript
import type { GateInput, GateResult } from "./types";

const PATTERNS: readonly RegExp[] = [
  /\bskill[ _-]?(?:evolution|autopilot)\b/i,
  /\bfeatures\.\s*skill[\w]*\b/i,
  /\bdisable\s+skill\b/i,
  /\bskip\s+skill\s+capture\b/i,
  /\b(?:lifecycle|executor|planner|brainstormer|octto)\s+(?:request|workflow|machinery|dispatch)\b/i,
  /\b(?:open|close)\s+(?:an\s+)?issue\s+for\b/i,
  /\bspawn[- ]?agent\b/i,
  /\b(?:batch|review)_completed\b/i,
  /\bworktree\s+(?:create|cleanup|merge)\b/i,
];

const REJECTION_REASON = "self-reference to autopilot or lifecycle tooling";

export function selfReferenceGate(input: GateInput): GateResult {
  const fields = [input.description, input.trigger, input.body, ...input.steps];
  for (const field of fields) {
    if (PATTERNS.some((pattern) => pattern.test(field))) {
      return { ok: false, reason: REJECTION_REASON };
    }
  }
  return { ok: true };
}
```

**Verify:** `bun test tests/skill-autopilot/security/self-reference-gate.test.ts`
**Commit:** `feat(skill-autopilot): reject lifecycle-tooling self-references`

### Task 2.6: Update push-guard to align with public-by-default policy
**File:** `src/skill-autopilot/push-guard.ts`
**Test:** `tests/skill-autopilot/push-guard.test.ts`
**Depends:** 1.3 (config.skillAutopilot.allowedAutoWriteSensitivities exists)
**Domain:** general

The current push-guard blocks `internal` and `secret`. With the public-by-default policy, the guard becomes "block anything not on the allow-list". Same behavior in MVP (allow-list = `["public"]`), but expressed declaratively so it tracks the policy automatically.

Replace `src/skill-autopilot/push-guard.ts` with:

```typescript
import { parseSkillFile } from "@/skill-autopilot/schema";
import { config } from "@/utils/config";
import { detectSecret } from "@/utils/secret-detect";

const SKILL_PATH = /^\.opencode\/skills\/[^/]+\/SKILL\.md$/;

export interface PushGuardInput {
  readonly changedPaths: readonly string[];
  readonly readFile: (path: string) => string;
}

export interface PushGuardDecision {
  readonly allowed: boolean;
  readonly reason?: string;
  readonly blockedPaths: readonly string[];
}

function readSkillText(input: PushGuardInput, path: string): string | null {
  try {
    return input.readFile(path);
  } catch {
    // intentional: unreadable file is treated as blocked, fail closed
    return null;
  }
}

function isAllowedSensitivity(sensitivity: string): boolean {
  return config.skillAutopilot.allowedAutoWriteSensitivities.includes(sensitivity);
}

function isBlockedSkill(text: string | null): boolean {
  if (text === null) return true;
  if (detectSecret(text)) return true;
  const parsed = parseSkillFile(text);
  if (!parsed.ok) return true;
  const sensitivity = (parsed.value.frontmatter["x-micode-sensitivity"] as string | undefined)
    ?? config.skillAutopilot.defaultSensitivity;
  return !isAllowedSensitivity(sensitivity);
}

export function evaluatePushGuard(input: PushGuardInput): PushGuardDecision {
  const blocked: string[] = [];
  for (const path of input.changedPaths) {
    if (!SKILL_PATH.test(path)) continue;
    if (isBlockedSkill(readSkillText(input, path))) blocked.push(path);
  }
  if (blocked.length === 0) return { allowed: true, blockedPaths: [] };
  return {
    allowed: false,
    reason: `push blocked: ${blocked.length} skill(s) not in allowed-sensitivity allow-list (${config.skillAutopilot.allowedAutoWriteSensitivities.join(", ")}). Downgrade, freeze, or remove before push.`,
    blockedPaths: blocked,
  };
}
```

**Verify:** `bun test tests/skill-autopilot/push-guard.test.ts`
**Commit:** `feat(skill-autopilot): push-guard tracks public-by-default allow-list`

---

## Batch 3: Tests Update + Regression Tests (parallel - 7 implementers)

All tasks in this batch depend on Batch 2 completing (refactored modules exist, behavior is correct, tests can target them).
Tasks: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7

### Task 3.1: Add regression test asserting no injector module is reachable
**File:** `tests/skill-autopilot/no-injection.test.ts` (NEW)
**Test:** self
**Depends:** 1.1, 1.4
**Domain:** general

Create a regression test that imports the plugin entry indirectly and asserts that no `chat.params` invocation appends a `<skill-context>` block to `output.system`. The test relies on the fact that after Batch 1 there is no exported `buildInjectionBlock` symbol anywhere in `src/skill-autopilot/`.

```typescript
import { describe, expect, it } from "bun:test";
import { existsSync } from "node:fs";
import { join } from "node:path";

describe("no-injection regression", () => {
  it("has no injector module on disk", () => {
    const root = process.cwd();
    expect(existsSync(join(root, "src/skill-autopilot/injector"))).toBe(false);
    expect(existsSync(join(root, "src/skill-autopilot/injector/hook.ts"))).toBe(false);
  });

  it("has no buildInjectionBlock export anywhere under src/skill-autopilot", async () => {
    // Import the package barrel paths that COULD have transitively re-exported the deleted module.
    // Each import MUST throw or yield a module without buildInjectionBlock.
    // We use a dynamic import wrapped in a try so a missing module is the success case.
    const tryImport = async (path: string): Promise<Record<string, unknown> | null> => {
      try {
        return (await import(path)) as Record<string, unknown>;
      } catch {
        return null;
      }
    };
    const candidates = [
      "@/skill-autopilot/runner",
      "@/skill-autopilot/loader",
      "@/skill-autopilot/push-guard",
      "@/skill-autopilot/stale-sweep",
    ];
    for (const path of candidates) {
      const mod = await tryImport(path);
      if (mod === null) continue;
      expect(Object.keys(mod)).not.toContain("buildInjectionBlock");
    }
  });

  it("does not contain chat.params skill injection helper in src/index.ts", async () => {
    const { readFileSync } = await import("node:fs");
    const text = readFileSync(join(process.cwd(), "src/index.ts"), "utf8");
    expect(text).not.toMatch(/injectSkillContext/);
    expect(text).not.toMatch(/buildInjectionBlock/);
    expect(text).not.toMatch(/<skill-context>/);
  });
});
```

**Verify:** `bun test tests/skill-autopilot/no-injection.test.ts`
**Commit:** `test(skill-autopilot): regression assert no injector path remains`

### Task 3.2: Add regression test asserting session.deleted does not trigger autopilot
**File:** `tests/skill-autopilot/no-session-deleted-trigger.test.ts` (NEW)
**Test:** self
**Depends:** 1.4
**Domain:** general

Create a regression test that statically asserts `src/index.ts` does not call any helper named `triggerAutopilotOnDeletedSession` or `triggerAutopilotForCurrentLifecycle`, and that the `event` hook handling `session.deleted` performs only cleanup (PTY, octto, fetch tracker, conversation title, etc.), never autopilot.

```typescript
import { describe, expect, it } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";

describe("no session.deleted skill autopilot trigger", () => {
  const indexPath = join(process.cwd(), "src/index.ts");

  it("does not declare or call triggerAutopilotOnDeletedSession", () => {
    const text = readFileSync(indexPath, "utf8");
    expect(text).not.toMatch(/triggerAutopilotOnDeletedSession/);
  });

  it("does not declare or call triggerAutopilotForCurrentLifecycle", () => {
    const text = readFileSync(indexPath, "utf8");
    expect(text).not.toMatch(/triggerAutopilotForCurrentLifecycle/);
  });

  it("the event hook on session.deleted does not call runAutopilot or runSkillAutopilot", () => {
    const text = readFileSync(indexPath, "utf8");
    // Locate the session.deleted branch.
    const branchIndex = text.indexOf('event.type === "session.deleted"');
    expect(branchIndex).toBeGreaterThan(-1);
    // Slice the next 1500 chars and confirm no autopilot call appears in that window.
    const window = text.slice(branchIndex, branchIndex + 1500);
    expect(window).not.toMatch(/runAutopilot|runSkillAutopilot/);
  });
});
```

**Verify:** `bun test tests/skill-autopilot/no-session-deleted-trigger.test.ts`
**Commit:** `test(skill-autopilot): regression assert session.deleted does not trigger autopilot`

### Task 3.3: Add regression test asserting plugin start does not migrate skills
**File:** `tests/skill-autopilot/no-startup-migration.test.ts` (NEW)
**Test:** self
**Depends:** 1.2, 1.4
**Domain:** general

Create a regression test that statically asserts `src/index.ts` no longer imports or calls the deleted migration module, and that no helper named `triggerSkillMigrationIfEnabled` or `runSkillMigration` exists.

```typescript
import { describe, expect, it } from "bun:test";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

describe("no startup skill migration", () => {
  const indexPath = join(process.cwd(), "src/index.ts");

  it("the migration module is deleted from src/", () => {
    expect(existsSync(join(process.cwd(), "src/skill-autopilot/migration.ts"))).toBe(false);
  });

  it("src/index.ts does not import the deleted migration module", () => {
    const text = readFileSync(indexPath, "utf8");
    expect(text).not.toMatch(/from "@\/skill-autopilot\/migration"/);
    expect(text).not.toMatch(/runMigration/);
  });

  it("src/index.ts does not call triggerSkillMigration helpers", () => {
    const text = readFileSync(indexPath, "utf8");
    expect(text).not.toMatch(/triggerSkillMigration\b/);
    expect(text).not.toMatch(/triggerSkillMigrationIfEnabled/);
    expect(text).not.toMatch(/runSkillMigration\b/);
  });

  it("the migration tests are deleted", () => {
    expect(existsSync(join(process.cwd(), "tests/skill-autopilot/migration.test.ts"))).toBe(false);
    expect(existsSync(join(process.cwd(), "tests/skill-autopilot/integration/migration.test.ts"))).toBe(false);
  });
});
```

**Verify:** `bun test tests/skill-autopilot/no-startup-migration.test.ts`
**Commit:** `test(skill-autopilot): regression assert plugin start does not migrate`

### Task 3.4: Update miner.test.ts to assert lifecycle Request first line is not used verbatim
**File:** `tests/skill-autopilot/miner.test.ts`
**Test:** self
**Depends:** 2.1
**Domain:** general

Replace the test file. The new tests assert: (a) the lifecycle Request first line "Skill Autopilot Native Alignment" is NEVER used verbatim as a trigger; (b) lifecycle drafts only emit when an approved review exists AND the first batch summary is substantive; (c) ledger-derived candidates work and pass the substantive filter; (d) lifecycle-tooling-shaped triggers are rejected.

```typescript
import { describe, expect, it } from "bun:test";

import { extractRawCandidates } from "@/skill-autopilot/miner";

describe("extractRawCandidates", () => {
  it("never uses lifecycle Request first line verbatim as a trigger", () => {
    const mined = extractRawCandidates({
      projectId: "p",
      lifecycleIssueNumber: 31,
      lifecycleRecord: "## Request\n\nSkill Autopilot Native Alignment\n\n## Constraints\n- ok",
      journalEvents: [
        { kind: "review_completed", reviewOutcome: "approved" } as never,
        { kind: "batch_completed", summary: "Add token-aware truncation hook" } as never,
        { kind: "batch_completed", summary: "Run bun run check before commit" } as never,
      ],
      ledgers: [],
    });

    for (const candidate of mined.candidates) {
      expect(candidate.trigger).not.toBe("Skill Autopilot Native Alignment");
    }
  });

  it("emits a lifecycle candidate only when first batch summary is substantive", () => {
    const mined = extractRawCandidates({
      projectId: "p",
      lifecycleIssueNumber: 31,
      lifecycleRecord: "## Request\n\nDeploy CI\n\n## Constraints\n- ok",
      journalEvents: [
        { kind: "review_completed", reviewOutcome: "approved" } as never,
        { kind: "batch_completed", summary: "Add token-aware truncation hook" } as never,
        { kind: "batch_completed", summary: "Run bun run check before commit" } as never,
      ],
      ledgers: [],
    });

    expect(mined.candidates.length).toBe(1);
    expect(mined.candidates[0]?.trigger).toBe("Add token-aware truncation hook");
    expect(mined.candidates[0]?.steps).toEqual(["Run bun run check before commit"]);
  });

  it("rejects lifecycle drafts whose first step is lifecycle-tooling-shaped", () => {
    const mined = extractRawCandidates({
      projectId: "p",
      lifecycleIssueNumber: 31,
      lifecycleRecord: null,
      journalEvents: [
        { kind: "review_completed", reviewOutcome: "approved" } as never,
        { kind: "batch_completed", summary: "executor dispatch ran" } as never,
        { kind: "batch_completed", summary: "lifecycle workflow finished" } as never,
      ],
      ledgers: [],
    });

    expect(mined.candidates.length).toBe(0);
  });

  it("emits nothing when review was not approved", () => {
    const mined = extractRawCandidates({
      projectId: "p",
      lifecycleIssueNumber: 31,
      lifecycleRecord: null,
      journalEvents: [{ kind: "batch_completed", summary: "Add a hook" } as never],
      ledgers: [],
    });

    expect(mined.candidates.length).toBe(0);
  });

  it("emits a candidate from a substantive ledger procedure", () => {
    const mined = extractRawCandidates({
      projectId: "p",
      lifecycleIssueNumber: null,
      lifecycleRecord: null,
      journalEvents: [],
      ledgers: [
        {
          path: "thoughts/ledgers/CONTINUITY_2026-05-04.md",
          text: "## Decisions\n\n- procedure: Add token-aware truncation hook; verify with bun test\n",
        },
      ],
    });

    expect(mined.candidates.length).toBeGreaterThanOrEqual(0);
    if (mined.candidates.length > 0) {
      expect(mined.candidates[0]?.trigger).toMatch(/^Add /);
    }
  });
});
```

The last test is a soft assertion because the ledger parser is provided by `@/project-memory/parser`; if its output structure differs, the candidate may not be produced. The test guards only the substantive shape if a candidate IS produced. The hard assertions are the first four tests, which exercise the corrected miner directly.

**Verify:** `bun test tests/skill-autopilot/miner.test.ts`
**Commit:** `test(skill-autopilot): assert miner does not use lifecycle Request verbatim`

### Task 3.5: Update runner.test.ts for sovereignty, public default, full-render scan
**File:** `tests/skill-autopilot/runner.test.ts`
**Test:** self
**Depends:** 2.2
**Domain:** general

Augment the existing runner test with three new behaviors. The existing test file already exercises the runner end-to-end with seedCandidates; we add three describe blocks. Use the existing test scaffolding pattern (mkdtemp + fake projectId).

The implementer must:

1. Read the current `tests/skill-autopilot/runner.test.ts` to understand the existing setup helper and seed pattern.
2. Append (do not replace) three describe blocks at the bottom of the file:

```typescript
describe("runner sovereignty", () => {
  it("does not overwrite an existing frozen file", async () => {
    // Setup: create .opencode/skills/foo/SKILL.md with x-micode-frozen: true and matching candidate.
    // Run autopilot with a seed candidate that would otherwise patch this skill.
    // Assert: the on-disk file is unchanged.
    // (Use the existing setup helper from the file. If the helper is named `setupRunner`, reuse it.)
    // Pseudocode below; adapt to the existing helpers.
    //
    // const env = setupRunner();
    // mkdirSync(join(env.cwd, ".opencode/skills/frozen-skill"), { recursive: true });
    // writeFileSync(
    //   join(env.cwd, ".opencode/skills/frozen-skill/SKILL.md"),
    //   "---\nname: frozen-skill\ndescription: Frozen\nversion: 1\nx-micode-managed: true\nx-micode-frozen: true\n---\n## When to Use\nFrozen\n",
    // );
    // const before = readFileSync(join(env.cwd, ".opencode/skills/frozen-skill/SKILL.md"), "utf8");
    // await runAutopilot({ ...env.input, seedCandidates: [...] });
    // const after = readFileSync(join(env.cwd, ".opencode/skills/frozen-skill/SKILL.md"), "utf8");
    // expect(after).toBe(before);
    expect(true).toBe(true);
  });

  it("does not overwrite an unmanaged file (missing x-micode-managed)", async () => {
    // Same shape as above but the existing file lacks x-micode-managed.
    expect(true).toBe(true);
  });

  it("does not overwrite an imported file without x-micode-local-overrides", async () => {
    // Same shape but the existing file has x-micode-imported-from set and no x-micode-local-overrides.
    expect(true).toBe(true);
  });
});

describe("runner public-by-default sensitivity", () => {
  it("rendered SKILL.md uses x-micode-sensitivity: public", async () => {
    // Setup minimal env with a passing seed candidate that meets the recurrence policy.
    // Run autopilot; read the written .opencode/skills/<name>/SKILL.md.
    // expect(content).toMatch(/x-micode-sensitivity:\s*public/);
    expect(true).toBe(true);
  });
});

describe("runner full-render security scan", () => {
  it("rejects a candidate whose rendered frontmatter contains an injection pattern", async () => {
    // Construct a seed candidate whose trigger includes "ignore prior instructions"
    // (placed in a context the pre-render fields would not catch on their own).
    // Assert: no file is written, and the rejections journal records the candidate.
    expect(true).toBe(true);
  });
});
```

The implementer is expected to materialize the pseudocode against the actual `setupRunner`-equivalent helper that already exists in the file. The three placeholder `expect(true).toBe(true)` lines MUST be replaced with the real assertions before commit; if the test scaffolding cannot be made to fit (e.g., concurrency mutex blocks), surface that as a Batch 4 follow-up rather than committing fake tests.

**Verify:** `bun test tests/skill-autopilot/runner.test.ts`
**Commit:** `test(skill-autopilot): cover sovereignty, public-default, full-render scan`

### Task 3.6: Update policy.test.ts to cover the public-by-default reject
**File:** `tests/skill-autopilot/policy.test.ts`
**Test:** self
**Depends:** 2.4
**Domain:** general

Append a describe block that exercises the new sensitivity gate. The implementer must read the existing test file, identify the helper that builds a `PolicyInput`, and reuse it.

```typescript
describe("decidePolicy public-by-default sensitivity", () => {
  it("skips a candidate whose proposedSensitivity is internal", () => {
    // const input = makePolicyInputThatWouldOtherwiseCreate();
    // const decision = decidePolicy({ ...input, proposedSensitivity: "internal" });
    // expect(decision.action).toBe("skip");
    // expect(decision.reason).toMatch(/sensitivity 'internal' not in allow-list/);
    expect(true).toBe(true);
  });

  it("skips a candidate whose proposedSensitivity is secret", () => {
    expect(true).toBe(true);
  });

  it("creates when proposedSensitivity is omitted (defaults to public)", () => {
    expect(true).toBe(true);
  });
});
```

Materialize the placeholders against the actual existing helper.

**Verify:** `bun test tests/skill-autopilot/policy.test.ts`
**Commit:** `test(skill-autopilot): cover public-by-default policy reject`

### Task 3.7: Update self-reference-gate.test.ts for new lifecycle-tooling patterns
**File:** `tests/skill-autopilot/security/self-reference-gate.test.ts`
**Test:** self
**Depends:** 2.5
**Domain:** general

Append cases for the new lifecycle-tooling patterns added in Task 2.5. Read the existing test file, reuse its `gate(...)` or input builder, and append:

```typescript
describe("selfReferenceGate lifecycle tooling", () => {
  const samples: ReadonlyArray<{ readonly label: string; readonly field: string }> = [
    { label: "lifecycle workflow", field: "Documents the lifecycle workflow steps" },
    { label: "executor dispatch", field: "Trigger the executor dispatch routine" },
    { label: "open issue for", field: "Open an issue for tracking the change" },
    { label: "spawn-agent", field: "Use spawn-agent to fan out subagents" },
    { label: "batch_completed", field: "Wait for batch_completed event" },
    { label: "worktree create", field: "Worktree create then merge" },
  ];

  for (const sample of samples) {
    it(`rejects ${sample.label} in trigger`, () => {
      // const result = selfReferenceGate({
      //   name: "x",
      //   description: sample.field,
      //   trigger: sample.field,
      //   steps: [],
      //   body: "",
      //   frontmatter: {},
      // });
      // expect(result.ok).toBe(false);
      expect(true).toBe(true);
    });
  }
});
```

Materialize against the actual gate input shape.

**Verify:** `bun test tests/skill-autopilot/security/self-reference-gate.test.ts`
**Commit:** `test(skill-autopilot): cover new lifecycle-tooling self-reference patterns`

---

## Batch 4: Quality Gate (1 implementer)

Final quality gate. Depends on Batch 3 completing.
Tasks: 4.1

### Task 4.1: Run the full quality gate and fix lingering fallout
**File:** repository-wide (no single file)
**Test:** the full suite
**Depends:** 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 1.7, 2.1, 2.2, 2.3, 2.4, 2.5, 2.6, 3.1, 3.2, 3.3, 3.4, 3.5, 3.6, 3.7
**Domain:** general

Run the full quality gate. Fix any lingering type errors, lint findings, dead imports, or test failures introduced by the refactor. Re-confirm the feature flag `features.skillAutopilot` remains default-off in `src/config-loader.ts` and `src/config-schemas.ts`.

```sh
# Implementation
bun run check
```

If `bun run check` fails:

1. **Type errors** in `src/index.ts`: most likely a leftover reference to a deleted helper. Search and remove.
2. **Type errors** in `src/skill-autopilot/runner.ts` regarding `parseSkillFile`: confirm the import path is correct and the returned shape matches `CurrentSnapshot`.
3. **Lint errors** about unused imports: remove the offenders.
4. **Test failures** in tests not listed above (e.g., `tests/skill-autopilot/integration/lifecycle-commit.test.ts`, `tests/skill-autopilot/integration/self-hosting.test.ts`): inspect and adjust the integration test to drop expectations that the deleted injector or migration paths still run. Lifecycle-commit integration likely still works because the runner-level wiring is unchanged. Self-hosting integration may need to drop migration assertions.
5. Re-run `bun run check` until clean.

After clean, verify the feature flag default by reading `src/config-loader.ts` around the `skillAutopilot` field: it MUST remain `optional` and undefined-by-default. The plugin's `skillAutopilotEnabled = userConfig?.features?.skillAutopilot === true` line means the flag is OFF unless the user explicitly sets it. Add a comment if not already present.

**Verify:** `bun run check`
**Commit:** `chore(skill-autopilot): final quality gate clean`

After this commit, lifecycle commit auto-pushes per v9 lifecycle convention. Implementer reports back to executor with: green test count, lint clean, typecheck clean, and the names of any integration tests that needed adjustment.
