---
date: 2026-05-15
topic: "README overhaul: design philosophy + feature inventory + bilingual"
status: validated
---

## Problem Statement

The repository's user-facing README is the project's "shop window," but it is currently mis-aligned with what micode actually does:

1. **Design Philosophy is invisible.** The single source of truth (`.mindmodel/architecture/coupling-reuse.md`) is buried inside `.mindmodel/`. The "Philosophy" section in the current README is a 7-bullet list of generic workflow values, not the project's actual opinionated stance (need-first / wheels-first / layered knowledge / agent-maintained knowledge / multi-round alignment / effect-first / pre-flight).

2. **Feature inventory is single-focused and stale.** The README front-loads "domain-routed implementers + frozen contracts" as the headline, but the project has at least 7 other equally-weighted capabilities that are invisible to a first-time visitor: v9 issue-driven lifecycle, three-layer knowledge system (Mindmodel/Atlas/Project Memory), 6 user-triggered specialist agents, multi-round requirement alignment, knowledge-bootstrap `/all-*` commands, subagent resilience (resume/parallel allSettled), and ownership-aware safety pre-flight.

3. **Reference tables are incomplete.** The Commands table lists 3 commands; the project has 12. The Agents table lists ~15 agents; the project has 30+. The Tools table lists 10; the project has 20+.

4. **The `micode vs oh-my-opencode` comparison is outdated** and risks drift over time.

5. **No Chinese entry point.** AGENTS.md, atlas/, and most internal docs are Chinese-first; visitors from Chinese-speaking communities have no signal that the project is bilingual-aware.

## Constraints

- **No code changes.** Documentation-only work.
- **No `ARCHITECTURE.md` / `CODE_STYLE.md` / `AGENTS.md` rewrites.** Those are separate sources of truth.
- **English primary `README.md`** matching the current language of the file, with a banner link to a new `README.zh.md`.
- **`README.zh.md` is structurally 1:1 with `README.md`**, in Chinese-first prose. Machine-syntax (paths, command names, agent names, tool names, frontmatter keys, code identifiers) stays English.
- **Detailed configuration content moves to `docs/configuration.md`.** README keeps a 3-5 line stub plus a link.
- **Approximate target length:** ~600 lines per README (about 2× current).
- **Do not invent features.** Every capability claim must be verifiable in `src/index.ts`, `src/agents/`, `src/lifecycle/`, `src/tools/`, `AGENTS.md`, or `.mindmodel/architecture/coupling-reuse.md`.
- **Do not rewrite the demo gif.** Keep the existing `https://github.com/user-attachments/assets/...` embed.
- **Preserve** Inspiration, Acknowledgments, License Notices, and the local-runtime-path note sections.

## Approach

**Extension-style overhaul**, not full rewrite. Keep the current skeleton (Hero / Quick Start / Workflow / Commands / Agents / Tools / Hooks / Configuration / Octto / Development / Inspiration / License) and:

- Add **new** sections: `Why micode`, `Design Philosophy`, `Features` (replacing the single-focus "Current focus" intro).
- **Rewrite** the Commands / Agents / Tools tables to be complete.
- **Update** the Workflow section to reflect Knowledge Maintenance (Read/Maintain/Verify/Report) and Multi-Round Requirement Alignment phases.
- **Remove** the `micode vs oh-my-opencode` comparison.
- **Move** detailed configuration to `docs/configuration.md`.

## Architecture

Three output files:

```
README.md              English, ~600 lines, with banner link to README.zh.md
README.zh.md           Chinese, ~600 lines, structurally 1:1 with README.md
docs/configuration.md  English, ~200 lines, extracted detailed config
```

## Components

### README.md section order

1. **Hero** — tagline (rewritten as product positioning, not plugin description), Chinese banner link, demo gif, 1-paragraph elevator pitch, ToC.
2. **Why micode** — 3-4 paragraphs answering "what does vanilla OpenCode lack / what micode adds / who benefits."
3. **Quick Start** — preserve existing 3-step setup, add `/all-init` as the recommended next step after `/init`.
4. **Design Philosophy** (NEW) — 7 numbered principles, each 1-2 sentences + a design motivation sentence + a deep-link to the authoritative source (`.mindmodel/architecture/coupling-reuse.md`, `AGENTS.md`, etc.). The 7 principles, verbatim labels:
   - Need-first thinking
   - Low coupling, wheels-first
   - Layered knowledge
   - Multi-round alignment before commitment
   - Effect-first reporting
   - Agent-maintained knowledge
   - Safety pre-flight
5. **Features** (REWRITE) — 8 grouped sections, each with 3-5 sentences and one concrete "user does X → system does Y" narrative example:
   - 🎯 Brainstorm → Plan → Implement Workflow
   - 🧠 Multi-Round Requirement Alignment (NEW)
   - 🚦 Issue-Driven Lifecycle (v9) (NEW)
   - 🎚️ Domain-Routed Implementers + Frozen Contracts (compressed)
   - 📚 Three-Layer Knowledge System (NEW, with a comparison table)
   - 🧑‍🔬 User-Triggered Specialist Agents (NEW, 6 specialists listed)
   - 💬 Octto Browser Questions (extended with 16-type categorization + auto-resume)
   - ⚙️ Resilience & Safety (NEW: resume, parallel allSettled, ownership pre-flight, bounded recovery)
6. **How It Works** — extended workflow walkthrough including Knowledge Maintenance phase.
7. **Slash Commands** — complete table (12 commands grouped: Core / Knowledge / Atlas / Memory).
8. **Agents** — regrouped table:
   - Primary (commander, brainstormer, octto)
   - Workflow (planner, executor, reviewer)
   - Implementers (4 domain-routed)
   - Specialists (6 user-triggered)
   - Workers (codebase-locator/analyzer, pattern-finder, mm-*, atlas-*, etc.)
9. **Tools** — complete table categorized (Code analysis / File ops / Artifact search / Subagent / Octto / PTY / Lifecycle / Knowledge / Notification).
10. **Configuration** — 3-5 line stub with link to `docs/configuration.md`.
11. **Hooks** — preserve current list + add any missing ones.
12. **Octto Configuration** — preserve current section verbatim.
13. **Development** — preserve current section (including Local runtime path note + deploy:runtime helper).
14. **Inspiration** — preserve.
15. **Acknowledgments** — preserve.
16. **License Notices** — preserve.

### README.zh.md
1:1 structural mirror of README.md, in Chinese-first prose. Reference style: `AGENTS.md`, `atlas/00-index.md`, `.mindmodel/architecture/coupling-reuse.md`. Machine-syntax preserved in English.

### docs/configuration.md
Extracted detailed configuration content. Sections:

1. Model Configuration (resolution priority, provider/model syntax)
2. micode.jsonc Field Reference (agents, features.mindmodelInjection, fragments, compactionThreshold)
3. LLM-Controlled Spawn Model Overrides (including primary-agent escape hatch)
4. Environment Variables (OCTTO_PORT, OCTTO_PUBLIC_BASE_URL, PERPLEXITY_API_KEY, FIRECRAWL_API_KEY)
5. Runtime Deploy Helper (deploy:runtime workflow, runtime-local exclusions)
6. Local Plugin Path Development (clone, build, point opencode.json)
7. Release flow (npm version patch + git push --follow-tags)

## Data Flow

User journey through the new README:

```
First-time GitHub visitor
  → Hero (3 seconds: "what is this")
  → Why micode (30 seconds: "do I care")
  → Design Philosophy (60 seconds: "is this opinionated in my direction")
  → Features (2 minutes: "what can I do with it")
  → Quick Start (5 minutes: "let me try")
  → How It Works (10 minutes: "let me understand")
  → Commands/Agents/Tools tables (reference)
  → docs/configuration.md (deep configuration)

Chinese-speaking visitor
  → Hero banner link → README.zh.md → same journey in Chinese
```

## Error Handling

N/A — documentation work, no runtime error paths.

## Testing Strategy

Manual review by the project owner:

1. Read README.md end-to-end as a first-time visitor.
2. Read README.zh.md end-to-end as a Chinese-first visitor.
3. Spot-check every capability claim against `src/`, `AGENTS.md`, or `.mindmodel/`.
4. Verify all deep-links resolve (no broken anchors).
5. Verify Commands / Agents / Tools tables are exhaustive against `src/index.ts` `PLUGIN_COMMANDS`, `src/agents/index.ts`, and `src/tools/index.ts`.

## Open Questions

None. All 4 strategic decisions are locked from chat: language (C: English + Chinese mirror), depth (B: ~2× current), philosophy treatment (A: 7 principles with deep-links), comparison removal (A: drop oh-my-opencode table).

## Behavior

After this work lands:

- **First-time English visitor** sees a product positioning sentence in 3 seconds, can decide "do I care" in 30 seconds via the Why section, and can mentally map all 8 capability groups in 2 minutes via Features.
- **Chinese-speaking visitor** sees `🇨🇳 [简体中文 →](./README.zh.md)` near the top of README.md and gets a structurally identical Chinese experience.
- **Returning user** can find any of the 12 slash commands, 30+ agents, and 20+ tools in the complete reference tables without grepping the source.
- **Contributors** can read the 7 philosophy principles in README.md to understand the project's opinionated stance, then deep-link to `.mindmodel/architecture/coupling-reuse.md` or `AGENTS.md` for the full rules.
- **Anyone hunting for configuration details** finds a small stub in README.md and the complete reference at `docs/configuration.md`.
- **The outdated oh-my-opencode comparison** is gone — no more risk of comparing-to-stale-snapshot.
