# Configuration Reference

Complete configuration reference for micode. The top-level [README.md](../README.md) keeps only a short stub and links here.

## 1. Model Configuration

micode reads your default model from `opencode.json`:

```json
{
  "model": "github-copilot/gpt-5-mini",
  "plugin": ["micode"]
}
```

All micode agents will use this model automatically unless overridden in `micode.json` / `micode.jsonc`.

## 2. micode.jsonc Field Reference

This project's main value is routing each agent to a model that fits its role. Copy [`micode.example.jsonc`](../micode.example.jsonc) to `~/.config/opencode/micode.jsonc` and fill in the placeholder model names:

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
    "implementer-frontend-ui":   { "model": "<YOUR_FRONTEND_UI_MODEL>" },
    "implementer-frontend-code": { "model": "<YOUR_FRONTEND_CODE_MODEL>" },
    "implementer-backend":       { "model": "<YOUR_BACKEND_MODEL>" },
    "implementer-general":       { "model": "<YOUR_BACKEND_MODEL>" },

    // Diagnostic and direct-execution
    "investigator":     { "model": "<YOUR_DIAGNOSTIC_MODEL>" },
    "executor-direct":  { "model": "<YOUR_DIRECT_EXEC_MODEL>" }
  }
}
```

The repo ships no concrete provider or model names. Fill in what your gateway supports. The example file documents each placeholder and all optional top-level keys (`features`, `fragments`, `compactionThreshold`).

### Options

| Option | Type | Description |
|---|---|---|
| `agents` | object | Per-agent overrides (`model`, `temperature`, `maxTokens`, `thinking`) |
| `features.mindmodelInjection` | boolean | Enable mindmodel context injection |
| `features.conversationTitleChatFallback` | boolean | Re-enable the legacy chat-message title fallback (off by default in v9) |
| `compactionThreshold` | number | Context usage threshold (0-1) for auto-compaction. Default: `0.5` |
| `fragments` | object | Additional prompt fragments per agent |

### Model Resolution Priority

1. Per-agent override in `micode.json` / `micode.jsonc` (highest)
2. Default model from `opencode.json` `"model"` field
3. Plugin default (fallback, from `src/utils/config.ts:DEFAULT_MODEL`)

### Model Syntax

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

### File Formats

Both `.json` and `.jsonc` are supported. JSONC allows comments and trailing commas. If both `~/.config/opencode/micode.json` and `~/.config/opencode/micode.jsonc` exist, the loader will read both; prefer using only one to avoid surprises.

## 3. LLM-Controlled Spawn Model Overrides

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

**Primary-agent escape hatch.** Among primary agents, `brainstormer` is the only one allowed to choose `spawn_agent` for model overrides. It may do so only when the user's message includes a concrete model literal token such as `claude`, `opus`, `sonnet`, `gpt`, or `gemini`; otherwise primary agents should use Task. `octto` currently stays at its configured default, `spawn_agent` is not explicitly disabled there, and separate follow-up evaluation is needed before changing that behavior. See `thoughts/shared/designs/2026-04-27-primary-agent-model-override-escape-hatch-design.md`.

**Sunset.** When OpenCode Task adds a `model` parameter, this escape hatch should be removed immediately.

## 4. Environment Variables

| Var | Default | Purpose |
|---|---|---|
| `OCTTO_PORT` | `0` (Bun chooses a free port) | Port the shared Octto HTTP server binds to |
| `OCTTO_PUBLIC_BASE_URL` | unset | URL prefix returned to agents when behind a reverse proxy; trailing `/` is stripped |
| `PERPLEXITY_API_KEY` | unset | Enables Perplexity MCP server registration |
| `FIRECRAWL_API_KEY` | unset | Enables Firecrawl MCP server registration |

Public reverse proxies must route each session page at `<base>/s/<sessionId>` and its WebSocket at `<base>/ws/<sessionId>`. Browsers on HTTPS use `wss://` for the WebSocket automatically.

## 5. Runtime Deploy Helper

When you change runtime-sensitive plugin code in `/root/CODE/micode`, the live OpenCode plugin at `/root/.micode` does not pick it up automatically. Use the helper:

```sh
# Preview what would change
bun run deploy:runtime -- --dry-run

# Sync, install (if needed), build, and verify the live bundle
bun run deploy:runtime
```

The helper performs preflight checks (clean source, clean runtime, required tools), an `rsync` with the runtime-local exclusion list, `bun install --frozen-lockfile` when the lockfile changed, `bun run build`, and a sanity check on `/root/.micode/dist/index.js`.

The helper does NOT restart OpenCode. After it prints `Runtime ready. Restart of OpenCode requires explicit user approval.`, ask the user before running any restart command.

The helper preserves runtime-local state in `/root/.micode`: `node_modules`, `dist` (rebuilt by the helper), `.git`, `thoughts`, and environment files are never overwritten by the sync.

See `docs/runtime-deploy.md` for the full operational rule when present in the repo.

## 6. Local Plugin Path Development

```bash
git clone git@github.com:Wuxie233/micode.git ~/.micode
cd ~/.micode && bun install && bun run build
```

```json
// ~/.config/opencode/opencode.json
{ "plugin": ["~/.micode"] }
```

On this server, `~/.config/opencode/opencode.json` loads the live plugin from `/root/.micode`. The `/root/CODE/micode` checkout is a separate working copy used for development.

Because `package.json` points `main` and `module` at `dist/index.js`, runtime fixes must be copied or pulled into `/root/.micode` and rebuilt with `bun run build` before restarting OpenCode.

Changing files under `/root/CODE/micode/src` alone will not affect live tools such as `create_brainstorm`. When debugging a "fix did not load" issue, check both the configured plugin path and the generated `/root/.micode/dist/index.js` bundle first.

The simplest workflow is: develop in `/root/CODE/micode`, run `bun run deploy:runtime` to sync into `/root/.micode`, then ask the user before any OpenCode restart.

## 7. Release Flow

```bash
npm version patch  # or minor, major
git push --follow-tags
```

`npm version patch` updates `package.json` and creates a git tag. `git push --follow-tags` publishes both the commit and the tag. The release workflow under `.github/workflows/release.yml` takes over from there.
