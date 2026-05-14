# Native `question` Tool Visibility Fix: Rollback Runbook

Use when the visibility fix needs to be reverted in production. Each section
is independent; you can roll back the systemd drop-in alone, the plugin
permission alone, or both.

## Pre-conditions to check first

- [ ] Is the failure actually caused by this fix? Cross-check against:
      - `journalctl -u opencode-web.service -n 200` for plugin load errors.
      - `tests/plugins/opencode-question/` test suite still green offline.
      - `/root/.micode/dist/index.js` modification time vs. expected.
- [ ] Capture a single line in the team channel describing the observed
      failure mode before rolling back. (We want a paper trail for any
      follow-up issue.)

## Option A — Roll back the systemd drop-in only

Use when: the runtime smoke test failed, but you want to keep the micode
plugin permission change in place (so when you re-enable the flag later,
the per-agent permission is already correct).

Steps:

```
rm /etc/systemd/system/opencode-web.service.d/question-tool.conf
systemctl daemon-reload
# Coordinate a USER-approved restart per the no-auto-restart rule:
#   systemctl restart opencode-web.service
```

After restart, `OPENCODE_ENABLE_QUESTION_TOOL` is unset, and the tool
falls back to the `OPENCODE_CLIENT`-based gate. On this host that still
evaluates to enabled (`OPENCODE_CLIENT` defaults to `"cli"`); to fully
disable the tool you would need to ALSO set `OPENCODE_CLIENT` to a value
outside `{app, cli, desktop}` — which is NOT recommended because it has
unrelated telemetry side effects.

## Option B — Roll back the micode plugin permission only

Use when: the systemd flag is fine, but the plugin-level allow rule caused
an unexpected interaction in a custom agent.

Steps:

1. Revert the commit produced by Task 2.2 in the lifecycle worktree:

   ```
   git revert <commit-sha-from-task-2.2>
   ```

   The revert touches `src/index.ts` only (removes the import and reverts
   the config hook to its pre-fix shape).

2. Rebuild and redeploy the plugin:

   ```
   bun run build
   bun run deploy:runtime
   ```

3. Coordinate a USER-approved restart so the running plugin picks up the
   reverted `dist/index.js`.

After this, custom micode agents see `question` denied per upstream
defaults again. The systemd flag still registers the tool — it just is
not permitted for non-built-in agents.

## Option C — Full rollback (both gates)

Use when: both the env var and the plugin permission must be removed (e.g.,
preparing to revert issue #71 in its entirety).

Run Option A and Option B in either order. They are commutative.

## What rollback does NOT remove

- The notify-only askquestion bridge (`/root/.config/opencode/plugins/askquestion_bridge.js`)
  and its config entry in `/root/.config/opencode/opencode.json` are a
  SEPARATE concern (sibling plan `2026-05-14-question-notify-only-bridge.md`).
  They have their own rollback path documented in their own smoke
  checklist. Do NOT remove them as part of rolling back THIS plan.
- The `tests/plugins/opencode-question/` test suite. Leave the tests in
  place even after a rollback — they will go red, which is the correct
  signal that the production state has diverged from the locked-in policy.
  Re-applying the fix later turns them green again.

## Forbidden during rollback

- `git push --force` to the lifecycle branch.
- `git reset --hard` against the worktree.
- `--no-verify` on the revert commit.
- Auto-restarting OpenCode without user approval. The restart in Options
  A and B is a USER ACTION; the executor states the proposed command and
  stops.
