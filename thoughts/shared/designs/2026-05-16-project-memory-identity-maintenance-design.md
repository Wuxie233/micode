---
date: 2026-05-16
topic: "Project Memory Identity Resolver and Maintenance Dreaming"
status: validated
---

## 承诺清单 / Commitments

- Project Memory must resolve the intended project through deterministic signals, not only the current runtime directory.
- Default lookup must keep agent context clean: archived, tombstoned, deprecated, and superseded memories must not appear unless explicitly requested.
- A background Project Memory maintenance mechanism must run after non-trivial task terminal states by default, but must not block the user-facing task result.
- Maintenance must prefer soft cleanup: archive, tombstone, supersede, mark stale, deduplicate, and refine; hard delete is limited to secrets or explicit forget requests.
- Lifecycle may provide source material or checkpoint events, but it must not own Project Memory promotion or maintenance logic.

## Problem Statement

Project Memory currently works well when the active tool context is inside the project, a project subdirectory, or another worktree with the same normalized `origin`. It becomes fragile when the current runtime directory is outside the intended project because the memory scope is derived from the directory context rather than an explicit or inherited target project.

The second issue is memory quality. Project Memory is meant to be reusable agent context, not a dumping ground for every chat fragment, smoke-test note, stale hypothesis, or low-signal lifecycle artifact. Without active consolidation, even a correctly scoped memory store will gradually pollute the context agents rely on.

## Constraints

- Project identity must use deterministic signals only. No fuzzy matching by project name, README title, package metadata similarity, or fork-parent guesses.
- Existing behavior must remain compatible: when no stronger signal exists, the resolver may fall back to current `ctx.directory` behavior.
- Ambiguous or degraded identity must block writes and maintenance rather than risk cross-project pollution.
- Archived, tombstoned, deprecated, and superseded entries must be excluded from default agent lookup.
- Maintenance must be non-blocking for the main user task. A failed cleanup job becomes a warning or journal entry, not a failed implementation.
- Background maintenance must not scan secrets, `.env`, credential files, logs, raw chat transcripts, or arbitrary repository contents by default.
- Lifecycle remains a source provider / event source only. It must not regain implicit Project Memory promotion on finish.
- Atlas and Project Memory remain separate layers. Project Memory maintenance may emit observations, but must not directly rewrite Atlas nodes.
- Leaf agents continue to consume coordinator-provided context briefs. They must not promote, forget, or maintain Project Memory directly.

## Approach

Use a two-part design:

1. A **Project Identity Resolver** that determines the target Project Memory scope through an ordered, deterministic chain.
2. A **Project Memory Maintenance Worker** that consolidates memory after meaningful work, keeps default lookup clean, and records maintenance actions for audit and recovery.

The resolver fixes the root scoping issue before any automated maintenance can run. The worker then provides a Claude Code-inspired “dreaming” mechanism, but only at the level of design philosophy: idle/background consolidation, index cleanliness, source-grounded summaries, and recoverability. It does not try to replicate unofficial AutoDream internals.

The chosen cleanup model is **soft cleanup by default**. The system may archive, tombstone, mark stale, mark superseded, or refine entries; it does not hard-delete active knowledge unless the content is a secret or the user explicitly asks to forget it.

## Architecture

The architecture keeps project identity, memory storage, and memory maintenance as separate domains.

**Project identity layer** owns target resolution:

- explicit target supplied by tool caller
- session or lifecycle target identity
- registry alias / origin / known worktree mapping
- current `ctx.directory` fallback
- degraded identity handling

**Project Memory tool runtime** consumes the resolver result and passes a scoped `projectId` into lookup, promote, forget, health, and maintenance operations.

**Project Memory store** remains the source of persisted memory entries, entities, sources, statuses, and maintenance metadata. It should expose enough status semantics for default lookup to exclude noise.

**Maintenance worker** runs as a low-priority project-scoped state machine. It gathers a bounded snapshot, classifies candidates, builds a maintenance plan, applies safe actions, and writes a maintenance journal.

**Hooks / lifecycle / primary agents** can schedule maintenance, but they do not implement cleanup rules themselves. They enqueue or request maintenance against a resolved project identity.

## Components

**Project Identity Resolver**

- Resolves a target project through the priority chain: explicit target → session/lifecycle target → registry alias/origin → `ctx.directory` fallback → degraded identity.
- Normalizes origins consistently with the existing project-id behavior.
- Rejects ambiguous matches and degraded write scopes.
- Provides explainable metadata such as `source=explicit`, `source=lifecycle`, `source=registry`, `source=directory`, or `source=degraded`.

**Project Registry**

- Stores deterministic mappings for known project roots, origins, aliases, and recent worktrees.
- Does not merge projects by similarity.
- Treats fork/upstream relationships conservatively; sharing memory across them requires exact identity or explicit binding.

**Project Memory Runtime Integration**

- Updates `project_memory_lookup`, `project_memory_promote`, `project_memory_health`, `project_memory_forget`, and the new maintenance entrypoint to use the shared resolver.
- Keeps default lookup scoped to active, non-archived memory.
- Allows explicit historical lookup when a caller intentionally wants archived or superseded entries.

**Maintenance Worker**

- Runs per project with a projectId-level lock.
- Supports manual dry-run, scheduled low-priority runs, and terminal-state runs after non-trivial tasks.
- Produces a maintenance plan before applying safe changes.
- Applies only allowed safe actions by default.

**Maintenance Journal**

- Records what was classified, changed, skipped, or blocked.
- Is audit metadata, not Project Memory content injected into agent context.
- Allows recovery and later diagnosis without polluting lookup results.

**Lookup Status Filter**

- Defines default lookup as active memory only.
- Excludes archived, tombstoned, deprecated, and superseded entries unless explicitly requested.
- Keeps tentative or hypothesis entries opt-in or caller-controlled, depending on the tool request.

## Data Flow

### Normal lookup

1. Agent calls Project Memory lookup.
2. Tool runtime asks the resolver for the target identity.
3. Resolver checks explicit target, session/lifecycle context, registry, then directory fallback.
4. Runtime receives a scoped `projectId` and identity metadata.
5. Lookup queries active entries only by default.
6. Archived, tombstoned, deprecated, and superseded entries stay out of the agent context.

### Non-trivial task completion

1. Primary workflow reaches a terminal state for a non-trivial task.
2. The workflow schedules a low-priority Project Memory maintenance run for the resolved project.
3. Maintenance acquires the projectId lock.
4. Worker snapshots bounded Project Memory metadata, source pointers, health signals, and recent task-owned artifacts.
5. Worker classifies duplicate, orphan, missing-source, stale, superseded, deprecated, overlong, or low-signal entries.
6. Worker builds a maintenance plan.
7. Safe actions are applied: soft archive, tombstone, supersede, mark stale, deduplicate exact duplicates, or refine summaries with provenance.
8. Worker writes a maintenance journal and releases the lock.

### Ambiguous target

1. Resolver finds multiple plausible targets or only degraded path identity.
2. Read-only health may proceed with a warning if safe.
3. Writes, forgets, and maintenance are blocked.
4. The caller receives an explicit identity warning rather than silently writing to the wrong project.

## Error Handling

**Ambiguous project identity:** Block writes and maintenance. Return a diagnostic explaining candidate sources and require an explicit target or registry binding.

**Degraded identity:** Treat path-only or non-git identity as unsafe for background maintenance by default. Preserve read compatibility where useful, but refuse durable writes when configured to do so.

**Maintenance lock conflict:** Skip or reschedule. Never run two cleanup jobs for the same project concurrently.

**Maintenance failure:** Record a journal failure and surface a warning in health or terminal summaries. Do not fail the main user task.

**Potential secret:** Do not archive or summarize. Use the existing secret hygiene boundary and route to explicit forget / hard-delete handling where appropriate.

**High-risk memory change:** Do not automatically hard-delete, merge across entities, or deactivate active architecture decisions. Mark as needs-review, conflict, or superseded candidate instead.

**Source pointer missing:** Mark or archive based on confidence. Missing source alone is a quality signal, not proof that the memory is false.

## Testing Strategy

- Unit-test resolver priority: explicit target beats session/lifecycle, session/lifecycle beats registry, registry beats directory fallback.
- Unit-test deterministic origin normalization and ensure fuzzy name matching is absent.
- Integration-test lookup from a non-project directory with a session/lifecycle target resolving to the intended project memory.
- Integration-test ambiguous identity blocking writes and maintenance.
- Integration-test same-origin worktrees still share memory.
- Integration-test archived, tombstoned, deprecated, and superseded entries are excluded from default lookup.
- Integration-test explicit historical lookup can retrieve archived entries when requested.
- Unit-test maintenance classification for duplicate, orphan, missing-source, stale, superseded, deprecated, and low-signal entries.
- Integration-test maintenance lock behavior under concurrent terminal-state triggers.
- Integration-test maintenance failure does not fail the main workflow.
- Regression-test lifecycle boundaries: lifecycle may schedule or provide source context, but must not auto-promote Project Memory on finish.
- Regression-test Atlas boundaries: maintenance must not directly write Atlas nodes.

## Open Questions

- Whether the first landing should include a durable project registry, or ship explicit target plus session/lifecycle target first and add registry in a follow-up.
- Whether tentative and hypothesis entries should be excluded from default lookup or included only when the caller explicitly requests broader context.
- How much summary refinement should be model-assisted in the first version versus rule-based only.
- Whether maintenance should have a manual command surface immediately, or only expose a tool entrypoint and health status first.

## Behavior

- When a task runs from a directory outside the project but the session or lifecycle target is known, Project Memory resolves to the intended project instead of the incidental current directory.
- When the target project cannot be determined safely, Project Memory refuses writes and maintenance rather than polluting another project.
- When Project Memory lookup is used normally by agents, archived and tombstoned memories do not appear in the returned context.
- After a non-trivial task reaches a terminal state, background maintenance can clean and compact Project Memory without blocking the task result.
- Maintenance keeps the store useful for agents by preferring soft cleanup and provenance over irreversible deletion.

Atlas relation: this design may require updates to Project Memory implementation and behavior nodes, but maintenance itself must not directly rewrite Atlas nodes.
