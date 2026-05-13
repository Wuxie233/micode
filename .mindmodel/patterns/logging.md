# Logging

## Rules

- **All logging goes through `log`** from `@/utils/logger`. Never call `console.log`, `console.error`, `console.warn` directly in source modules (only `log.*` methods call console internally).
- **Always prefix with module name** as first argument: `log.info("ledger-loader", "...")`.
- **`log.debug`** only emits when `DEBUG` env var is set — use for verbose developer traces.
- **`log.info`** for normal operational messages (hook loaded, tool invoked, file found).
- **`log.warn`** for non-fatal issues (missing optional file, degraded path, expected probe failure).
- **`log.error(module, message, error?)`** for caught errors — pass the error object as third arg for context.
- **Module string** should match the file's domain, not the full path: `"lifecycle"`, `"mindmodel"`, `"config-loader"`, `"octto"`.
- **Do not log secrets**, tokens, API keys, or raw user prompt content.
- **Log at action boundaries** (start/end of significant I/O), not inside tight loops.

## Examples

### Standard module log usage

```typescript
// src/utils/logger.ts (the implementation — reference)
export const log = {
  debug(module: string, message: string): void {
    if (process.env.DEBUG) console.log(`[${module}] ${message}`);
  },
  info(module: string, message: string): void {
    console.log(`[${module}] ${message}`);
  },
  warn(module: string, message: string): void {
    console.warn(`[${module}] ${message}`);
  },
  error(module: string, message: string, error?: unknown): void {
    if (error !== undefined) console.error(`[${module}] ${message}`, error);
    else console.error(`[${module}] ${message}`);
  },
};
```

### Typical hook/tool usage

```typescript
// src/tools/mindmodel-lookup.ts
import { log } from "@/utils/logger";

const MAX_QUERY_LOG_LENGTH = 100;

execute: async ({ query }) => {
  log.info("mindmodel", `Looking up patterns for: "${query.slice(0, MAX_QUERY_LOG_LENGTH)}..."`);
  // ...
  log.debug("mindmodel", `Matched categories: ${categories.join(", ")}`);
  log.debug("mindmodel", `Returning ${examples.length} examples`);
}
```

### Logging a caught error in a runner

```typescript
// src/lifecycle/runner.ts
} catch (error) {
  const message = extractErrorMessage(error);
  log.warn(LOG_MODULE, `${bin} failed: ${message}`);   // non-fatal, warn level
  return { stdout: "", stderr: message, exitCode: 1 };
}
```

## Anti-patterns

### Direct console.log in source module

```typescript
// BAD: bypasses structured logging, no module prefix
console.log("Hook loaded");
console.error("failed:", err);

// GOOD
log.info("my-hook", "Hook loaded");
log.error("my-hook", "failed", err);
```

### Logging sensitive data

```typescript
// BAD: leaks token or user secrets into logs
log.info("octto", `Portal token: ${token}`);
log.debug("config", `Raw config: ${JSON.stringify(config)}`);

// GOOD: log redacted reference
log.info("octto", `Portal token present: ${token.length > 0}`);
```
