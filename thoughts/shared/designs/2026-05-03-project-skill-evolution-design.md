---
date: 2026-05-03
topic: "Project Skill Evolution"
status: validated
---

## Problem Statement

micode already preserves decisions, plans, ledgers, and coding constraints, but it does not yet turn successful development workflows into reusable procedural memory.

The goal is to make recurring project work smoother over time by capturing proven workflows as searchable, gated procedures that future agents can load only when relevant.

## Constraints

- Reuse Project Memory as the canonical active store instead of adding a separate active skill database.
- Do not auto-activate unreviewed procedures.
- Do not store candidate files under `thoughts/`, because those paths are auto-indexed and may be accidentally injected into context.
- Keep MVP scoped to procedural capture and retrieval only.
- Exclude GEPA, tool-description optimization, prompt mutation, and code evolution from the MVP.
- Feature flag defaults to disabled so existing behavior is unchanged.
- Candidate content must be sanitized before any disk write.
- Retrieval must respect sensitivity filtering and context budget limits.

## Approach

The chosen design is a conservative hybrid: active procedures live in Project Memory, while unreviewed mined candidates live in a private candidate directory outside the repository tree.

This gives us Hermes-style procedural memory without creating a parallel skill store or silently changing agent behavior. The agent can discover reusable workflows automatically, but activation remains explicitly gated.

Rejected alternatives:

- A full Project Skill Store was rejected because it duplicates Project Memory, adds state-machine complexity, and creates unclear ownership between Mindmodel, Memory, and Skills.
- Auto-activating generated skills was rejected because bad procedures can poison future tasks.
- GEPA-style optimization was rejected for MVP because we need usage traces and evaluation datasets before prompt evolution has a trustworthy signal.

## Architecture

The system has four layers:

- **Procedure entry type:** Project Memory gains a `procedure` entry type for reusable workflows.
- **Candidate miner:** deterministic lifecycle artifacts are scanned for procedural candidates.
- **Review gate:** users approve or reject pending candidates through a dedicated `/skills` flow.
- **Procedure retrieval:** active or tentative procedures are retrieved and injected under a strict feature flag and context budget.

Project Memory remains the single source of truth for active reusable knowledge. Mindmodel remains responsible for coding constraints. Lifecycle remains responsible for issue progress and artifact boundaries.

## Components

**Project Memory schema:** Adds `procedure` to the supported entry types and `skill` as a source kind so activated candidates can be traced and cleaned up.

**Parser support:** Adds a `Procedure` section pattern so approved candidate markdown can be promoted through the existing Project Memory promotion path.

**Lookup safety:** Exposes sensitivity filtering in the project memory lookup tool so injected procedures never exceed the allowed sensitivity ceiling.

**Candidate storage:** Stores pending candidates under a user-level project-scoped directory outside the repository, avoiding `thoughts/` auto-indexing and context injection.

**Candidate schema:** Validates trigger, normalized steps, source pointers, created timestamp, expiry, sensitivity, and status with Valibot.

**Miner:** Reads only deterministic persisted sources: lifecycle journal, lifecycle record, and ledgers. It does not mine arbitrary raw agent output.

**Review flow:** Presents pending candidates, purges expired ones, and promotes approved candidates as tentative Project Memory procedures.

**Injector:** Reuses the existing context injection path and shared budget. It retrieves at most a small number of relevant procedure entries and injects trimmed summaries only when the feature flag is enabled.

## Data Flow

1. A lifecycle task completes and writes durable artifacts such as journal events, lifecycle records, and ledgers.
2. The miner scans deterministic persisted artifacts for reusable procedural patterns.
3. Candidate content is normalized, deduplicated, path-sanitized, and secret-scanned before it is written.
4. Pending candidates remain inactive until reviewed.
5. The `/skills` review flow shows candidates to the user, deletes expired ones, and promotes approved items through Project Memory as `procedure` entries.
6. Future tasks query relevant procedure entries with type, status, sensitivity, and limit filters.
7. Matching procedures are injected under a strict budget alongside existing contextual guidance.

## Error Handling

- Miner failures are non-blocking and logged, because procedure capture must never break the main development workflow.
- Sanitization failures prevent candidate writes entirely.
- Duplicate candidates update usage metadata instead of creating new noise.
- Expired candidates are purged when the review flow opens.
- Lookup errors result in no procedure injection rather than degraded task execution.
- Feature flag rollback disables retrieval and injection without deleting stored procedures.

## Testing Strategy

- Unit-test Project Memory type and parser support for `procedure` entries.
- Unit-test sensitivity filtering through the lookup tool boundary.
- Unit-test pure candidate extraction from fixture journal and ledger content.
- Unit-test path normalization, secret detection, deduplication, expiry, and atomic candidate write behavior.
- Unit-test review-state transitions independently from the Octto or command UI wrapper.
- Unit-test injection budget behavior with the feature flag disabled, enabled with no matches, and enabled with multiple matches.
- Run the full `bun run check` quality gate after implementation.

## Open Questions

- Whether activation should remain permanently user-gated, or whether repeated successful use can auto-promote a tentative procedure to active later.
- Whether the review flow should use Octto immediately or start as a text command that lists pending candidates.
- Which usage metrics should be tracked first: hit count, accepted count, rejection reasons, or task-call reduction.
