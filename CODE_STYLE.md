# Code Style

## Sources of Truth

Follow these files before inferring style from memory:

- `CLAUDE.md`: project rules and architecture conventions.
- `.mindmodel/`: project-specific patterns and anti-patterns.
- `biome.json`: formatter and selected lint rules.
- `eslint.config.js`: TypeScript, complexity, class, naming, and safety rules.
- Existing source files under `src/` and behavior tests under `tests/`.

## Naming Conventions

| Item | Convention | Examples |
| --- | --- | --- |
| Source filenames | kebab-case | `auto-compact.ts`, `artifact-auto-index.ts`, `spawn-agent-args.ts` |
| Directory names | domain nouns, usually lowercase | `agents`, `hooks`, `octto`, `mindmodel`, `indexing` |
| Functions | camelCase, domain-meaningful | `createSessionStore`, `loadMicodeConfig`, `extractErrorMessage` |
| Factory functions | `createX` | `createOcttoTools`, `createPTYManager`, `createContextInjectorHook` |
| Interfaces and schemas | PascalCase | `SessionStore`, `MicodeConfig`, `RawMicodeConfigSchema` |
| Runtime constant maps | UPPER_SNAKE members in `as const` objects | `STATUSES.PENDING`, `QUESTIONS.PICK_ONE` |
| Agent registry keys | kebab-case strings when exposed to OpenCode | `codebase-locator`, `implementer-frontend` |
| Unused parameters | Leading underscore | `_ctx`, `_output` |

Avoid generic names such as `data`, `result`, and `temp` when a domain name is available. Avoid Hungarian-style suffixes like `Map`, `List`, `Dict`, `Fn`, `Func`, and `Callback` in identifiers.

## File Organization

Use the module layout documented in `CLAUDE.md`:

| Path | Contents |
| --- | --- |
| `src/agents/` | `AgentConfig` objects and prompt factories, mostly pure data |
| `src/hooks/` | Lifecycle hook factories shaped as `createXHook(ctx) => { handlers }` |
| `src/tools/` | OpenCode tools from `tool()` and context-bound tool factories |
| `src/utils/` | Shared config, logging, error, and model-limit helpers |
| `src/mindmodel/` | `.mindmodel/` loading, formatting, classification, and review parsing |
| `src/octto/` | Browser session, state, WebSocket, and UI bundle internals |
| `src/indexing/` | Milestone artifact classification and ingestion |
| `tests/` | Tests mirroring `src/` areas |

Within a source file, keep this order:

1. Imports.
2. Exported types and constants.
3. Internal constants and schemas.
4. Private helpers.
5. Main factory or exported runtime object.

Use barrel files named `index.ts` for public module exports, as in `src/tools/index.ts`, `src/hooks/index.ts`, and `src/agents/index.ts`.

## Import Style

- Use `node:` prefixes for Node built-ins: `node:fs`, `node:path`, `node:os`.
- Group imports as built-ins, external packages, `@/` project imports, then `./` relative imports.
- Use `@/*` aliases for cross-folder project imports, configured in `tsconfig.json`.
- Use `./` for files in the same folder.
- Avoid parent-relative imports such as `../` where `@/*` is appropriate, enforced by `biome.json`.
- Use `import type` for type-only imports, enforced by ESLint.
- Use named exports only in `src/`; config files may use default exports when required by the tool.

Representative pattern from `src/config-loader.ts`:

```ts
import { existsSync, readFileSync } from "node:fs";
import { readFile } from "node:fs/promises";

import type { AgentConfig } from "@opencode-ai/sdk";
import * as v from "valibot";

import { OpencodeConfigSchema } from "@/config-schemas";
import { log } from "@/utils/logger";
```

## Formatting

Biome settings in `biome.json` define the formatting baseline:

- 2-space indentation.
- 120-character line width.
- Double quotes.
- Semicolons always.
- Trailing commas.
- Bracket spacing enabled.
- Always-parenthesized arrow function parameters.
- Organize imports through Biome assist.

## TypeScript Rules

- Strict TypeScript is enabled in `tsconfig.json`.
- Prefer `interface` for object contracts and `type` for unions or aliases.
- Use discriminated unions instead of class hierarchies.
- Use `readonly` on data structures that should not mutate.
- Exported functions need explicit return types.
- Use `unknown` at system boundaries, then validate or normalize.
- Avoid `any`. Tests are relaxed, runtime source is not.
- Minimize type assertions. Prefer Valibot schemas or type guards.
- Use `as const` maps to derive status and event unions.
- Do not use default exports in `src`.

Example from `src/octto/session/types.ts` style:

```ts
export const STATUSES = {
  PENDING: "pending",
  ANSWERED: "answered",
  CANCELLED: "cancelled",
} as const;

export type QuestionStatus = (typeof STATUSES)[keyof typeof STATUSES];
```

## Code Patterns

### Factory functions with closed-over state

Business logic uses factories rather than classes. Examples:

- `createSessionStore()` in `src/octto/session/sessions.ts` closes over session maps and waiters.
- `createPTYManager()` in `src/tools/pty/manager.ts` closes over PTY sessions and spawner state.
- `createOcttoTools()` in `src/tools/octto/index.ts` combines tool groups from a shared store.
- `createImplementerAgent()` in `src/agents/implementer.ts` builds `AgentConfig` objects.

Pattern:

```ts
export function createSessionStore(options: SessionStoreOptions = {}): SessionStore {
  const sessions = new Map<string, Session>();

  return {
    getSession: (id) => sessions.get(id),
    cleanup: async () => {
      for (const id of sessions.keys()) await endSession(id);
    },
  };
}
```

### Tool definitions

- Static tools export a `tool({ name, description, args, execute })` object.
- Tools needing plugin context use factories, such as `createSpawnAgentTool(ctx)` and `createBatchReadTool(ctx)`.
- Multi-tool groups are composed through object spreads, as in `createOcttoTools()`.
- Validate raw tool inputs before executing side effects.

### Early returns and shallow functions

- No nesting beyond 2 levels in function bodies.
- Prefer early returns and small helpers.
- Keep functions under 40 non-blank, non-comment lines unless an explicit lint exception exists.
- Keep cognitive complexity at or below 10.

### Constants and tunables

- Do not use magic numbers or repeated string literals.
- Put shared tunables in `src/utils/config.ts`.
- Keep local constants near their module when not shared.

### Promises and cleanup

- Await promises or explicitly handle them.
- Cleanup should be best-effort and should not mask primary failures.
- Listener fan-out must not allow one listener exception to break the loop.

## Validation

- Use Valibot for schemas at system boundaries.
- Derive types with `v.InferOutput<typeof Schema>`.
- Prefer `v.safeParse` for tolerant inputs and `v.parse` where invalid input should fail.
- Keep schemas near boundary types, for example `src/config-schemas.ts`, `src/mindmodel/types.ts`, and `src/octto/session/schemas.ts`.
- Treat parse failures as non-fatal when possible: accumulate warnings, return `null`, or return safe defaults.

Representative pattern from `src/config-schemas.ts`:

```ts
const result = v.safeParse(AgentOverrideSchema, picked);
if (!result.success) return null;
return result.output;
```

## Error Handling

- Catch boundary errors as `unknown`.
- Normalize error messages with `extractErrorMessage()` from `src/utils/errors.ts`.
- Log recoverable errors with `log.warn()` or `log.error()` and return safe defaults where possible.
- Bare `catch {}` is acceptable for expected probing, such as missing config files, but include a why-comment.
- Do not use direct `instanceof Error` checks outside error utilities unless necessary.

Common patterns:

```ts
try {
  const manifest = parseManifest(content);
  return { directory, manifest };
} catch (error) {
  log.warn("mindmodel", `Failed to load manifest: ${extractErrorMessage(error)}`);
  return null;
}
```

```ts
await ctx.client.session.delete({ path: { id: sessionId } }).catch((_e: unknown) => {
  /* fire-and-forget */
});
```

## Logging

- Use `log.debug`, `log.info`, `log.warn`, and `log.error` from `src/utils/logger.ts`.
- Do not call `console.*` directly in runtime code.
- Include a module scope string as the first argument, such as `"micode"`, `"octto"`, or `"artifact-auto-index"`.
- Use `log.warn` for recoverable issues and `log.error` for failures.
- Include original error objects as trailing parameters when the logger method supports it.

Logger shape from `src/utils/logger.ts`:

```ts
log.warn("micode", "ast-grep unavailable");
log.error("octto", "Failed to parse WebSocket message", error);
```

## Testing

- Use Bun's native test runner from `bun:test`.
- Place tests in `tests/` mirroring `src/` structure.
- Use behavior-focused `it(...)` or `test(...)` names.
- Prefer real behavior over mocked behavior.
- Mock data, not implementation behavior.
- Test all public exports and error paths.
- Use unique `/tmp` paths for filesystem tests and clean them up in `afterEach`.
- Prefer polling helpers over fixed sleeps.
- Keep test output pristine by capturing expected errors.

Examples of existing test areas:

- `tests/agents/` covers agent prompts, routing, and planner or executor behavior.
- `tests/hooks/` covers lifecycle hook behavior.
- `tests/tools/` covers tool wrappers, PTY behavior, and artifact indexing.
- `tests/mindmodel/` covers manifest loading, formatting, classification, and review.
- `tests/indexing/` covers milestone artifact indexing and search.

Run targeted tests with `bun test path/to/file.test.ts`. Run the full gate with `bun run check`.

## Do's and Don'ts

### Do

- Use factory functions for business logic.
- Use `@/*` imports across folders and `./` within the same folder.
- Validate untrusted input with Valibot.
- Normalize errors with `extractErrorMessage()`.
- Keep tunables in `src/utils/config.ts`.
- Add tests next to the matching `tests/` area.
- Re-export public APIs through barrel files.
- Preserve batch-first parallelism in agent prompts and tools.

### Don't

- Do not add classes for business logic. Error subclasses are allowed where already used.
- Do not use `any` in runtime source.
- Do not add parent-relative `../` imports when `@/*` fits.
- Do not call `console.*` outside `src/utils/logger.ts` or tests.
- Do not add nested ternaries.
- Do not leave floating promises.
- Do not skip contract propagation for cross-domain frontend and backend plans.
- Do not edit generated or build output in `dist/` unless the task explicitly targets release artifacts.

## Quality Gate

Use the commands defined in `package.json`:

| Command | Purpose |
| --- | --- |
| `bun run format` | Format with Biome |
| `bun run lint` | Run Biome lint and ESLint |
| `bun run typecheck` | TypeScript check |
| `bun test` | Test suite |
| `bun run check` | Full gate: Biome check, ESLint, typecheck, tests |
| `bun run build` | Build plugin output to `dist/` |

After substantive code changes, run `bun run check`. If runtime or build-sensitive code changed, also run `bun run build`.
