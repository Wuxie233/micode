# micode

> Turn AI pair-programming into structured, multi-agent software engineering — with first-class layered knowledge, an issue-driven delivery lifecycle, and effect-first reporting.

🇨🇳 **简体中文文档 / Chinese README →** [README.zh.md](./README.zh.md)

https://github.com/user-attachments/assets/85236ad3-e78a-4ff7-a840-620f6ea2f512

micode is an OpenCode plugin that replaces the open-ended chat loop with a brainstorm → plan → implement workflow, routes implementation tasks to domain specialists across a frozen API contract, persists project memory across sessions and worktrees, and runs the entire issue-driven lifecycle (issue, branch, worktree, commit, PR, merge) as deterministic tool calls. It is designed for people who maintain non-trivial codebases with agents and want the work to outlive any single conversation.

## Table of Contents

- [Why micode](#why-micode)
- [Quick Start](#quick-start)
- [Design Philosophy](#design-philosophy)
- [Features](#features)
- [How It Works](#how-it-works)
- [Slash Commands](#slash-commands)
- [Agents](#agents)
- [Tools](#tools)
- [Configuration](#configuration)
- [Hooks](#hooks)
- [Octto Configuration](#octto-configuration)
- [Development](#development)
- [Inspiration](#inspiration)
- [Acknowledgments](#acknowledgments)
- [License Notices](#license-notices)

## Why micode

Vanilla OpenCode is a powerful general-purpose chat agent, but for serious engineering work it leaves several structural gaps. Conversations are flat: there is no enforced phase boundary between "what is this idea" and "let's start changing code." Knowledge dies with the session: an architectural decision made in turn 12 is not visible to a new conversation started a week later. There is no built-in notion of "this implementation task is frontend-UI, that one is backend" — every task runs against the same model with the same prompt. Failures inside parallel subagents tend to wipe out peer progress instead of being isolated.

micode adds those missing structures as plugin code, not as prompt etiquette. The brainstorm → plan → implement flow is enforced by distinct agents with distinct prompts and outputs. A three-layer knowledge system separates HOW code is written (`.mindmodel/`), how the project is organized (`atlas/`), and WHY past decisions were made (Project Memory, SQLite). The issue-driven lifecycle turns each non-trivial change into a GitHub issue, branch, worktree, auto-commit cadence, and PR — using tool calls, not freeform shell. The planner tags every task with a `Domain` so the executor can dispatch UI work to a UI-strong model and backend work to a backend-strong model, with a frozen API contract bridging them.

micode is most useful when you are: a developer maintaining a complex codebase who wants AI agents to respect your existing structure rather than reinvent it; an agent orchestrator who needs determinism and recoverability under failure; or a team that needs decisions, lessons, and risks to survive turnover, conversation compaction, and worktree cleanup. If you only want a faster chat completion, vanilla OpenCode is already fine.

## Quick Start

Add to `~/.config/opencode/opencode.json`:

```json
{ "plugin": ["github:Wuxie233/micode"] }
```

Copy [`micode.example.jsonc`](./micode.example.jsonc) to `~/.config/opencode/micode.jsonc` and replace the placeholders with your real model strings (this repo ships no concrete provider or model names).

Then run `/init` to generate `ARCHITECTURE.md` and `CODE_STYLE.md`.

Once `/init` is done, run `/all-init` to bootstrap the `.mindmodel/` and `atlas/` knowledge layers in one shot.

`/all-init` detects which of the three knowledge layers (project docs, `.mindmodel/`, `atlas/`) are missing and runs only the missing parts — it is safe to re-run.

## Design Philosophy

These are the project's seven opinionated stances. Each links to the authoritative source.

#### 1. Need-first thinking

The user's underlying NEED is the source of truth; the user's proposed IMPLEMENTATION is a candidate, not automatically the best path. Agents are required to identify and lock the need before evaluating the proposed solution, and to surface a clearly better alternative when one exists — without re-litigating decisions the user has already approved.

→ See [`AGENTS.md` "Need-First Critical Thinking"](https://github.com/Wuxie233/micode/blob/main/AGENTS.md) for the full rule.

#### 2. Low coupling, wheels-first

Modules communicate via explicit interfaces and pure data; never via private state or hidden singletons. Business code is composed from small reusable utilities and shared hooks. New abstractions are only allowed when an existing wheel genuinely cannot express the need and the new wheel will be used in multiple places.

→ See [`.mindmodel/architecture/coupling-reuse.md`](./.mindmodel/architecture/coupling-reuse.md) for the full rule.

#### 3. Layered knowledge

Three distinct knowledge layers, each answering a different question. `.mindmodel/` answers "HOW code is written" (style, patterns, anti-patterns). `atlas/` answers "how the project is organized" (modules, behaviors, decisions, risks, in an Obsidian-style vault). Project Memory answers "WHY decisions were made" (durable SQLite entries scoped per repo origin, surviving worktree cleanup).

→ See [`AGENTS.md` "Project Memory (v9)"](https://github.com/Wuxie233/micode/blob/main/AGENTS.md) and [`AGENTS.md` "Atlas Shared Mental Model"](./AGENTS.md) for the full rule.

#### 4. Multi-round alignment before commitment

One-round-and-go is an anti-pattern. Non-trivial proposals must pass through research (parallel subagents) → reasoning with explicit alternatives → batched questions with recommended defaults → scenario walkthrough → optional adversarial review BEFORE `lifecycle_start_request` is called. Discussion stays in chat; nothing lands in `thoughts/shared/designs/` until the user explicitly approves entering implementation.

→ See [`AGENTS.md` "Multi-Round Requirement Alignment"](https://github.com/Wuxie233/micode/blob/main/AGENTS.md) for the full rule.

#### 5. Effect-first reporting

Terminal reports lead with "what you will see" and "how to verify it," not "which files I changed." The default five-section structure is: 预期表现 (expected behavior) → 你可以怎么验收 (how you can verify) → 已知限制 / 下一步 (known limitations / next steps) → 本次知识上下文 (knowledge context this run) → 实现记录 (implementation log). Blocked and failed-stop cases lead with the blocker and required user action.

→ See [`AGENTS.md` `<effect-first-reporting>`](./AGENTS.md) and [project-local `AGENTS.md` "Effect-First User-Facing Reports"](./AGENTS.md) for the full rule.

#### 6. Agent-maintained knowledge

Users never directly edit `atlas/` files or the Project Memory SQLite database. Agents do the maintenance, following a Read → Maintain → Verify → Report protocol on each non-trivial task. Every changes is surfaced to the user via the "本次知识上下文 / Knowledge Context" section of the terminal report, including `Atlas status:` and `Project Memory status:` lines.

→ See [project-local `AGENTS.md` "Atlas Shared Mental Model"](./AGENTS.md) and ["Project Memory Active Maintenance"](./AGENTS.md) for the full rule.

#### 7. Safety pre-flight

Before any remote-write git operation (`git push`, `gh issue create`, `gh pr create`, `gh pr merge`, branch delete on remote), agents classify repo ownership into one of three cases: fork-for-personal-use, own original repo, or upstream contribution. Pushing to upstream is never automatic. Force push and `--no-verify` are hard-banned.

→ See [`AGENTS.md` "Repository Ownership Awareness"](https://github.com/Wuxie233/micode/blob/main/AGENTS.md) for the full rule.

## Features

### 🎯 Brainstorm → Plan → Implement Workflow

Three distinct phases backed by three distinct agents, each with its own prompt, output artifact, and exit condition. `brainstormer` (text-based) or `octto` (browser-based) drives design exploration with parallel research subagents and writes `thoughts/shared/designs/YYYY-MM-DD-{topic}-design.md`. `planner` reads the design and writes a bite-sized task plan (2-5 min per task, exact file paths, dependency batches). `executor` reads the plan and dispatches each task by `Domain` to the matching implementer, running implementer → reviewer cycles per task.

Example: you say "add password reset to the user settings page" → brainstormer asks a batched set of questions about scope and edge cases, locks the approach → planner writes ten tasks split across `frontend-ui`, `frontend-code`, and `backend` → executor fans them out in parallel batches and reviewer signs off each one.

### 🧠 Multi-Round Requirement Alignment

Pre-lifecycle refinement loop that runs in chat before any design document is written. Research → reasoning with explicit alternatives → questions batched with recommended defaults → scenario walkthrough that renders abstract decisions as concrete future moments ("when you start a new task...", "when an agent fails...") → optional adversarial review by 2-3 subagents with conflicting roles (`archaeology`, `conservative`, `red team`, `YAGNI auditor`). The loop only ends when the user explicitly says "go." No `thoughts/shared/designs/` writes during exploration.

Example: you say "let's add an audit log" → research subagents fan out to map existing logging and security boundaries → brainstormer proposes two designs with trade-offs → you ask for red-team review → 3 adversarial subagents return findings → consensus surfaces → you say "go" → only THEN does `lifecycle_start_request` fire.

### 🚦 Issue-Driven Lifecycle (v9)

For non-trivial work, the entire delivery cycle is owned by deterministic tool calls. `lifecycle_start_request` creates the GitHub issue + branch + worktree in one shot. `lifecycle_commit` performs the ownership pre-flight, commits, and auto-pushes to fork `origin` at each checkpoint. `lifecycle_finish` merges (PR-first if remote CI exists, else local `--no-ff`), closes the issue, and cleans up the worktree. Failures emit structured `### Recovery hint` blocks; the primary agent runs a bounded recovery loop (max 3 rounds for primaries, 2 for planner/executor) without force-push or `--no-verify`.

Example: brainstormer finalizes a design → `lifecycle_start_request` opens issue #42 and `wt-42` worktree → planner commits its plan via `lifecycle_commit` → executor commits each batch as it lands → on green, `lifecycle_finish` opens the PR, waits for CI, merges, and removes `wt-42`.

### 🎚️ Domain-Routed Implementers + Frozen Contracts

`planner` tags every task with a `Domain` field (`frontend-ui`, `frontend-code`, `backend`, or `general`). When a plan spans both frontend (ui or code) and backend, `planner` additionally emits `thoughts/shared/plans/YYYY-MM-DD-{topic}-contract.md` — a frozen API contract document the concurrent implementers must conform to. `executor` reads each task's `Domain` and dispatches to the matching specialist: `implementer-frontend-ui` for layout/styling/a11y, `implementer-frontend-code` for state/forms/types, `implementer-backend` for APIs/DB, `implementer-general` for shared config. The contract path is injected into every implementer and reviewer spawn prompt; implementers that detect a contract mismatch escalate — they never edit the contract.

Example: a "new feed endpoint + new feed component" plan → contract file freezes `GET /feed → { items: FeedItem[] }` → `implementer-backend` and `implementer-frontend-code` run in parallel against the same contract, reviewer verifies conformance on both sides.

### 📚 Three-Layer Knowledge System

micode separates project knowledge into three layers with distinct scopes and storage backends:

| Layer | Question it answers | Storage |
|---|---|---|
| `.mindmodel/` | HOW code is written (style, patterns, anti-patterns) | Markdown + YAML manifest |
| `atlas/` | How the project is organized (modules, behaviors, decisions, risks) | Obsidian vault (Markdown + wikilinks) |
| Project Memory | WHY decisions were made (durable facts/decisions/lessons/risks) | SQLite, scoped per repo origin |

Agents read all three at task start (via `mindmodel_lookup`, `atlas_lookup`, `project_memory_lookup`) and maintain them at semantic checkpoints. Project Memory survives worktree cleanup because it is keyed by repo origin, not by `thoughts/` path.

Example: you start a task that touches the auth module → executor reads `atlas/10-impl/auth.md` for current organization, `project_memory_lookup("auth")` returns three past decisions and one open risk, `.mindmodel/security/auth.md` returns the project's auth coding pattern. None of these had to be re-derived.

### 🧑‍🔬 User-Triggered Specialist Agents

Six read-only specialist agents that you summon by name. They never auto-spawn, never enter the executor's reviewer loop, and never participate in output-class routing. They produce evaluation material for you to integrate; their verdicts are not control signals.

- `product-manager` — converts a fuzzy request into a PRD: problem framing, stakeholders, success metrics, in/out-of-scope, risks, recommendation. Up to 3 batched clarifying questions with A/B/C/D/E options.
- `software-architect` — produces 2-3 architecture alternatives with explicit trade-offs and a recommended option, anchored to existing module coupling.
- `ux-designer` — audits UI/UX against WCAG 2.2, Material Design 3, Apple HIG, Core Web Vitals, Nielsen 10, and AI transparency, ranked by severity × frequency × business impact.
- `architecture-quality-inspector` — checks SOLID, circular dependencies, anti-patterns, coupling constraints; emits P0/P1/P2/P3 findings with one of three verdicts.
- `rubric-reviewer` — scores a proposal on multiple dimensions (Excellent / Good / Acceptable / Poor / Failed) with mandatory per-dimension evidence; never emits a 1-10 aggregate.
- `critic` — adversarial archaeologist / conservative / red team / YAGNI / cross-family critique with severity tiers and evidence.

→ See [project-local `AGENTS.md` "User-Triggered Specialist Agents"](./AGENTS.md) for the full dispatch rules.

Example: "派 software-architect 审一下" → the architect returns 3 alternatives with trade-offs, you pick one, brainstormer integrates it.

### 💬 Octto Browser Questions

A bundled browser UI that runs as a single shared HTTP server per OpenCode plugin process. Sessions are scoped to the OpenCode conversation that created them; cross-conversation tool calls return `## Forbidden`. Sixteen question types cover the spectrum: `confirm`, `pick_one`, `pick_many`, `ask_text`, `ask_code`, `ask_file`, `ask_image`, `show_diff`, `show_plan`, `show_options`, `review_section`, `rank`, `rate`, `slider`, `thumbs`, `emoji_react`, plus multi-branch `brainstorm` sessions. Auto-resume dispatch: agent ends its turn after pushing questions, the portal re-prompts the OpenCode session when the user answers.

Example: planner needs 5 batched decisions → pushes them to octto → ends its turn → you answer in the browser → planner resumes automatically and writes the plan.

### ⚙️ Resilience & Safety

Subagent failures are classified into `{success, transient_retried, task_error, blocked, hard_failure}`. Transient errors auto-retry inside the same subagent session. On `task_error` or `blocked`, the coordinator prefers `resume_subagent(session_id, hint)` over respawn — the resumed subagent has all its prior context intact. Parallel batches use `Promise.allSettled` so one subagent's failure never kills its peers. The repository ownership pre-flight runs before any remote-write git op. Lifecycle failures emit structured `Recovery hint` blocks; agents run a bounded recovery loop without force-push, without `--no-verify`, and without auto-restarting OpenCode.

Example: a batch of 5 parallel implementers runs → one returns `task_error` because of a missing import → executor calls `resume_subagent` with a hint, the subagent fixes the import and finishes, the other 4 are unaffected.

### Bounded Upstream Continuation Retry

micode 在 built-in Task / executor-direct continuation 与 Octto auto-resume 上对可恢复 `upstream_error` 提供有界自动重试（默认 20 次 × 30 秒），避免临时 provider 故障让用户被迫手动点 "continue"。详细策略与排除范围见 [`AGENTS.md` 的 `Bounded Upstream Continuation Retry` 段](./AGENTS.md)，行为承诺见 [`atlas/20-behavior/bounded-upstream-continuation-retry.md`](./atlas/20-behavior/bounded-upstream-continuation-retry.md)，设计见 [`thoughts/shared/designs/2026-05-16-bounded-upstream-error-continuation-retry-design.md`](./thoughts/shared/designs/2026-05-16-bounded-upstream-error-continuation-retry-design.md)。`spawn_agent` 内层 45 秒 budget、`lifecycle` git/GitHub 重试、`resume_subagent` 语义均不在此范围。

## How It Works

```
Brainstorm → Plan → Implement
     ↓         ↓        ↓
  research  research  executor
```

### Brainstorm

Refine ideas into designs through collaborative questioning. Two entry points: `brainstormer` (text-based) and `octto` (browser UI with 16 question types, bundled). Fires research subagents in parallel.

Non-trivial proposals run the multi-round alignment loop first: research → propose with reasoning and explicit alternatives → questions batched with recommended defaults → scenario walkthrough → optional adversarial review (`archaeology` / `conservative` / `red team` / `YAGNI`) → user explicitly says "go" → only THEN `lifecycle_start_request` and the design document are written.

Output: `thoughts/shared/designs/YYYY-MM-DD-{topic}-design.md` (the optional `## Behavior` section captures user-visible behavior promises).

### Plan

Transform designs into implementation plans with bite-sized tasks (2-5 min each), exact file paths, and TDD workflow. Every task is tagged with a `Domain` (`frontend-ui`, `frontend-code`, `backend`, or `general`). When the plan spans both frontend (ui or code) and backend tasks, the planner additionally emits a **frozen API contract document** that concurrent implementers must conform to.

The plan also includes a `## 行为承诺映射` section that maps each Behavior bullet from the design to the tasks that cover it, surfacing any gap before implementation starts.

Outputs:
- `thoughts/shared/plans/YYYY-MM-DD-{topic}.md`
- `thoughts/shared/plans/YYYY-MM-DD-{topic}-contract.md` (cross-domain plans only)

### Implement

Execute in a git worktree for isolation. The **Executor** reads each task's `Domain` and dispatches to the matching specialist implementer (`implementer-frontend-ui`, `implementer-frontend-code`, `implementer-backend`, or `implementer-general`), injecting the contract path into every implementer and reviewer spawn prompt. The literal stale `Domain: frontend` value (from plans generated before the split) is treated as a stale-plan error and stops execution with a clear instruction to re-run the planner.

Batches run with batch-first parallelism via `Promise.allSettled`: independent tasks fan out concurrently, one failure does not cancel peers. On `task_error` or `blocked`, the executor prefers `resume_subagent(session_id, hint)` over respawn so the failed subagent keeps its context. Implementers that detect a contract mismatch escalate; they do not edit the contract.

Each batch finishes with reviewer signoff and a `lifecycle_log_progress(kind="status", summary="batch N complete")` checkpoint.

### Knowledge Maintenance

During every non-trivial task, agents run a Read → Maintain → Verify → Report protocol on the three knowledge layers:

- **Read** — call `mindmodel_lookup`, `atlas_lookup`, `project_memory_lookup` before designing or planning. Atlas context is automatically injected at start of session via the `atlas-auto-inject` hook.
- **Maintain** — at batch completion, decision points, or lifecycle phase changes, write or update `atlas/` nodes and call `project_memory_promote` for non-trivial decisions, lessons, risks, or open questions.
- **Verify** — reviewer and executor check that code diffs match the claims in updated nodes; mismatches escalate as `Atlas observation: stale-detected` or `Project Memory observation: ...` lines that the coordinator routes.
- **Report** — every terminal report contains a "本次知识上下文 / Knowledge Context" subsection ending with two fixed lines: `Atlas status: <value>` and `Project Memory status: <value>`. You see exactly which knowledge sources were read and which were maintained.

Users never edit `atlas/` files or the Project Memory SQLite database directly. To change a behavior node, you tell the agent ("update `atlas/20-behavior/X` to say Y") and the agent does the write.

### Session Continuity

Maintain context across sessions with structured compaction. Run `/ledger` to create or update `thoughts/ledgers/CONTINUITY_{session}.md`. The auto-compact hook also produces a ledger summary when context crosses the configured threshold. Project Memory survives worktree cleanup and is shared across all worktrees of the same fork origin.

## Slash Commands

| Command | Category | Description |
|---|---|---|
| `/init` | Core | Initialize project with `ARCHITECTURE.md` and `CODE_STYLE.md` |
| `/ledger` | Core | Create or update continuity ledger for session state |
| `/search` | Core | Search past handoffs, plans, and ledgers |
| `/mindmodel` | Core | Generate `.mindmodel/` constraints for this project |
| `/memory` | Core | Inspect or query durable Project Memory (no args → `project_memory_health`; with args → `project_memory_lookup`) |
| `/all-init` | Knowledge Bootstrap | Bootstrap all three knowledge layers (missing-only mode); safe to re-run |
| `/all-rebuild` | Knowledge Bootstrap | Rebuild all three knowledge layers with overwrite (requires user confirm via octto) |
| `/all-status` | Knowledge Bootstrap | Read-only status report on all three layers and Project Memory |
| `/atlas-init` | Atlas | Cold-start the Atlas vault (supports `--reconcile` or `--force-rebuild`) |
| `/atlas-status` | Atlas | Report Atlas health: open challenges, broken wikilinks, orphan staging, last run |
| `/atlas-refresh` | Atlas | Auxiliary batch reconcile/history cleanup via `atlas-compiler` |
| `/atlas-translate` | Atlas | Translate Atlas nodes or the full vault into Chinese, preserving structure |

## Agents

Verified against `src/agents/index.ts`.

**Primary (user-facing)**

| Agent | Purpose |
|---|---|
| `commander` | Primary workflow orchestrator |
| `brainstormer` | Design exploration (text-based) |
| `octto` | Design exploration (browser UI with 16 question types) |

**Workflow**

| Agent | Purpose |
|---|---|
| `planner` | Bite-sized task plans with `Domain` tags and optional frozen API contracts |
| `executor` | Domain dispatch + implementer/reviewer batches with `Promise.allSettled` |
| `reviewer` | Read-only review of one micro-task; verifies contract conformance |
| `executor-direct` | No-plan scoped direct execution in a single subagent session |

**Implementers (domain-routed)**

| Agent | Purpose |
|---|---|
| `implementer-frontend-ui` | UI/UX, layout, styling, accessibility, motion, design-system use |
| `implementer-frontend-code` | Frontend code-logic, state, data flow, forms, type fixes, frontend tests |
| `implementer-backend` | APIs, data layer, server-side work |
| `implementer-general` | Configs, scripts, shared types, test infrastructure |

**Specialists (user-triggered, read-only)**

| Agent | Purpose |
|---|---|
| `product-manager` | Converts fuzzy requests into PRDs with framing, metrics, scope, recommendation |
| `software-architect` | 2-3 architecture alternatives with trade-offs and a recommended option |
| `ux-designer` | UI/UX audit against WCAG 2.2 / Material Design 3 / Apple HIG / CWV / Nielsen 10 |
| `architecture-quality-inspector` | SOLID, circular dependencies, anti-patterns, coupling constraints; P0/P1/P2/P3 findings |
| `rubric-reviewer` | Multi-dimensional rubric scoring with mandatory per-dimension evidence |
| `critic` | Adversarial archaeologist / conservative / red-team / YAGNI / cross-family critique |

**Investigation**

| Agent | Purpose |
|---|---|
| `investigator` | Read-only diagnostic: gathers evidence, proposes root cause, recommends escalation |

**Workers**

| Agent | Purpose |
|---|---|
| `codebase-locator` | Find WHERE files live in the codebase |
| `codebase-analyzer` | Explain HOW code works with precise `file:line` references |
| `pattern-finder` | Find existing patterns and examples to model after |
| `artifact-searcher` | Search past handoffs, plans, and ledgers |
| `ledger-creator` | Continuity ledger creation and updates |
| `notification-courier` | Dispatches QQ completion notifications via the `autoinfo` MCP |
| `probe` | Evaluates octto branch Q&A and decides whether to ask more or complete |
| `bootstrapper` | Analyzes a request and creates exploration branches with scopes for octto |

**Mindmodel**

| Agent | Purpose |
|---|---|
| `mm-orchestrator` | Orchestrates the 2-phase mindmodel v2 generation pipeline |
| `mm-stack-detector` | Detects project tech stack |
| `mm-pattern-discoverer` | Discovers pattern categories |
| `mm-example-extractor` | Extracts code examples for one mindmodel category |
| `mm-convention-extractor` | Naming, style, code organization conventions |
| `mm-anti-pattern-detector` | Inconsistencies and anti-patterns in the codebase |
| `mm-dependency-mapper` | Approved vs one-off libraries |
| `mm-domain-extractor` | Business domain terminology and concepts |
| `mm-constraint-writer` | Assembles analysis into `.mindmodel/` with inline example extraction |
| `mm-constraint-reviewer` | Reviews generated code against project constraints |
| `mm-code-clusterer` | Groups similar code patterns across the codebase |

**Atlas**

| Agent | Purpose |
|---|---|
| `atlas-initializer` | Cold-init Atlas builder: discovers project, plans nodes, fans out workers |
| `atlas-compiler` | Auxiliary batch reconcile / history cleanup (user-triggered only) |
| `atlas-translator` | Translates existing Atlas node prose to Chinese while preserving machine syntax |
| `atlas-cold-build` | Cold-init Build-layer worker: enriches one `10-impl/<module>.md` |
| `atlas-cold-behavior` | Cold-init Behavior-layer worker: drafts one `20-behavior/<topic>.md` |
| `atlas-worker-build` | Proposes Build layer (`10-impl`) node updates from module map and sources |
| `atlas-worker-behavior` | Proposes Behavior layer (`20-behavior`) node updates anchored to user perspective |

**Bootstrap**

| Agent | Purpose |
|---|---|
| `knowledge-bootstrap-orchestrator` | Orchestrates `/all-init` / `/all-rebuild` / `/all-status` serial pipeline |
| `project-initializer` | Generates `ARCHITECTURE.md` and `CODE_STYLE.md` |

## Tools

Verified against `src/tools/index.ts` and `src/index.ts` tool registration.

**Code analysis**

| Tool | Description |
|---|---|
| `ast_grep_search` | AST-aware code pattern search via `sg` |
| `ast_grep_replace` | AST-aware code pattern replacement via `sg` |
| `look_at` | Extract file structure / outline to save context tokens |

**Artifact search**

| Tool | Description |
|---|---|
| `artifact_search` | Search past plans and ledgers (SQLite FTS5) |
| `milestone_artifact_search` | Search milestone-driven artifacts (feature / decision / session) |

**Subagent dispatch**

| Tool | Description |
|---|---|
| `spawn_agent` | Spawn subagents in parallel via `Promise.allSettled` |
| `resume_subagent` | Resume a preserved subagent session after `task_error` or `blocked` |
| `batch_read` | Read multiple files in parallel via `Promise.all` |

**Knowledge lookup**

| Tool | Description |
|---|---|
| `mindmodel_lookup` | Look up `.mindmodel/` coding patterns and examples |
| `atlas_lookup` | Search the Atlas vault for node summaries and source links |
| `project_memory_lookup` | Query durable Project Memory by topic, type, or status |
| `project_memory_promote` | Promote markdown decisions / lessons / risks into Project Memory |
| `project_memory_forget` | Hard-delete Project Memory entries (user-explicit only) |
| `project_memory_health` | Report Project Memory health for the current project |

**Lifecycle**

| Tool | Description |
|---|---|
| `lifecycle_start_request` | Create the GitHub issue, branch, and worktree |
| `lifecycle_commit` | Commit lifecycle work for an issue (auto-pushes to fork origin) |
| `lifecycle_finish` | Merge (PR-first or local `--no-ff`) and close the issue |
| `lifecycle_current` | Resolve the active lifecycle for the current branch / worktree |
| `lifecycle_resume` | Reconstruct local lifecycle record from the GitHub issue body |
| `lifecycle_recovery_decision` | Inspect lifecycle state and produce a recovery decision (read-only) |
| `lifecycle_record_artifact` | Record a lifecycle artifact pointer (design / plan / ledger / commit / pr / worktree) |
| `lifecycle_log_progress` | Append a progress entry (decision / blocker / discovery / status / handoff) |

**Octto**

| Tool | Description |
|---|---|
| `start_session` | Start an Octto session with initial questions; opens browser |
| `end_session` | End an Octto session and clean up |
| `push_question` | Push a question to an existing session queue |
| `get_answer` | Get the answer to a specific question |
| `get_next_answer` | Wait for ANY question to be answered |
| `cancel_question` | Cancel a pending question |
| `list_questions` | List all questions and their status for a session |
| `create_brainstorm` | Create a new brainstorm session with exploration branches |
| `await_brainstorm_complete` | Wait for a brainstorm session to complete |
| `get_brainstorm_summary` | Get summary of all branches and their findings |

**PTY**

| Tool | Description |
|---|---|
| `pty_spawn` | Start a background PTY session |
| `pty_write` | Send input to a PTY session |
| `pty_read` | Read output from a PTY session |
| `pty_list` | List all PTY sessions |
| `pty_kill` | Terminate a PTY session |

**Library docs**

| Tool | Description |
|---|---|
| `btca_ask` | Ask questions about library/framework source code via `btca` |

**Other**

| Tool | Description |
|---|---|
| `detect_knowledge_state` | Detect which of the three knowledge layers exist on disk |

## Configuration

For complete configuration reference (model resolution, `micode.jsonc` fields, spawn model overrides, environment variables, runtime deploy, release flow), see **[docs/configuration.md](./docs/configuration.md)**.

Quick examples:

```json
// opencode.json: default model for all micode agents
{ "model": "<your-default-model>", "plugin": ["github:Wuxie233/micode"] }
```

```jsonc
// ~/.config/opencode/micode.jsonc: per-agent overrides
{
  "agents": {
    "implementer-frontend-ui": { "model": "<your-frontend-ui-model>" },
    "implementer-backend": { "model": "<your-backend-model>" }
  }
}
```

## Hooks

Verified against `src/hooks/index.ts`.

- **Think Mode** — Keywords like "think hard" enable a 128k token thinking budget.
- **Ledger Loader** — Injects the latest `thoughts/ledgers/CONTINUITY_*.md` into the system prompt.
- **Auto-Compact** — Summarizes the session and writes a ledger when context crosses the configured threshold.
- **File Ops Tracker** — Tracks read/write/edit operations per session for deterministic logging.
- **Artifact Auto-Index** — Detects writes to `thoughts/ledgers/` and `thoughts/shared/plans/` and indexes them in SQLite FTS5.
- **Context Injector** — Injects `ARCHITECTURE.md`, `CODE_STYLE.md`, and directory context.
- **Token-Aware Truncation** — Truncates large search-like tool outputs to fit context.
- **Fetch Tracker** — Caches repeated fetch-like tool output and prevents loops.
- **Context Window Monitor** — Tracks context usage and injects status.
- **Mindmodel Injector** — Optional task-aware `.mindmodel/` prompt injection when `features.mindmodelInjection` is enabled.
- **Constraint Reviewer** — Reviews generated code against `.mindmodel/` constraints through `mm-constraint-reviewer`.
- **Session Recovery** — Attempts recovery for recoverable session errors.
- **Atlas Auto-Inject** — Injects Atlas context at the start of relevant sessions.
- **Comment Checker** — Reviews comment hygiene in generated code.
- **Conversation Title** — Sets conversation titles from lifecycle and tool milestones (chat-message fallback disabled by default in v9).
- **Fragment Injector** — Prepends configured user prompt fragments per agent.

## Octto Configuration

Octto runs a single shared HTTP server per OpenCode plugin process. Sessions are exposed on session-scoped URLs.

Each Octto session belongs to the OpenCode conversation that created it. Tool calls from another conversation return `## Forbidden` and do not modify session state.

| Env var | Default | Effect |
|---------|---------|--------|
| `OCTTO_PORT` | `0` (Bun chooses a free port) | Port the shared Octto server binds to. |
| `OCTTO_PUBLIC_BASE_URL` | unset | URL prefix returned to agents when behind a reverse proxy. Trailing `/` is stripped. Example: `https://octto.wuxie233.com`. |

Public reverse proxies must route each session page at `<base>/s/<sessionId>` and its WebSocket at `<base>/ws/<sessionId>`. Browsers on HTTPS use `wss://` for the WebSocket automatically.

The browser UI uses draft-before-send: clicking a question's Submit stores a local draft. The answer is sent to the agent only when you click `Send N answer(s)`, and each draft can be changed with `Edit` before sending.

## Development

```bash
git clone git@github.com:Wuxie233/micode.git ~/.micode
cd ~/.micode && bun install && bun run build
```

```json
// Use local path
{ "plugin": ["~/.micode"] }
```

For details on the local runtime path, the `bun run deploy:runtime` helper, and the release flow, see [docs/configuration.md](./docs/configuration.md).

## Inspiration

- [vtemian/micode](https://github.com/vtemian/micode) - Original MIT-licensed project foundation
- [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) - Plugin architecture
- [HumanLayer ACE-FCA](https://github.com/humanlayer/12-factor-agents) - Structured workflows
- [Factory.ai](https://factory.ai/blog/context-compression) - Structured compaction research

## Acknowledgments

This project was initially based on [vtemian/micode](https://github.com/vtemian/micode) (MIT License)
and has been substantially restructured. The original copyright and license text are preserved in
`LICENSES/upstream-micode-MIT.txt`.

## License Notices

See `LICENSES/` for upstream license preservation.
