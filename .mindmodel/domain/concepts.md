# Domain Concepts

## Core Workflow Vocabulary

| Term | Definition |
|---|---|
| **Brainstorm** | Design exploration phase. Produces a Design doc in `thoughts/shared/designs/YYYY-MM-DD-{topic}-design.md`. Entry agents: `brainstormer` (text), `octto` (browser UI with 16 question types). |
| **Design** | Markdown artifact capturing the WHAT — requirements, options, decisions. Not the implementation HOW. |
| **Plan** | Micro-task list produced by `planner`. Each task: one file + its test, Domain tag, dependencies, expected API. Stored in `thoughts/shared/plans/YYYY-MM-DD-{topic}.md`. |
| **Micro-task** | Atomic unit of implementation: one file, one test, 2–5 min of work. Always has exactly one Domain. |
| **Batch** | Group of micro-tasks that can run in parallel (no file-level dependencies between them). Executor spawns all tasks in a batch simultaneously. |
| **Domain** | Routing tag on every micro-task. Valid values: `frontend-ui`, `frontend-code`, `backend`, `general`. The bare string `"frontend"` is a stale-plan error — executor stops. |
| **Frozen API Contract** | Contract document emitted by planner when a plan spans both frontend (ui or code) and backend domains. Implementers must conform; they **never edit** it. Escalate mismatches to executor. |
| **Executor** | Orchestrator that reads the plan, groups tasks into batches, spawns implementers+reviewers in parallel, and manages lifecycle commits. |
| **Implementer** | Leaf agent dispatched by executor for one Domain: `implementer-frontend-ui`, `implementer-frontend-code`, `implementer-backend`, `implementer-general`. |
| **Reviewer** | Leaf agent that verifies correctness and contract conformance for one micro-task. |
| **Context Brief** | `<context-brief>` block injected by executor into every leaf agent spawn prompt. Contains: atlas excerpt, Project Memory entries, confirmed env facts, contract path. Leaf agents trust it and do not re-lookup. |
| **Lifecycle** | Issue-driven delivery state machine: issue → branch → worktree → implement → lifecycle_commit → lifecycle_finish → merge+close. |
| **Worktree** | Git worktree created per lifecycle issue for isolated implementation. Inherits parent repo's `origin`. |
| **Ownership Preflight** | Mandatory check before any remote git write: `git remote -v` + `gh repo view --json nameWithOwner,isFork,parent`. Classifies repo as Fork/Own/Upstream and determines safe push target. |
| **Continuity Ledger** | Session compaction artifact in `thoughts/ledgers/CONTINUITY_{session}.md`. Created/updated via `/ledger` command. Injected into system prompt by `ledger-loader` hook. |
| **Atlas** | Shared human+AI mental model stored as Obsidian vault in `atlas/`. Maintained by primary/coordinator agents (not leaf agents, not lifecycle hooks). |
| **Project Memory** | SQLite store of durable engineering knowledge: decisions, lessons, risks, open questions. Keyed by `projectId` (git remote URL hash). Maintained by coordinator agents at semantic checkpoints. |
| **Mindmodel** | This `.mindmodel/` directory. Answers "HOW code should be written" — patterns, constraints, examples. Consumed by agents via `mindmodel_lookup` tool and `mindmodel-injector` hook. |
| **Spawn Meta** | `<spawn-meta task-id="..." run-id="..." generation="1" />` block required at the start of every executor `spawn_agent` prompt. Used for crash recovery / duplicate fencing. |
| **Recovery Hint** | Structured `### Recovery Hint` block emitted by lifecycle tools on failure. Primary agents attempt bounded auto-recovery (max 3 rounds) before halting. |

## Knowledge Layer Separation

```
Atlas (atlas/)           ← "How is the project organized NOW?"
Project Memory (SQLite)  ← "Why did we make this choice / what did we learn?"
Mindmodel (.mindmodel/)  ← "How should code be written in THIS project?"
thoughts/ (filesystem)   ← Raw artifacts: designs, plans, ledgers (not permanent memory)
```

## Agent Role Boundaries

- **Primary agents** (commander, brainstormer, octto): own QQ notifications, Atlas/Project Memory maintenance, multi-round refinement before lifecycle.
- **Coordinator agents** (planner, executor): spawn leaf agents, inject context-brief, handle recovery, own checkpoint commits.
- **Leaf agents** (implementer-*, reviewer): consume context-brief, do NOT write Atlas/Project Memory, escalate observations in terminal report.
- **Specialist agents** (product-manager, software-architect, ux-designer, architecture-quality-inspector, rubric-reviewer): user-triggered only, read-only, never auto-spawned.

## Commands Reference

| Command | What it does |
|---|---|
| `/init` | Generates `ARCHITECTURE.md` + `CODE_STYLE.md` |
| `/ledger` | Creates/updates continuity ledger for current session |
| `/search` | Searches past plans and ledgers in `thoughts/` |
| `/mindmodel` | Rebuilds `.mindmodel/` from codebase analysis |
| `/atlas-init` | Initializes `atlas/` vault |
| `/atlas-status` | Health check of atlas vault |
| `/atlas-refresh` | Batch reconcile atlas nodes |
| `/all-init` | Builds all three knowledge layers (missing only) |
| `/all-rebuild` | Force-rebuilds all three knowledge layers |
| `/all-status` | Read-only health check of all three layers |
