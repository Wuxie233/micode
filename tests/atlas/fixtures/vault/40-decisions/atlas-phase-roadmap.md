---
id: decision/atlas-phase-roadmap
layer: decision
status: active
last_verified_commit: 
last_written_mtime: 0
sources:
  - thoughts:shared/designs/2026-05-04-project-atlas-design.md
---

## Summary

Canonical record of what is in scope for Phase 2 and what is deferred to Phase 3.

## Connections

_none_

## Sources

- thoughts:shared/designs/2026-05-04-project-atlas-design.md

## Notes

### Phase 2: Closed-loop integration (delivered)

Lifecycle finish auto-spawn of agent2; structured handoff; spawn receipt; worker fan-out;
atomic write protocol; mtime-based edit detection; challenge flow with dedup and cooldown;
wikilink rewiring constraint; soft delete to `_archive/`; first-person maintenance log;
`/atlas-status`; `/atlas-init --reconcile` and `--force-rebuild`; `atlas:` commit prefix;
User Perspective lifecycle enforcement; schema version file at `_meta/schema-version`.

### Phase 3: Hardening and operational maturity (deferred)

Independent lint and GC pass; project type profile system; agent2 failure escalation;
cross-project schema migration tools; independent git isolation; madge/dep-cruiser SVG;
Behavior layer round-trip verification.
