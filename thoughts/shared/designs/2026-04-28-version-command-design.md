---
date: 2026-04-28
topic: "Version Command"
status: validated
---

## Problem Statement

We need a lightweight `/version` command so users can quickly confirm which micode plugin build is loaded.

This is also a small end-to-end validation of the v9 lifecycle workflow: design, plan, execute, commit, and finish.

## Constraints

- Keep the change minimal and avoid broad command-system refactors.
- Follow the existing slash command registration pattern.
- Use the package metadata as the version source of truth, or a single derived source kept in sync with it.
- Do not introduce a new external dependency.
- Do not restart the live OpenCode runtime without explicit user approval.

## Approach

The chosen approach is to add `/version` as a simple command registered beside the existing plugin commands, with output driven by the current package version.

I considered three options:

- **Reuse the primary agent:** Lowest wiring cost, but too indirect if the only job is to print a deterministic version string.
- **Add a dedicated lightweight command path:** Best fit because `/version` is deterministic, small, and should not require exploratory agent behavior.
- **Expose a broader runtime status tool:** Useful later, but overbuilt for this request.

We will use the dedicated lightweight path while keeping the surface narrow: version only, no speculative runtime diagnostics.

## Architecture

The command remains part of micode's existing plugin command surface.

At a high level:

- The plugin exposes `/version` in the same command map as `/init`, `/mindmodel`, `/ledger`, `/search`, and `/memory`.
- The command resolves the current micode version from package metadata or a single synchronized version utility.
- The response is short markdown, suitable for direct chat display.

This keeps the command discoverable without changing the broader agent architecture.

## Components

- **Command registration:** Adds `/version` to the plugin command registry with a clear description.
- **Version source:** Reads from the package version or an internal utility that is verified against the package version.
- **Response formatter:** Produces a concise markdown response containing the version.
- **Tests:** Cover command registration and version source consistency.

## Data Flow

The user invokes `/version`, OpenCode resolves the command from micode's plugin configuration, then micode returns a short version response.

The version value flows from package metadata into the command response. Tests ensure the displayed value stays aligned with the package version.

## Error Handling

The command should fail soft if the version cannot be resolved.

Instead of throwing through the command path, it should return a clear markdown failure message. This matches existing tool and lifecycle output conventions and avoids breaking the chat session for a simple info command.

## Testing Strategy

- Verify `/version` appears in the plugin command configuration.
- Verify the command description is user-friendly and specific.
- Verify the output contains the current package version.
- Verify the version source remains consistent with package metadata.

The tests should be focused and behavior-oriented. No broad mocks are needed beyond what existing plugin wiring tests already use.

## Open Questions

None for this scope.
