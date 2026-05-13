# Backend Stack

## Rules

- **Runtime is Bun**, not Node. Use `Bun.$`, `Bun.file()`, `Bun.spawn()`, `bun:sqlite` — not `child_process` or `fs.createWriteStream`.
- **Build**: `bun build src/index.ts --outdir dist` produces `dist/index.js`. The built artifact is what OpenCode loads at runtime.
- **Shell commands** via tagged template `$`: use `$.quiet().nothrow()` and capture stdout/stderr/exitCode explicitly. Never assume success.
- **External CLIs** (`git`, `gh`, `sg`/ast-grep, `btca`) are checked with `Bun.which()` at call time. Provide a graceful degradation message when unavailable.
- **PTY** (`bun-pty`) must be dynamically imported — never static-import it at module top. Load lazily inside `createPtySpawnTool`.
- **Entry point** is `src/index.ts`, which exports `OpenCodeConfigPlugin` as the default export. Do not add side effects outside the plugin factory.
- **ESM only**: use `import`/`export`, no `require()`.

## Examples

### Shell command via Bun.$

```typescript
// src/lifecycle/runner.ts
async function runCommand(bin: string, args: readonly string[], cwd?: string): Promise<RunResult> {
  try {
    const tokens = [...args];
    const command = cwd ? $`${bin} ${tokens}`.cwd(cwd) : $`${bin} ${tokens}`;
    const completed = await command.quiet().nothrow();
    return {
      stdout: completed.stdout.toString(),
      stderr: completed.stderr.toString(),
      exitCode: completed.exitCode,
    };
  } catch (error) {
    const message = extractErrorMessage(error);
    log.warn(LOG_MODULE, `${bin} failed: ${message}`);
    return { stdout: EMPTY_OUTPUT, stderr: message, exitCode: FAILURE_EXIT_CODE };
  }
}
```

### CLI availability check before use

```typescript
// src/tools/ast-grep/index.ts — pattern for optional CLI tools
export async function checkAstGrepAvailable(): Promise<boolean> {
  return (await Bun.which("sg")) !== null;
}
// In tool execute: if not available, return formatted error string, never throw
```

### Dynamic PTY import (lazy load)

```typescript
// src/tools/pty/spawn.ts — never static-import bun-pty
async function loadPty() {
  const libPath = process.env.BUN_PTY_LIB ?? "bun-pty";
  const mod = await import(libPath);
  return mod.default ?? mod;
}
```

## Anti-patterns

### Using Node child_process instead of Bun.$

```typescript
// BAD: brings in Node API, wrong runtime model
import { execSync } from "node:child_process";
execSync("git status");
```

### Static import of bun-pty

```typescript
// BAD: bun-pty may not be available; crashes module load
import pty from "bun-pty";
```

### Assuming shell exit code 0 without checking

```typescript
// BAD: ignores failure
await $`git push origin main`;
// GOOD: use .nothrow(), then check exitCode
const result = await $`git push origin main`.quiet().nothrow();
if (result.exitCode !== 0) { /* handle */ }
```
