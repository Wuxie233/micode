# Micode — System Overview

## What This Project Is

**micode** is an OpenCode plugin (TypeScript/Bun, published as an npm package) that adds a structured
Brainstorm → Plan → Implement workflow on top of OpenCode's native agent system.
It is a **service-shaped plugin**: a WebSocket/HTTP server (Octto UI), a CLI orchestrator,
and a collection of modular AI agents and tools, all loaded as a single `OpenCodeConfigPlugin`.

## Core Workflow

```
Brainstorm (brainstormer / octto)
  → Design doc in thoughts/shared/designs/
  → Plan (planner) with Domain-tagged micro-tasks + optional frozen API contract
  → Execute (executor) dispatches per Domain to specialist implementers running in parallel
  → Review (reviewer) per micro-task; lifecycle_commit per checkpoint
  → lifecycle_finish → merge + close issue
```

## Agent Taxonomy

| Layer | Agents |
|---|---|
| Primary / coordinator | commander, brainstormer, octto |
| Orchestrators | planner, executor |
| Domain implementers | implementer-frontend-ui, implementer-frontend-code, implementer-backend, implementer-general |
| Specialist reviewers | reviewer |
| Analysis / discovery | codebase-locator, codebase-analyzer, pattern-finder, critic, various -inspector/pm agents |
| Utility | ledger-creator, artifact-searcher, mm-orchestrator |

## Knowledge Layers

- **Atlas** (`atlas/`) — shared human+AI mental model of project structure (Obsidian vault, markdown)
- **Project Memory** (SQLite) — historical decisions, lessons, risks, open questions
- **Mindmodel** (`.mindmodel/`) — **this directory**: code-style constraints, patterns, HOW to write code
- **thoughts/** — raw artifacts (designs, plans, ledgers); not indexed for long-term memory

## Key Technology Decisions

- Runtime: **Bun** (test, build, SQLite, PTY, shell `$`)
- Language: **TypeScript strict**, ESM, ES2022
- Validation: **Valibot** (not Zod) — `v.safeParse` for tolerant, `v.parse` for strict
- Linting: **Biome** (formatter + basic lint) + ESLint (sonarjs/unicorn/typescript-eslint)
- Entry: `src/index.ts` → `dist/index.js` via `bun build`
- All imports use `@/*` aliases; parent-relative `../` imports are forbidden

## Mindmodel Categories

| Group | File | Purpose |
|---|---|---|
| stack | stack/backend.md | Bun runtime, build, external CLIs |
| stack | stack/database.md | Bun SQLite + filesystem JSON persistence |
| stack | stack/dependencies.md | Approved library list and import constraints |
| style | style/imports.md | Import aliases, ordering, type-only imports |
| style | style/naming.md | File, function, variable, constant naming |
| style | style/types.md | TypeScript strictness, Valibot, readonly |
| patterns | patterns/error-handling.md | extractErrorMessage, catch unknown, no stack leaks |
| patterns | patterns/logging.md | log.info/warn/error with module prefix |
| patterns | patterns/validation.md | Valibot schemas at boundaries |
| patterns | patterns/testing.md | Bun test, BDD, drift guard tests |
| patterns | patterns/tool-formatting.md | Tool factory, formatted markdown return |
| architecture | architecture/layers.md | Plugin layers: hooks, tools, agents, lifecycle |
| architecture | architecture/organization.md | Directory layout, file conventions |
| architecture | architecture/coupling-reuse.md | Low coupling, reuse, no business classes |
| domain | domain/concepts.md | Workflow vocabulary: Domain, Batch, Contract, etc. |
| ops | ops/database.md | SQLite store pattern, FTS, project memory |
| components | components/shared.md | Protocol constants, hook factories, config pattern |
