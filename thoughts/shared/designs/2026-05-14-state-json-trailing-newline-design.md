---
date: 2026-05-14
topic: ".opencode/skills/.state.json trailing newline 修复"
status: validated
issue: 75
---

## 承诺清单 / Commitments

> brainstormer 在 understanding 阶段提炼的用户原始要求 + sub-decisions 已确认。

用户原话：
- "OpenCode runtime 写 `.state.json` 不加 trailing newline：每次 commit 后 runtime 会覆盖，CI 反复 fail"
- "建议开独立 quick-mode lifecycle 修 OpenCode runtime 写文件时加 newline"

8 个 sub-decisions 已 batched ask 并获用户「可以 你推进吧」确认：

1. 修复方向 = **A**（在 `runner.ts:103` 加 `+ "\n"`，修源头）
2. INDEX.md 一并检查 = **A**（调研后确认 `renderIndexMd` 输出本已以 `\n` 结尾，INDEX.md 无问题，无需修改；本次只修 `.state.json`）
3. 测试 1 & 2 修复策略 = **A**（属于修复 B 范围，下个 lifecycle）
4. 测试 3 promoteOnLifecycleFinish = **A**（属于修复 B 范围）
5. 执行顺序 = **A**（先修复 A，本 lifecycle 就是 A）

本次提交承诺：
- 改 `src/skill-autopilot/runner.ts:103` 的 `saveState()` 加 trailing `\n`
- 检查 `renderIndexMd`：调研已确认无需修改（输出已含 `\n`）
- 加 regression 单元测试覆盖 saveState 输出以 `\n` 结尾
- 不改 `.gitignore` / biome 配置 / lefthook 配置
- 不破坏 saveState 现有行为契约
- 不引入新 byte-identical 镜像

## Problem Statement

`.opencode/skills/.state.json` 是 git tracked 文件，但 micode 自身的 `src/skill-autopilot/runner.ts:103` 的 `saveState()` 写入时用：

```
writeFileSync(file, JSON.stringify(state, null, JSON_INDENT))
```

**不附加 trailing `\n`**。每次 `lifecycle_commit` 的 pre-stage hook（`src/index.ts:907`）都会调用 `runSkillAutopilot` → `runInsideMutex` → 末尾无条件 `saveState`，覆盖 `.state.json` 为无 trailing newline 版本。

CI `bun run check` 中的 `biome check .` 扫描所有 tracked 文件，POSIX 规范要求所有文本文件末尾必须 `\n`，于是每次 PR 都会因 `.state.json` 缺 `\n` fail。

issue #69 (`b2dd03b`) 和 issue #73 (`ed573e9`) 都手动加过 `\n`，但只改了磁盘文件、没改源码，下次 autopilot 运行立即被覆盖回去。

## Constraints

- 不改 `.gitignore`（保持 `.state.json` 仍然 tracked，跨 session 状态 `hits` / `distinctIssues` 不丢）
- 不改 `biome.json` 配置（不绕过 lint）
- 不改 lefthook 配置（不引入 pre-commit auto-fix 复杂度）
- 不破坏 `saveState()` 现有行为契约：State object 结构不变、写入路径不变、调用者无感知
- 不动 lifecycle 工具代码 / Atlas / Project Memory / .mindmodel/
- 不引入新 byte-identical 镜像（本次不涉及 prompt）
- 不破坏现有 skill-autopilot 测试
- 修复后 `.state.json` 必须能被 `biome check .` 接受

## Approach

唯一改动点：`src/skill-autopilot/runner.ts:103` 的 `saveState()` 一行修改：

```diff
- writeFileSync(file, JSON.stringify(state, null, JSON_INDENT));
+ writeFileSync(file, `${JSON.stringify(state, null, JSON_INDENT)}\n`);
```

理由：
- **根本原因在 micode 自身代码**（非 OpenCode 平台）—— investigator 已确认 saveState 是 sole writer
- **1 行 1 文件**，影响范围最小
- **不改 saveState 调用契约**——只改输出字节末尾加 `\n`，调用者无感知
- 选项 B（gitignore）会丢跨-session 计数语义，不可接受
- 选项 C（biome ignore）是反模式
- 选项 D（lefthook auto-fix）治标且增加复杂度

并补一个 regression 单元测试，覆盖 saveState 输出以 `\n` 结尾，防止未来重构再退化。

## Architecture

修改前数据流：

```
lifecycle_commit
  └─ preStageHook = runSkillAutopilot
      └─ runInsideMutex
          └─ ... (业务逻辑)
          └─ saveState(cwd, state)
              └─ writeFileSync(file, JSON.stringify(...))   ← 无 \n
              
disk: .opencode/skills/.state.json  ← 末尾是 `}`
git add → git commit → push
CI biome check → FAIL
```

修改后数据流：

```
lifecycle_commit
  └─ preStageHook = runSkillAutopilot
      └─ runInsideMutex
          └─ ... (业务逻辑)
          └─ saveState(cwd, state)
              └─ writeFileSync(file, JSON.stringify(...) + "\n")   ← 有 \n
              
disk: .opencode/skills/.state.json  ← 末尾是 `}\n`
git add → git commit → push
CI biome check → PASS
```

## Components

### Component 1: `saveState()` 一行修改

文件：`src/skill-autopilot/runner.ts`
位置：第 103 行
变更：在 `JSON.stringify(state, null, JSON_INDENT)` 末尾拼接 `"\n"`

不动：
- `STATE_FILE` 常量
- `JSON_INDENT` 常量
- `mkdirSync` 逻辑
- 函数签名 `(cwd: string, state: State): void`
- 调用者（`runInsideMutex` 在 line 334 处的调用不变）

### Component 2: regression 单元测试

新增（或在现有 skill-autopilot 测试文件追加）一个测试：调用 `saveState`（或通过 runner 的公开 API 触发），读回写入文件，断言 `content.endsWith("\n") === true`。

测试需在临时目录运行（mkdtempSync），避免污染 worktree。

## Data Flow

无新数据流。仅改变现有 saveState 写入字节的末尾格式。

## Error Handling

- saveState 现有 fail-safe 行为（loadState 在解析失败时返回 `emptyState()`）不受影响：旧版本无 `\n` 的 .state.json 仍可被 JSON.parse 接受（newline 不是 JSON 语法元素）
- 旧 .state.json 升级路径：next saveState() 调用即修复（写入带 `\n` 的版本）；用户不需要手动迁移

## Testing Strategy

### 新增测试

- regression unit test：覆盖 saveState 输出以 `\n` 结尾

### 保持不变

- 所有 drift-guard / boundary 测试（本修复不涉及 prompt / lifecycle / Atlas / PM 协议）
- 现有 skill-autopilot 测试（如有）

### 验收

修复后跑 `bun run check`：
- `biome check .` 必须通过（特别是 `.opencode/skills/.state.json` 不再报缺 trailing newline）
- 整体 quality gate 不退化

dogfood：本 lifecycle 自身 commit 时会触发 preStageHook 跑 saveState（修改后的版本），CI 应一次通过。

## Open Questions

1. **是否在未来同步给其它 writeFileSync 调用加 trailing newline**：`lifecycle/lease/store.ts:58`、`atlas/challenge-dedup.ts:54`、`atlas/write-lock.ts:48` 都用 writeFileSync + JSON.stringify 无 `\n`，但产出的文件 **未被 git tracked**，不触发 CI fail。当前不修；若未来其中某个文件变成 tracked，应一并修。本 lifecycle 不扩展 scope。

2. **是否将 `JSON.stringify + "\n"` 抽出 helper**：micode 内多处用此 pattern，未来若有第 4 处可考虑抽出 `writeJsonFile()` helper。本次只 1 处修复，不抽象。

## Behavior

- `saveState()` 写出的 `.opencode/skills/.state.json` 文件末尾**始终包含 `\n`**（POSIX 规范）
- 用户运行 `lifecycle_commit` 时，pre-stage hook 触发 saveState，文件被写入后 `biome check .` 接受
- CI（`bun run check` 含 `biome check .`）不再因 `.state.json` 缺 trailing newline fail
- regression 测试守护：未来重构 saveState 时若不慎删除 `\n`，单元测试立即报错
- 验收方式：
  - 本 lifecycle 自身的 PR CI 通过（dogfood——本次 lifecycle_commit 会触发 saveState 写入新格式）
  - 修复后开新 lifecycle，观察 `.state.json` commit 后是否以 `\n` 结尾（`od -c <file> | tail -3` 看末尾字节）
  - 跑 `bun test src/skill-autopilot/` 或对应测试文件，新 regression test 应通过

> Atlas 关联：本次修复属于 runtime bug 修复，不构成长期心智模型变化，**不维护 atlas/20-behavior 节点**。Project Memory 也不 promote decision（无长期取舍）。Atlas status: no-change · Project Memory status: read-only。
