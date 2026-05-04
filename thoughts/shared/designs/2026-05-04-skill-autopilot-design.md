---
date: 2026-05-04
topic: "Skill Autopilot"
status: validated
supersedes: thoughts/shared/designs/2026-05-03-project-skill-evolution-design.md
issue: 27
---

## Problem Statement

The MVP from issue #24 captured procedural memory but kept activation behind a manual `/skills approve|reject` flow and stored active procedures inside Project Memory.

Two real problems with that shape:

- **Wrong work split.** The user is asked to babysit a candidate queue. That is exactly the toil the autopilot is supposed to eliminate.
- **Wrong storage.** Procedures live in SQLite as opaque entries. They are not shareable, not git-diffable, not directly editable, and break the agentskills.io ecosystem expectation that skills are folder-based markdown.

This redesign replaces both choices.

## Constraints

These constraints are non-negotiable. Several were surfaced by adversarial review and must hold in code, not only in docs.

- The autopilot operates strictly inside `ctx.directory`. The runtime install path `/root/.micode` is never a write target when micode self-hosts.
- Writes happen **inside** the lifecycle worktree, **before** `git add` and `commit`, **never** after worktree cleanup.
- Internal-sensitivity skills must never reach a remote without explicit user action. Ownership pre-flight is enforced in code, not only AGENTS.md prose.
- Skills must remain agentskills.io spec compliant: directory name equals `name`, lowercase kebab, byte-based caps on `description` and body.
- Backward compatible with existing `procedure` entries in Project Memory via a one-shot migration; old entries are not silently lost.
- Feature flag `features.skillAutopilot` defaults off until the security layer ships and is reviewed.
- Concurrent miner runs are serialized per project (in-process async mutex) and per skill (rename-based lock file).
- The autopilot never auto-creates `scripts/` or executable files under `.opencode/skills/`.
- The autopilot never edits agents' configs, never edits `micode.json`, never modifies its own feature flag.

## Approach

The chosen approach is a **file-backed Skill Autopilot** with an explicit security layer, conservative write policies, and explicit user-sovereignty markers.

Rejected alternatives:

- Keep Project Memory as canonical active store: rejected because it is not shareable, not editable, not git-diffable.
- Auto-promote without any safeguards: rejected because adversarial review identified concrete prompt-injection, privilege-escalation, destructive-operation, and anti-evolution failure modes.
- Per-candidate user approval queue: rejected by user requirement.
- Optimize prompts and tool descriptions in this round: rejected as out of scope.

The autopilot keeps the deterministic miner from #24, but its output target changes from "Project Memory tentative procedure" to "SKILL.md write through a guarded writer".

## Architecture

The system is six layers, top to bottom:

- **Trigger boundary.** Only deterministic lifecycle artifacts trigger writes. The hook fires inside the lifecycle worktree, between merge readiness and `git add`.
- **Miner.** Reads only persisted sources (lifecycle journal, lifecycle record, ledger files). Produces normalized candidates with provenance.
- **Security layer.** A pure pipeline that runs before any disk write. A failure rejects the candidate and logs to a rejection journal.
- **Writer.** Performs read-then-CAS atomic writes against `.opencode/skills/<name>/SKILL.md`. Honors user sovereignty markers and managed-marker invariants.
- **Loader.** Progressive disclosure: discovery loads only `name` + `description` per skill under a global byte ceiling; activation loads the full SKILL.md only when a trigger matches.
- **Injector.** Filters by agent role, sensitivity ceiling, and per-turn budget. Strips conflict markers and HTML-escapes injected content.

Project Memory steps back to its original role: durable why-only entries (decisions, lessons, risks). The `procedure` entry type stays in the schema for backward compatibility, but the autopilot does not write there. Existing entries are exported once, then injection prefers SKILL.md.

## Components

### Skill file format

Each skill is a directory under `.opencode/skills/<name>/` with one required file `SKILL.md`. The frontmatter is a strict superset of the agentskills.io baseline; private fields use the `x-micode-` namespace so other skill consumers ignore them safely.

Required:

- `name`: lowercase kebab, max 64 chars, must equal parent directory name.
- `description`: byte-capped (1024 bytes), describes both what and when.
- `version`: monotonically increasing integer, used for write CAS and for the loader change-detection.

Private (`x-micode-*`):

- `x-micode-managed`: `true` if the file is under autopilot management. Required for autopilot to be allowed to overwrite.
- `x-micode-frozen`: `true` if the user has frozen the file from autopilot edits.
- `x-micode-imported-from`: external source URL or registry id; if present, autopilot only reads, never writes, unless `local-overrides` is true.
- `x-micode-local-overrides`: opt-in flag for autopilot to mutate an imported skill, with a logged warning.
- `x-micode-project-origin`: `projectId` at creation time, used to detect cross-project contamination.
- `x-micode-sensitivity`: one of `public | internal | secret`. Default `internal`.
- `x-micode-agent-scope`: list of agents allowed to read this skill at injection time. Defaults to implementer-* roles only; reviewer/planner/executor are excluded by default.
- `x-micode-sources`: list of `{kind, pointer}` provenance entries.
- `x-micode-rationale`: short why-this-exists snippet captured at creation, so an issue link going stale is not catastrophic.
- `x-micode-hits`: integer, incremented on dedup collisions during mining; gates promotion.
- `x-micode-locale`: optional, e.g. `zh-CN`, used by downstream consumers to route correctly.
- `x-micode-validated-at`: timestamp of last source-file hash verification.
- `x-micode-source-file-hashes`: map of file path to SHA-256 used for stale detection.

Body:

- Sections required: `When to Use`, `Procedure`, `Pitfalls`, `Verification`.
- Body is treated as documentation by the loader and injector. It is never piped into PTY tools as commands.

### Tombstones and freezing

A user-deleted skill leaves `.opencode/skills/<name>/.tombstone` (committed). The miner checks the tombstone before recreating; matching content hashes are skipped permanently unless the user removes the tombstone.

A user-frozen skill sets `x-micode-frozen: true`. The writer treats this as a hard skip.

A user-edited skill that is still under autopilot management is detected via the version field plus mtime CAS. Concurrent user edits cause the autopilot write to be skipped, not silently overwrite the user's content.

### Index file

`.opencode/skills/INDEX.md` is regenerated by the autopilot after a successful write. It lists each skill name, description, hit count, and last-updated date. New engineers get a single onboarding entry point.

### Security layer

A pure pipeline that runs before any disk write. Each gate either passes or rejects with reason. Rejections are logged to `.opencode/skills/.rejections.jsonl`, keyed by dedup key, so the same flawed candidate does not get re-mined endlessly.

Gates, in order:

- **Schema gate.** Frontmatter and body must validate against Valibot schemas. Byte caps enforced at byte level, not char level.
- **agentskills.io compliance gate.** `name` regex, `name == basename(dir)`, description byte cap, no `scripts:` field.
- **Secret detection.** Existing `detectSecret` runs on `name`, `description`, `triggers`, every body section, and provenance pointers.
- **PII / internal-data scrub.** Strips or rejects absolute paths, internal hostnames (`*.internal`, `*.corp`, `*.lan`, `*.local`), private IPs, internal Slack/JIRA/Confluence URLs, customer name patterns. Rejection on detection; redaction is opt-in only.
- **Prompt injection guard.** Pattern set rejects `Ignore prior instructions`, `disregard previous`, `you are now a`, `system:`, `</?system>`, `[INST]`. Applied to frontmatter and body.
- **Destructive command guard.** Pattern set rejects steps containing destructive shell snippets as the leading token: `rm -r[f]`, `git push --force` (without `--force-with-lease`), `DROP TABLE`, `mkfs.`, `shred`, `> /dev/`.
- **Self-reference guard.** Pattern set rejects content that references the autopilot itself (`skillEvolution`, `skillAutopilot`, `features.skill*`, `disable skill`, `skip skill capture`). Logged as security rejection.
- **Code-verbatim guard.** Steps must not be triple-backtick blocks longer than a small threshold; steps describe actions, not source code.
- **Conflict-marker guard.** Files containing `<<<<<<<`, `=======`, `>>>>>>>` are rejected by the loader; the writer also refuses to write content containing these patterns.
- **Conflict-with-existing guard.** Before writing a new skill, BM25-search existing skill triggers; reject if overlap with an existing trigger exceeds the configured threshold without an explicit `supersedes` link.
- **Length and entry-cap gate.** Per-skill body byte cap, per-skill step count cap, per-project skill count cap.
- **Project boundary gate.** `ctx.directory` must not equal the runtime install path; `projectId` must resolve from a git remote, not from a path-only fallback.

### Conservative write policies

Even after the security layer passes, writes are throttled by these policies:

- **Recurrence requirement.** A new skill is only created if `hits >= 2` across at least 2 distinct lifecycle issues. Single-shot anecdotes do not become skills.
- **Per-lifecycle ceiling.** A single lifecycle finish produces at most a small number of skill writes (default 2). Goodhart guard against task-fragmentation gaming.
- **Small-step patches.** Existing skills can only be patched with append-or-mark-deprecated changes. Whole-section rewrites require a separate consolidation pass.
- **Soft deprecation.** Skills are not hard-deleted by the autopilot. They are marked deprecated, hidden from injection, kept on disk and in git history.
- **Stale detection.** `x-micode-source-file-hashes` lets the loader detect stale source references and downgrade the skill to deprecated until reverified.
- **Heterogeneous review.** When the autopilot uses an internal review pass, the reviewer model alias is configurable and defaults to a different family from the writer to reduce shared blind spots.

### User-sovereignty rules

- `x-micode-frozen: true` skips all autopilot writes for that skill.
- `.tombstone` files block recreation of the same content.
- Files without `x-micode-managed: true` are read-only to the autopilot.
- Files with `x-micode-imported-from` and no `x-micode-local-overrides` are read-only to the autopilot.
- User edits between writer reads and writer renames cause the writer to abort with a logged warning.

### Boundaries

- **Project boundary.** All skill paths resolve from `ctx.directory`. The runtime install path is excluded by an explicit guard.
- **Worktree boundary.** Writes happen inside the lifecycle worktree, between merge readiness and `git add`. Worktree cleanup runs only after a successful commit that includes any skill diffs.
- **Self-hosting boundary.** When `ctx.directory` resolves to the plugin install path itself, the autopilot logs a warning and skips writes. The deploy-runtime sync excludes `.opencode/skills/` so runtime-side files are never accidentally deleted.
- **Concurrency boundary.** Two layers of locking:
  - In-process async mutex per `projectId` around the miner.
  - Per-skill rename-based file lock around the writer.
  Two parallel batches that both observe a candidate produce a single write.

### Loader and injector

Discovery is a directory scan that loads only `name` + `description` for each skill, capped by `skillAutopilot.maxIndexBytes`. A skill that exceeds the per-entry description budget is excluded from discovery, not silently truncated, and surfaces in the rejection log instead.

Injection at chat-params time:

- Filters by `x-micode-agent-scope` against the current agent role.
- Filters by `x-micode-sensitivity` against `injectionSensitivityCeiling`.
- Caps total injected bytes per turn at `injectionCharBudget`.
- Suppresses skills whose triggers conflict; keeps the higher-hit one.
- HTML-escapes injected content to break inline injection vectors.

### Migration

A one-shot migration runs on first activation of `features.skillAutopilot`:

- Read existing `procedure` entries from Project Memory for the current project.
- For each entry that has `sources` and a derivable name, generate a candidate SKILL.md, run it through the security layer, and write it.
- Entries that fail the security layer remain in Project Memory and are not silently lost.
- The injector path falls back to Project Memory only when no SKILL.md matches a query.

## Data Flow

1. A lifecycle batch reaches `lifecycle_commit` readiness.
2. Inside the worktree, before `git add`, the autopilot acquires the per-project async mutex and runs the miner against the persisted lifecycle journal, lifecycle record, and ledger files.
3. The miner emits raw candidates with provenance and dedup keys.
4. Each candidate is incremented (`hits += 1`) on dedup collision; new dedup keys start at 1.
5. Candidates with `hits >= 2` across at least 2 distinct lifecycle issues advance.
6. Each advancing candidate runs the full security layer; failures are logged to the rejection journal and skipped.
7. Surviving candidates pass the conservative write policies; the per-lifecycle ceiling caps total writes.
8. The writer acquires the per-skill rename lock, performs read-then-CAS atomic write to `.opencode/skills/<name>/SKILL.md`, and updates `INDEX.md`.
9. The lifecycle journal records a `skill_autopilot_write` event with skill name, action (`create | patch | deprecate`), reason, and provenance.
10. `git add` and `commit` run; the skill diff is part of the lifecycle commit.
11. A pre-push secret + sensitivity scan rejects the push if any internal/secret skill changed; user must explicitly downgrade or freeze before push.
12. Worktree cleanup runs after the commit. Skill files survive in the merged history.
13. Future tasks discover skills via the loader and inject filtered subsets via the injector.

## Error Handling

- Miner failures are non-blocking and logged. They never break the main development workflow.
- Security-layer rejections are written to `.opencode/skills/.rejections.jsonl` with reason and dedup key. Same candidate is skipped on future runs unless the rejection is purged.
- Writer aborts on user-edit CAS conflict, logging `concurrent_edit_skipped` with skill name. The lifecycle continues.
- Loader rejects files containing conflict markers, missing managed marker on autopilot writes, or schema validation failures. Bad files are visible to the user, not silently absent.
- Injector errors result in zero injection rather than degraded execution.
- Push-time sensitivity check failures stop the push, surface a clear actionable error, and never silently downgrade.
- Feature flag rollback disables miner, writer, loader hook, and injector. SKILL.md files remain on disk for manual use.

## Testing Strategy

- Pure functions (security gates, sanitizers, validators, dedup, CAS) get unit tests with fixture inputs.
- Loader and injector get tests against synthetic skill trees.
- Concurrency tests exercise the per-project mutex and the per-skill rename lock.
- Migration test runs against a synthetic Project Memory with a mix of valid and invalid procedure entries.
- Self-hosting test asserts that when `ctx.directory` equals the plugin install path, no writes occur.
- Push-time guard test asserts that internal-sensitivity changes block `git push`.
- Full quality gate (`bun run check`) must pass.

## Open Questions

- Whether the autopilot's internal review pass should be required for every write, or only for first-time creations. Default for the MVP is "first-time creation only".
- Whether `INDEX.md` should be committed or kept as runtime state. Default is committed for shareability and onboarding clarity.
- Whether stale-detection downgrade should run on every loader pass or only on lifecycle finish. Default is lifecycle finish to avoid loader-time IO bloat.
- Whether to expose a `/skills sync` user command for manual on-demand mining outside lifecycle. Out of scope for MVP; can be added later as an opt-in.
- Whether skill name generation should call out to an LLM at all. Default is a deterministic slugifier with collision avoidance, no LLM call.
