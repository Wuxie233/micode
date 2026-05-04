# Atlas test fixture

This directory contains a minimal but realistic atlas vault used by atlas integration tests.

Layout matches a Phase 2 vault produced by `/atlas-init`:

- `00-index.md`
- `10-impl/runner.md`
- `20-behavior/spawning.md`
- `40-decisions/atlas-phase-roadmap.md`
- `_meta/schema-version`
- `_meta/challenges/.gitkeep`
- `_meta/log/.gitkeep`

Tests copy the fixture to a `/tmp` working dir per case, mutate it, then assert resulting state.
