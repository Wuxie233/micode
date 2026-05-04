# Windows Repo Sync Helper

## 用途

这个小工具用于在 Windows 的当前文件夹中拉取或克隆 Project Atlas 仓库，让你可以直接用 Obsidian 打开本地的 `atlas/` 目录。它适合把 Git 仓库当作笔记源的使用方式：先在目标文件夹运行同步，再从 Obsidian 选择同步出来的 `atlas/` vault。

## 前置条件

- Windows 10 或 Windows 11。
- Python 3 已安装并加入 PATH，或者可以通过 `py -3` 启动。
- Git for Windows 已安装并加入 PATH。

## 安装

- 将 `scripts/windows-repo-sync/` 整个文件夹复制到一个稳定位置，例如 `D:\Tools\windows-repo-sync\`。
- 将 `repo-sync-config.example.json` 复制为 `repo-sync-config.json`，然后按自己的仓库列表编辑里面的 `name` 和 `url`。
- 双击 `repo-sync.bat` 启动，或者在命令行中进入该工具目录后运行 `python repo-sync.py`。

## 使用

1. 在想要保存仓库的 Windows 文件夹中双击 `repo-sync.bat`。
2. 在菜单中选择 `1` 拉取仓库，或者选择 `2` 配置仓库列表。
3. 选择拉取时，输入要同步的仓库编号。
4. 脚本会在当前文件夹下克隆仓库，或者对已有仓库执行快进更新。
5. 同步完成后，用 Obsidian 打开仓库里的 `atlas/` 目录。

## 安全性

- 不存储任何凭据、token、密码或 SSH 密钥。
- 仓库脏时跳过,不会 stash/reset。
- 远端 URL 与配置不匹配时跳过,不会改写 origin。
- 仅使用 `git pull --ff-only`,从不 rebase/合并。

## 配置文件格式

`repo-sync-config.json` 是一个仓库列表，每个条目只包含显示名称和 Git URL。

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

字段说明：

- `name`：菜单里显示的仓库名称，可以写成自己容易识别的备注。
- `url`：仓库的 HTTPS 或 SSH 地址，必须和已有本地仓库的 `origin` 地址一致。

## 常见问题

- `未找到 Python` -> 安装 Python 3 并勾选 Add to PATH。
- `未找到 Git` -> 安装 Git for Windows。
- `跳过: 仓库有未提交改动` -> 在该仓库手动提交或丢弃改动后重试。
- `跳过: 远端 URL 不匹配` -> 检查配置或换一个空目录重试。

## 限制

- 一次只拉一个仓库。
- 不支持自定义本地目录名。
- 不会自动打开 Obsidian。
