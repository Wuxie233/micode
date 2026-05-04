---
date: 2026-05-04
topic: "Windows repo sync helper for local Obsidian Atlas viewing"
status: validated
---

# Windows repo sync helper for local Obsidian Atlas viewing

## Problem Statement

The user develops through OpenCode web on a Linux host, but views Obsidian locally on Windows. Project Atlas vaults live inside git repositories, so the Windows side needs a simple way to clone or update those repositories into a local folder before opening `atlas/` in Obsidian.

The user wants a small interactive script, not a full git manager. The script should maintain a list of repositories with human-friendly notes and URLs, then clone or safely update a selected repository in the current folder.

## Constraints

- Windows is the primary runtime.
- Use Python plus a `.bat` launcher for the first version.
- Configuration file lives next to the script as `repo-sync-config.json`.
- The current working directory is the target workspace.
- First version supports selecting one repository at a time only.
- Repository configuration contains only a note/name and a URL.
- No credentials, tokens, passwords, or SSH keys are stored.
- Updates must be conservative: no stash, no reset, no rebase, no branch switching.
- Existing repositories update with `git pull --ff-only` only when the repository is clean and the remote matches.
- The script must be double-click friendly and keep the window open before exit.

## Approach

Build a tiny interactive repo sync helper focused on safe clone and fast-forward pull.

The script starts with two top-level choices:

1. Pull repository.
2. Configure repositories.

Configuration mode supports add, modify, delete, and list. Pull mode shows numbered repositories, asks for one number, computes the local directory name from the repository URL, then either clones the repository or safely updates the existing checkout.

I considered broader sync options such as Syncthing, sshfs, rclone, OneDrive, and Windows bridge relay. They are rejected for the first version because they introduce sync conflicts, remote filesystem fragility, cloud state, or unnecessary custom transport. Git is already the source of truth and matches Project Atlas' git-tracked design.

## Architecture

The tool is intentionally standalone and lives under `scripts/windows-repo-sync/`.

Files:

- `repo-sync.py`: Python interactive CLI.
- `repo-sync.bat`: Windows double-click launcher.
- `repo-sync-config.example.json`: example configuration.
- `README.md`: usage notes for Windows and Obsidian.

Runtime files beside the script:

- `repo-sync-config.json`: user-managed repository list, created automatically on first write.
- Optional `logs/`: deferred; not required for first version.

## Components

### Menu

The main menu shows:

- Pull repository.
- Configure repositories.
- Exit.

All prompts are Chinese-first and concise.

### Configuration Store

The JSON config stores an array of repositories:

- `name`: human-facing note or repo nickname.
- `url`: git remote URL.

The display index is derived at runtime from list order. The index is not treated as stable identity.

### Directory Name Derivation

The local directory name is derived from the URL:

- Strip trailing `/`.
- Take the final path segment.
- Remove a trailing `.git`.

Examples:

- `https://github.com/Wuxie233/micode.git` -> `micode`.
- `git@github.com:org/server.git` -> `server`.

If two repositories derive the same directory, pull mode rejects the selection and asks the user to edit configuration. Custom local directory names are intentionally deferred.

### Pull Engine

The pull engine uses directory state to decide behavior:

- Directory missing: run `git clone <url> <dir>`.
- Directory exists and is not git: skip with a clear message.
- Directory exists and is git but origin URL does not match config: skip with a clear message.
- Directory exists, origin matches, working tree dirty: skip to avoid conflicts.
- Directory exists, origin matches, working tree clean: run `git pull --ff-only`.

The engine continues to report errors rather than trying to repair git state automatically.

### Git Detection

At startup, the tool checks that `git` is available on PATH. If missing, it prints a Git for Windows installation hint and exits after waiting for Enter.

### Windows Launcher

`repo-sync.bat` runs the Python script from its own directory and pauses at the end. This makes double-click use viable without the window closing immediately.

## Data Flow

1. User opens `repo-sync.bat` or runs `python repo-sync.py`.
2. Script prints current target workspace directory.
3. User chooses pull or configure.
4. Configuration mode reads/writes `repo-sync-config.json` beside the script.
5. Pull mode reads config, displays numbered entries, and prompts for one number.
6. The selected URL derives a target directory under current working directory.
7. Pull engine runs clone or safe pull.
8. Result is shown and the user returns to menu.

## Error Handling

The script handles common Windows and Git failure cases explicitly:

- Missing Git: stop with installation hint.
- Missing config: show empty list and suggest configuration mode.
- Invalid JSON: stop configuration load and show the config path.
- Invalid menu input: re-prompt.
- Directory conflict: skip, never overwrite.
- Remote mismatch: skip, never repoint origin.
- Dirty working tree: skip, never stash.
- `git pull --ff-only` failure: print Git's error and leave repository unchanged.
- Clone failure: print Git's error and return to menu.

## Testing Strategy

Tests should cover the pure decision logic without requiring real network access:

- Config load/save behavior.
- URL to directory name derivation.
- Input validation for menu indices.
- Pull decision states: missing directory, non-git directory, remote mismatch, dirty repository, clean repository.
- Command planning for clone and pull.

Because this is a small helper script, test coverage can use Python's built-in `unittest` and temporary directories. The repository's main Bun check should not depend on Windows-only behavior.

## Open Questions

- Should a future version support `all` or multi-select? Deferred until the single-repo flow proves useful.
- Should a future version support custom local directory names? Deferred until a real directory collision appears.
- Should a future version auto-open Obsidian after pull? Deferred because Obsidian installation paths vary.
- Should a future version support scheduled pull? Deferred; Windows Task Scheduler can be documented later.

## User Perspective

The user wants to keep developing through OpenCode on Linux while reading Project Atlas locally in Windows Obsidian. They do not want a complicated sync system. They want to open a small helper, pick a repository by number, and safely clone or update it in the current Windows folder so Obsidian can open the local `atlas/` directory.
