# OpenCode Question Support Restoration: File Map

## Summary
This document maps all files involved in OpenCode's `question` support infrastructure (octto tools, brainstorming, question-type tools, and cross-layer gating). No mutations applied.

---

## Core Config & Entry Points

### OpenCode Config Layer
- `/root/.config/opencode/opencode.json` — **Entry point**: loads micode plugin via `"plugin": ["github:Wuxie233/micode"]` or local path
- `/root/.config/opencode/plugins/askquestion_bridge.js` — **Bridge plugin** (377 lines): RPC bridge to `autoinfo-mcp` for remote question routing; exposes `createAskQuestionBridgeHooks()` with `handleQuestionAsked`, `handleQuestionResolution`, remote ask dispatch

### Micode Plugin Entry
- `/root/CODE/micode/src/index.ts` (1243 lines) — **Main plugin export**
  - Line 345–369: `createAtlasOcttoAsker()` — wraps octto sessions for atlas cold-init questioning
  - Line 371–381: `buildColdInitDeps()` — packages askQuestions function
  - Line 955: `createOcttoTools()` instantiation
  - Line 996: `...octtoTools` exported in return block

---

## Tool Infrastructure

### Octto Tool Registration
- `/root/CODE/micode/src/tools/octto/index.ts` (27 lines) — **Factory**: `createOcttoTools()`
  - Combines 5 tool groups:
    - `createSessionTools()` — session lifecycle (start, end, list)
    - `createQuestionTools()` — question CRUD (push, get, update, answers)
    - `createResponseTools()` — response handling
    - `createPushQuestionTool()` — batch question push
    - `createBrainstormTools()` — brainstorm session creation

### Question Tool Types & Schema
- `/root/CODE/micode/src/tools/octto/questions.ts` — 16 question type tools:
  - `pick_one`, `pick_many`, `confirm`, `ask_text`, `ask_code`, `ask_image`, `ask_file`, `slider`, `rank`, `rate`, `thumbs`, `emoji_react`, `show_diff`, `show_plan`, `review_section`, `show_options`
  - Each tool has schema with `DESC_QUESTION = "Question to display"`

- `/root/CODE/micode/src/tools/octto/factory.ts` — `createPushQuestionTool()`: registers question type enum, question config schema
- `/root/CODE/micode/src/tools/octto/types.ts` — `OcttoTools` type definition
- `/root/CODE/micode/src/tools/octto/session.ts` — Session management, WebSocket message routing (`WS_MESSAGES.QUESTION`)
- `/root/CODE/micode/src/tools/octto/extractor.ts` — Answer extraction from responses
- `/root/CODE/micode/src/tools/octto/processor.ts` — Request/response processing
- `/root/CODE/micode/src/tools/octto/responses.ts` — Response tool creation
- `/root/CODE/micode/src/tools/octto/brainstorm.ts` — Brainstorm-specific session creation
- `/root/CODE/micode/src/tools/octto/formatters.ts` — Output formatting
- `/root/CODE/micode/src/tools/octto/utils.ts` — Utility functions
- `/root/CODE/micode/src/tools/octto/forbidden.ts` — Access control for cross-session tool calls

### Octto Session & WebSocket Server
- `/root/CODE/micode/src/octto/session/index.ts` — **Core session**: `createSessionStore()`
- `/root/CODE/micode/src/octto/session/types.ts` — `QUESTIONS`, `QUESTION_TYPES`, `WS_MESSAGES`, answer types
- `/root/CODE/micode/src/octto/session/sessions.ts` — Session state machine, question lifecycle (`QUESTION_PUSHED`, `QUESTION_ANSWERED`)
- `/root/CODE/micode/src/octto/session/server.ts` — HTTP/WebSocket server
- `/root/CODE/micode/src/octto/session/browser.ts` — Browser launcher
- `/root/CODE/micode/src/octto/session/waiter.ts` — Question answering waiter
- `/root/CODE/micode/src/octto/session/listeners.ts` — Session event listeners
- `/root/CODE/micode/src/octto/session/errors.ts` — Error types
- `/root/CODE/micode/src/octto/session/schemas.ts` — Zod schemas
- `/root/CODE/micode/src/octto/session/utils.ts` — Helpers

### Octto UI Bundle
- `/root/CODE/micode/src/octto/ui/index.ts` — Frontend entry
- `/root/CODE/micode/src/octto/ui/bundle.ts` — Bundled HTML/CSS/JS

### Octto Portal (Multi-Session)
- `/root/CODE/micode/src/octto/portal/landing.ts` — Portal landing page
- `/root/CODE/micode/src/octto/portal/conversations.ts` — Multi-session management
- `/root/CODE/micode/src/octto/portal/auth.ts` — Auth if needed
- `/root/CODE/micode/src/octto/portal/register.ts` — Portal registration

### Octto Auto-Resume (Session Recovery)
- `/root/CODE/micode/src/octto/auto-resume/dispatcher.ts` — Auto-dispatch on new message arrival
- `/root/CODE/micode/src/octto/auto-resume/registry.ts` — Session registry
- `/root/CODE/micode/src/octto/auto-resume/model-lookup.ts` — Model routing
- `/root/CODE/micode/src/octto/auto-resume/prompt.ts` — Continue prompt template
- `/root/CODE/micode/src/octto/auto-resume/scheduler.ts` — Scheduling

### Octto Persistence (State Survival)
- `/root/CODE/micode/src/octto/persistence/index.ts` — Persistence factory
- `/root/CODE/micode/src/octto/persistence/store.ts` — Persisted session store
- `/root/CODE/micode/src/octto/persistence/listener.ts` — Persistence event listener
- `/root/CODE/micode/src/octto/persistence/schemas.ts` — Persistence schemas
- `/root/CODE/micode/src/octto/persistence/reconcile.ts` — Session reconciliation on startup

### Octto State (In-Memory)
- `/root/CODE/micode/src/octto/state/store.ts` — In-memory state
- `/root/CODE/micode/src/octto/state/index.ts` — State factory
- `/root/CODE/micode/src/octto/state/persistence.ts` — Persistence integration
- `/root/CODE/micode/src/octto/state/schemas.ts` — Schemas
- `/root/CODE/micode/src/octto/state/types.ts` — Types

### Octto Constants
- `/root/CODE/micode/src/octto/constants.ts` — Configuration constants
- `/root/CODE/micode/src/octto/types.ts` — Top-level octto types

---

## Gating & Availability

### Atlas Cold-Init Question Gating
- `/root/CODE/micode/src/atlas/cold-init/orchestrator.ts` — **Key gating logic**:
  - Line 20: `askQuestions: ((batch: readonly ColdInitQuestion[]) => ... | null) | null` — nullable function
  - Line 42: `shouldAskQuestions()` — checks both `input.options.askQuestions && deps.askQuestions !== null`
  - Line 49: fallback to defaults if `deps.askQuestions === null`
  - Line 54: `await deps.askQuestions(questions)` — calls if non-null
  - Line 61: error handling, continues with defaults on failure

- `/root/CODE/micode/src/atlas/cold-init/octto-adapter.ts` — Octto adapter wrapping for cold-init
- `/root/CODE/micode/src/atlas/cold-init/config.ts` — Timeout constants
- `/root/CODE/micode/src/atlas/cold-init/questions.ts` — Question definitions, grouping logic
- `/root/CODE/micode/src/atlas/cold-init/types.ts` — Types (`options.askQuestions: boolean`)
- `/root/CODE/micode/src/atlas/cold-init/synthesize.ts` — Answer synthesis
- `/root/CODE/micode/src/atlas/cold-init/renderer.ts` — Rendering
- `/root/CODE/micode/src/atlas/cold-init/vault-writer.ts` — Vault write integration
- `/root/CODE/micode/src/atlas/cold-init/discover.ts` — Project discovery

### Tool Init Hook
- `/root/CODE/micode/src/tools/atlas/init.ts` — **Atlas init command entry**:
  - Line 30: `QUESTION_TIMEOUT_MS = 0`
  - Line 37: `askQuestions: null` — **default dependency is null**
  - Line 43: `deps.askQuestions ?? defaultDeps.askQuestions` — merge with override
  - Line 63: `options: { askQuestions: deps.askQuestions !== null, ... }` — gates based on non-null

- `/root/CODE/micode/src/tools/knowledge-bootstrap/questionnaire.ts` — Bootstrap questionnaire defaults when octto unavailable
- `/root/CODE/micode/src/tools/knowledge-bootstrap/index.ts` — Bootstrap tool
- `/root/CODE/micode/src/tools/knowledge-bootstrap/status.ts` — Status query
- `/root/CODE/micode/src/tools/knowledge-bootstrap/types.ts` — Types
- `/root/CODE/micode/src/tools/atlas/index.ts` — Tools export

---

## Agent & Prompt Integration

### Brainstorming Agents (Question Consumers)
- `/root/CODE/micode/src/agents/octto.ts` — Octto agent (browser-based design)
- `/root/CODE/micode/src/agents/brainstormer.ts` — Brainstormer agent (text-based design)
- `/root/CODE/micode/src/agents/knowledge-bootstrap-orchestrator.ts` — Knowledge bootstrap orchestrator

### Atlas Commands
- `/root/CODE/micode/src/atlas/commands.ts` — `/atlas-init`, `/atlas-status`, `/atlas-refresh` commands
- `/root/CODE/micode/src/index.ts` Line 389–417: `runAtlasCommand()` — command router

---

## Tests

### Question-Related Tests
- `/root/CODE/micode/tests/integration/octto-auto-resume.test.ts` — Auto-resume on question answered
- `/root/CODE/micode/tests/integration/octto-auto-resume-batching.test.ts` — Batched auto-resume
- `/root/CODE/micode/tests/integration/octto-portal.test.ts` — Multi-session portal
- `/root/CODE/micode/tests/integration/knowledge-bootstrap-orchestrator.test.ts` — Bootstrap orchestrator with questions
- `/root/CODE/micode/tests/index-all-commands-routing.test.ts` — Command routing (includes atlas commands)
- `/root/CODE/micode/tests/index-atlas-init-routing.test.ts` — Atlas init routing

---

## Deploy & Build

### Runtime Deploy Helper
- `/root/CODE/micode/scripts/deploy-runtime.ts` — **Sync, install, build, verify workflow**
  - Copies source → `/root/.micode`
  - Runs `bun install` if needed
  - Builds dist bundle
  - Verifies new bundle is callable

### Package Configuration
- `/root/CODE/micode/package.json` — Scripts: `deploy:runtime`
- `/root/CODE/micode/tsconfig.json` — TypeScript config

---

## Likely Edit Points (to Restore Question Support)

### 1. **Gating Re-enable** (highest impact)
   - `/root/CODE/micode/src/tools/atlas/init.ts:37`
     - Change `askQuestions: null` → `askQuestions: deps.askQuestions`
     - Or pass through the factory function when available

   - `/root/CODE/micode/src/index.ts:378`
     - Ensure `createAtlasOcttoAsker()` is called and passed to deps
     - Confirm `octtoSessionStore` is initialized first (lines 914–931)

### 2. **Tool Export Verification**
   - `/root/CODE/micode/src/index.ts:996`
     - Confirm `...octtoTools` is included in returned tool object
     - Verify no conditional gating wrapping octtoTools spread

### 3. **OcttoTools Factory Chain**
   - `/root/CODE/micode/src/tools/octto/index.ts:15–27`
     - Verify all 5 sub-factories are called
     - Check for any error handling that might suppress tools

### 4. **Octto Initialization**
   - `/root/CODE/micode/src/index.ts:914–955`
     - Sessions store (925)
     - Octto tools (955)
     - Tracker (937–953)
     - Ensure none are conditionally skipped

### 5. **Atlas Command Routing**
   - `/root/CODE/micode/src/index.ts:1038–1040`
     - Verify `buildColdInitDeps()` closure is capturing octtoSessionStore correctly

### 6. **Bridge Plugin (if remote question support needed)**
   - `/root/.config/opencode/plugins/askquestion_bridge.js:209+`
     - Hook registration for remote question events
     - Ensure autoinfo-mcp child process is spawned and RPC works

---

## Upstream OpenCode References (if available)

**Files not in this codebase; would be in OpenCode core:**
- `opencode-ai/plugin` tool registration mechanism (used: `/root/CODE/micode/src/index.ts:979–999`)
- `opencode-ai/sdk` client and MCP config (used: `/root/CODE/micode/src/index.ts:6`)
- OpenCode `question` tool gating in agent config or tool filtering layer (not visible in micode, likely in core plugin loading)
- Octto portal CDN or proxy endpoints (expected at `octto.wuxie233.com` per README)

---

## Quick Restore Checklist

1. ✅ Verify askquestion_bridge.js is loaded in opencode.json
2. ✅ Check `/root/CODE/micode/src/tools/atlas/init.ts:37` is not filtering `askQuestions: null`
3. ✅ Run `bun run deploy:runtime` to sync `/root/CODE/micode` → `/root/.micode`
4. ✅ Confirm `createOcttoTools()` is called and spread in tool object (`src/index.ts:996`)
5. ✅ Test `/atlas-init` or brainstormer call to trigger octto session
6. ✅ Verify browser opens on session create
7. ✅ Check WebSocket connects for question push/answer

