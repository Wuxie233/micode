---
date: 2026-05-04
topic: "Skill Autopilot Native Alignment"
status: validated
supersedes: thoughts/shared/designs/2026-05-04-skill-autopilot-design.md
issue: 31
---

## Problem Statement

Issue #27 delivered a file-backed Skill Autopilot, but two core behaviors were misaligned with the intended product.

First, micode still injected skill metadata through `chat.params` into `output.system`, duplicating OpenCode's native skill mechanism and risking prompt-cache churn. Second, mining was lifecycle-centric, so the generated skills risked becoming playbooks for micode's lifecycle machinery rather than substantive project-development workflows.

The corrected design makes micode a **SKILL.md generator and governance layer only**. OpenCode remains responsible for native skill discovery, metadata exposure, permission handling, and full skill loading.

## Constraints

- micode must not inject skill context into `output.system`, `chat.params`, or any system-transform path.
- micode must not implement a parallel skill loader or skill tool for agent activation.
- `.opencode/skills/<name>/SKILL.md` is the active file-backed project skill format.
- OpenCode native skill behavior is the only runtime skill-loading path.
- Skill content must focus on substantive project-development workflows.
- Lifecycle artifacts are evidence, not the primary or sole source of truth.
- No user approval queue returns. The system remains automatic, but visible through files, `INDEX.md`, logs, and git diffs.
- Default behavior must stay safe: `features.skillAutopilot` remains disabled until this correction lands and is redeployed intentionally.
- Internal or secret content must not be written as native skills by default, because OpenCode native loading ignores `x-micode-*` sensitivity fields.

## Approach

The corrected approach has three moves.

**Remove micode injection.** Delete the Skill Autopilot injector module and all `chat.params` wiring. SKILL.md files are discovered by OpenCode, not by micode.

**Refocus mining.** Reframe mining around project development evidence. Code reality, tests, package scripts, `.mindmodel/`, architecture docs, Project Memory decisions, ledgers, and explicit user instructions outrank lifecycle journal summaries.

**Harden write-time gates.** Because OpenCode native loading does not enforce `x-micode-*`, anything written to `.opencode/skills/` must be safe to expose via native skill metadata and full body. Security moves entirely to write time.

Rejected alternatives:

- Keep micode injector as fallback: rejected because it preserves the cache-breaking parallel path.
- Continue lifecycle-first mining: rejected because it creates lifecycle/tooling skills rather than project-development skills.
- Rely on `x-micode-sensitivity` at load time: rejected because OpenCode native loader ignores private micode metadata.

## Architecture

The final responsibility split is explicit:

**micode owns:**

- Candidate evidence gathering.
- SKILL.md schema validation.
- Security gates.
- Quality gates.
- Atomic writes.
- `INDEX.md` generation.
- Push-time safety checks.
- Stale/deprecation maintenance.
- Frozen/imported/unmanaged sovereignty checks.

**OpenCode owns:**

- Scanning `.opencode/skills/` and global skills directories.
- Showing `name`, `description`, and location as available skills.
- Enforcing native `permission.skill` behavior.
- Loading full SKILL.md content through the native `skill` tool.
- Provider prompt-cache behavior.

No micode runtime component should bridge those two responsibilities by injecting skill summaries or skill bodies into system prompts.

## Components

### Native-aligned skill store

The active skill store remains `.opencode/skills/<name>/SKILL.md`. Files stay agentskills.io-compatible: `name`, `description`, optional standard fields, and private governance under `x-micode-*`.

OpenCode ignores `x-micode-*`, so these fields are for micode's writer and governance tools only.

### Removed injector path

The following behavior is removed:

- Directory scan during `chat.params`.
- `<skill-context>` system block construction.
- Any `output.system` append for skills.
- Config keys that only existed for injection: injection character budget, injection sensitivity ceiling, default agent scope.

Regression tests assert that no Skill Autopilot code is reachable from `chat.params`.

### Evidence model

Skill mining uses ordered evidence:

1. User's explicit current instruction.
2. Code reality: source files, tests, package scripts, config files, documented commands.
3. `.mindmodel/` patterns and constraints.
4. Project Memory decisions, risks, and rationales.
5. Ledgers and continuity summaries.
6. Lifecycle artifacts and journal events.
7. External documentation, when explicitly relevant.

Lifecycle evidence can support a candidate, but lifecycle request titles and batch summaries cannot become reusable skill triggers verbatim.

### Substantive-skill filter

A candidate must answer: "Will this help the next agent develop, test, debug, deploy, or maintain this project?"

Valid examples:

- Adding or modifying this project's API surface.
- Adding tests using this project's real test conventions.
- Deploying or rebuilding this project safely.
- Debugging this project's runtime issues.
- Modifying hooks, tools, or agents according to project constraints.

Invalid examples:

- How lifecycle creates issues or worktrees.
- How executor dispatches subagents.
- How Skill Autopilot captures skills.
- One-off issue summaries.
- Temporary workaround steps.

### Public-by-default write policy

Because OpenCode native loading ignores `x-micode-sensitivity`, native project skills must be safe by construction.

Defaults:

- `x-micode-sensitivity: public` for auto-written skills.
- `internal` and `secret` candidates are rejected by default.
- Future opt-in internal skills require an explicit config and matching OpenCode permission policy. This is out of MVP scope.

### OpenCode permission alignment

micode must not assume its private metadata controls runtime access. If OpenCode exposes `permission.skill`, micode should set or document an explicit default rather than relying on an unknown platform default.

The MVP assumes native skills written by autopilot are public-safe, so no runtime filtering is needed.

### Explicit migration only

Project Memory `procedure` entries from #24 are not migrated on plugin startup. Migration is explicit and future-command driven. Until then, Project Memory remains a why-store and legacy procedure archive.

### Trigger boundary

Autopilot writes run only at controlled write boundaries:

- lifecycle `preStageHook`, before `git add`, for lifecycle-driven work;
- a future explicit command, if added later.

The `session.deleted` path is removed.

Plugin startup background mutation is removed.

## Data Flow

1. A lifecycle reaches the pre-stage boundary, or a future explicit command invokes the autopilot.
2. The miner gathers evidence from the project and from persisted artifacts.
3. Candidates are normalized into reusable project-development practices.
4. Substantive-skill filtering rejects lifecycle/tooling/self-referential noise.
5. Security gates scan the final rendered SKILL.md content, not only pre-render trigger and steps.
6. Quality gates reject changelog-style triggers, sentence fragments, one-shot anecdotes, and conflicts with existing skills.
7. Sovereignty checks read the existing on-disk file before writing and respect frozen/imported/unmanaged files.
8. Atomic writer updates `.opencode/skills/<name>/SKILL.md` and regenerates `INDEX.md`.
9. OpenCode native skill discovery sees the file on a new/refreshing session and controls subsequent skill activation.

## Error Handling

- Security rejection writes a debug rejection record and does not create a skill.
- Bad candidates are skipped silently from the user's main workflow, with one-line lifecycle logs for created/patched/skipped skills.
- Frozen/imported/unmanaged files are skipped, not overwritten.
- Concurrent user edits cause CAS skip, not overwrite.
- Loader/schema validation failures keep the file visible for human repair but stop autopilot from mutating it further.
- Push guard remains the last remote-write defense and must print actionable remediation.

## Testing Strategy

- Assert no Skill Autopilot code is called from `chat.params`.
- Assert no skill injection touches `output.system`.
- Assert no `session.deleted` path reaches the runner.
- Assert no plugin-start path reaches migration or runner.
- Assert lifecycle request first line cannot become a candidate trigger verbatim.
- Assert full rendered SKILL.md content is scanned for prompt injection and destructive commands.
- Assert `internal` and `secret` candidates are rejected by default.
- Assert existing frozen/imported/unmanaged files are not overwritten.
- Assert OpenCode-compatible SKILL.md layout is preserved.
- Run full `bun run check`.

## Open Questions

No user decision is required for the correction. Defaults are fixed:

- Delete micode injector entirely.
- Keep `features.skillAutopilot` off until correction lands.
- Use OpenCode native loading only.
- Public-only auto-written skills for MVP.
- Lifecycle remains evidence only.
- Explicit migration later; no startup mutation.
