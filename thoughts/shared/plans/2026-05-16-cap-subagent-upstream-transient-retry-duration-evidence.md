# Cap Subagent Upstream Transient Retry Duration Evidence

## Scope

This note records whether the reported long retry symptom (for example, “retry 7 / 127 seconds” or “127 秒后 - 第 7 次”) is owned by micode-controlled `spawn_agent` retry orchestration or by an upstream OpenCode/provider layer.

## Evidence Checklist

- [x] Searched micode source for the exact visible strings or close variants: `retry 7`, `127`, `temporarily unavailable`, `Upstream service temporarily unavailable`, `第 7 次`, `seconds`.
- [x] Confirmed current micode-owned `spawn_agent` retry boundary is `src/tools/spawn-agent/retry.ts` called from `src/tools/spawn-agent/tool.ts`.
- [x] Confirmed current micode-owned retry uses `config.subagent.transientRetries` and `config.subagent.transientBackoffMs`.
- [x] Confirmed ordinary chat/provider prompt paths such as `src/index.ts`, `src/tools/octto/processor.ts`, `src/octto/auto-resume/dispatcher.ts`, and `src/hooks/session-recovery.ts` are not being modified by this issue.
- [x] Confirmed lifecycle push retry / PR check polling paths remain under `src/lifecycle/commits.ts`, `src/lifecycle/merge.ts`, and `config.lifecycle` and are not part of the 45 second cap.

## Findings

### micode-owned evidence

- `src/tools/spawn-agent/tool.ts:557` calls `retryOnTransient(() => runAttempt(...), { retries: config.subagent.transientRetries, backoffMs: config.subagent.transientBackoffMs })`.
- `src/tools/spawn-agent/retry.ts:33` currently controls only retry count and per-retry sleep; it has no elapsed wall-clock budget.
- `src/utils/config.ts:205` and `src/utils/config.ts:206` currently define `config.subagent.transientRetries` and `config.subagent.transientBackoffMs` near other subagent runtime settings.
- The in-flight provider call that a future budget cannot safely interrupt is `ctx.client.session.prompt(...)` inside `src/tools/spawn-agent/tool.ts:305`; this call is wrapped by `runAttempt(...)` and retried only after it returns or throws.

### Screenshot/string ownership evidence

- Search for the exact/close visible strings in `src/**` found no `retry 7`, `temporarily unavailable`, `Upstream service temporarily unavailable`, or `第 7 次` owner in micode source.
- The `127` matches are loopback addresses or unrelated comments/config values such as `src/utils/config.ts:176`, not retry countdown text.
- The `seconds` matches are unrelated UI/time comments such as `src/octto/portal/landing.ts:22` and `src/octto/types.ts:7`, not the reported retry symptom.
- No exact visible-string owner found in micode source; the screenshot may be emitted by OpenCode/provider internals.

### Ordinary chat/provider prompt paths out of scope

- Ordinary/internal prompt call sites remain separate from `spawn_agent` retry orchestration: `src/index.ts:542`, `src/index.ts:624`, `src/index.ts:652`, `src/index.ts:824`, `src/tools/octto/processor.ts:111`, `src/octto/auto-resume/dispatcher.ts:106`, and `src/hooks/session-recovery.ts:104`.
- This issue should not modify those paths unless a separate design proves they share the same safe owner and cancellation boundary.

### Lifecycle retry/polling out of scope

- Lifecycle push retry remains `src/lifecycle/commits.ts:179`, sleeping with `config.lifecycle.pushRetryBackoffMs`.
- Lifecycle PR check polling remains `src/lifecycle/merge.ts:264` and `src/lifecycle/merge.ts:281-289`, using `config.lifecycle.prCheckTimeoutMs` and `PR_CHECK_POLL_MS`.
- Lifecycle config values remain `src/utils/config.ts:194` and `src/utils/config.ts:195` and are independent from `config.subagent`.

### Provider/internal limitation

- The 45 second cap applies before sleeps/next attempts in micode-controlled transient retry; it cannot safely interrupt one already in-flight provider/internal prompt wait without a separate cancellation design.

## Implementation Gate Decision

- Proceed with the scoped micode-owned `spawn_agent` retry budget only.
- Do not modify ordinary chat/provider behavior because this note records no concrete evidence that the reported visible screenshot string is emitted by micode source or that those prompt paths have a safe scoped timeout/cancel boundary.
- Do not modify lifecycle push retry or PR check polling; keep `src/lifecycle/commits.ts`, `src/lifecycle/merge.ts`, and `config.lifecycle` outside the 45 second subagent transient retry cap.

## Commands / Searches Run

- `batch_read`: read plan, target evidence path, `src/tools/spawn-agent/retry.ts`, `src/tools/spawn-agent/tool.ts`, `src/index.ts`, `src/tools/octto/processor.ts`, `src/octto/auto-resume/dispatcher.ts`, `src/hooks/session-recovery.ts`, `src/lifecycle/commits.ts`, and `src/lifecycle/merge.ts`.
- `grep`: searched `*.ts` under the worktree for `retry 7|127|temporarily unavailable|Upstream service temporarily unavailable|第 7 次|seconds`.
- `grep`: searched `src/**/*.ts` for `retryOnTransient`.
- `grep`: searched `src/**/*.ts` for `transientRetries|transientBackoffMs`.
- `grep`: searched `src/**/*.ts` for `session\.prompt|ctx\.client\.session\.prompt|client\.session\.prompt`.
- `grep`: searched `src/**/*.ts` for `pushRetryBackoffMs|prCheckTimeoutMs|config\.lifecycle|PR_CHECK|check`.
- `grep`: repeated visible-string search under `src/**` with include `*` to confirm no non-`.ts` source owner for the reported text.
- `read`: read focused line ranges in `src/tools/spawn-agent/tool.ts`, `src/index.ts`, and `src/lifecycle/merge.ts` for line-specific evidence.

## Executor Terminal Report Reminder

- If screenshot ownership is not micode-owned, terminal report must state the limitation: “本次 45 秒预算覆盖 micode-controlled `spawn_agent` transient retry；截图中的 provider/internal 单次等待若不经过该 helper，仍是已知限制。”
