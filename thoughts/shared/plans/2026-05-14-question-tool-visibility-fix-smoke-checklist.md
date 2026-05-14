# Native `question` Tool Visibility Fix: Manual Smoke Checklist

Run by the USER after Tasks 2.1, 2.2, 3.1 have landed and tests are green.
The executor MUST NOT perform Step 1 or Step 3 below — both touch the
running OpenCode process.

## Pre-conditions

- [ ] `bun test tests/plugins/opencode-question/` passes (all four files green).
- [ ] `bun run build` succeeds.
- [ ] `bun run deploy:runtime` has been run so `/root/.micode/dist/index.js`
      reflects the source change.
- [ ] `systemctl show opencode-web.service --property=Environment | grep OPENCODE_ENABLE_QUESTION_TOOL=1`
      prints the variable (the staged env var; not yet effective in the
      running process).
- [ ] The sibling notify-only bridge plan (`2026-05-14-question-notify-only-bridge.md`)
      has either landed or is being smoke-tested in the same restart window —
      the two are complementary and ideally validated together.

## Step 1 — Reload OpenCode (USER ACTION)

Pick whichever matches your operational preference. Choose ONE:

- `systemctl daemon-reload && systemctl restart opencode-web.service` —
  restarts only the web service, picks up the new `Environment=` and the
  freshly built plugin.
- `/usr/local/bin/restart-opencode-detached` — the host's existing
  detached restart helper.

Do NOT use `pkill` or `kill -9` — those skip the systemd-managed lifecycle.

## Step 2 — Confirm the env var is live in the running process

```
ps -ef | grep '[o]pencode web' | awk '{print $2}' | head -1 | \
  xargs -I{} cat /proc/{}/environ | tr '\0' '\n' | grep OPENCODE_ENABLE_QUESTION_TOOL
```

Expected output: `OPENCODE_ENABLE_QUESTION_TOOL=1`.

If the line is missing, the restart in Step 1 did not pick up the drop-in.
Re-run `systemctl daemon-reload` then restart again.

## Step 3 — Trigger a built-in question from a micode agent

Open a new conversation with any micode primary agent (commander or
brainstormer) and ask it a question that should plausibly need user
clarification. Or, more deterministically, type to the agent:

> Please call the `question` tool with a single yes/no question.

Expected:

- [ ] The agent's response shows a tool call with name `question` (NOT
      `askquestion`, NOT an octto session, NOT a chat-only ask).
- [ ] OpenCode's built-in question UI displays the prompt inside the
      conversation panel.
- [ ] You receive a QQ notification from the notify-only bridge with the
      format `[<project>] OpenCode 有一个 question 等待回答（1 题），请回到 OpenCode 处理。`
      (if the notify-only bridge plan has already landed).
- [ ] You answer the question inside OpenCode's UI; the agent receives the
      answer and continues normally.
- [ ] No QQ reply was treated as the answer.

## Step 4 — Negative test: built-in agents still work

Switch to OpenCode's built-in `build` agent (the upstream default). Trigger
any normal tool call (e.g., `read` on a small file).

Expected:

- [ ] No regression. `build` agent's tools work as before. (The fix added a
      key to `config.permission`; it must not have broken anything.)

## Step 5 — Negative test: octto remains a separate path

Trigger an octto-driven question flow (e.g., a brainstorm with 4+ batched
questions or a `show_plan`). The portal at `octto.wuxie233.com` should open
as before.

Expected:

- [ ] Octto still uses its browser portal, not the inline `question` tool.
- [ ] The agent did not "downgrade" the octto-eligible flow to inline
      `question` (it should still pick octto for bulky / multi-question
      decisions per AGENTS.md channel rules).

## What success looks like

After this checklist passes, the user has BOTH:

1. The upstream `question` tool actually appearing as a tool call in
   micode agent transcripts (the goal of this plan).
2. A QQ notification when it does (the goal of the sibling notify-only
   bridge plan).

If only (1) is true and (2) is missing, that's the bridge plan's smoke
checklist failing, not this one. They're independent fixes.

## If the question tool still does not appear

Cross-check in this order:

1. Is the env var really in `/proc/<pid>/environ`? (Step 2.) If no,
   the systemd drop-in did not load — re-check Task 2.1's file.
2. Is `config.permission.question` really `"allow"` after the plugin
   loads? `bun test tests/plugins/opencode-question/config-merge.test.ts`
   covers this offline. If the test passes but live behavior differs,
   `/root/.micode/dist/index.js` is stale — re-run `bun run deploy:runtime`
   and restart again.
3. Is the agent you're using configured to disallow `question` somewhere
   else (e.g., `~/.config/opencode/micode.json` per-agent override)?
   Grep for `question` in that file.
4. Is upstream OpenCode at a version that changed `tool/registry.ts:194`?
   Re-read that line; the gate logic may have moved. If so, file a
   follow-up issue rather than patching ad-hoc here.
