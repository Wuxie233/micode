# micode (Wuxie233 fork)

> Fork of [vtemian/micode](https://github.com/vtemian/micode) adding **domain-routed implementers** and **auto-generated API contracts** for the cross-domain plan case.
>
> What this fork changes:
> - `implementer` is split into `implementer-frontend` / `implementer-backend` / `implementer-general`, so each can run on a model that is strong in that domain (frontend-strong model for UI, backend-strong model for APIs, etc).
> - `planner` tags every task with a `Domain` field, and when a plan spans both frontend and backend it emits a frozen API contract document the concurrent implementers must conform to.
> - `executor` dispatches each task to the matching specialist implementer and injects the contract path into implementer and reviewer spawn prompts.
>
> Everything else (brainstormer, octto, mindmodel, ledger, hooks, tools) is unchanged from upstream.

OpenCode plugin with structured Brainstorm → Plan → Implement workflow and session continuity.

https://github.com/user-attachments/assets/85236ad3-e78a-4ff7-a840-620f6ea2f512

## Quick Start

Add to `~/.config/opencode/opencode.json`:

```json
{ "plugin": ["github:Wuxie233/micode"] }
```

Copy [`micode.example.jsonc`](./micode.example.jsonc) to `~/.config/opencode/micode.jsonc` and replace the placeholders with your real model strings (this repo ships no concrete provider or model names).

Then run `/init` to generate `ARCHITECTURE.md` and `CODE_STYLE.md`.

## Workflow

```
Brainstorm → Plan → Implement
     ↓         ↓        ↓
  research  research  executor
```

### Brainstorm
Refine ideas into designs through collaborative questioning. Two entry points: `brainstormer` (text-based) and `octto` (browser UI with 16 question types, bundled). Fires research subagents in parallel. Output: `thoughts/shared/designs/YYYY-MM-DD-{topic}-design.md`

### Plan
Transform designs into implementation plans with bite-sized tasks (2-5 min each), exact file paths, and TDD workflow. Every task is tagged with a `Domain` (frontend, backend, or general). When the plan spans both frontend and backend tasks, the planner additionally emits a **frozen API contract document** that concurrent implementers must conform to. Outputs:
- `thoughts/shared/plans/YYYY-MM-DD-{topic}.md`
- `thoughts/shared/plans/YYYY-MM-DD-{topic}-contract.md` (cross-domain plans only)

### Implement
Execute in git worktree for isolation. The **Executor** reads each task's `Domain` and dispatches to the matching specialist implementer (`implementer-frontend`, `implementer-backend`, or `implementer-general`), injecting the contract path into every implementer and reviewer spawn prompt. Runs implementer → reviewer cycles with parallel execution via fire-and-check pattern. Implementers that detect a contract mismatch escalate; they do not edit the contract.

### Session Continuity
Maintain context across sessions with structured compaction. Run `/ledger` to create/update `thoughts/ledgers/CONTINUITY_{session}.md`.

## Commands

| Command | Description |
|---------|-------------|
| `/init` | Initialize project docs |
| `/ledger` | Create/update continuity ledger |
| `/search` | Search past plans and ledgers |

## Agents

| Agent | Purpose |
|-------|---------|
| commander | Orchestrator |
| brainstormer | Design exploration (text) |
| octto | Design exploration (browser UI with 16 question types) |
| planner | Implementation plans with Domain tags and optional API contracts |
| executor | Dispatches by Domain, orchestrates implement→review cycles |
| **implementer-frontend** | Executes frontend tasks (React/Vue/Svelte, CSS, UI) |
| **implementer-backend** | Executes backend tasks (APIs, DB, middleware, services) |
| **implementer-general** | Executes cross-cutting tasks (configs, shared types, scripts) |
| reviewer | Check correctness, verify contract conformance |
| codebase-locator | Find file locations |
| codebase-analyzer | Deep code analysis |
| pattern-finder | Find existing patterns |
| project-initializer | Generate project docs |
| ledger-creator | Continuity ledgers |
| artifact-searcher | Search past work |

## Tools

| Tool | Description |
|------|-------------|
| `ast_grep_search` | AST-aware code pattern search |
| `ast_grep_replace` | AST-aware code pattern replacement |
| `look_at` | Extract file structure |
| `artifact_search` | Search past plans/ledgers |
| `btca_ask` | Query library source code |
| `pty_spawn` | Start background terminal session |
| `pty_write` | Send input to PTY |
| `pty_read` | Read PTY output |
| `pty_list` | List PTY sessions |
| `pty_kill` | Terminate PTY |

## Hooks

- **Think Mode** - Keywords like "think hard" enable 128k token thinking budget
- **Ledger Loader** - Injects continuity ledger into system prompt
- **Auto-Compact** - At 50% context usage, automatically summarizes session to reduce context
- **File Ops Tracker** - Tracks read/write/edit for deterministic logging
- **Artifact Auto-Index** - Indexes artifacts in thoughts/ directories
- **Context Injector** - Injects ARCHITECTURE.md, CODE_STYLE.md
- **Token-Aware Truncation** - Truncates large tool outputs

## Configuration

### Model Configuration

micode reads your default model from `opencode.json`:

```json
{
  "model": "github-copilot/gpt-5-mini",
  "plugin": ["micode"]
}
```

All micode agents will use this model automatically.

### micode.json (domain routing)

This fork's main value is routing each agent to a model that fits its role. Copy [`micode.example.jsonc`](./micode.example.jsonc) to `~/.config/opencode/micode.jsonc` and fill in the three placeholder types:

```jsonc
{
  "agents": {
    // Orchestration and review (strong reasoning model)
    "commander":   { "model": "<YOUR_STRONG_REASONING_MODEL>" },
    "planner":     { "model": "<YOUR_STRONG_REASONING_MODEL>" },
    "executor":    { "model": "<YOUR_STRONG_REASONING_MODEL>" },
    "reviewer":    { "model": "<YOUR_STRONG_REASONING_MODEL>" },

    // Brainstorm entry points (primary-mode, user picks per session)
    "brainstormer": { "model": "<YOUR_STRONG_REASONING_MODEL>" },
    "octto":        { "model": "<YOUR_STRONG_REASONING_MODEL>" },

    // Domain specialists
    "implementer-frontend": { "model": "<YOUR_FRONTEND_MODEL>" },
    "implementer-backend":  { "model": "<YOUR_BACKEND_MODEL>" },
    "implementer-general":  { "model": "<YOUR_BACKEND_MODEL>" }
  }
}
```

The repo ships no concrete provider or model names. Fill in what your gateway supports. The example file documents each placeholder and all optional top-level keys (features, fragments, compactionThreshold).

> **Note:** Both `.json` and `.jsonc` formats are supported. JSONC allows comments and trailing commas.

#### Options

| Option | Type | Description |
|--------|------|-------------|
| `agents` | object | Per-agent overrides (model, temperature, maxTokens, thinking) |
| `features.mindmodelInjection` | boolean | Enable mindmodel context injection |
| `compactionThreshold` | number | Context usage threshold (0-1) for auto-compaction. Default: 0.5 |
| `fragments` | object | Additional prompt fragments per agent |

#### Model Resolution Priority

1. Per-agent override in `micode.json` (highest)
2. Default model from `opencode.json` `"model"` field
3. Plugin default (fallback)

#### Model Syntax

Models use `provider/model` format. The provider must match exactly what's in your `opencode.json`:

```json
{
  "provider": {
    "github-copilot": {
      "models": { "gpt-5-mini": {} }
    }
  }
}
```

Use `"model": "github-copilot/gpt-5-mini"` (not `github/copilot:gpt-5-mini`).

#### LLM-Controlled Spawn Model Overrides

The assistant can choose a model for an individual spawned subagent by passing `model` to `spawn_agent`. This is not an automatic chat parser and does not rewrite config. The LLM reads your instruction, then sets the optional tool parameter when it delegates work.

For example, if you say:

```text
接下来一段时间原来 opus 的模型用 gpt5.5 替代
```

the calling agent should include the replacement model on future relevant `spawn_agent` calls:

```jsonc
{ "agents": [{ "agent": "reviewer", "prompt": "...", "description": "Review", "model": "openai/gpt-5.5" }] }
```

micode validates explicit `provider/model` values and can resolve unambiguous aliases against configured models, for example `gpt5.5` to `openai/gpt-5.5`.

Primary-agent escape hatch: among primary agents, `brainstormer` is the only one allowed to choose `spawn_agent` for model overrides. It may do so only when the user's message includes a concrete model literal token such as `claude`, `opus`, `sonnet`, `gpt`, or `gemini`; otherwise primary agents should use Task. `octto` currently stays at its upstream default, `spawn_agent` is not explicitly disabled there, and separate follow-up evaluation is needed before changing that behavior. See `thoughts/shared/designs/2026-04-27-primary-agent-model-override-escape-hatch-design.md`. Sunset: when OpenCode Task adds a `model` parameter, this escape hatch should be removed immediately.

## Development

```bash
git clone git@github.com:Wuxie233/micode.git ~/.micode
cd ~/.micode && bun install && bun run build
```

```json
// Use local path
{ "plugin": ["~/.micode"] }
```

### Local runtime path note

On this server, `~/.config/opencode/opencode.json` loads the live plugin from `/root/.micode`.
The `/root/CODE/micode` checkout is a separate working copy used for development.
Because `package.json` points `main` and `module` at `dist/index.js`, runtime fixes must be copied or pulled into `/root/.micode` and rebuilt with `bun run build` before restarting OpenCode.

Changing files under `/root/CODE/micode/src` alone will not affect live tools such as `create_brainstorm`.
When debugging a "fix did not load" issue, check both the configured plugin path and the generated `/root/.micode/dist/index.js` bundle first.

## Runtime deploy helper

When you change runtime-sensitive plugin code in `/root/CODE/micode`, the live OpenCode plugin at `/root/.micode` does not pick it up automatically. Use the helper:

```sh
# Preview what would change
bun run deploy:runtime -- --dry-run

# Sync, install (if needed), build, and verify the live bundle
bun run deploy:runtime
```

The helper does NOT restart OpenCode. After it prints `Runtime ready. Restart of OpenCode requires explicit user approval.`, ask the user before running any restart command.

The helper preserves runtime-local state in `/root/.micode`: `node_modules`, `dist` (rebuilt by the helper), `.git`, `thoughts`, and environment files are never overwritten by the sync.

### Syncing with upstream

This fork tracks `vtemian/micode` as the `upstream` remote. To pull upstream changes:

```bash
git fetch upstream
git rebase upstream/main
bun run check          # verify the rebase did not break anything
git push origin main --force-with-lease
```

The fork's changes are isolated to new files (`src/agents/implementer-{frontend,backend,general}.ts`, four new test files, `micode.example.jsonc`) plus prompt edits in `planner.ts`, `executor.ts`, and registry updates in `agents/index.ts`, so rebase conflicts are limited in scope.

### Release

```bash
npm version patch  # or minor, major
git push --follow-tags
```

## Philosophy

1. **Brainstorm first** - Refine ideas before coding
2. **Research before implementing** - Understand the codebase
3. **Plan with human buy-in** - Get approval before coding
4. **Parallel investigation** - Spawn multiple subagents
5. **Isolated implementation** - Use git worktrees
6. **Continuous verification** - Implementer + Reviewer per task
7. **Session continuity** - Never lose context

## micode vs oh-my-opencode

Both are OpenCode plugins, but with different philosophies:

| Aspect | micode | oh-my-opencode |
|--------|--------|----------------|
| **Philosophy** | Opinionated workflow (brainstorm→plan→implement) | Batteries-included framework |
| **Agent Design** | Role-based (Brainstormer, Planner, Executor) | Greek mythology theme (Sisyphus, Atlas, Prometheus) |
| **Parallelism** | Batch-first: 10-20 concurrent micro-tasks (2-5 min each) | Background tasks with tmux visual monitoring |
| **Code Guidance** | Mindmodel system with project-specific patterns | Comment checker, keyword modes (ultrawork) |
| **Context Recovery** | Ledger system (CONTINUITY files) | AGENTS.md hierarchy, preemptive compaction |
| **Workflow** | TDD-enforced with adaptation over escalation | Category-based delegation (visual-engineering, ultrabrain) |
| **Configuration** | Focused options | Extensive (34 hooks, 11 agents, fallback chains) |

### When to Choose micode

- You want a **structured brainstorm→plan→implement workflow**
- You prefer **TDD-driven implementation** with test-first development
- You need **project-specific pattern enforcement** via mindmodel
- You want **high parallelism on granular tasks** (10-20 concurrent micro-tasks)
- You value **session continuity** via structured ledgers

### When to Choose oh-my-opencode

- You want **maximum flexibility** and configuration options
- You prefer **keyword-driven modes** (e.g., "ultrawork", "analyze")
- You need **extensive model fallback chains** with subscription detection
- You like **category-based task delegation** (visual-engineering, infrastructure)
- You want **visual monitoring** via tmux integration

## Octto Configuration

Octto runs a single shared HTTP server per OpenCode plugin process. Sessions are exposed on session-scoped URLs.

Each Octto session belongs to the OpenCode conversation that created it. Tool calls from another conversation return `## Forbidden` and do not modify session state.

| Env var | Default | Effect |
|---------|---------|--------|
| `OCTTO_PORT` | `0` (Bun chooses a free port) | Port the shared Octto server binds to. |
| `OCTTO_PUBLIC_BASE_URL` | unset | URL prefix returned to agents when behind a reverse proxy. Trailing `/` is stripped. Example: `https://octto.wuxie233.com`. |

Public reverse proxies must route each session page at `<base>/s/<sessionId>` and its WebSocket at `<base>/ws/<sessionId>`. Browsers on HTTPS use `wss://` for the WebSocket automatically.

The browser UI uses draft-before-send: clicking a question's Submit stores a local draft. The answer is sent to the agent only when you click `Send N answer(s)`, and each draft can be changed with `Edit` before sending.

## Inspiration

- [oh-my-opencode](https://github.com/code-yeongyu/oh-my-opencode) - Plugin architecture
- [HumanLayer ACE-FCA](https://github.com/humanlayer/12-factor-agents) - Structured workflows
- [Factory.ai](https://factory.ai/blog/context-compression) - Structured compaction research
