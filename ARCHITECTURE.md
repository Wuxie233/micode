# Architecture

## Overview

`micode` is a TypeScript OpenCode plugin that installs a structured Brainstorm -> Plan -> Implement workflow, project-aware hooks, agent tooling, browser brainstorming, and searchable session artifacts. This fork adds domain-routed implementers (`implementer-frontend`, `implementer-backend`, `implementer-general`) and frozen API contract documents for cross-domain plans.

Primary runtime entry point: `src/index.ts`. Package entry points: `package.json` `module` and `main` point to `dist/index.js`, built from `src/index.ts`.

## Tech Stack

| Area | Files | Notes |
| --- | --- | --- |
| Runtime | `package.json`, `src/index.ts` | Bun target, ESM package, OpenCode plugin export |
| Language | `tsconfig.json` | Strict TypeScript, `@/*` path alias, `bun-types` |
| Plugin APIs | `@opencode-ai/plugin`, `@opencode-ai/plugin/tool` | Plugin lifecycle and tool definitions |
| Validation | `valibot`, `jsonc-parser`, `yaml` | Runtime schemas for config, tool input, WebSocket messages, mindmodel |
| Persistence | `bun:sqlite`, filesystem | Artifact FTS index and JSON brainstorm state |
| Browser UI | `src/octto/`, `src/tools/octto/` | Bun HTTP and WebSocket server for Octto sessions |
| External CLIs | `src/tools/ast-grep/`, `src/tools/btca/`, `src/tools/pty/` | `sg`, `btca`, optional `bun-pty` |
| Quality | `biome.json`, `eslint.config.js`, `lefthook.yml` | Biome formatting, ESLint complexity and type rules, pre-commit hooks |
| Tests | `tests/`, `package.json` | Bun native test runner |

## Directory Structure

```text
.
├── src/
│   ├── index.ts                  # Plugin composition, commands, hooks, tool registry
│   ├── agents/                   # AgentConfig objects and prompt registries
│   │   └── mindmodel/            # Agents that generate and review .mindmodel constraints
│   ├── hooks/                    # OpenCode lifecycle hook factories
│   ├── tools/                    # OpenCode tool definitions and tool factories
│   │   ├── octto/                # Tool wrappers for browser questions and brainstorm sessions
│   │   ├── pty/                  # Long-running terminal session tools
│   │   ├── ast-grep/             # AST-aware search and replace via sg
│   │   ├── btca/                 # Library source-code question tool
│   │   └── artifact-index/       # SQLite-backed search index
│   ├── octto/                    # Browser session, WebSocket, state, and UI bundle internals
│   │   ├── session/              # Question lifecycle and Bun WebSocket server
│   │   ├── state/                # Brainstorm branch state and JSON persistence
│   │   └── ui/                   # HTML bundle for the browser UI
│   ├── mindmodel/                # Loader, formatter, classifier, and review parser
│   ├── indexing/                 # Milestone artifact classification and ingestion
│   └── utils/                    # Shared config, logger, errors, model limits
├── tests/                        # Mirrors src modules with Bun tests
├── .mindmodel/                   # Project constraints and examples injected or queried by agents
├── thoughts/                     # Designs, plans, ledgers, and long-lived artifacts
├── .github/workflows/            # Quality gate and release workflows
└── dist/                         # Build output from bun build
```

## Core Components

### Plugin composition

- `src/index.ts` exports `OpenCodeConfigPlugin`.
- Startup checks optional external tools with `checkAstGrepAvailable()` and `checkBtcaAvailable()`.
- It creates hook instances, PTY manager, `spawn_agent`, `batch_read`, Octto sessions, and tool registries.
- The `config` hook mutates OpenCode config to install permissions, MCP servers, slash commands, and micode agents.

### Agent registry

- `src/agents/index.ts` exports `agents`, `primaryAgent`, and `PRIMARY_AGENT_NAME`.
- `commander` is the primary orchestrator from `src/agents/commander.ts`.
- `brainstormer` and `octto` produce design artifacts.
- `planner` writes micro-task plans with `Domain` tags and optional contract files.
- `executor` dispatches tasks to domain implementers, then runs reviewer passes.
- Mindmodel agents under `src/agents/mindmodel/` generate and review project constraints.

### Workflow agents

| Agent | File | Responsibility |
| --- | --- | --- |
| `commander` | `src/agents/commander.ts` | Primary workflow decision maker |
| `brainstormer` | `src/agents/brainstormer.ts` | Text design exploration and design document creation |
| `octto` | `src/agents/octto.ts` | Browser-assisted design exploration |
| `planner` | `src/agents/planner.ts` | Exact micro-task plans with dependency batches |
| `executor` | `src/agents/executor.ts` | Batch-first implementer and reviewer orchestration |
| `implementer-frontend` | `src/agents/implementer-frontend.ts` | UI, styling, browser-facing work |
| `implementer-backend` | `src/agents/implementer-backend.ts` | APIs, data layer, server-side work |
| `implementer-general` | `src/agents/implementer-general.ts` | Config, tooling, shared types, cross-cutting files |
| `reviewer` | `src/agents/reviewer.ts` | Read-only review of one micro-task |
| `ledger-creator` | `src/agents/ledger-creator.ts` | Continuity ledger creation and updates |
| `artifact-searcher` | `src/agents/artifact-searcher.ts` | Search previous plans and ledgers |

### Hooks

`src/hooks/index.ts` re-exports all hook factories. `src/index.ts` wires them into OpenCode lifecycle callbacks.

| Hook | Files | Purpose |
| --- | --- | --- |
| Context injector | `src/hooks/context-injector.ts` | Injects `ARCHITECTURE.md`, `CODE_STYLE.md`, and directory context |
| Ledger loader | `src/hooks/ledger-loader.ts` | Injects latest `thoughts/ledgers/CONTINUITY_*.md` |
| Fragment injector | `src/hooks/fragment-injector.ts` | Prepends configured user fragments |
| Auto-compact | `src/hooks/auto-compact.ts` | Summarizes and writes ledger when context crosses threshold |
| Token truncation | `src/hooks/token-aware-truncation.ts` | Truncates large search-like tool output |
| Context monitor | `src/hooks/context-window-monitor.ts` | Tracks context usage and injects status |
| File ops tracker | `src/hooks/file-ops-tracker.ts` | Tracks reads and modifications per session |
| Fetch tracker | `src/hooks/fetch-tracker.ts` | Caches repeated fetch-like tool output and prevents loops |
| Artifact auto-index | `src/hooks/artifact-auto-index.ts` | Indexes written plan and ledger artifacts |
| Mindmodel injector | `src/hooks/mindmodel-injector.ts` | Optional task-aware `.mindmodel/` prompt injection |
| Constraint reviewer | `src/hooks/constraint-reviewer.ts` | Reviews generated code against `.mindmodel/` constraints |
| Session recovery | `src/hooks/session-recovery.ts` | Attempts recovery for recoverable session errors |

### Tools

- `src/tools/index.ts` is the tool barrel.
- Static tools include `artifact_search`, `milestone_artifact_search`, `look_at`, `ast_grep_search`, `ast_grep_replace`, and `btca_ask`.
- Context-bound factories include `createSpawnAgentTool(ctx)`, `createBatchReadTool(ctx)`, and `createMindmodelLookupTool(ctx)`.
- Manager and store factories include `createPtyTools(manager)` and `createOcttoTools(sessions, client, tracker)`.

### Octto browser brainstorming

- `src/tools/octto/index.ts` combines session, question, response, push, and brainstorm tools.
- `src/octto/session/sessions.ts` owns browser sessions, question maps, answer waiters, and WebSocket state.
- `src/octto/session/server.ts` serves the browser UI and validates WebSocket messages with Valibot.
- `src/octto/state/store.ts` records branch questions, answers, and findings.
- `src/octto/state/persistence.ts` saves brainstorm state JSON files under the configured state directory.
- `src/tools/octto/processor.ts` runs the `probe` agent to continue or complete branch exploration.

### Mindmodel and constraint system

- `.mindmodel/manifest.yaml` lists constraint categories.
- `src/mindmodel/loader.ts` loads the manifest and examples.
- `src/tools/mindmodel-lookup.ts` exposes relevant patterns to agents.
- `src/hooks/mindmodel-injector.ts` can inject system and example context when `features.mindmodelInjection` is enabled.
- `src/hooks/constraint-reviewer.ts` can review `Write` and `Edit` outputs through `mm-constraint-reviewer`.

### Artifact indexing

- `src/hooks/artifact-auto-index.ts` detects writes to `thoughts/ledgers/` and `thoughts/shared/plans/`.
- `src/tools/artifact-index/index.ts` maintains SQLite tables and FTS5 virtual tables for plans, ledgers, and milestone artifacts.
- `src/tools/artifact-search.ts` searches plans and ledgers.
- `src/tools/milestone-artifact-search.ts` searches milestone artifacts.
- `src/indexing/milestone-artifact-ingest.ts` classifies and indexes milestone artifacts.

## Data Flow

### Plugin startup and registration

1. OpenCode loads `dist/index.js`, built from `src/index.ts`.
2. `OpenCodeConfigPlugin(ctx)` checks optional CLIs and loads user config.
3. Hook factories and tool factories are constructed with `ctx` or shared stores.
4. `config` handler installs commands, agents, MCP servers, and broad tool permissions.
5. Runtime callbacks handle chat messages, chat params, tool output, transforms, compaction, and session events.

### User workflow

1. User invokes the primary `commander`, or slash commands such as `/init`, `/ledger`, `/search`, and `/mindmodel`.
2. `brainstormer` or `octto` creates a design in `thoughts/shared/designs/`.
3. `planner` reads the design and writes `thoughts/shared/plans/YYYY-MM-DD-topic.md`.
4. If a plan has both frontend and backend tasks, `planner` also writes `thoughts/shared/plans/YYYY-MM-DD-topic-contract.md`.
5. `executor` parses task batches and `Domain` tags, then spawns domain implementers in parallel.
6. `reviewer` checks each micro-task, including contract conformance when a contract path exists.
7. Ledgers and auto-compaction preserve state in `thoughts/ledgers/`.

### Tool execution flow

1. Agents call tools from `src/index.ts` `tool` registry.
2. Tool output flows through token truncation, comment checking, context injection, artifact indexing, file tracking, fetch tracking, and constraint review.
3. Session deletion cleans think-mode state, PTY sessions, Octto sessions, fetch state, and constraint-review state.

## External Integrations

| Integration | Files | Behavior |
| --- | --- | --- |
| OpenCode plugin API | `src/index.ts` | Lifecycle hooks, config mutation, tool registry |
| OpenCode session API | `src/tools/spawn-agent.ts`, `src/tools/octto/processor.ts`, `src/index.ts` | Temporary subagent, probe, and constraint-review sessions |
| Context7 MCP | `src/index.ts` | Always registered via `npx -y @upstash/context7-mcp@latest` |
| Perplexity MCP | `src/index.ts` | Registered only when `PERPLEXITY_API_KEY` exists |
| Firecrawl MCP | `src/index.ts` | Registered only when `FIRECRAWL_API_KEY` exists |
| ast-grep CLI | `src/tools/ast-grep/index.ts` | Runs `sg` for AST search and replacement |
| btca CLI | `src/tools/btca/index.ts` | Runs `btca ask` for library source questions |
| bun-pty | `src/tools/pty/` | Optional PTY support for background commands |
| Browser opener | `src/octto/session/browser.ts` | Opens the Octto UI with platform-specific commands |
| SQLite | `src/tools/artifact-index/index.ts` | Local FTS index under OpenCode config directory |

## Configuration

| Config | Files | Purpose |
| --- | --- | --- |
| Package scripts | `package.json` | Build, test, format, lint, check, clean |
| TypeScript | `tsconfig.json`, `tsconfig.eslint.json` | Strict checking and ESLint project config |
| Biome | `biome.json` | Formatting, import organization, default-export restrictions |
| ESLint | `eslint.config.js` | Type rules, complexity limits, no business classes, no `any` |
| Hooks | `lefthook.yml` | Pre-commit Biome and ESLint fixes on staged files |
| CI | `.github/workflows/quality-gate.yml`, `.github/workflows/release.yml` | Pull request checks and release flow |
| User config example | `micode.example.jsonc` | Agent model overrides, feature flags, fragments, compaction threshold |
| Runtime config loader | `src/config-loader.ts`, `src/config-schemas.ts` | Loads `micode.json/jsonc` and `opencode.json/jsonc` |
| Shared tunables | `src/utils/config.ts` | Paths, limits, Octto timings, thinking budget |

Model resolution order is documented in `README.md`: per-agent `micode.json` override, then default `opencode.json` model, then plugin fallback.

## Build, Test, and Deploy

| Command | Source | Purpose |
| --- | --- | --- |
| `bun run build` | `package.json` | Builds `src/index.ts` to `dist/` targeting Bun |
| `bun run typecheck` | `package.json` | Runs `tsc --noEmit` |
| `bun test` | `package.json` | Runs all Bun tests under `tests/` |
| `bun run lint` | `package.json` | Runs Biome lint and ESLint |
| `bun run format` | `package.json` | Formats with Biome |
| `bun run check` | `package.json` | Full gate: Biome check, ESLint, typecheck, tests |
| `npm version patch` | `README.md` | Release version bump before pushing tags |

Local development plugin usage is described in `README.md`: clone, `bun install`, `bun run build`, then point OpenCode plugin config at the local path.
