---
date: 2026-05-04
topic: "Project Atlas, Karpathy-style human-and-agent project knowledge layer"
status: validated
---

# Project Atlas, Karpathy-style human-and-agent project knowledge layer

## Problem Statement

The current micode workflow already has Project Memory, lifecycle records, thoughts artifacts, and mindmodel constraints, but the user experience still feels like pure vibe coding without a shared project map. The user owner often cannot see the project shape directly, so understanding the project requires asking an agent to re-explore code and summarize it again. Project Memory is structured durable memory but feels low value because it is invisible, hard to verify, and disconnected from a navigable project portrait.

We need a durable, human-and-agent-readable project knowledge layer that makes the project understandable after weeks away, increases user participation, and gives agents a curated starting point before they do deeper exploration.

The user has a long pre-existing habit of maintaining markdown notes for project mechanics and behavior, and wants AI to take over the maintenance cost of that habit while strengthening it with structure, cross-linking, and graph visualization.

The system serves two equal users: the human owner and the agents that work on the project. It is a co-working interface, not a human-only document or an agent-only RAG index.

## Constraints

- The Atlas is a human-and-agent shared cognitive interface, not a one-sided tool.
- The first version must be Markdown-first, Git-tracked inside the project, and Obsidian-renderable.
- The Atlas must not mirror raw code or become a noisy full-code graph.
- Project Memory remains the structured durable store for decisions, lessons, risks, and open questions.
- Mindmodel remains the coding pattern and constraint layer.
- Lifecycle remains the workflow state machine and current-task source of truth.
- Thoughts remain the raw artifact layer for designs, plans, ledgers, and lifecycle snapshots.
- Every Atlas fact must carry source pointers for audit and refresh.
- Staleness must be visible rather than silently hidden.
- Atlas updates must not corrupt vault state on partial failure.
- Atlas updates must not silently overwrite user edits made directly in Obsidian.
- Atlas commits must not pollute the project's functional git history.
- No heavyweight graph database is required; Obsidian provides graph view, search, and backlinks natively.
- No dependency on Obsidian community plugins; pure Markdown plus wikilinks plus YAML frontmatter only.

## Approach

The chosen approach is to add a new layer called Project Atlas above the existing memory stack, rendered as an Obsidian vault committed inside the project repository.

Project Atlas is a curated project map. It projects selected knowledge from Project Memory, lifecycle, thoughts, and mindmodel into stable Markdown nodes that humans and agents can both browse and read.

I considered three approaches:

1. Replace Project Memory with a Karpathy-style wiki.
   - Rejected because Project Memory already provides durable structured entries, source pointers, status, sensitivity handling, and project identity isolation.
   - Replacing it would throw away useful infrastructure while not solving the visibility and shared-cognition problem.

2. Add a full graph database and code graph.
   - Rejected for the first version because it would overfit to implementation structure, add operational burden, and risk becoming another machine-only artifact.
   - A code graph can come later as an export or optional enrichment.

3. Add a Markdown-first Obsidian vault backed by existing artifacts and Project Memory, maintained by an asynchronous KG agent triggered after lifecycle finish.
   - Chosen because it directly solves the human visibility problem, keeps the system auditable, gives agents a clean entry point, leverages Obsidian's native graph and backlinks, and aligns with the user's pre-existing markdown note habit.

The vault is split into two layers (Build and Behavior) connected by cross-layer wikilinks, because the user explicitly identified that mixing implementation structure with behavior, mechanics, and numerics produces an unreadable map.

## Architecture

Project Atlas sits between raw artifacts and agent behavior.

The source side contains lifecycle issues, thoughts documents, Project Memory entries, and mindmodel summaries. The Atlas compiler reads these sources and updates a small set of curated Markdown pages. Both humans (in Obsidian) and agents (during context gathering) use the Atlas as the project map before deeper analysis.

The stack becomes:

- Lifecycle: current work state and artifact pointers.
- Thoughts: raw design, plan, ledger, and session documents.
- Project Memory: structured durable conclusions.
- Mindmodel: coding constraints and implementation patterns.
- Project Atlas: shared human-and-agent project map and cognitive interface.

Atlas pages are not the canonical source for workflow state or coding rules. They are the navigable project portrait assembled from canonical sources.

### Two-layer model

The vault is divided into Build layer and Behavior layer, connected by cross-layer wikilinks.

- Build layer (`10-impl/`) describes how the project is built: modules, subsystems, dependencies, internal structure.
- Behavior layer (`20-behavior/`) describes what the project does: features, gameplay, business rules, numerics, user-visible behavior.

Cross-layer connections use Obsidian wikilinks. Build layer nodes link to the Behavior layer features they realize. Behavior layer nodes link back to the Build layer modules that support them.

Node granularity stops at module or feature level. The vault does not represent files or functions.

## Components

### Vault Layout

The vault lives at `atlas/` in the project root, tracked by git.

Top-level directories:

- `atlas/00-index.md`: project overview and reading guide; agent2 may not modify the human-authored sections.
- `atlas/10-impl/`: Build layer module and subsystem nodes.
- `atlas/20-behavior/`: Behavior layer feature, mechanic, and rule nodes.
- `atlas/40-decisions/`: pages projected from active Project Memory decision entries; details remain in Project Memory.
- `atlas/50-risks/`: pages projected from active Project Memory risk entries.
- `atlas/60-timeline/`: per-period project events; aggregated to keep the directory readable.
- `atlas/_archive/`: soft-deleted nodes; preserved for recovery; subject to GC pass in Phase 3.
- `atlas/_meta/`: maintenance logs, agent2 reports, challenges, intent anchors, schema definitions.

Numeric prefixes give Obsidian a stable file tree ordering.

### Node Schema

Each node is a Markdown file with YAML frontmatter and semi-structured body.

Required frontmatter fields:

- `id`: stable identifier; immutable; used by cross-references.
- `layer`: `impl` or `behavior` or `decision` or `risk` or `timeline`.
- `status`: `active` or `superseded` or `deprecated`.
- `last_verified_commit`: commit SHA the node was last reconciled against.
- `last_written_mtime`: agent2's record of the file mtime after its last write; used to detect human edits.
- `sources`: list of source pointers (lifecycle issue, thoughts file, Project Memory entry id, mindmodel constraint, source code path).

Frontmatter explicitly excludes:

- `confidence`: removed; AI-self-rated confidence is unreliable and creates a false signal of authority.
- `human_authored`: removed; the role split into "human pages" and "agent pages" conflicts with the human-and-agent co-working model. Edits are detected by mtime, not by tag.

Body has a small fixed H2 set followed by free narrative:

- `## Summary`: one paragraph for what this node represents.
- `## Connections`: cross-layer wikilinks (e.g. `[[20-behavior/economy-system]]`).
- `## Sources`: pointers backing the node.
- `## Notes`: free-form narrative; agent and human can both write here.

Schema versioning is recorded at `atlas/_meta/schema-version` so future migrations can be deterministic.

### Atlas Compiler (agent2)

agent2 is the asynchronous KG maintenance line, spawned after lifecycle finish.

Responsibilities:

- Receive a structured handoff package from agent1.
- Spawn worker subagents in parallel, with a hard upper bound on concurrency.
- Update relevant Build and Behavior nodes; add cross-layer wikilinks; refresh decisions and risks projected from Project Memory.
- Detect conflicts between sources or between agent observation and existing nodes; route conflicts to the challenge stream rather than silently merging them.
- Respect mtime checks before overwriting any node; route human-edited nodes to challenge.
- Write a first-person natural-language maintenance log per run.

agent2 power is intentionally narrow on subjective decisions:

- Worker conflicts are not LLM-reconciled; they are routed to `_meta/challenges/`.
- agent2 may not modify `_meta/` content (no self-rewriting of its own logs or challenges).
- agent2 may not retroactively close challenges; that requires user action or an independent lint pass.

agent2 power is broad on objective changes:

- New nodes for newly identified modules or features.
- Updates to nodes whose source artifacts changed.
- Soft delete (move to `_archive/`) for nodes whose backing sources have disappeared.
- Wikilink rewiring when a node is renamed, with the constraint described under Challenge Flow.

### Handoff Package

agent1 must produce a structured handoff before spawning agent2. The handoff must contain:

- Lifecycle issue number.
- Modules and features agent1 believes were affected (impact scope).
- Pointers to the design, plan, and ledger artifacts.
- Key decisions agent1 wants Atlas to record.
- Cross-layer effects agent1 expects (e.g. "this changed economy mechanics, expect Behavior layer updates").
- Things agent2 should explicitly not touch.

Handoff lives in lifecycle issue body under a dedicated marker so agent2 can read it deterministically.

### Spawn Receipt

agent2 spawn must not be fire-and-forget without bookkeeping.

When agent1 spawns agent2, lifecycle issue body records:

- `spawn_at`: timestamp.
- `session_id`: agent2 session identifier.
- `expected_completion_window`: soft deadline.

agent2 records `done_at` and a short summary on completion.

`/atlas-status` compares lifecycle finish count against vault update count. A diff greater than 1 is a hard signal that agent2 silently failed; the user is notified via QQ rather than waiting for the next OpenCode startup.

### Atomic Write Discipline

agent2 may run for minutes; the process can be killed mid-run by token caps, OOM, restart, or upstream errors. Vault state must remain consistent.

Write protocol:

- Stage all node changes under a per-run staging directory.
- After all worker output is collected and reconciled, atomic-rename staged files into vault.
- On startup, agent2 detects orphaned staging directories and rolls them back.
- Vault writes are serialized per project (one writer per atlas at a time) to avoid concurrent worktree races.

### mtime-based Edit Detection

When agent2 prepares to write a node, it compares the file's current mtime to the `last_written_mtime` recorded in frontmatter from the previous agent2 run.

- mtime matches: agent2 may write directly.
- mtime differs: a human edited the file in Obsidian since agent2 last touched it. agent2 does not overwrite. Instead, agent2 emits a challenge entry with a natural-language explanation of the proposed change and the user's prior edit.

This replaces the earlier `human_authored` tag mechanism. The system trusts no flags; it observes evidence.

### Challenge Flow

Challenges live in `atlas/_meta/challenges/`. Each challenge is a Markdown file with:

- The target node.
- A natural-language first-person explanation: "I see X in source Y, which differs from what the node currently says about Z. I suggest changing it to W. If you disagree, dismiss this challenge."
- Source pointers backing the proposed change.
- Status: `open`, `approved`, `dismissed`.

Challenge lifecycle:

- agent2 creates challenges when (a) it detects a contradiction between node content and current sources, (b) mtime detection shows human edits, (c) worker subagents disagree on a fact.
- The user reviews challenges in Obsidian or via `/atlas-status`.
- Approved challenges trigger agent2 to apply the proposed change on the next run.
- Dismissed challenges enter cooldown; agent2 will not re-raise the same `(target, claim_hash)` pair until source artifacts materially change.
- Per-run challenge volume has a hard cap to prevent challenge storms; excess challenges are merged or deferred.

agent2 may not modify or close existing challenges; only the user or an independent lint pass can do so.

### Wikilink Rewiring Constraint

agent2 can rename and create nodes freely, but a hidden risk is that a renamed node breaks all wikilinks pointing at it, or that creating a v2 node and rewiring all references silently bypasses challenge protections on the original.

Rule:

- When agent2 rewires a wikilink that points at a node whose mtime indicates human authorship within the past N runs, the rewire is routed to challenge instead of applied silently.
- This protects user-edited nodes from being orphaned by side-channel link changes.

### /atlas-init Command

`/atlas-init` performs first-time vault construction.

Behavior on a fresh project:

- Spawn worker subagents in parallel: structure scanner, module mapper, doc harvester, history summarizer, behavior inferrer, question generator.
- Workers complete in parallel.
- Main agent collects worker output and assembles a structured question batch.
- Push the batch to Octto in a single session; user answers all in one round.
- Project type is one of the questions; the user picks explicitly. agent does not infer project type.
- After answers return, main agent assembles the vault skeleton, including a starter set of Behavior layer nodes derived from user answers and code-inferred drafts.
- Vault is committed under the `atlas:` commit prefix.
- A natural-language first-person init report is written to `_meta/log/`.

Behavior on an existing vault:

- `/atlas-init` without flags is rejected; the user must pass `--reconcile` or `--force-rebuild`.
- `--reconcile` runs a dry-run pass that produces a report of proposed changes, then waits for user approval before applying.
- `--force-rebuild` triggers a full rebuild; before any write, the system creates a git tag of the current vault for rollback.

### /atlas-status Command

`/atlas-status` reports vault health:

- Spawn receipt diff (lifecycle finish count vs. vault update count).
- Open challenges count.
- Broken wikilink count (scanned at status time).
- Orphan staging directories detected.
- Stale node count (last_verified_commit older than threshold).
- Last successful agent2 run timestamp.

### /atlas-refresh Command

`/atlas-refresh <module-or-node>` triggers manual refresh of a specific area without waiting for the next lifecycle finish.

### Git Discipline

atlas changes are committed separately from functional code changes.

- Commit message prefix: `atlas:`.
- Atlas commits never bundle with feature commits.
- This allows users to filter atlas noise from log/blame: `git log --invert-grep='^atlas:'`.
- Atlas changes are pushed with the rest of lifecycle commits; no separate branch in Phase 2.
- Phase 3 may move atlas to a sibling submodule for stronger isolation; not in Phase 2.

### Required Lifecycle Discipline

micode lifecycle design and ledger documents must include a "User Perspective" section. This is the long-term anchor that prevents the Behavior layer from drifting away from user intent. Without this, agent2 can only infer behavior from code, which strengthens drift instead of revealing it.

This is enforced at the lifecycle level, not at agent2 level: lifecycle artifact recording rejects design and ledger files that lack the User Perspective section.

## Data Flow

### Lifecycle Finish to Atlas Update

1. Lifecycle finish marks the issue closed and records artifact pointers.
2. Project Memory automatic promotion runs from the latest ledger or issue body.
3. agent1 assembles the handoff package and writes it to lifecycle issue body.
4. agent1 spawns agent2 (fire-and-forget on the surface, with spawn receipt for accountability) and ends its turn.
5. agent2 acquires the per-project vault write lock.
6. agent2 spawns worker subagents in parallel.
7. Workers produce proposed changes in their domains.
8. agent2 reconciles worker output. Conflicts go to challenges. Agreed changes go to staging.
9. agent2 atomic-renames staging into vault.
10. agent2 writes the maintenance log and updates spawn receipt with `done_at`.
11. agent2 commits with `atlas:` prefix and pushes.

### Reading Flow for Humans

The user opens Obsidian on the `atlas/` directory. Starting points:

- `00-index.md`: project overview and recent activity.
- Build layer folder: graph view shows module structure and dependencies.
- Behavior layer folder: graph view shows feature groupings; cross-layer links reveal which modules implement which behaviors.
- `_meta/challenges/`: open challenges to review.

The graph view, search, and backlinks are Obsidian-native. The system does not produce its own graph renderer.

### Reading Flow for Agents

When agent1 begins non-trivial work:

1. Read `atlas/00-index.md` for project orientation.
2. Read relevant Build and Behavior nodes for the affected area.
3. Cross-reference Project Memory entries linked from decision and risk pages.
4. Use Project Memory lookup and mindmodel lookup as before.
5. Only then dispatch deeper code exploration as needed.

This shifts agent1 from a context-cold starting position to a context-warm one.

### Behavior Layer Cold Start

`/atlas-init` produces a starter Behavior layer with explicit human input. Subsequent lifecycle activity refreshes Behavior nodes that have lifecycle handoff signals or source artifact changes touching their domain.

The Behavior layer is never a free-form code summary; it is anchored to user intent through the User Perspective section enforced at lifecycle level.

## Error Handling

The system fails visibly and conservatively.

- Missing source artifact: the affected node displays a missing-source marker; node is not silently regenerated without provenance.
- Source conflict: both claims are preserved with source pointers; the section enters challenge.
- Compilation failure mid-run: staging is rolled back; vault remains at previous coherent state; an entry is appended to maintenance log; spawn receipt records failure.
- Repeated agent2 failure: `/atlas-status` shows the failure history; QQ notification fires when failure crosses threshold or when init failure occurs.
- Broken wikilinks accumulating: `/atlas-status` reports count; a Phase 3 lint pass repairs.
- Concurrent worktree writes: per-project vault write lock blocks parallel agent2 runs; the second run waits or defers.

The system prefers stale-but-labeled knowledge over silently regenerated knowledge with no provenance.

## Testing Strategy

Testing verifies behavior at the artifact level rather than mocking agent intelligence.

Key test areas:

- Atlas generation from representative lifecycle, thoughts, Project Memory, and mindmodel inputs.
- Source pointer preservation through agent2 runs.
- Incremental updates that do not delete unrelated human edits (mtime detection happy path and edge cases).
- Atomic write rollback on simulated mid-run failure.
- Spawn receipt reconciliation with `/atlas-status`.
- Wikilink rewiring constraint when rename touches recently human-edited nodes.
- Challenge creation, deduplication, dismissal, and cooldown.
- `/atlas-init` on fresh project, on existing vault without flag (rejection), with `--reconcile`, with `--force-rebuild`.
- Conflict routing to challenges instead of silent merge.
- Schema version detection.

A small fixture project demonstrates Build layer mapping, Behavior layer mapping, decisions, risks, and timeline updates end-to-end.

## Phase Roadmap

This roadmap is the canonical record of what is in scope for Phase 2 and what is deliberately deferred to Phase 3. It exists in three places to prevent context loss: this design document, Project Memory `open_question` entries created at lifecycle finish, and `atlas/40-decisions/atlas-phase-roadmap.md` inside the vault itself.

### Phase 1: MVP (foundation only)

- Vault schema and node templates.
- `/atlas-init` command with multi-agent parallel scan and Octto question batch.
- `/atlas-refresh` manual command.
- No automatic lifecycle integration.

Status: Phase 1 is not the delivery target; it exists only as a conceptual stage Phase 2 builds on.

### Phase 2: Closed-loop integration (this delivery)

Includes Phase 1 plus:

- Lifecycle finish auto-spawn of agent2.
- Structured handoff package.
- Spawn receipt protocol with `/atlas-status` reconciliation.
- Worker subagent fan-out with hard concurrency cap.
- Staging-directory atomic write protocol with rollback on failure.
- mtime-based edit detection routing to challenge.
- Challenge flow with deduplication, cooldown, batched approval rules.
- Wikilink rewiring constraint for recently-edited nodes.
- Soft delete to `_archive/`.
- First-person natural-language maintenance log per run.
- `/atlas-status` command (spawn diff, broken wikilinks, open challenges, stale nodes).
- `/atlas-init --reconcile` and `--force-rebuild` semantics with dry-run report and pre-write git tag.
- `atlas:` commit prefix discipline.
- Lifecycle-level enforcement of User Perspective section in design and ledger.
- Schema version file at `_meta/schema-version`.

This is the scope batch the planner and executor work against.

### Phase 3: Hardening and operational maturity (deferred)

- Independent lint and GC pass.
  - Trigger: vault has more than 200 nodes, or `_archive/` exceeds 50 entries, or broken wikilink count exceeds 10.
  - Hard delete from `_archive/` after retention window.
  - Broken wikilink detection and repair pass.
  - Stale node visual demotion (CSS or frontmatter status update).
- Project type profile system.
  - Trigger: more than one project type using Atlas, or first non-server project adoption.
  - Schema variants per profile; init questions per profile.
- agent2 failure escalation.
  - Trigger: failure rate above threshold or repeated silent stop.
  - Modal blocking notification on next OpenCode startup.
  - Not subsumed by routine `/atlas-status` reporting.
- Cross-project schema migration tools.
  - Trigger: schema version increment.
  - Migration script that batches frontmatter rewrites; required before any breaking schema change.
- Independent git isolation for atlas.
  - Trigger: atlas commits exceed perceived signal-to-noise threshold in main git log.
  - Move atlas to sibling submodule or independent repo.
- madge or dependency-cruiser SVG cross-reference.
  - Trigger: user wants a compiler-grounded cross-check on Build layer.
  - Generate dependency SVG alongside agent-written wikilinks for comparison.
- Behavior layer round-trip verification.
  - Trigger: behavior drift incident or repeated user disagreement with Behavior layer content.
  - Each behavior assertion must include a minimal verification operation.

Each Phase 3 item is also recorded as an `open_question` Project Memory entry at lifecycle finish so that future agents can lookup `atlas phase 3` and find the deferred list.

## Open Questions

- Should the user be able to mark specific nodes as "frozen" in the schema (locking out agent2 modification entirely), beyond the mtime detection mechanism? Decided no for Phase 2 since mtime detection plus challenge already covers the user-edited case; revisit if challenge volume becomes a problem.
- Should challenge resolution have a web UI or stay inside Obsidian? Decided Obsidian-native for Phase 2; web UI is a Phase 3 candidate if challenge volume justifies it.
- Should Phase 2 include a one-shot "verify all nodes against current source" command separate from `/atlas-refresh`? Deferred to Phase 3 lint pass.
- Should `_meta/log/` have a retention policy in Phase 2? Deferred; the user has stated token cost is not a concern, and aggregation can be added in Phase 3 lint.

## Decision Summary

Project Atlas is introduced as a human-and-agent shared cognitive layer rendered as an Obsidian vault inside the project repository. It does not replace Project Memory; it makes project knowledge navigable, visible, and maintained without manual cost.

The first delivered version is Phase 2 (closed-loop integration). It includes lifecycle-driven asynchronous maintenance via agent2, atomic write discipline, mtime-based edit detection, challenge flow, soft delete, and operational visibility through `/atlas-status` and spawn receipts.

The frontmatter schema deliberately excludes `confidence` (unreliable AI self-rating) and `human_authored` (incompatible with the human-and-agent co-working model). Edits are detected by mtime, not by tags. Trust is observation-based.

Phase 3 hardening items are recorded in three redundant locations to prevent loss of context if any one source is lost.
