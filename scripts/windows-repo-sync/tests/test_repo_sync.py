import importlib.util
import tempfile
import unittest
from pathlib import Path


SCRIPT_PATH = Path(__file__).resolve().parent.parent / "repo-sync.py"
SPEC = importlib.util.spec_from_file_location("repo_sync", SCRIPT_PATH)

if SPEC is None or SPEC.loader is None:
    raise RuntimeError(f"Unable to load repo-sync module from {SCRIPT_PATH}")

repo_sync = importlib.util.module_from_spec(SPEC)
SPEC.loader.exec_module(repo_sync)


class TestDeriveDirName(unittest.TestCase):
    def test_https_with_dot_git(self):
        self.assertEqual(repo_sync.derive_dir_name("https://github.com/Wuxie233/micode.git"), "micode")

    def test_ssh_with_dot_git(self):
        self.assertEqual(repo_sync.derive_dir_name("git@github.com:org/server.git"), "server")

    def test_https_no_dot_git(self):
        self.assertEqual(repo_sync.derive_dir_name("https://example.com/foo/bar"), "bar")

    def test_trailing_slash(self):
        self.assertEqual(repo_sync.derive_dir_name("https://example.com/foo/bar/"), "bar")

    def test_empty_url_raises(self):
        with self.assertRaises(ValueError):
            repo_sync.derive_dir_name("")


class TestParseMenuIndex(unittest.TestCase):
    def test_valid_lower_bound(self):
        self.assertEqual(repo_sync.parse_menu_index("1", 3), 0)

    def test_valid_upper_bound(self):
        self.assertEqual(repo_sync.parse_menu_index("3", 3), 2)

    def test_zero_invalid(self):
        with self.assertRaises(ValueError):
            repo_sync.parse_menu_index("0", 3)

    def test_over_count_invalid(self):
        with self.assertRaises(ValueError):
            repo_sync.parse_menu_index("4", 3)

    def test_non_integer_invalid(self):
        with self.assertRaises(ValueError):
            repo_sync.parse_menu_index("abc", 3)

    def test_empty_invalid(self):
        with self.assertRaises(ValueError):
            repo_sync.parse_menu_index("", 3)


class TestDecidePullAction(unittest.TestCase):
    def test_missing_dir_clones(self):
        action, _reason = repo_sync.decide_pull_action(
            Path("/tmp/x"),
            "https://github.com/foo/bar.git",
            exists=False,
            is_git=False,
            origin_url=None,
            dirty=False,
        )
        self.assertEqual(action, "clone")

    def test_existing_non_git_skips(self):
        action, _reason = repo_sync.decide_pull_action(
            Path("/tmp/x"),
            "https://github.com/foo/bar.git",
            exists=True,
            is_git=False,
            origin_url=None,
            dirty=False,
        )
        self.assertEqual(action, "skip-not-git")

    def test_remote_mismatch_skips(self):
        action, _reason = repo_sync.decide_pull_action(
            Path("/tmp/x"),
            "https://github.com/foo/bar.git",
            exists=True,
            is_git=True,
            origin_url="https://other.example/x.git",
            dirty=False,
        )
        self.assertEqual(action, "skip-remote-mismatch")

    def test_dirty_skips(self):
        action, _reason = repo_sync.decide_pull_action(
            Path("/tmp/x"),
            "https://github.com/foo/bar.git",
            exists=True,
            is_git=True,
            origin_url="https://github.com/foo/bar.git",
            dirty=True,
        )
        self.assertEqual(action, "skip-dirty")

    def test_clean_pulls(self):
        action, _reason = repo_sync.decide_pull_action(
            Path("/tmp/x"),
            "https://github.com/foo/bar.git",
            exists=True,
            is_git=True,
            origin_url="https://github.com/foo/bar.git",
            dirty=False,
        )
        self.assertEqual(action, "pull")


class TestCommandPlanning(unittest.TestCase):
    def test_clone_command(self):
        self.assertEqual(
            repo_sync.plan_clone_command("https://example.com/foo.git", "foo"),
            ["git", "clone", "https://example.com/foo.git", "foo"],
        )

    def test_pull_command(self):
        self.assertEqual(repo_sync.plan_pull_command(), ["git", "pull", "--ff-only"])


class TestConfigStore(unittest.TestCase):
    def setUp(self):
        self.tempdir = tempfile.TemporaryDirectory()
        self.path = Path(self.tempdir.name) / "repo-sync-config.json"

    def tearDown(self):
        self.tempdir.cleanup()

    def test_load_missing_returns_empty(self):
        self.assertEqual(repo_sync.load_config(self.path), [])

    def test_save_then_load_roundtrip(self):
        repos = [{"name": "x", "url": "https://e.com/x.git"}]
        repo_sync.save_config(self.path, repos)
        self.assertEqual(repo_sync.load_config(self.path), repos)

    def test_load_invalid_json_raises(self):
        self.path.write_text("{", encoding="utf-8")

        with self.assertRaises(RuntimeError) as caught:
            repo_sync.load_config(self.path)

        self.assertIn(str(self.path), str(caught.exception))

    def test_load_non_list_top_level_raises(self):
        self.path.write_text("{}", encoding="utf-8")

        with self.assertRaises(RuntimeError):
            repo_sync.load_config(self.path)


class TestRepoIsGit(unittest.TestCase):
    def test_repo_is_git_detects_git_directory(self):
        with tempfile.TemporaryDirectory() as tempdir:
            path = Path(tempdir)

            self.assertFalse(repo_sync.repo_is_git(path))

            (path / ".git").mkdir()
            self.assertTrue(repo_sync.repo_is_git(path))


if __name__ == "__main__":
    unittest.main()
