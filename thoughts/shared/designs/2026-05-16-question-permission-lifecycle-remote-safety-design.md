---
date: 2026-05-16
topic: "Question permission and lifecycle remote-write safety"
status: validated
---

## 承诺清单 / Commitments

**用户原话：**

- “最近Issue开发的新功能都要合并到main 然后我要最新版本的插件”
- “那你推进这两个吧”

**已确认决策：**

- #71 和 #81 之前确实做过，但旧分支落后当前 `main`，不直接 merge。
- 在当前 `main` 上重落仍有价值的功能。
- #71 只补 OpenCode 内置 `question` 工具权限默认可见，不注册自定义 wrapper。
- #81 只补 lifecycle 远端写前 ownership gate，不做 repo-discovery 大重构，不做远端分支自动清理。
- 交付后推送 `origin/main` 并部署 runtime，但不重启 OpenCode。

**承诺条目：**

- micode agents 默认能调用 OpenCode 内置 `question` 工具。
- 用户显式配置的 `permission.question` 不被覆盖。
- 插件不会注册自定义 `question` 工具来 shadow OpenCode 内置工具。
- lifecycle 的 `commit` / `finish` 等远端写路径在写 GitHub 或 push 前重新执行 ownership 检查。
- `UNKNOWN` / `UPSTREAM` remote classification 必须 fail closed，不允许继续远端写。
- 当前 `main` 已有的新能力不能被旧 #71/#81 分支回退。

## Problem Statement

近期 #71 和 #81 的方向是对的，但旧分支已经落后当前 `main`。直接 merge 会把 lifecycle、Project Memory、Atlas、Lens Swarm、conflict resolver 等后续能力带回旧状态。

我们要做的是**基于当前 `main` 重放核心能力**：让 built-in `question` 可用，并让 lifecycle 的远端写操作不再只依赖 start 阶段的 ownership 检查。

## Constraints

- 不直接 merge `origin/issue/71` 或 `origin/issue/81`。
- 不 force push，不 `--no-verify`，不 `git reset --hard`。
- 不自动重启 OpenCode，只部署 runtime 供用户手动重启。
- 远端写只允许确认安全的 `origin=Wuxie233/micode` fork，不碰 upstream。
- #81 的 branch cleanup / remote branch deletion 保持 defer；本轮不引入自动删除远端分支能力。
- repo discovery 不做大重构；复用当前 `classifyRepo` 与 origin-derived slug 模式。

## Approach

我选 **最小重放方案**。

**#71：**在 plugin config hook 中补 `permission.question = "allow"` 的 fill-missing 语义。也就是说默认打开 built-in `question`，但用户显式 deny/ask/pattern-map 时不覆盖。

**#81：**把当前 start 阶段已有的 `classifyRepo` 思路提升成 remote-write gate，在 `commit` 和 `finish` 等会 push / PR / issue close 的路径前重新检查 ownership。`FORK` / `OWN` 放行，`UNKNOWN` / `UPSTREAM` 阻断并返回可恢复提示。

我拒绝直接合旧分支，因为它会引入旧 lifecycle 文件、旧测试和过期文档，回归面大于收益。

## Architecture

整体保持当前架构，只新增两个小边界：

- **Permission default boundary**：plugin config 生成阶段补齐 built-in question 权限。
- **Remote mutation boundary**：lifecycle 远端写阶段统一调用 ownership guard。

这两个边界都应是小 helper，不改变 agent prompt、工具注册模型或 lifecycle record 主结构。

## Components

**Question permission helper**

- 输入现有 OpenCode `permission` map。
- 只在缺少 `question` 时填默认 allow。
- 不注册自定义 `question` tool。
- 测试覆盖用户 override 与 tool map 不 shadow。

**Lifecycle remote-write guard**

- 复用 `classifyRepo`。
- 对 remote mutation 给出明确 allow/block 结果。
- 覆盖 `lifecycle_commit` push 与 `lifecycle_finish` PR/local-merge/close issue 入口。
- UNKNOWN / UPSTREAM 必须 fail closed。

**Tests**

- 权限合并测试。
- plugin wiring smoke test。
- lifecycle commit/finish remote-write gate 测试。
- 现有 lifecycle recovery / merge / pre-flight 测试保持通过。

## Data Flow

**Question permission：**

OpenCode loads plugin config → micode config hook merges permission map → helper fills missing `question` permission → agents can call built-in question UI.

**Lifecycle remote write：**

Lifecycle tool invoked → resolve record/worktree → before remote mutation, classify current `origin` → allow only `FORK` / `OWN` → execute push/PR/issue mutation → otherwise return blocked/recovery result.

## Error Handling

- `UNKNOWN` remote：阻断远端写，保留本地状态，返回 decision-minimal recovery hint。
- `UPSTREAM` remote：阻断远端写，提示需要 fork / origin 修正 / 用户明确决策。
- `gh` 不可用或 repo view 失败：按 `UNKNOWN` 处理，不猜测安全。
- `question` 权限用户显式覆盖：尊重用户配置，不强行恢复 allow。

## Testing Strategy

- Unit：permission helper preserves override / fills missing。
- Wiring：plugin tool map 不包含自定义 `question`，config hook 后 permission 可见。
- Lifecycle：commit/finish remote-write 前调用 ownership gate；UNKNOWN/UPSTREAM 不执行 push/PR/issue mutation。
- Regression：跑 build 与相关 lifecycle/plugin 测试；全量测试若仍受 host fixture 影响，要明确记录。

## Open Questions

- 是否将 `task` / `todowrite` / `todoread` 也默认 allow：本轮不做，避免扩大 read-only agent 权限面。
- 是否实现 branch audit / cleanup：本轮不做；若后续需要，单独设计只读审计，不自动删远端分支。
- 是否做 repo discovery 大重构：本轮不做，当前问题可用 remote-write gate 解决。

## Behavior

用户可见行为承诺：

- agent 需要结构化提问时，默认可以走 OpenCode 内置 `question` UI，不再因为 micode config 没放权而退回纯聊天。
- 如果用户自己显式禁用或改写 `permission.question`，micode 尊重该配置。
- lifecycle 在 commit / finish 这类会写 GitHub 或 push 的阶段，会重新确认当前 `origin` 是安全目标；如果发现 unknown/upstream，会停下而不是误写。
- 本轮不会自动重启 OpenCode；部署后由用户下次手动重启加载新插件。

验收方式：

- 检查 plugin config hook 后 `permission.question` 默认存在。
- 检查 plugin tool map 没有自定义 `question`。
- 模拟 UNKNOWN / UPSTREAM remote，确认 lifecycle commit/finish 不执行远端写。
- 正常 fork/own remote 下 build 和相关测试通过，runtime deploy 成功。

Atlas 关联：未找到现有 atlas/20-behavior 节点；本次行为对应新的 built-in question permission 与 lifecycle remote-write safety，executor 在 batch 完成后按需维护 Atlas。
