# -*- coding: utf-8 -*-
from __future__ import annotations

import json
import subprocess
from pathlib import Path


CONFIG_FILENAME = "repo-sync-config.json"

TOP_MENU = """
请选择操作:
1. 拉取仓库
2. 配置仓库
3. 退出
"""
CONFIG_MENU = """
配置仓库:
1. 添加仓库
2. 修改仓库
3. 删除仓库
4. 查看列表
5. 返回主菜单
"""

ACTION_CLONE = "clone"
ACTION_PULL = "pull"
ACTION_SKIP_NOT_GIT = "skip-not-git"
ACTION_SKIP_REMOTE_MISMATCH = "skip-remote-mismatch"
ACTION_SKIP_DIRTY = "skip-dirty"

EXIT_SUCCESS = 0
EXIT_GIT_MISSING = 1

SUBPROCESS_OPTIONS = {
    "check": False,
    "capture_output": True,
    "text": True,
    "encoding": "utf-8",
}


def derive_dir_name(url: str) -> str:
    normalized = url.strip().rstrip("/").replace(":", "/")
    name = normalized.split("/")[-1]

    if name.endswith(".git"):
        name = name[: -len(".git")]

    if not name:
        raise ValueError("错误: 无法从仓库 URL 推导目录名")

    return name


def parse_menu_index(raw: str, count: int) -> int:
    try:
        selected = int(raw.strip())
    except ValueError as error:
        raise ValueError("错误: 请输入数字编号") from error

    if selected < 1 or selected > count:
        raise ValueError(f"错误: 请输入 1 到 {count} 之间的编号")

    return selected - 1


def decide_pull_action(
    target_dir: Path,
    expected_url: str,
    *,
    exists: bool,
    is_git: bool,
    origin_url: str | None,
    dirty: bool,
) -> tuple[str, str]:
    if not exists:
        return ACTION_CLONE, f"目标目录不存在,将克隆到 {target_dir}"

    if not is_git:
        return ACTION_SKIP_NOT_GIT, f"跳过: {target_dir} 已存在但不是 Git 仓库"

    if origin_url != expected_url:
        return ACTION_SKIP_REMOTE_MISMATCH, "跳过: 远端 URL 不匹配,不会改写 origin"

    if dirty:
        return ACTION_SKIP_DIRTY, "跳过: 仓库有未提交改动,请手动处理后重试"

    return ACTION_PULL, "仓库干净且远端匹配,将执行 fast-forward 拉取"


def plan_clone_command(url: str, target_dir: str) -> list[str]:
    return ["git", "clone", url, target_dir]


def plan_pull_command() -> list[str]:
    return ["git", "pull", "--ff-only"]


def load_config(path: Path) -> list[dict]:
    if not path.exists():
        return []

    try:
        content = path.read_text(encoding="utf-8")
        repos = json.loads(content)
    except json.JSONDecodeError as error:
        raise RuntimeError(f"错误: 配置文件 JSON 无效: {path}: {error}") from error

    if not isinstance(repos, list):
        raise RuntimeError(f"错误: 配置文件顶层必须是列表: {path}")

    for index, repo in enumerate(repos, start=1):
        if not _is_repo_config(repo):
            raise RuntimeError(f"错误: 第 {index} 个仓库配置必须包含字符串 name 和 url: {path}")

    return repos


def save_config(path: Path, repos: list[dict]) -> None:
    path.parent.mkdir(parents=True, exist_ok=True)
    content = json.dumps(repos, ensure_ascii=False, indent=2)
    path.write_text(f"{content}\n", encoding="utf-8")


def git_available() -> bool:
    try:
        result = subprocess.run(["git", "--version"], **SUBPROCESS_OPTIONS)
    except FileNotFoundError:
        return False

    return result.returncode == EXIT_SUCCESS


def repo_origin_url(target_dir: Path) -> str | None:
    result = subprocess.run(["git", "-C", str(target_dir), "remote", "get-url", "origin"], **SUBPROCESS_OPTIONS)

    if result.returncode != EXIT_SUCCESS:
        return None

    origin = result.stdout.strip()
    return origin or None


def repo_is_dirty(target_dir: Path) -> bool:
    result = subprocess.run(["git", "-C", str(target_dir), "status", "--porcelain"], **SUBPROCESS_OPTIONS)

    if result.returncode != EXIT_SUCCESS:
        return True

    return bool(result.stdout.strip())


def repo_is_git(target_dir: Path) -> bool:
    return (target_dir / ".git").exists()


def run_pull_flow(repos: list[dict], cwd: Path, config_path: Path) -> None:
    try:
        if not repos:
            print(f"跳过: 暂无仓库配置,请先配置 {config_path}")
            return

        _print_repo_list(repos)
        selected = parse_menu_index(input("请输入仓库编号: "), len(repos))
        repo = repos[selected]
        url = repo["url"]
        target_name = derive_dir_name(url)
        target_dir = cwd / target_name
        target_exists = target_dir.exists()
        target_is_git = repo_is_git(target_dir)
        origin_url = repo_origin_url(target_dir) if target_is_git else None
        dirty = repo_is_dirty(target_dir) if target_is_git else False
        action, reason = decide_pull_action(
            target_dir,
            url,
            exists=target_exists,
            is_git=target_is_git,
            origin_url=origin_url,
            dirty=dirty,
        )
        print(reason)
        _run_pull_action(action, url, target_name, cwd, target_dir)
    except Exception as error:
        print(f"错误: 拉取流程失败: {error}")


def run_configure_flow(config_path: Path) -> None:
    try:
        repos = load_config(config_path)
    except RuntimeError as error:
        print(error)
        return

    while True:
        print(CONFIG_MENU)
        raw = input("请输入操作编号: ")

        try:
            selected = parse_menu_index(raw, 5)
        except ValueError as error:
            print(error)
            continue

        if selected == 0:
            _add_repo(config_path, repos)
            continue

        if selected == 1:
            _modify_repo(config_path, repos)
            continue

        if selected == 2:
            _delete_repo(config_path, repos)
            continue

        if selected == 3:
            _print_repo_list(repos)
            continue

        return


def main() -> None:
    cwd = Path.cwd()
    config_path = Path(__file__).with_name(CONFIG_FILENAME)
    print(f"当前目标文件夹: {cwd}")

    if not git_available():
        print("错误: 未找到 Git。请安装 Git for Windows 并加入 PATH 后再试。")
        input("按回车键退出...")
        raise SystemExit(EXIT_GIT_MISSING)

    while True:
        print(TOP_MENU)
        raw = input("请输入操作编号: ")

        try:
            selected = parse_menu_index(raw, 3)
        except ValueError as error:
            print(error)
            continue

        if selected == 0:
            try:
                repos = load_config(config_path)
            except RuntimeError as error:
                print(error)
                continue

            run_pull_flow(repos, cwd, config_path)
            continue

        if selected == 1:
            run_configure_flow(config_path)
            continue

        input("按回车键退出...")
        raise SystemExit(EXIT_SUCCESS)


def _is_repo_config(repo: object) -> bool:
    if not isinstance(repo, dict):
        return False

    return isinstance(repo.get("name"), str) and isinstance(repo.get("url"), str)


def _print_repo_list(repos: list[dict]) -> None:
    if not repos:
        print("暂无仓库配置。")
        return

    for index, repo in enumerate(repos, start=1):
        print(f"{index}. {repo['name']} - {repo['url']}")


def _run_pull_action(action: str, url: str, target_name: str, cwd: Path, target_dir: Path) -> None:
    if action == ACTION_CLONE:
        result = subprocess.run(plan_clone_command(url, target_name), cwd=cwd, **SUBPROCESS_OPTIONS)
        _print_process_output(result)
        return

    if action == ACTION_PULL:
        result = subprocess.run(plan_pull_command(), cwd=target_dir, **SUBPROCESS_OPTIONS)
        _print_process_output(result)


def _print_process_output(result: subprocess.CompletedProcess[str]) -> None:
    if result.stdout:
        print(result.stdout.rstrip())

    if result.stderr:
        print(result.stderr.rstrip())

    if result.returncode != EXIT_SUCCESS:
        print(f"错误: Git 命令失败,退出码 {result.returncode}")


def _prompt_non_empty(label: str) -> str:
    while True:
        value = input(label).strip()

        if value:
            return value

        print("错误: 输入不能为空")


def _add_repo(config_path: Path, repos: list[dict]) -> None:
    name = _prompt_non_empty("请输入仓库名称/备注: ")
    url = _prompt_non_empty("请输入仓库 URL: ")
    repos.append({"name": name, "url": url})
    save_config(config_path, repos)
    print("已添加仓库配置。")


def _modify_repo(config_path: Path, repos: list[dict]) -> None:
    if not repos:
        print("跳过: 暂无仓库配置")
        return

    _print_repo_list(repos)

    try:
        selected = parse_menu_index(input("请输入要修改的仓库编号: "), len(repos))
    except ValueError as error:
        print(error)
        return

    repo = repos[selected]
    name = input(f"请输入新名称,留空保持 [{repo['name']}]: ").strip() or repo["name"]
    url = input(f"请输入新 URL,留空保持 [{repo['url']}]: ").strip() or repo["url"]
    repos[selected] = {"name": name, "url": url}
    save_config(config_path, repos)
    print("已修改仓库配置。")


def _delete_repo(config_path: Path, repos: list[dict]) -> None:
    if not repos:
        print("跳过: 暂无仓库配置")
        return

    _print_repo_list(repos)

    try:
        selected = parse_menu_index(input("请输入要删除的仓库编号: "), len(repos))
    except ValueError as error:
        print(error)
        return

    repo = repos[selected]
    confirm = input(f"确认删除 {repo['name']}? 输入 y 确认: ").strip().lower()

    if confirm != "y":
        print("已取消删除。")
        return

    del repos[selected]
    save_config(config_path, repos)
    print("已删除仓库配置。")


if __name__ == "__main__":
    main()
