# Project Atlas

Project Atlas is a curated project knowledge layer maintained jointly by the project owner and agents.

This vault is rendered as Markdown plus YAML frontmatter plus Obsidian wikilinks. Open the directory in Obsidian for graph view, search, and backlinks.

## Layout

- `00-index.md` - project overview and reading guide.
- `10-impl/` - Build layer: modules, subsystems, dependencies, internal structure.
- `20-behavior/` - Behavior layer: features, mechanics, numerics, user-visible behavior.
- `40-decisions/` - pages projected from active Project Memory decisions.
- `50-risks/` - pages projected from active Project Memory risks.
- `60-timeline/` - per-period project events.
- `_archive/` - soft-deleted nodes preserved for recovery.
- `_meta/` - maintenance logs, agent2 reports, challenges, schema version.

## How updates happen

After a lifecycle finish, the lifecycle hook spawns `atlas-compiler` (agent2). It reads the handoff package from the lifecycle issue body, fans out workers, reconciles their output, and atomically updates this vault.

If a node was edited by a human in Obsidian since the last agent2 write, agent2 routes the proposed change to a challenge under `_meta/challenges/` instead of overwriting your edit. Review challenges in Obsidian or via `/atlas-status`.

Manual refresh of one node: `/atlas-refresh <id>`.

## Commit discipline

Atlas changes are committed with the `atlas:` prefix and never bundled with feature commits. Filter atlas noise from log: `git log --invert-grep='^atlas:'`.

## Schema

The current schema version is recorded at `_meta/schema-version`. Frontmatter required fields: `id`, `layer`, `status`, `last_verified_commit`, `last_written_mtime`, `sources`. Body H2 set: `Summary`, `Connections`, `Sources`, `Notes`.
