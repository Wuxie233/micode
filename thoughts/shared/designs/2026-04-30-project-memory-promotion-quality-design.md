---
date: 2026-04-30
topic: "Project Memory Promotion Quality"
status: validated
---

# Project Memory Promotion Quality Design

## Problem Statement

Project Memory Core is writing new entries through lifecycle finish, but the promoted issue-body entries are too coarse. They appear as active `note` entries titled `## Request`, which proves the write path works but makes retrieval less useful than intended.

We also had smoke-test entries left behind after manual source deletion, creating missing-source noise. Those were cleaned by deleting the smoke entity, and the implementation should avoid making future degraded memory harder to detect.

## Constraints

- Preserve existing Project Memory tool APIs: lookup, promote, health, and forget remain compatible.
- Keep lifecycle finish promotion best-effort and non-blocking.
- Do not add vector search, LLM extraction, or broad memory redesign.
- Keep secret rejection behavior unchanged.
- Do not weaken source provenance. Every promoted entry still needs source pointers.
- Keep `thoughts` and lifecycle issue bodies as raw source artifacts, not the durable structured memory itself.

## Approach

The chosen approach is to make the parser lifecycle-aware while keeping it deterministic and lightweight.

The parser should continue extracting explicit `## Decisions`, `## Risks`, `## Lessons`, and `## Open Questions` bullets as structured entries. When those sections are absent, it should treat lifecycle issue-body sections such as `## Request`, `## Goals`, and `## Constraints` as structured notes instead of collapsing the whole document into one generic note titled `## Request`.

I considered adding an LLM summarization pass, but rejected it because v1 memory promotion must stay deterministic, cheap, and safe. We can get a large quality gain by improving section and title extraction without introducing model calls.

## Architecture

Project Memory promotion remains a three-step pipeline:

1. Parse markdown into promotion candidates.
2. Reject candidates containing secrets.
3. Store accepted entries, entities, and source pointers idempotently.

This change is limited to the parser and related tests. The storage layer, tool layer, lifecycle finisher, and safety checks should remain stable unless tests reveal a small bug in forget-source behavior.

## Components

**Lifecycle section parser:** Recognizes issue-body sections and produces meaningful note entries for request, goals, and constraints.

**Title derivation:** Uses the first meaningful content line or bullet text, not the markdown header itself, for fallback and lifecycle notes.

**Structured section parser:** Keeps existing behavior for decisions, risks, lessons, and open questions.

**Health/forget validation:** Ensures smoke-test cleanup leaves no missing sources and verifies entity-level forget removes entries and sources consistently.

**Lifecycle promotion tests:** Cover ledger-priority behavior and issue-body fallback behavior with realistic issue bodies.

## Data Flow

**Lifecycle issue-body promotion:**

1. Lifecycle finish selects ledger artifact content when available.
2. If no ledger content exists, lifecycle finish uses issue body content.
3. Parser detects lifecycle sections.
4. `## Request` becomes a note titled from the request text.
5. `## Goals` bullets become note entries with meaningful titles.
6. `## Constraints` bullets become note entries with meaningful titles.
7. Explicit `## Decisions`, `## Risks`, `## Lessons`, or `## Open Questions` still produce their specialized entry types.

**Manual cleanup:**

1. Health reports missing sources.
2. User approves cleanup.
3. Entity-level forget removes entity, entries, sources, and FTS rows.
4. Health returns to zero missing sources.

## Error Handling

- Empty lifecycle sections produce no candidates.
- Unstructured markdown still emits a single fallback note, but its title should come from the first meaningful content line rather than a heading marker.
- Secret-containing candidates are rejected exactly as before.
- Promotion failures during lifecycle finish remain notes on the lifecycle result and do not block merge cleanup.
- Forget operations must remain project-scoped to prevent cross-project deletion.

## Testing Strategy

Add or update tests for:

- Lifecycle issue body with `## Request`, `## Goals`, and `## Constraints` produces meaningful note entries.
- Explicit decision/risk/lesson/open-question sections still win over lifecycle fallback behavior.
- Fallback note titles do not become raw markdown headings when useful content exists.
- Empty sections are ignored.
- Entity-level forget removes entries and source pointers, leaving health with zero missing sources for the cleaned project.
- Lifecycle finish promotion still prefers ledger artifact content over issue body content.
- Full quality gate remains green.

## Open Questions

- Whether `## Goals` should eventually map to a dedicated `todo` entry type. For now, keep it as `note` to avoid schema churn.
- Whether lifecycle issue entities should later be linked to feature-level entities. For now, group under `issue-N` and rely on meaningful entry titles.
