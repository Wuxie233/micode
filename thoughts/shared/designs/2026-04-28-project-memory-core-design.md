---
date: 2026-04-28
topic: "Project Memory Core"
status: validated
---

# Project Memory Core Design

## Problem Statement

Micode already has several memory-like systems: `thoughts`, `.mindmodel`, artifact search, lifecycle records, and ledgers. They work, but they are fragmented and mostly flat, so agents still need to read broad files and manually infer what matters.

We need a durable project-level memory layer that preserves reusable engineering knowledge across worktrees without turning every scratch note into permanent context. The goal is cleaner retrieval, better continuity, and less repeated exploration.

## Constraints

**Existing workflow compatibility:** The design must not break `/ledger`, `/search`, `/mindmodel`, existing artifact search tools, lifecycle records, or current `thoughts` paths.

**Durable memory separation:** Long-lived memory must not live only inside issue worktrees or lifecycle scratch state. Worktree cleanup must not delete reusable knowledge.

**Source of truth:** `thoughts` remains the raw source artifact layer. Structured memory stores summaries, relationships, state, and source pointers, not the only copy of important context.

**Project isolation:** Retrieval defaults to the current project. Cross-project leakage is a hard failure mode and must be prevented at the storage/query boundary.

**Safety first:** Durable entries need source provenance, sensitivity metadata, status, and timestamps. Secret-like content is rejected or redacted before storage.

**No overreach in v1:** No vector store, no full automatic chat capture, no replacement of `.mindmodel`, and no complex knowledge graph reasoning in the first version.

## Approach

The chosen approach is to add **Project Memory Core** as an additive structured index layer over existing project artifacts.

I considered simply improving the current flat artifact search, but that would not solve stale facts, entity relationships, worktree durability, or context pollution. I also considered a full knowledge graph with semantic retrieval, but that is too heavy for the first durable foundation.

The selected design uses a small, explicit model:

- **Entity:** A durable project concept such as a workflow, module, tool, feature, risk area, or decision area.
- **Entry:** A reusable memory item attached to an entity, such as a fact, decision, rationale, lesson, risk, todo, open question, or hypothesis.
- **Relation:** A lightweight link between entities or entries, initially limited to parent, related, and supersedes relationships.
- **Source pointer:** A reference back to the original artifact, such as a design, plan, ledger, lifecycle issue, or mindmodel file.

This gives us structure without forcing the raw project memory into a brittle schema.

## Architecture

Project Memory Core sits between agents and the existing memory stores.

**Raw artifact layer:** `thoughts/shared/designs`, `thoughts/shared/plans`, `thoughts/ledgers`, lifecycle summaries, and `.mindmodel` continue to hold original material.

**Structured memory layer:** A project-scoped store keeps entities, entries, relations, and source pointers. It is durable across worktrees and queryable through dedicated tools.

**Retrieval layer:** Agents use project memory lookup first for concise, structured results. They only read raw source artifacts when the lookup result is insufficient or a fact needs verification.

**Lifecycle integration:** Lifecycle finish promotes useful decisions, risks, and lessons into durable memory before worktree cleanup. Scratch state can be removed after promotion.

## Components

**Project identity resolver:** Determines the stable project namespace used by all memory reads and writes. It must treat different issue worktrees for the same repository as the same project memory domain.

**Memory store:** Persists entities, entries, relations, sources, and health metadata. It should support structured filters before ranking, especially project scope, type, status, and sensitivity.

**Promotion pipeline:** Converts selected design, plan, ledger, or lifecycle summary content into durable entries. Promotion must be source-backed and should prefer concise conclusions over raw transcript content.

**Lookup tool:** Returns matching entities and entries with status, evidence, sensitivity, source pointers, and stale markers. It does not return full raw payloads by default.

**Health tool:** Reports memory coverage, stale entries, missing sources, project isolation state, recent updates, and safety warnings.

**Forget tool:** Deletes memory by project, session, source, entity, or entry, including related search rows. This is required for operational safety.

**Compatibility facade:** Keeps existing `mindmodel_lookup`, `artifact_search`, and `milestone_artifact_search` available. Project Memory Core is the preferred higher-level entry point, not an immediate replacement.

## Data Flow

**Lookup flow:**

1. Agent asks the project memory lookup tool for a topic.
2. The tool resolves the current project namespace.
3. The store filters by project, status, sensitivity, and optional scope.
4. Ranked structured results are returned with source pointers.
5. Agent reads raw source only if needed.

**Promotion flow:**

1. A design, plan, ledger, or lifecycle summary is selected as source material.
2. The promotion pipeline extracts candidate durable entries.
3. Safety checks reject or redact sensitive content.
4. Entries are stored with status, evidence, source pointer, and timestamp.
5. Relations are added only when they are obvious and useful.

**Lifecycle finish flow:**

1. Lifecycle execution completes implementation and validation.
2. Before cleanup, the lifecycle summary is promoted into project memory.
3. Durable entries capture decisions, lessons, risks, and unresolved follow-ups.
4. Worktree scratch state can be cleaned without losing reusable knowledge.

## Error Handling

**Project identity failure:** Refuse durable memory writes if the project namespace cannot be resolved safely. Reads can fall back to raw artifact search with a warning.

**Secret detection failure:** Prefer rejection over accidental persistence. The user can keep sensitive details in local raw artifacts, but durable structured entries should not store them.

**Promotion uncertainty:** Store uncertain conclusions as `hypothesis` or `tentative`, not as facts or decisions.

**Stale source:** If a source pointer no longer exists, lookup still returns the entry but marks it as degraded. Health checks surface these for cleanup.

**Conflicting entries:** Newer entries can supersede older entries instead of deleting them immediately. Lookup defaults to active entries but can expose history when needed.

**Store failure:** Existing workflows continue. Memory failure should not block normal design, plan, execution, or lifecycle completion unless the operation explicitly requested durable memory promotion.

## Testing Strategy

**Project isolation tests:** Verify that two projects with similar content do not return each other's memory entries.

**Worktree durability tests:** Verify that issue worktrees share project memory and that cleanup does not remove durable memory.

**Lookup tests:** Verify filtering by entity, entry type, status, source, and sensitivity before ranking.

**Promotion tests:** Verify that supported source artifacts produce source-backed entries with correct status and evidence metadata.

**Safety tests:** Verify secret-like content is rejected or redacted and that raw payloads are not returned by default.

**Forget tests:** Verify project, source, entity, and entry deletion removes structured rows and search rows consistently.

**Compatibility tests:** Verify existing search, mindmodel, ledger, and lifecycle behavior remains unchanged unless explicitly using the new memory tools.

## Open Questions

**Storage location:** The durable store should be project-level and worktree-independent. The implementation plan needs to choose whether this lives under a stable project root, a global micode data directory keyed by project identity, or a hybrid of both.

**Remote sync:** The first version should keep full durable memory local by default. A later version can sync curated summaries to issue bodies or a private memory repository.

**Promotion trigger policy:** Lifecycle finish should promote summaries automatically, but manual promotion should remain available for important historical artifacts.

**Mindmodel boundary:** `.mindmodel` remains implementation constraints and code patterns. Project Memory Core owns historical decisions, lessons, risks, and durable project context.
