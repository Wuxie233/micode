# Error Handling

## Rules

- **Always catch `unknown`**, never `any` in catch blocks.
- **Normalize with `extractErrorMessage(e)`** from `@/utils/errors` — handles `Error`, strings, and other types uniformly.
- **Log via `log.warn` / `log.error`**, never `console.error` directly. Pass the error object as the third argument to `log.error`.
- **No stack traces in returned strings** — callers (agents, UI) should see a human-readable message, not a stack.
- **No error rethrowing** unless the caller explicitly handles it (document the escalation contract).
- **Tools return formatted error strings** — never throw from a tool's `execute`. Use `return "## ToolName Failed\n\nReason"` pattern.
- **Lifecycle commands** return structured `{ ok: false, issues: string[] }` — not thrown errors.
- **Bare `catch` (no binding)** only for probe operations where failure is expected and harmless (e.g., `getFileMtime`). Add a comment explaining why.

## Examples

### extractErrorMessage + log.error

```typescript
// src/lifecycle/runner.ts
import { extractErrorMessage } from "@/utils/errors";
import { log } from "@/utils/logger";

async function runCommand(bin: string, args: readonly string[], cwd?: string): Promise<RunResult> {
  try {
    const completed = await $`${bin} ${args}`.quiet().nothrow();
    return { stdout: completed.stdout.toString(), stderr: completed.stderr.toString(), exitCode: completed.exitCode };
  } catch (error) {
    const message = extractErrorMessage(error);    // normalize unknown → string
    log.warn(LOG_MODULE, `${bin} failed: ${message}`);
    return { stdout: EMPTY_OUTPUT, stderr: message, exitCode: FAILURE_EXIT_CODE };
  }
}
```

### Tool execute: return error string, never throw

```typescript
// src/tools/mindmodel-lookup.ts
execute: async ({ query }) => {
  try {
    const model = await getMindmodel(ctx.directory);
    if (!model) return "No .mindmodel/ directory found. Proceed without specific patterns.";
    // ...
    return formatted;
  } catch (error) {
    const message = extractErrorMessage(error);
    log.error("mindmodel", "lookup failed", error);
    return `## mindmodel_lookup Failed\n\n${message}`;
  }
},
```

### Structured result for lifecycle/parse operations

```typescript
// src/lifecycle/schemas.ts
export function parseLifecycleRecord(
  raw: unknown,
): { ok: true; record: LifecycleRecord } | { ok: false; issues: string[] } {
  const parsed = v.safeParse(LifecycleRecordSchema, raw);
  if (parsed.success) return { ok: true, record: parsed.output };
  return { ok: false, issues: parsed.issues.map(formatIssue) };
}
```

## Anti-patterns

### Catching `any` and exposing the stack

```typescript
// BAD: any + stack leak
} catch (e: any) {
  console.error(e.stack);
  throw e;
}

// GOOD: unknown + normalize + log
} catch (e: unknown) {
  log.error("module", "operation failed", e);
  return extractErrorMessage(e);
}
```

### Throwing from tool execute

```typescript
// BAD: uncaught throw bubbles to OpenCode runtime
execute: async (args) => {
  if (!args.query) throw new Error("query required");
  ...
}

// GOOD: return formatted error
execute: async (args) => {
  if (!args.query) return "## tool_name Failed\n\nquery is required";
  ...
}
```
