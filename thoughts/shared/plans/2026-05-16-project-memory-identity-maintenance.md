---
date: 2026-05-16
topic: "project-memory-identity-maintenance"
issue: 83
scope: project-memory
contract: none
---

# Project Memory Identity Resolver and Maintenance Implementation Plan

**Goal:** Make Project Memory resolve the intended project through deterministic multi-signal identity, keep default lookup clean, and run non-blocking soft maintenance after non-trivial terminal workflow states.

**Architecture:** Add a Project Memory identity layer (`src/project-memory/identity.ts`) above the existing `utils/project-id.ts`, backed by a deterministic JSON registry and explicit/session/lifecycle target inputs. Extend Project Memory statuses and lookup filters so normal agent context returns active entries only, then add a rule-based maintenance worker with project-level locking, a journal, a manual tool entrypoint, and a lifecycle terminal scheduling hook that never owns promotion or cleanup rules itself.

**Design:** [thoughts/shared/designs/2026-05-16-project-memory-identity-maintenance-design.md](../designs/2026-05-16-project-memory-identity-maintenance-design.md)

**Contract:** none（无 frontend ↔ backend HTTP/API contract；全部为 Node/TypeScript workflow + storage/tooling 改动）

---

## Senior-engineer gap-filling decisions

- **Registry first landing:** Ship a durable JSON registry now, not later. Design requires registry alias / origin / known worktree mapping; implementing it as `src/project-memory/registry.ts` with a JSON file under `config.projectMemory.registryFile` keeps it deterministic and testable without adding a second database.
- **Identity shape:** Keep existing `ProjectIdentity` compatibility, but add `ProjectMemoryIdentityResolution` with `resolutionSource`, `safeForWrites`, `safeForMaintenance`, `warnings`, and `candidates`. Reads may proceed on directory fallback with warnings; writes and maintenance are blocked when identity is ambiguous or degraded and `refuseWritesOnDegradedIdentity` is true.
- **Explicit target args:** Tool callers can pass optional `project_target`, `project_origin`, `project_alias`, or `project_worktree` fields. Existing calls without these fields keep current `ctx.directory` fallback behavior.
- **Status vocabulary:** Extend statuses with `archived`, `tombstoned`, and `stale`. Default lookup remains `active` only; explicit historical lookup can pass `status: archived | tombstoned | superseded | deprecated | stale | tentative | hypothesis`.
- **Maintenance implementation:** First version is rule-based only（Claude Code philosophy only: background consolidation, source-grounded summaries, recoverability）. No model-assisted rewriting in this landing.
- **Soft cleanup default:** Worker can archive/tombstone/supersede/mark stale/deduplicate/refine provenance. Hard delete is only used for detected secrets inside Project Memory entries or explicit `project_memory_forget`; it never scans repository files, `.env`, raw logs, or chat transcripts.
- **Lifecycle boundary:** Lifecycle emits a terminal event / source context and schedules maintenance best-effort. Lifecycle does not call `project_memory_promote`, does not implement cleanup rules, and `lifecycle_finish` does not regain auto-promotion.
- **Atlas boundary:** Maintenance may record journal observations such as `atlas_observation_needed`, but it never imports `atlas_lookup`, never edits `atlas/`, and never spawns `atlas-compiler`.

---

## 行为承诺映射

design.md `## Behavior` 段列出 5 条行为承诺：

- **行为 1**（任务从项目外目录运行但 session/lifecycle target 已知时，Project Memory 解析到目标项目）→ 由 **Task 1.3**（origin normalization primitives）、**Task 2.1**（registry）、**Task 3.1**（identity resolver）和 **Task 6.1**（non-project directory integration test）实现与验证。
- **行为 2**（无法安全确定目标项目时，拒绝 writes 和 maintenance）→ 由 **Task 3.1**（resolver safe flags）、**Task 3.3/3.4/3.5**（tools/runtime write/maintenance identity enforcement）、**Task 6.2**（ambiguous/degraded integration test）实现与验证。
- **行为 3**（普通 agent lookup 不返回 archived / tombstoned memories）→ 由 **Task 1.2**（status vocabulary）、**Task 3.2**（lookup active-only default）、**Task 3.6**（lookup tool explicit historical status）实现；由 `tests/project-memory/lookup.test.ts` 与 `tests/tools/project-memory/lookup.test.ts` 验证。默认 active-only 同时排除 superseded/deprecated/stale/tentative/hypothesis，满足用户要求的 archived/tombstoned/deprecated/superseded 默认不出现。
- **行为 4**（非平凡任务 terminal 后后台维护可清理/压缩 PM 且不阻塞主结果）→ 由 **Task 4.3**（worker）、**Task 4.4**（scheduler/lock）、**Task 5.1**（lifecycle terminal trigger）实现；由 **Task 6.4** 验证 scheduler failure 不影响 finish outcome。
- **行为 5**（维护偏好 soft cleanup + provenance，避免不可逆删除）→ 由 **Task 4.1**（classification/action policy）、**Task 4.2**（journal）、**Task 4.3**（worker apply allowed actions only）实现；由 `tests/project-memory/maintenance/worker.test.ts` 验证 exact duplicate supersede/archive、missing source stale/archive、secret-only hard delete、Atlas no-write observation。

**未对应任何 task 的行为**：无。所有行为承诺都有实现 task 和测试 task 覆盖。

> Atlas 关联：本 plan 会要求后续 executor 在代码落地后维护 `atlas/10-impl/Project Memory 存储`、`atlas/20-behavior/Project Memory 工作流`、`atlas/40-decisions/Project Memory 与 Atlas 分层`。本次 plan 只声明影响，maintenance 代码自身不直接写 Atlas。

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2, 1.3 [foundation - no deps]
Batch 2 (parallel): 2.1, 2.2, 2.3, 2.4 [registry/store/journal foundations - depends on batch 1]
Batch 3 (parallel): 3.1, 3.2, 3.3, 3.4, 3.5, 3.6 [resolver + runtime/tool lookup/write integration - depends on batch 2]
Batch 4 (parallel): 4.1, 4.2, 4.3, 4.4, 4.5 [maintenance engine/tool - depends on batch 2 and resolver]
Batch 5 (parallel): 5.1, 5.2, 5.3, 5.4, 5.5 [trigger + wiring + boundary tests - depends on batches 3-4]
Batch 6 (parallel): 6.1, 6.2, 6.3, 6.4, 6.5 [integration/regression verification - depends on batch 5]
```

---

## Batch 1: Foundation (parallel - 3 implementers)

All tasks in this batch have NO dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3

### Task 1.1: Project Memory identity and maintenance config
**File:** `src/utils/config.ts`
**Test:** `tests/utils/config.test.ts`
**Depends:** none
**Domain:** general
**Atlas-impact:** none

Extend the existing `projectMemory` config block. Keep `promoteOnLifecycleFinish: false` unchanged.

Implementation requirements:
- Add `registryFile: join(homedir(), ".config", "opencode", "project-memory", "registry.json")`.
- Add `maintenanceJournalDir: join(homedir(), ".config", "opencode", "project-memory", "maintenance-journal")`.
- Add `maintenanceLockTtlMs: 600_000`, `maintenanceSnapshotLimit: 200`, `maintenanceEnabled: true`, `maintenanceTerminalTriggerEnabled: true`.
- Add `defaultLookupStatuses: ["active"] as readonly string[]` and `historicalStatuses` containing every `StatusValues` literal after Task 1.2 lands. Because this task can land before 1.2, write string literals here and let Task 1.2 align tests.
- Do not flip `promoteOnLifecycleFinish`.

Test requirements:
- `tests/utils/config.test.ts` asserts registry/journal paths live under `.config/opencode/project-memory`.
- Assert maintenance terminal trigger defaults true.
- Assert `promoteOnLifecycleFinish` remains false.

**Verify:** `bun test tests/utils/config.test.ts`
**Commit:** `feat(project-memory): add identity registry and maintenance config`

---

### Task 1.2: Extend Project Memory statuses for cleanup lifecycle
**File:** `src/project-memory/types.ts`
**Test:** `tests/project-memory/types.test.ts`
**Depends:** none
**Domain:** backend
**Atlas-impact:** none

Extend `StatusValues` from current `active | superseded | tentative | hypothesis | deprecated` to:

```ts
export const StatusValues = [
  "active",
  "superseded",
  "tentative",
  "hypothesis",
  "deprecated",
  "archived",
  "tombstoned",
  "stale",
] as const;
```

Implementation requirements:
- Update `HealthReport.entriesByStatus` type automatically via `Status`.
- Do not remove existing statuses or reorder the original first five; append new statuses at the end to minimize snapshot churn.

Test requirements:
- Existing tests still pass.
- Add assertions that `EntrySchema` accepts `archived`, `tombstoned`, and `stale`.
- Add assertion that `StatusValues` contains all cleanup statuses.

**Verify:** `bun test tests/project-memory/types.test.ts`
**Commit:** `feat(project-memory): add archived tombstoned stale statuses`

---

### Task 1.3: Export deterministic project-id primitives
**File:** `src/utils/project-id.ts`
**Test:** `tests/utils/project-id.test.ts`
**Depends:** none
**Domain:** backend
**Atlas-impact:** none

Refactor existing private helpers into reusable deterministic primitives for the new resolver.

Implementation requirements:
- Export `normalizeProjectOrigin(remote: string): string` using the current `normalizeRemote` behavior exactly: trim, normalize ssh `git@host:path`, normalize URL host/path, lowercase, strip trailing `.git`, no fuzzy owner/name matching, no fork-parent guesses.
- Export `projectIdForSource(source: string): string` using the existing SHA-1 first 16 hex chars.
- Keep `resolveProjectId(cwd)` output behavior compatible.
- Add optional helper `isDegradedProjectIdentity(identity: ProjectIdentity): boolean` returning `identity.kind !== "origin"`.
- No registry logic in this file.

Test requirements:
- Existing ssh/https equivalence test still passes.
- Add direct tests for `normalizeProjectOrigin` with HTTPS, SSH, mixed case, and non-URL fallback.
- Add direct test for `projectIdForSource` stable 16-hex output.
- Add negative assertion: normalization does not remove fork parent or rewrite owner; exact normalized origin is the identity.

**Verify:** `bun test tests/utils/project-id.test.ts`
**Commit:** `feat(project-memory): export deterministic project identity primitives`

---

## Batch 2: Registry, Store, and Journal Foundations (parallel - 4 implementers)

All tasks in this batch depend on Batch 1 completing.
Tasks: 2.1, 2.2, 2.3, 2.4

### Task 2.1: Deterministic Project Memory registry
**File:** `src/project-memory/registry.ts`
**Test:** `tests/project-memory/registry.test.ts`
**Depends:** 1.1, 1.3
**Domain:** backend
**Atlas-impact:** layer-update

Create a JSON-backed deterministic registry for aliases, normalized origins, and known worktrees.

Public API to implement:
- `ProjectRegistryRecord { projectId, origin?: string, aliases: readonly string[], worktrees: readonly string[], updatedAt }`
- `ProjectRegistry { load(): Promise<readonly ProjectRegistryRecord[]>; upsert(record): Promise<void>; findByAlias(alias): Promise<readonly ProjectRegistryRecord[]>; findByOrigin(origin): Promise<readonly ProjectRegistryRecord[]>; findByWorktree(path): Promise<readonly ProjectRegistryRecord[]> }`
- `createProjectRegistry(options?: { filePath?: string }): ProjectRegistry`
- `normalizeRegistryRecord(input)` should normalize origins via `normalizeProjectOrigin` and absolute worktree paths via `resolve()`.

Implementation requirements:
- JSON file shape: `{ "version": 1, "records": [...] }`.
- Writes are atomic enough for local tool use: write temp file next to registry then rename.
- No fuzzy matching. Alias lookup is exact after trim/lowercase.
- Multiple records may match an alias/worktree; resolver treats that as ambiguous.

Test requirements:
- Upsert then find by alias/origin/worktree.
- SSH and HTTPS origin map to same normalized origin.
- Two exact alias matches are returned as two candidates, not silently merged.
- Missing registry file returns empty records.

**Verify:** `bun test tests/project-memory/registry.test.ts`
**Commit:** `feat(project-memory): add deterministic project registry`

---

### Task 2.2: Store support for maintenance snapshots and soft status updates
**File:** `src/project-memory/store.ts`
**Test:** `tests/project-memory/store.test.ts`
**Depends:** 1.2
**Domain:** backend
**Atlas-impact:** layer-update

Extend `ProjectMemoryStore` with methods the maintenance worker needs; do not change existing method behavior.

API additions:
- `listEntries(projectId: string, options?: { status?: Status; limit?: number }): Promise<readonly Entry[]>`
- `listEntities(projectId: string, options?: { limit?: number }): Promise<readonly Entity[]>`
- `listSources(projectId: string, options?: { limit?: number }): Promise<readonly Source[]>`
- `updateEntryStatus(projectId: string, entryId: string, status: Status, updatedAt?: number): Promise<void>`
- `updateEntrySummary(projectId: string, entryId: string, summary: string, updatedAt?: number): Promise<void>`

Implementation requirements:
- `EMPTY_STATUS_COUNTS` must include `archived`, `tombstoned`, and `stale`.
- Existing `searchEntries` with explicit `status` must support new statuses.
- `updateEntryStatus` must also update FTS row through existing `upsertEntryInDb` or equivalent, so status changes do not corrupt search.
- `listEntries` should order by `updated_at DESC, id ASC` and apply limit default from `config.projectMemory.maintenanceSnapshotLimit` when caller omits limit.

Test requirements:
- Count by status includes cleanup statuses with zero default.
- `updateEntryStatus(..., "archived")` makes explicit `searchEntries(..., { status: "archived" })` find the entry.
- `listEntries` respects status and limit.
- Existing forget/project isolation tests still pass.

**Verify:** `bun test tests/project-memory/store.test.ts`
**Commit:** `feat(project-memory): add maintenance snapshot store operations`

---

### Task 2.3: Maintenance action and journal types
**File:** `src/project-memory/maintenance/types.ts`
**Test:** `tests/project-memory/maintenance/types.test.ts`
**Depends:** 1.2
**Domain:** backend
**Atlas-impact:** none

Create the maintenance type vocabulary used by classifier, worker, scheduler, and tool output.

Types to export:
- `MaintenanceReason = "manual" | "terminal" | "scheduled" | "dry-run"`
- `MaintenanceCandidateKind = "duplicate" | "missing_source" | "stale" | "superseded" | "deprecated" | "low_signal" | "potential_secret" | "orphan"`
- `MaintenanceActionKind = "archive" | "tombstone" | "supersede" | "mark_stale" | "deduplicate" | "refine_summary" | "hard_delete_secret" | "needs_review" | "skip"`
- `MaintenancePlanItem`, `MaintenancePlan`, `MaintenanceRunInput`, `MaintenanceRunOutcome`, `MaintenanceJournalEvent`.

Constraints in types:
- `MaintenancePlanItem` must include `entryId`, `kind`, `action`, `confidence: "low" | "medium" | "high"`, `reason`, and `safeByDefault`.
- `MaintenanceRunInput` must include `projectId`, `reason`, `dryRun`, `triggeredBy`, and optional `sourcePointers`.
- Outcomes must include `applied`, `skipped`, `blocked`, `warnings`, `journalPath`.

Test requirements:
- Valibot schemas or literal arrays accept all allowed action/kind values.
- `hard_delete_secret` is represented as a distinct action, not conflated with archive.

**Verify:** `bun test tests/project-memory/maintenance/types.test.ts`
**Commit:** `feat(project-memory): define maintenance action vocabulary`

---

### Task 2.4: Maintenance journal writer
**File:** `src/project-memory/maintenance/journal.ts`
**Test:** `tests/project-memory/maintenance/journal.test.ts`
**Depends:** 1.1, 2.3
**Domain:** backend
**Atlas-impact:** none

Implement append-only JSONL maintenance journal. The journal is audit metadata and must not be returned by normal lookup.

Public API:
- `journalPathFor(projectId: string, date?: Date): string`
- `appendMaintenanceJournal(event: MaintenanceJournalEvent, options?: { dir?: string }): Promise<string>` returns file path.
- `readMaintenanceJournal(projectId: string, options?: { dir?: string; limit?: number }): Promise<readonly MaintenanceJournalEvent[]>` for tests and health follow-up.

Implementation requirements:
- Path under `config.projectMemory.maintenanceJournalDir/<projectId>.jsonl`.
- Create directories recursively.
- Never include entry summaries longer than 240 chars in journal events.
- Journal event should store IDs/action/reasons/counts, not raw markdown, not secrets.

Test requirements:
- Append two events and read them back in order.
- Long detail is truncated.
- Journal file is outside any repo path supplied by tests.

**Verify:** `bun test tests/project-memory/maintenance/journal.test.ts`
**Commit:** `feat(project-memory): add maintenance journal`

---

## Batch 3: Identity Runtime and Lookup Integration (parallel - 6 implementers)

All tasks in this batch depend on Batch 2 completing.
Tasks: 3.1, 3.2, 3.3, 3.4, 3.5, 3.6

### Task 3.1: Project Memory identity resolver
**File:** `src/project-memory/identity.ts`
**Test:** `tests/project-memory/identity.test.ts`
**Depends:** 2.1, 1.3
**Domain:** backend
**Atlas-impact:** layer-update

Implement the deterministic priority resolver from the design.

Public API:
- `ProjectMemoryTarget { projectId?: string; origin?: string; alias?: string; worktree?: string }`
- `ProjectMemoryIdentityContext { directory: string; explicitTarget?: ProjectMemoryTarget; sessionTarget?: ProjectMemoryTarget; lifecycleTarget?: ProjectMemoryTarget; registry?: ProjectRegistry }`
- `resolveProjectMemoryIdentity(context): Promise<ProjectMemoryIdentityResolution>`
- `assertWritableProjectIdentity(resolution): ProjectIdentity` throws a friendly diagnostic on ambiguous/degraded unsafe identity.
- `assertMaintenanceProjectIdentity(resolution): ProjectIdentity` same policy for maintenance.

Priority order:
1. explicit target
2. session target
3. lifecycle target
4. registry alias/origin/worktree mapping
5. current `ctx.directory` fallback via `resolveProjectId`
6. degraded identity handling

Rules:
- Exact projectId target wins without registry lookup.
- Origin target normalizes through `normalizeProjectOrigin` and hashes via `projectIdForSource`.
- Alias/worktree targets use registry; zero match falls through only if target was not explicit. Explicit alias/worktree zero match returns degraded/blocked diagnostic.
- Multiple registry matches returns `kind: "ambiguous"` resolution with candidates; reads may return warning, writes/maintenance blocked.
- `kind: "path"` directory fallback is degraded; writes/maintenance blocked when config says so.

Test requirements:
- Explicit beats session/lifecycle/registry/directory.
- Session beats lifecycle; lifecycle beats registry; registry beats directory.
- Deterministic origin normalization; no fuzzy project-name matching.
- Ambiguous alias blocks writable assertion and returns candidates.
- Path-only degraded identity blocks writable/maintenance assertions.

**Verify:** `bun test tests/project-memory/identity.test.ts`
**Commit:** `feat(project-memory): add deterministic multi-signal identity resolver`

---

### Task 3.2: Lookup service default active-only filter
**File:** `src/project-memory/lookup.ts`
**Test:** `tests/project-memory/lookup.test.ts`
**Depends:** 2.2
**Domain:** backend
**Atlas-impact:** none

Update lookup internals so omission of `status` means active-only, not unrestricted search.

Implementation requirements:
- Keep `LookupInput.status?: Status` for explicit historical lookup.
- Add constant `DEFAULT_LOOKUP_STATUS: Status = "active"`.
- In `lookup(input)`, pass `status: input.status ?? DEFAULT_LOOKUP_STATUS` into `store.searchEntries`.
- Update `STATUS_RANK` for new statuses, even though default lookup filters them out. Suggested order: active, tentative, hypothesis, stale, superseded, deprecated, archived, tombstoned.

Test requirements:
- Seed active, archived, tombstoned, deprecated, superseded with same query; default lookup returns only active.
- Explicit `status: "archived"` returns archived.
- Explicit `status: "tombstoned"` returns tombstoned.
- Existing sensitivity/snippet/degraded tests still pass.

**Verify:** `bun test tests/project-memory/lookup.test.ts`
**Commit:** `fix(project-memory): default lookup to active memory only`

---

### Task 3.3: Project Memory runtime identity integration
**File:** `src/tools/project-memory/runtime.ts`
**Test:** `tests/tools/project-memory/runtime-identity.test.ts`
**Depends:** 3.1
**Domain:** general
**Atlas-impact:** none

Replace direct `resolveProjectId(ctx.directory)` usage with the new resolver while preserving existing tests.

API additions:
- `ProjectMemoryToolTargetArgs` type for optional `project_target`, `project_origin`, `project_alias`, `project_worktree`, `session_project_origin`, `lifecycle_project_origin` fields.
- `getReadIdentity(directory: string, args?: ProjectMemoryToolTargetArgs): Promise<ProjectIdentity>` returns resolution identity, allowing degraded reads with warnings handled by caller.
- `getWriteIdentity(directory: string, args?: ProjectMemoryToolTargetArgs): Promise<ProjectIdentity>` asserts writable.
- `getMaintenanceIdentity(directory: string, args?: ProjectMemoryToolTargetArgs): Promise<ProjectIdentity>` asserts maintenance-safe.
- Keep `getIdentity(directory)` as backward-compatible alias to `getReadIdentity(directory)` for old tests.

Test requirements:
- Existing callers of `getIdentity` still compile/pass.
- `getWriteIdentity` rejects path-only degraded identity when config default is true.
- Explicit origin target from a non-project directory resolves to expected origin project id.
- Ambiguous registry target rejects writes.

**Verify:** `bun test tests/tools/project-memory/runtime-identity.test.ts tests/tools/project-memory/lookup.test.ts`
**Commit:** `feat(project-memory): route tools through identity resolver`

---

### Task 3.4: Promote tool enforces write-safe identity
**File:** `src/tools/project-memory/promote.ts`
**Test:** `tests/tools/project-memory/promote.test.ts`
**Depends:** 3.3
**Domain:** general
**Atlas-impact:** none

Update `project_memory_promote` tool wrapper.

Implementation requirements:
- Add optional target args to tool schema: `project_target`, `project_origin`, `project_alias`, `project_worktree`, `session_project_origin`, `lifecycle_project_origin`.
- Replace `getIdentity(ctx.directory)` with `getWriteIdentity(ctx.directory, args)`.
- Friendly refusal must say identity is ambiguous/degraded and include candidate sources when available; do not throw raw stack.
- Keep secret rejection and existing markdown promotion behavior unchanged.

Test requirements:
- Existing promote tests still pass.
- Promote from a non-project directory with explicit `project_origin` writes into the origin project.
- Promote from degraded path identity returns `## Error`/refusal and does not write.

**Verify:** `bun test tests/tools/project-memory/promote.test.ts`
**Commit:** `feat(project-memory): enforce safe identity for promotion tool`

---

### Task 3.5: Forget tool enforces write-safe identity
**File:** `src/tools/project-memory/forget.ts`
**Test:** `tests/tools/project-memory/forget.test.ts`
**Depends:** 3.3
**Domain:** general
**Atlas-impact:** none

Update `project_memory_forget` tool wrapper.

Implementation requirements:
- Add the same optional target args as Task 3.4.
- Replace `getIdentity(ctx.directory)` with `getWriteIdentity(ctx.directory, args)`.
- Preserve explicit-user-only policy in description. This tool remains hard-delete; maintenance worker must not use this tool except for secret action through store API, not through user-facing tool.

Test requirements:
- Existing forget tests still pass.
- Forget by explicit origin from non-project dir removes the intended project entry.
- Degraded/ambiguous write identity refuses and leaves store unchanged.

**Verify:** `bun test tests/tools/project-memory/forget.test.ts`
**Commit:** `feat(project-memory): enforce safe identity for forget tool`

---

### Task 3.6: Lookup and health tools support explicit historical/target lookup
**File:** `src/tools/project-memory/lookup.ts`
**Test:** `tests/tools/project-memory/lookup.test.ts`
**Depends:** 3.2, 3.3
**Domain:** general
**Atlas-impact:** none

Update lookup tool args and default behavior. Health tool remains read-only and is handled by Task 5.3 if registration needs export changes; this task only touches lookup file.

Implementation requirements:
- Add optional target args to lookup schema.
- Keep `status` optional; if omitted, service default active-only applies.
- Description must state archived/tombstoned/deprecated/superseded require explicit `status`.
- Use `getReadIdentity(ctx.directory, args)`.

Test requirements:
- Default tool lookup output excludes archived, tombstoned, deprecated, superseded.
- Passing `status: "archived"` returns archived entry.
- Explicit `project_origin` from non-project directory resolves intended project.
- Friendly error on store failure remains unchanged.

**Verify:** `bun test tests/tools/project-memory/lookup.test.ts`
**Commit:** `feat(project-memory): make lookup active-only by default with explicit history opt-in`

---

## Batch 4: Maintenance Engine and Manual Entrypoint (parallel - 5 implementers)

All tasks in this batch depend on Batch 2 and resolver foundations completing.
Tasks: 4.1, 4.2, 4.3, 4.4, 4.5

### Task 4.1: Maintenance classifier and safe action planner
**File:** `src/project-memory/maintenance/classifier.ts`
**Test:** `tests/project-memory/maintenance/classifier.test.ts`
**Depends:** 2.3, 2.2
**Domain:** backend
**Atlas-impact:** none

Implement pure classification from bounded snapshots to a maintenance plan.

Rules:
- Exact duplicates: same `entityId + type + title + summary`; newest kept, older entries get action `supersede` or `archive` with high confidence.
- Missing source: `note`/`todo` low-signal entries can `archive`; decisions/risks become `mark_stale` or `needs_review`, not deletion.
- Old active entries over stale threshold become `mark_stale` unless they are decisions/risks, which become `needs_review`.
- Already `deprecated`/`superseded` older than archive threshold can `archive`.
- `detectSecret(title + summary)` yields `hard_delete_secret` with high confidence and `safeByDefault: true` because the content is already inside PM; do not include secret text in reason.
- Atlas-related observations are `needs_review` journal notes only; classifier must not import atlas modules.

Test requirements:
- Duplicate plan keeps newest and marks older duplicate.
- Missing-source decision is not archived automatically.
- Deprecated/superseded old entries archive.
- Secret summary plans `hard_delete_secret` without echoing secret.
- Classifier is pure: no store writes.

**Verify:** `bun test tests/project-memory/maintenance/classifier.test.ts`
**Commit:** `feat(project-memory): classify maintenance candidates with soft cleanup policy`

---

### Task 4.2: Project-level maintenance lock
**File:** `src/project-memory/maintenance/lock.ts`
**Test:** `tests/project-memory/maintenance/lock.test.ts`
**Depends:** 1.1
**Domain:** backend
**Atlas-impact:** none

Implement a simple per-project lock for background maintenance.

Public API:
- `acquireMaintenanceLock(projectId: string, options?: { ttlMs?: number }): Promise<MaintenanceLock | null>`
- `MaintenanceLock { projectId: string; release(): Promise<void> }`

Implementation requirements:
- In-process lock map is sufficient for first landing; include stale lock expiry via `ttlMs`.
- Never block waiting; return null on lock conflict so scheduler can skip/reschedule.
- Tests should use fake short TTL, no sleeps over 50ms.

Test requirements:
- Same project second acquire returns null until release.
- Different projects can acquire concurrently.
- Expired lock can be reacquired.

**Verify:** `bun test tests/project-memory/maintenance/lock.test.ts`
**Commit:** `feat(project-memory): add project-level maintenance lock`

---

### Task 4.3: Maintenance worker
**File:** `src/project-memory/maintenance/worker.ts`
**Test:** `tests/project-memory/maintenance/worker.test.ts`
**Depends:** 2.2, 2.4, 4.1, 4.2
**Domain:** backend
**Atlas-impact:** none

Implement bounded snapshot → plan → apply safe actions → journal state machine.

Public API:
- `buildMaintenancePlan({ store, identity, now? }): Promise<MaintenancePlan>`
- `runProjectMemoryMaintenance(input: MaintenanceRunInput & { store: ProjectMemoryStore; identity: ProjectIdentity }): Promise<MaintenanceRunOutcome>`

Implementation requirements:
- Assert caller already supplied maintenance-safe identity; do not resolve ctx here.
- Acquire lock; if lock conflict, return skipped outcome with warning.
- Snapshot via `listEntries`, `listEntities`, `listSources` bounded by config.
- Dry-run returns plan and journal event but does not mutate entries.
- Apply allowed actions:
  - `archive` → `updateEntryStatus(..., "archived")`
  - `tombstone` → `updateEntryStatus(..., "tombstoned")`
  - `supersede` / `deduplicate` → `updateEntryStatus(..., "superseded")`
  - `mark_stale` → `updateEntryStatus(..., "stale")`
  - `hard_delete_secret` → `store.forgetEntry(projectId, entryId)`
  - `needs_review` / `skip` → no mutation, journal only
- Never call `project_memory_promote`, `project_memory_forget` tool, `atlas_lookup`, or write `atlas/`.

Test requirements:
- Dry-run does not mutate statuses.
- Exact duplicate maintenance marks older duplicate `superseded` or `archived` and keeps newest active.
- Missing-source decision becomes `stale`/`needs_review`, not hard deleted.
- Secret entry is hard-deleted and reason does not leak secret.
- Lock conflict returns skipped.
- Worker failure writes a failure journal and returns warning, not throw to scheduler.

**Verify:** `bun test tests/project-memory/maintenance/worker.test.ts`
**Commit:** `feat(project-memory): add non-blocking soft maintenance worker`

---

### Task 4.4: Maintenance scheduler
**File:** `src/project-memory/maintenance/scheduler.ts`
**Test:** `tests/project-memory/maintenance/scheduler.test.ts`
**Depends:** 4.3, 3.1
**Domain:** backend
**Atlas-impact:** none

Create the low-priority non-blocking scheduler used by lifecycle/tool/manual calls.

Public API:
- `scheduleProjectMemoryMaintenance(input: ScheduleMaintenanceInput): Promise<ScheduleMaintenanceOutcome>`
- `createProjectMemoryMaintenanceScheduler(deps)` for tests/lifecycle injection.

Implementation requirements:
- Scheduler resolves/accepts identity before queueing; degraded/ambiguous maintenance identity returns blocked outcome immediately.
- Default scheduler starts worker in a detached async turn (`queueMicrotask` or `setTimeout(..., 0)`) and catches all errors into journal/warnings.
- `dryRun` can execute immediately for manual tool calls.
- Return quickly with `{ scheduled: true | false, reason }`; never wait for background worker in terminal trigger mode.

Test requirements:
- Terminal schedule returns before worker promise resolves.
- Worker rejection is captured and does not reject scheduler call.
- Ambiguous/degraded identity blocks schedule.
- Dry-run path returns worker outcome for manual tool.

**Verify:** `bun test tests/project-memory/maintenance/scheduler.test.ts`
**Commit:** `feat(project-memory): add maintenance scheduler`

---

### Task 4.5: Manual project_memory_maintain tool
**File:** `src/tools/project-memory/maintain.ts`
**Test:** `tests/tools/project-memory/maintain.test.ts`
**Depends:** 3.3, 4.4
**Domain:** general
**Atlas-impact:** none

Add a manual tool entrypoint for dry-run and explicit maintenance.

Tool name: `project_memory_maintain`.

Args:
- `dry_run?: boolean` default true for safety.
- Optional target args: `project_target`, `project_origin`, `project_alias`, `project_worktree`, `session_project_origin`, `lifecycle_project_origin`.
- `reason?: "manual" | "scheduled" | "terminal"` default manual.

Implementation requirements:
- Use `getMaintenanceIdentity(ctx.directory, args)`.
- Manual dry-run should wait and render the plan.
- Manual apply (`dry_run: false`) should render applied/skipped/blocked counts and journal path.
- Do not expose raw secret summaries in output.

Test requirements:
- Default dry-run does not mutate status.
- `dry_run: false` applies safe archive/supersede actions.
- Degraded identity returns friendly error and does not run worker.

**Verify:** `bun test tests/tools/project-memory/maintain.test.ts`
**Commit:** `feat(project-memory): expose manual maintenance tool`

---

## Batch 5: Trigger, Wiring, and Boundary Tests (parallel - 5 implementers)

All tasks in this batch depend on Batches 3 and 4 completing.
Tasks: 5.1, 5.2, 5.3, 5.4, 5.5

### Task 5.1: Lifecycle terminal maintenance trigger
**File:** `src/lifecycle/index.ts`
**Test:** `tests/lifecycle/project-memory-maintenance-trigger.test.ts`
**Depends:** 4.4
**Domain:** backend
**Atlas-impact:** none

Schedule maintenance after non-trivial lifecycle terminal states without reintroducing auto-promotion.

Implementation requirements:
- Add optional `maintenanceScheduler?: ProjectMemoryMaintenanceScheduler` to `LifecycleStoreInput` and context.
- In `createFinisher`, after `saveAndSync(applyFinishOutcome(...))` and before/after `safeEmit` is acceptable, schedule maintenance only when:
  - `config.projectMemory.maintenanceEnabled` and `maintenanceTerminalTriggerEnabled` are true.
  - Outcome is terminal and non-trivial: merged success or executor-blocked terminal. Since lifecycle exists only for non-trivial issue-driven tasks, lifecycle finish is the non-trivial trigger.
- Pass source context only: issue number, branch, artifact pointers, outcome kind. Do not pass markdown bodies to promotion.
- Never await background maintenance in finish path. Catch scheduler errors and append/safeEmit warning only if cheap; finish outcome must remain unchanged.
- Do not import `promoteMarkdown` beyond existing gated legacy call. Do not call `runProjectMemoryMaintenance` directly; call scheduler.

Test requirements:
- Successful merged finish calls injected scheduler exactly once with `reason: "terminal"` and source pointers.
- Scheduler rejection does not change `FinishOutcome.merged` or close/cleanup behavior.
- Config flag false disables scheduling.
- Non-merged non-blocked finish does not schedule.

**Verify:** `bun test tests/lifecycle/project-memory-maintenance-trigger.test.ts tests/lifecycle/promote-on-finish.test.ts`
**Commit:** `feat(project-memory): schedule maintenance after lifecycle terminal states`

---

### Task 5.2: Project-memory tool barrel exports
**File:** `src/tools/project-memory/index.ts`
**Test:** none
**Depends:** 4.5
**Domain:** general
**Atlas-impact:** none

Export `createProjectMemoryMaintainTool` from the project-memory tools barrel.

Implementation requirements:
- Add exactly one export line.
- No behavior logic here.

**Verify:** `bun run typecheck`
**Commit:** `chore(project-memory): export maintenance tool factory`

---

### Task 5.3: Top-level tools export
**File:** `src/tools/index.ts`
**Test:** `tests/tools/project-memory/index.test.ts`
**Depends:** 5.2
**Domain:** general
**Atlas-impact:** none

Add `createProjectMemoryMaintainTool` to the top-level tools export list.

Test requirements:
- `tests/tools/project-memory/index.test.ts` imports from `@/tools/project-memory` and `@/tools` and asserts maintain factory is exported.

**Verify:** `bun test tests/tools/project-memory/index.test.ts`
**Commit:** `chore(tools): export project memory maintenance tool`

---

### Task 5.4: Plugin registration for maintain tool
**File:** `src/index.ts`
**Test:** `tests/tools/project-memory/index.test.ts`
**Depends:** 5.3
**Domain:** general
**Atlas-impact:** none

Register `project_memory_maintain` alongside lookup/promote/health/forget.

Implementation requirements:
- Add import and spread `...createProjectMemoryMaintainTool(ctx)` in the tool registration object.
- Keep existing `/memory` command behavior unchanged; `/memory` with args still lookup, no args still health. Manual maintenance is tool-only for first landing unless user later asks for a slash command.

Test requirements:
- Extend `tests/tools/project-memory/index.test.ts` or nearby registration test to assert tool map includes `project_memory_maintain`.

**Verify:** `bun test tests/tools/project-memory/index.test.ts bun run typecheck`
**Commit:** `feat(project-memory): register maintenance tool`

---

### Task 5.5: Lifecycle and Atlas boundary regression tests
**File:** `tests/lifecycle/project-memory-boundary.test.ts`
**Test:** `tests/lifecycle/project-memory-boundary.test.ts`
**Depends:** 5.1
**Domain:** general
**Atlas-impact:** none

Strengthen boundary tests for the new maintenance trigger.

Add assertions:
- Lifecycle files still do not import `project_memory_promote` tool or call `promoteMarkdown` outside the existing gated call site.
- `config.projectMemory.promoteOnLifecycleFinish` remains false.
- Lifecycle may import/schedule `scheduleProjectMemoryMaintenance`, but must not import `runProjectMemoryMaintenance` or classifier/worker modules directly.
- `src/project-memory/maintenance/**/*.ts` must not contain `atlas_lookup`, `atlas-compiler`, `writeFileSync("atlas`, `project_memory_promote`, or `project_memory_forget`.

**Verify:** `bun test tests/lifecycle/project-memory-boundary.test.ts tests/lifecycle/atlas-boundary.test.ts`
**Commit:** `test(project-memory): guard lifecycle and atlas maintenance boundaries`

---

## Batch 6: Integration and Regression Verification (parallel - 5 implementers)

All tasks in this batch depend on Batch 5 completing.
Tasks: 6.1, 6.2, 6.3, 6.4, 6.5

### Task 6.1: Non-project directory resolves via explicit/lifecycle target
**File:** `tests/integration/project-memory-identity-target.test.ts`
**Test:** `tests/integration/project-memory-identity-target.test.ts`
**Depends:** 3.1, 3.3, 3.4, 3.6
**Domain:** general
**Atlas-impact:** none

Add integration test for the core identity behavior.

Test flow:
1. Create temp repo with origin `https://github.com/Wuxie233/micode.git` and a separate temp non-git directory.
2. Use shared memory store via `setProjectMemoryStoreForTest`.
3. Promote a decision from the non-git directory using `project_origin: "https://github.com/Wuxie233/micode.git"`.
4. Lookup from the actual repo directory without explicit target finds the decision.
5. Lookup from another unrelated repo does not find it.

**Verify:** `bun test tests/integration/project-memory-identity-target.test.ts`
**Commit:** `test(project-memory): resolve explicit target outside project directory`

---

### Task 6.2: Ambiguous/degraded identity blocks writes and maintenance
**File:** `tests/integration/project-memory-identity-blocking.test.ts`
**Test:** `tests/integration/project-memory-identity-blocking.test.ts`
**Depends:** 3.1, 4.5
**Domain:** general
**Atlas-impact:** none

Test flow:
- Seed registry with two records sharing alias `micode` but different projectIds.
- From non-project directory, call promote with `project_alias: "micode"`; assert refusal and zero entries.
- Call `project_memory_maintain` with same alias; assert blocked, no journal mutation except blocked event if implemented.
- From plain path-only directory with no origin and no target, call promote and maintain; assert both refuse due degraded identity.
- Read-only health/lookup may return warning but must not write.

**Verify:** `bun test tests/integration/project-memory-identity-blocking.test.ts`
**Commit:** `test(project-memory): block ambiguous and degraded writes maintenance`

---

### Task 6.3: Same-origin worktrees still share memory after resolver changes
**File:** `tests/integration/project-memory-worktree.test.ts`
**Test:** `tests/integration/project-memory-worktree.test.ts`
**Depends:** 3.1, 3.3
**Domain:** general
**Atlas-impact:** none

Extend the existing worktree durability test to assert the new resolver metadata.

Requirements:
- Keep existing test behavior: promoted memory from one worktree remains visible from another after deleting the first worktree.
- Add assertions that both worktrees resolve through `resolutionSource: "directory"` or origin-derived directory fallback, `identity.kind === "origin"`, and same projectId.
- Add a second lookup using explicit `project_origin` from a non-worktree directory to the same project; it must find the same entry.

**Verify:** `bun test tests/integration/project-memory-worktree.test.ts`
**Commit:** `test(project-memory): preserve same-origin worktree sharing with new resolver`

---

### Task 6.4: Maintenance failure does not fail lifecycle finish
**File:** `tests/integration/project-memory-maintenance-nonblocking.test.ts`
**Test:** `tests/integration/project-memory-maintenance-nonblocking.test.ts`
**Depends:** 5.1, 4.4
**Domain:** general
**Atlas-impact:** none

Add integration-level lifecycle test with injected failing scheduler.

Test flow:
- Create lifecycle handle with fake runner that produces successful local merge.
- Inject `maintenanceScheduler.schedule` that rejects.
- Finish issue.
- Assert finish outcome is still merged/closed/cleanup as existing happy path expects.
- Assert lifecycle record notes or journal contains a warning marker such as `memory_maintenance_failed` if Task 5.1 records one; if implementation only logs, assert scheduler was called and finish did not throw.

**Verify:** `bun test tests/integration/project-memory-maintenance-nonblocking.test.ts`
**Commit:** `test(project-memory): maintenance failure is non-blocking on lifecycle finish`

---

### Task 6.5: Final project-memory regression suite
**File:** `(no file change)`
**Test:** none
**Depends:** 6.1, 6.2, 6.3, 6.4, 5.5
**Domain:** general
**Atlas-impact:** none

Verification-only task. No diff expected.

Run:

```sh
bun test tests/utils/project-id.test.ts
bun test tests/project-memory/types.test.ts tests/project-memory/store.test.ts tests/project-memory/lookup.test.ts
bun test tests/project-memory/registry.test.ts tests/project-memory/identity.test.ts
bun test tests/project-memory/maintenance/types.test.ts tests/project-memory/maintenance/classifier.test.ts tests/project-memory/maintenance/lock.test.ts tests/project-memory/maintenance/journal.test.ts tests/project-memory/maintenance/worker.test.ts tests/project-memory/maintenance/scheduler.test.ts
bun test tests/tools/project-memory/lookup.test.ts tests/tools/project-memory/promote.test.ts tests/tools/project-memory/forget.test.ts tests/tools/project-memory/maintain.test.ts tests/tools/project-memory/index.test.ts
bun test tests/lifecycle/project-memory-boundary.test.ts tests/lifecycle/atlas-boundary.test.ts tests/lifecycle/project-memory-maintenance-trigger.test.ts tests/lifecycle/promote-on-finish.test.ts
bun test tests/integration/project-memory-identity-target.test.ts tests/integration/project-memory-identity-blocking.test.ts tests/integration/project-memory-worktree.test.ts tests/integration/project-memory-maintenance-nonblocking.test.ts
bun run typecheck
bun test
```

Reviewer checks:
- No `git diff` for this task.
- All required resolver, lookup filter, maintenance worker, hook/trigger, and lifecycle boundary tests are present and passing.
- Any unrelated pre-existing failure must be clearly labeled; related failures must be fixed before finish.

**Verify:** command list above
**Commit:** none（verification-only）
