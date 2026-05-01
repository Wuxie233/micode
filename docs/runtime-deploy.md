# Runtime Deploy Helper

This document is the source of truth for moving runtime-sensitive plugin changes from `/root/CODE/micode` (development checkout) to `/root/.micode` (live OpenCode plugin).

## When to use

Use the helper when your change affects code that OpenCode actually executes at runtime:

- Anything under `src/` that ends up in `dist/index.js`.
- Plugin command behaviour, hook handlers, tool implementations, agent configs.
- Anything documented under "Local OpenCode Runtime" in `CLAUDE.md`.

You do NOT need to use the helper for:

- Documentation-only changes.
- Changes confined to `thoughts/`, `tests/`, or other non-bundled paths.
- Lifecycle metadata edits (issue body, PR description).

## Three-step rule

1. **Sync and build.** Run `bun run deploy:runtime`. The helper performs preflight checks, an rsync that preserves runtime-local state, dependency install when needed, and `bun run build` in the runtime checkout.
2. **Verify readiness.** The helper prints a structured report. Look for the line `Runtime ready. Restart of OpenCode requires explicit user approval.` Anything else means the deployment is not ready.
3. **Ask before restart.** The helper deliberately never restarts OpenCode. Surface the readiness state to the user and wait for explicit approval before any restart command.

## Modes

- `bun run deploy:runtime -- --dry-run` previews the rsync without writing.
- `bun run deploy:runtime` is the apply mode (default).
- `bun run deploy:runtime -- --force` allows applying when the runtime checkout has uncommitted changes. Use only when you have inspected what is dirty.

## What is preserved in `/root/.micode`

The sync explicitly excludes the following paths so runtime-local state is not clobbered:

- `node_modules`
- `dist` (rebuilt by the helper itself)
- `.git`
- `thoughts`
- `coverage`, `.turbo`, `.cache`
- `*.log`
- `.env`, `.env.*`

If you need to sync one of these, do it manually and out-of-band; the helper will not touch them.

## Failure modes

- **Source dirty:** commit or stash in `/root/CODE/micode` first. The helper refuses to copy uncommitted source.
- **Runtime dirty:** inspect `/root/.micode` for unexpected local edits. Rerun with `--force` only if those edits are safe to lose.
- **rsync or bun missing:** install on PATH; the helper does not silently degrade.
- **Build failure:** read the build stderr surfaced in the report. The previous runtime bundle remains in place.
- **Verification failure:** `dist/index.js` is missing or smaller than 1 KB. Treat as a failed build.

## Anti-patterns

- Running `bun run build` only in `/root/CODE/micode/` and assuming OpenCode reloaded.
- Restarting OpenCode without an explicit approval in the current conversation.
- Editing files in `/root/.micode` directly: any change there will be overwritten on the next sync unless it is in the preserved list.
