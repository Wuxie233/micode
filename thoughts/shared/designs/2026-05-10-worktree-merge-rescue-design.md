---
date: 2026-05-10
topic: "Worktree Merge Rescue"
status: validated
---

# Problem Statement

Several lifecycle-created worktrees contain real feature work that was pushed to feature branches but never merged into the corresponding remote mainline. One worktree, micode issue-60, also contains local uncommitted Atlas/runtime implementation work that would be lost if the worktree were deleted.

We need to preserve the local-only work first, then move each useful branch toward its repository mainline through safe remote writes, PRs, or documented blockers.

# Constraints

- Run repository ownership preflight before every remote mutation in each target repository.
- Push only to `origin`; never push to upstream or parent remotes.
- Do not restart OpenCode services, deploy, or delete remaining worktrees during rescue.
- Treat micode issue-60 as workflow/runtime-sensitive because it touches agent prompts, Atlas wiring, and tests.
- Resolve only small, evidence-clear conflicts. If conflicts imply competing implementations or unclear product decisions, stop that branch as blocked.

# Approach

Use a staged rescue pipeline: first protect local-only work, then advance already-pushed branches through PR or merge paths, then document unresolved cases.

The chosen approach favors recoverability over speed. Directly forcing all branches into mainline would risk overwriting newer mainline behavior, while leaving branches untouched keeps valuable work stranded.

# Architecture

The work is coordinated from lifecycle issue #62, but each target repository remains an independent merge unit.

- The coordinator tracks target branch state, ownership, PR status, and final outcome.
- Each repository worktree is handled in isolation to avoid cross-repo contamination.
- Remote writes happen only after ownership checks pass for that repository.
- Branches with existing PRs are advanced through their PR instead of creating duplicate PRs.

# Components

- **Rescue coordinator:** Maintains the branch inventory and ordered execution plan.
- **Repository preflight:** Confirms whether `origin` is a safe write target for each repository.
- **Local preservation step:** Commits and pushes dirty local work, especially micode issue-60.
- **PR / merge step:** Creates or advances PRs for already-pushed branches that are not in mainline.
- **Conflict reviewer:** Classifies merge conflicts as resolvable, covered by mainline, or blocked.
- **Outcome ledger:** Records merged, PR-created, preserved, and blocked branches.

# Data Flow

1. Read each worktree's local branch, HEAD, dirty status, origin branch, default branch, issue status, and PR status.
2. For dirty worktrees, commit and push to the existing feature branch before any merge attempt.
3. For pushed clean branches, compare feature branch against the remote default branch.
4. If the branch is not merged, create or reuse a PR where appropriate.
5. Attempt safe merge paths only when ownership and conflict checks are acceptable.
6. Record final status per repository and keep worktrees that are not fully merged.

# Error Handling

- **Ownership unsafe or unknown:** Stop remote mutation for that repo and mark blocked.
- **Push fails:** Keep the local commit and report the manual recovery command.
- **PR creation fails:** Keep branch pushed and report the failure with enough context to retry.
- **Merge conflict is small and semantic:** Resolve using the branch's feature intent plus current mainline behavior.
- **Merge conflict is broad or ambiguous:** Abort merge and mark blocked rather than guessing.
- **Tests fail after merge:** Do not merge; report the failing repo and verification signal.

# Testing Strategy

- Verify every branch's pushed SHA before merge/PR operations.
- Run repository-specific tests or build checks when discoverable and scoped.
- For micode issue-60, run the relevant Atlas / agent prompt / lifecycle boundary tests before PR or merge.
- After successful merge, verify the feature branch HEAD is contained in the remote default branch or associated PR state is merged.

# Open Questions

- issue-20 may already be superseded by later oc-remote work; it needs comparison against current master before merging.
- issue-37 includes a large research/docs deletion surface; it may need selective merge or user confirmation if the cleanup is not clearly desired.
- issue-40 is research-heavy and may be better preserved as a PR rather than immediately merged.
