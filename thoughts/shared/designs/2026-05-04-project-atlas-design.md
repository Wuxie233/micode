---
date: 2026-05-04
topic: "Project Atlas, Karpathy-style project knowledge layer"
status: validated
---

# Project Atlas, Karpathy-style project knowledge layer

## Problem Statement

The current micode workflow already has Project Memory, lifecycle records, thoughts artifacts, and mindmodel constraints, but the user experience still feels like pure vibe coding. The human owner often cannot see the project shape directly, so understanding the project requires asking an agent to re-explore code and summarize it again.

We need a durable, human-readable project knowledge layer that makes the project understandable after weeks away, increases user participation, and gives agents a curated starting point before they do deeper exploration.

The key product goal is not to create another hidden memory tool for LLMs. The goal is to create a shared workspace where humans and agents can both understand project state, module relationships, design intent, risks, and requirement drift.

## Constraints

- The Atlas serves humans first and LLMs second.
- The first version must be Markdown-first and Git-friendly.
- The Atlas must not mirror raw code or become a noisy full-code graph.
- Project Memory remains the structured durable store for decisions, lessons, risks, and open questions.
- Mindmodel remains the coding pattern and constraint layer.
- Lifecycle remains the workflow state machine and current-task source of truth.
- Thoughts remain the raw artifact layer for designs, plans, ledgers, and lifecycle snapshots.
- Every Atlas fact should carry enough source context to be audited or refreshed.
- Staleness must be visible rather than silently hidden.
- No heavyweight graph database is needed for the first version.

## Approach

The chosen approach is to add a new human-readable layer called Project Atlas above the existing memory stack.

Project Atlas is a curated project map, not a replacement for Project Memory. It projects selected knowledge from Project Memory, lifecycle, thoughts, and mindmodel into stable Markdown pages that the user can browse and agents can read before acting.

I considered three approaches:

1. Replace Project Memory with a Karpathy-style wiki.
   - Rejected because Project Memory already provides durable structured entries, source pointers, status, sensitivity handling, and project identity isolation.
   - Replacing it would throw away useful infrastructure while not solving the human visibility problem by itself.

2. Add a full graph database and code graph.
   - Rejected for the first version because it would overfit to implementation structure, add operational burden, and risk becoming another machine-only artifact.
   - A code graph can come later as an export or optional enrichment.

3. Add a Markdown-first Atlas backed by existing artifacts and Project Memory.
   - Chosen because it directly solves the human participation problem, keeps the system auditable, and gives agents a clean entry point without forcing a major storage migration.

The first version should optimize for usefulness, not theoretical graph completeness.

## Architecture

Project Atlas sits between raw artifacts and agent behavior.

The source side contains lifecycle issues, thoughts documents, Project Memory entries, and mindmodel summaries. The Atlas compiler reads these sources and updates a small set of curated Markdown pages. Agents then use the Atlas as a preflight context surface before deeper analysis.

The stack becomes:

- Lifecycle: current work state and artifact pointers.
- Thoughts: raw design, plan, ledger, and session documents.
- Project Memory: structured durable conclusions.
- Mindmodel: coding constraints and implementation patterns.
- Project Atlas: human-readable project map and shared cognitive interface.

Atlas pages are not the canonical source for workflow state or coding rules. They are the navigable project portrait assembled from canonical sources.

## Components

### Atlas Directory

The Atlas should live under a stable shared artifact path so it can be committed, reviewed, searched, and opened by humans.

Recommended first pages:

- `index`: current project overview and reading guide.
- `modules`: semantic module map, responsibilities, and relationships.
- `decisions`: active and superseded design decisions.
- `risks`: active risks, risk areas, and mitigations.
- `timeline`: important project events and state changes.
- `requirements`: user needs, implemented behavior, and known drift.
- `onboarding`: what a human or agent should read first after returning to the project.

### Atlas Compiler

The compiler updates Atlas pages from existing sources.

Responsibilities:

- Collect relevant source artifacts.
- Extract project-level facts, decisions, module responsibilities, risks, and requirement notes.
- Preserve source pointers.
- Update pages incrementally rather than rewriting everything blindly.
- Mark stale, missing, or uncertain content visibly.

The compiler should be conservative. If it cannot verify something from source artifacts, it should mark it as tentative instead of presenting it as fact.

### Atlas Lint

Atlas lint protects the system from becoming stale AI-generated documentation.

Responsibilities:

- Detect source pointers that no longer resolve.
- Detect orphan pages or unreferenced nodes.
- Detect decisions that appear superseded but are still marked active.
- Detect risks that have no owner, mitigation, or freshness marker.
- Detect pages that have not been refreshed after relevant lifecycle activity.

Lint results should be visible to humans, not buried in logs.

### Atlas Reader Policy

Agents should read the Atlas before broad project exploration when the task is non-trivial.

This does not replace direct code analysis. It changes the order:

1. Read Atlas overview and relevant pages.
2. Check Project Memory for historical decisions.
3. Check mindmodel for coding constraints.
4. Only then inspect code or dispatch exploration agents for task-specific details.

### Atlas Graph Export

The first graph should be derived from Markdown links and lightweight relationships, not from a new database.

Useful relationship types include:

- module depends on module
- decision affects module
- risk threatens module or workflow
- requirement maps to feature
- issue changed module
- decision supersedes decision

This can later be exported as graph JSON or rendered in a small viewer, but the Markdown pages remain the primary human interface.

## Data Flow

### Creation Flow

When a lifecycle-driven task completes a design, plan, implementation, or ledger, the Atlas compiler can refresh the relevant pages.

The flow is:

1. Lifecycle records artifact pointers.
2. Thoughts stores raw design, plan, and ledger content.
3. Project Memory promotes durable decisions, lessons, risks, and open questions after successful lifecycle finish.
4. Atlas compiler updates human-readable pages from the same sources.
5. Atlas lint reports freshness and consistency issues.

### Reading Flow

When a human returns to a project after time away, they open the Atlas index first.

The index should answer:

- What is this project trying to do?
- What changed recently?
- What modules exist and how do they relate?
- What decisions constrain future work?
- What risks or open questions matter now?
- Where should I look next?

When an agent starts non-trivial work, it should use the Atlas as the project-level context map, then use targeted tools for details.

### Requirement Drift Flow

Atlas should double as a lightweight living requirements document.

The requirements page should connect:

- original user needs
- implemented features
- relevant decisions
- known gaps
- behavior that may no longer match the user's intent

This lets the user inspect whether the built system still matches their evolving expectations without reading code.

## Error Handling

Atlas should fail visibly and conservatively.

If a source artifact is missing, the affected section should show that the source is missing rather than silently dropping the content.

If two sources conflict, the Atlas should preserve both claims with source pointers and mark the section as needing review.

If content is inferred rather than sourced, it should be marked tentative.

If compilation fails, the existing Atlas should remain intact and a failure note should be recorded for the user and future agents.

The system should prefer stale-but-labeled knowledge over silently regenerated knowledge with no provenance.

## Testing Strategy

Testing should verify behavior at the artifact level rather than mocking agent intelligence.

Key test areas:

- Atlas generation from representative lifecycle, thoughts, Project Memory, and mindmodel inputs.
- Source pointer preservation.
- Incremental updates that avoid deleting unrelated human edits.
- Staleness detection when source artifacts disappear or change.
- Conflict detection when two sources disagree.
- Reader policy integration so agents can discover Atlas pages during non-trivial work.
- Secret hygiene so sensitive content is not copied into human-visible Atlas pages.

The first implementation should ship with a small fixture project that demonstrates module mapping, decisions, risks, requirements, and timeline updates.

## Open Questions

- Should Atlas pages be committed by default, or should some pages remain local because they may contain private project intent?
- Should the graph view be a static generated HTML artifact, an Octto view, or just Markdown links in the first version?
- Should users be able to annotate Atlas pages manually, and if so, how do we prevent compiler refresh from overwriting those notes?
- Should Project Memory promotion happen before Atlas refresh, after Atlas refresh, or both independently from the same source artifacts?
- Should quick-mode tasks update the Atlas when they affect requirements or project state?

## Decision Summary

Project Atlas should be introduced as the human-facing Karpathy layer for micode.

It should not replace Project Memory. It should make Project Memory visible, useful, and connected to a broader project map.

The first version should be Markdown-first, source-linked, linted, and lightweight. A richer graph can be derived later once the page model proves useful.
