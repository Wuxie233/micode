---
date: 2026-05-04
topic: "Windows repo sync helper"
issue: 29
scope: scripts
contract: none
---

# Windows Repo Sync Helper Implementation Plan

**Goal:** Build a small Python interactive helper plus Windows launcher that lets the user clone or fast-forward-pull a configured git repository into the current Windows folder, so Obsidian can open the local `atlas/` directory.

**Architecture:** Standalone tool under `scripts/windows-repo-sync/`. One Python script holds the menu, config store, URL-to-directory derivation, git detection, and pull engine. A `.bat` launcher invokes Python and pauses. Config lives next to the script as `repo-sync-config.json`. Tests cover the pure decision logic via Python's built-in `unittest` so the host repo's Bun check stays Windows-free.

**Design:** [thoughts/shared/designs/2026-05-04-windows-repo-sync-helper-design.md](../designs/2026-05-04-windows-repo-sync-helper-design.md)

**Contract:** none (single-domain `general` plan, no frontend/backend split)

---

## Dependency Graph

```
Batch 1 (parallel): 1.1, 1.2, 1.3, 1.4 [foundation - independent files]
Batch 2 (sequential after 1.1): 2.1 [tests for pure logic in repo-sync.py]
```

Batch 1 contains the script, launcher, example config, and README. They reference each other only by name/path and can be authored in parallel. Batch 2 holds the unittest file because it imports from `repo-sync.py`.

---

## Batch 1: Helper Files (parallel - 4 implementers)

All tasks in this batch have no code dependencies and run simultaneously.
Tasks: 1.1, 1.2, 1.3, 1.4

### Task 1.1: Python interactive helper script
**File:** `scripts/windows-repo-sync/repo-sync.py`
**Test:** `scripts/windows-repo-sync/tests/test_repo_sync.py` (created in task 2.1)
**Depends:** none
**Domain:** general

Implement a single-file Python 3 script with the following structure. Keep it self-contained: stdlib only (`json`, `os`, `sys`, `subprocess`, `pathlib`, `urllib.parse`). Chinese-first prompts, concise output. The functions below MUST be module-level so the test file can import them.

Module layout:

1. Constants block: `CONFIG_FILENAME = "repo-sync-config.json"`, menu strings, exit codes.
2. Pure helpers (testable, no I/O):
   - `derive_dir_name(url: str) -> str`: strip trailing `/`, take last path segment after splitting on `/` and `:`, strip trailing `.git`. Examples: `https://github.com/Wuxie233/micode.git` -> `micode`, `git@github.com:org/server.git` -> `server`. Raise `ValueError` on empty result.
   - `parse_menu_index(raw: str, count: int) -> int`: validates input is a 1-based integer in `[1, count]`, returns 0-based index. Raise `ValueError` on invalid.
   - `decide_pull_action(target_dir: Path, expected_url: str, *, exists: bool, is_git: bool, origin_url: str | None, dirty: bool) -> tuple[str, str]`: pure decision function returning `(action, reason)` where action is one of `"clone"`, `"pull"`, `"skip-not-git"`, `"skip-remote-mismatch"`, `"skip-dirty"`. Order: not exists -> `clone`; exists and not git -> `skip-not-git`; exists and git but `origin_url != expected_url` -> `skip-remote-mismatch`; exists and git and origin matches and dirty -> `skip-dirty`; otherwise -> `pull`.
   - `plan_clone_command(url: str, target_dir: str) -> list[str]`: returns `["git", "clone", url, target_dir]`.
   - `plan_pull_command() -> list[str]`: returns `["git", "pull", "--ff-only"]`.
3. Config store (file I/O, also testable with tempdir):
   - `load_config(path: Path) -> list[dict]`: returns `[]` when file missing; raises `RuntimeError` on invalid JSON with the path included; rejects non-list top level.
   - `save_config(path: Path, repos: list[dict]) -> None`: writes UTF-8 JSON with `indent=2` and trailing newline.
   - Each repo entry shape: `{"name": str, "url": str}`.
4. Git inspection (subprocess wrappers):
   - `git_available() -> bool`: runs `git --version`, returns success.
   - `repo_origin_url(target_dir: Path) -> str | None`: runs `git -C <dir> remote get-url origin`, returns trimmed stdout or `None` on failure.
   - `repo_is_dirty(target_dir: Path) -> bool`: runs `git -C <dir> status --porcelain`, dirty if any non-empty line.
   - `repo_is_git(target_dir: Path) -> bool`: checks `target_dir / ".git"` exists.
5. Interactive flows (impure, exercised manually):
   - `run_pull_flow(repos, cwd, config_path)`: lists numbered repos, prompts for one number, calls `decide_pull_action`, then runs the planned command via `subprocess.run` in `cwd`, captures and prints results, never raises into the menu loop.
   - `run_configure_flow(config_path)`: sub-menu with add / modify / delete / list. Add asks for `name` then `url`, both non-empty. Modify shows numbered list, asks for index, then new name and url (blank keeps existing). Delete asks for index and confirms. Each mutation calls `save_config`.
   - `main()`: prints current working directory, checks `git_available()` (exits with hint on failure), then loops top-level menu (`1` pull, `2` configure, `3` exit). On exit, prompt `按回车键退出...` so the launcher's window stays open one extra beat even outside the `.bat` pause.
6. `if __name__ == "__main__": main()` guard.

Implementation rules:

- All `subprocess.run` calls use `check=False`, `capture_output=True`, `text=True`, `encoding="utf-8"`. Print `result.stdout` and `result.stderr` on failure.
- Never call `git stash`, `git reset`, `git checkout`, `git rebase`, or `git remote set-url`. The pull engine only runs `git clone` or `git pull --ff-only`.
- All user-facing strings are Chinese-first. Error lines start with `错误:` and skip lines with `跳过:`.
- No third-party dependencies. Python 3.9+ syntax (`list[dict]`, `str | None` allowed because Atlas Windows users likely have a modern Python; fall back to `from __future__ import annotations` at top of file to keep it 3.7-compatible at runtime).
- File must be ASCII-safe except for Chinese strings; declare `# -*- coding: utf-8 -*-` at top for older Windows consoles.

Verification (Linux dev side, no real Windows needed):

```sh
python3 -c "import ast; ast.parse(open('scripts/windows-repo-sync/repo-sync.py').read())"
```

**Verify:** `python3 -c "import ast; ast.parse(open('scripts/windows-repo-sync/repo-sync.py').read())"`
**Commit:** `feat(scripts): add windows repo-sync helper python script`

### Task 1.2: Windows .bat launcher
**File:** `scripts/windows-repo-sync/repo-sync.bat`
**Test:** none
**Depends:** none
**Domain:** general

Create a minimal Windows batch launcher that runs the Python script from the user's current working directory while resolving the script's location, then pauses so a double-click does not close the window.

Required behavior:

- Set local scope (`@echo off` and `setlocal`).
- Resolve the script directory via `%~dp0` and call `python "%~dp0repo-sync.py"`.
- DO NOT `cd` away from the user's current working directory: the script needs the original CWD as the workspace target.
- After Python exits, run `pause` so the window stays open even on error.
- If `python` is not on PATH, fall back to `py -3` then print a hint to install Python from python.org.

Required content (exact):

```bat
@echo off
setlocal

where python >nul 2>nul
if %ERRORLEVEL%==0 (
    python "%~dp0repo-sync.py"
    goto :done
)

where py >nul 2>nul
if %ERRORLEVEL%==0 (
    py -3 "%~dp0repo-sync.py"
    goto :done
)

echo 未找到 Python。请从 https://www.python.org/downloads/ 安装 Python 3 后再试。
:done
pause
endlocal
```

**Verify:** file exists and contains `pause` plus `%~dp0repo-sync.py`:

```sh
test -f scripts/windows-repo-sync/repo-sync.bat && grep -q '%~dp0repo-sync.py' scripts/windows-repo-sync/repo-sync.bat && grep -q '^pause' scripts/windows-repo-sync/repo-sync.bat
```

**Commit:** `feat(scripts): add windows repo-sync .bat launcher`

### Task 1.3: Example configuration file
**File:** `scripts/windows-repo-sync/repo-sync-config.example.json`
**Test:** none
**Depends:** none
**Domain:** general

Provide a copy-renameable example config so the user can drop it next to the script as `repo-sync-config.json` and edit. Two illustrative entries: one HTTPS and one SSH URL, both pointing at plausible Atlas-hosting repos.

Required content (exact):

```json
[
  {
    "name": "Project Atlas (主仓库)",
    "url": "https://github.com/Wuxie233/micode.git"
  },
  {
    "name": "示例:个人笔记仓库",
    "url": "git@github.com:example-user/notes.git"
  }
]
```

**Verify:**

```sh
python3 -c "import json; json.load(open('scripts/windows-repo-sync/repo-sync-config.example.json'))"
```

**Commit:** `feat(scripts): add example config for windows repo-sync helper`

### Task 1.4: README usage notes
**File:** `scripts/windows-repo-sync/README.md`
**Test:** none
**Depends:** none
**Domain:** general

Write a short Chinese-first README aimed at the Windows + Obsidian user. Sections in this order:

1. **用途** - one paragraph: pull/clone Project Atlas vault into the current Windows folder so Obsidian can open `atlas/` locally.
2. **前置条件** - bullets: Windows 10/11; Python 3 安装并加入 PATH (or `py -3`); Git for Windows 安装并加入 PATH.
3. **安装** - bullets: copy `scripts/windows-repo-sync/` to a stable location; copy `repo-sync-config.example.json` to `repo-sync-config.json` and edit; double-click `repo-sync.bat` or run `python repo-sync.py`.
4. **使用** - numbered: 双击 `repo-sync.bat` -> 选择 `1` 拉取或 `2` 配置 -> 拉取时输入仓库编号 -> 脚本在当前文件夹下克隆或快进更新 -> 用 Obsidian 打开 `atlas/`。
5. **安全性** - bullets explicit:
   - 不存储任何凭据、token、密码或 SSH 密钥。
   - 仓库脏时跳过,不会 stash/reset。
   - 远端 URL 与配置不匹配时跳过,不会改写 origin。
   - 仅使用 `git pull --ff-only`,从不 rebase/合并。
6. **配置文件格式** - show a JSON snippet identical in shape to `repo-sync-config.example.json`.
7. **常见问题** - bullets:
   - `未找到 Python` -> 安装 Python 3 并勾选 Add to PATH。
   - `未找到 Git` -> 安装 Git for Windows。
   - `跳过: 仓库有未提交改动` -> 在该仓库手动提交或丢弃改动后重试。
   - `跳过: 远端 URL 不匹配` -> 检查配置或换一个空目录重试。
8. **限制** - bullets: 一次只拉一个仓库;不支持自定义本地目录名;不会自动打开 Obsidian。

Length target: roughly 60-100 lines of Markdown. Plain prose, no badges, no shields, no fancy ASCII boxes.

**Verify:**

```sh
test -f scripts/windows-repo-sync/README.md && wc -l scripts/windows-repo-sync/README.md
```

**Commit:** `docs(scripts): add windows repo-sync helper README`

---

## Batch 2: Tests (parallel - 1 implementer)

Depends on Batch 1 task 1.1 (imports functions from `repo-sync.py`).
Tasks: 2.1

### Task 2.1: Unittest for pure decision logic
**File:** `scripts/windows-repo-sync/tests/test_repo_sync.py`
**Test:** self
**Depends:** 1.1 (imports from `repo-sync.py`)
**Domain:** general

Cover the pure logic from task 1.1 using Python's built-in `unittest`. NO real network, NO real `git` binary calls. Use `tempfile.TemporaryDirectory` for filesystem cases. Inject state into `decide_pull_action` via its keyword arguments rather than mocking `subprocess`.

Import strategy: because the script file is named `repo-sync.py` (hyphenated, not a valid module name), use `importlib.util.spec_from_file_location` to load it as a module under the name `repo_sync` from a sibling-relative path. Put the loader at the top of the test file.

Required test classes and cases:

1. `TestDeriveDirName(unittest.TestCase)`:
   - `test_https_with_dot_git`: `https://github.com/Wuxie233/micode.git` -> `micode`.
   - `test_ssh_with_dot_git`: `git@github.com:org/server.git` -> `server`.
   - `test_https_no_dot_git`: `https://example.com/foo/bar` -> `bar`.
   - `test_trailing_slash`: `https://example.com/foo/bar/` -> `bar`.
   - `test_empty_url_raises`: empty string raises `ValueError`.

2. `TestParseMenuIndex(unittest.TestCase)`:
   - `test_valid_lower_bound`: `parse_menu_index("1", 3)` returns `0`.
   - `test_valid_upper_bound`: `parse_menu_index("3", 3)` returns `2`.
   - `test_zero_invalid`: `"0"` raises `ValueError`.
   - `test_over_count_invalid`: `"4"` with count 3 raises `ValueError`.
   - `test_non_integer_invalid`: `"abc"` raises `ValueError`.
   - `test_empty_invalid`: `""` raises `ValueError`.

3. `TestDecidePullAction(unittest.TestCase)`: build a `Path("/tmp/x")` placeholder and exercise every branch in the same order as the spec.
   - `test_missing_dir_clones`: `exists=False` -> `("clone", ...)`.
   - `test_existing_non_git_skips`: `exists=True, is_git=False` -> `("skip-not-git", ...)`.
   - `test_remote_mismatch_skips`: `exists=True, is_git=True, origin_url="https://other.example/x.git", expected_url="https://github.com/foo/bar.git"` -> `("skip-remote-mismatch", ...)`.
   - `test_dirty_skips`: matching origin, `dirty=True` -> `("skip-dirty", ...)`.
   - `test_clean_pulls`: matching origin, `dirty=False` -> `("pull", ...)`.

4. `TestCommandPlanning(unittest.TestCase)`:
   - `test_clone_command`: `plan_clone_command("https://example.com/foo.git", "foo")` returns exactly `["git", "clone", "https://example.com/foo.git", "foo"]`.
   - `test_pull_command`: `plan_pull_command()` returns exactly `["git", "pull", "--ff-only"]`.

5. `TestConfigStore(unittest.TestCase)`:
   - `setUp`: create `tempfile.TemporaryDirectory`, store `Path` to `repo-sync-config.json` in `self.path`.
   - `tearDown`: cleanup the tempdir.
   - `test_load_missing_returns_empty`: file does not exist -> `[]`.
   - `test_save_then_load_roundtrip`: save `[{"name": "x", "url": "https://e.com/x.git"}]`, reload, assert equal.
   - `test_load_invalid_json_raises`: write `"{"` to path, `load_config` raises `RuntimeError` and the error message contains the path.
   - `test_load_non_list_top_level_raises`: write `"{}"`, `load_config` raises `RuntimeError`.

6. `TestRepoIsGit(unittest.TestCase)` (filesystem only, no `git` binary):
   - In a tempdir, assert `repo_is_git(tmpdir)` is `False`.
   - Create `tmpdir / ".git"` directory, assert `repo_is_git(tmpdir)` is `True`.

Append the standard guard:

```python
if __name__ == "__main__":
    unittest.main()
```

**Verify:** `python3 -m unittest discover -s scripts/windows-repo-sync/tests -t scripts/windows-repo-sync`
**Commit:** `test(scripts): add unittest for windows repo-sync pure logic`
