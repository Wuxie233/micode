---
date: 2026-05-12
topic: "Autonomous Lifecycle Recovery for Finish / Commit / Merge"
status: draft
---

# Autonomous Lifecycle Recovery

## Problem Statement

`lifecycle_finish` 的设计目标本来就是完成 lifecycle 的最后一公里：merge issue branch 到 base branch、关闭 GitHub issue、清理 worktree。实际使用中，工具一旦遇到 ambiguous lifecycle、record missing、merge conflict、dirty main worktree、cleanup blocker 等情况，经常直接失败并要求用户接管。用户真实预期是：这些属于 lifecycle 内部可恢复故障，AI 应该在安全边界内自己解决并继续 merge 到 main，而不是每次打断。

最近 issue #63 / #64 的落地暴露了两个典型问题：

- 多个历史 lifecycle record 长期停留在 `branch_ready` / `merging`，导致 `lifecycle_log_progress` / `lifecycle_current` 报 `ambiguous_active_lifecycle`。
- `lifecycle_finish(issue_number=63/64)` 在本地 lifecycle store 与运行时 store 不一致时返回 `Invalid issue number` / record not found，AI 只能退回手工 `git merge`。

根因不是单个 Git 命令失败，而是 lifecycle 体系缺少 **结构化诊断 + 有边界自动恢复循环**。工具目前主要输出 markdown 错误，prompt 又规定 single attempt + halt，导致 AI 没有稳定协议继续恢复。

## Constraints

硬约束：

- 不 force push；禁止 `git push --force` / `--force-with-lease`。
- 不跳过 git hooks；禁止 `--no-verify`。
- 不自动删除用户工作；untracked 文件默认不删，只能移动明确归属当前 lifecycle 的 artifacts 到 backup/quarantine。
- 不对主 worktree 执行 destructive reset；禁止在主 worktree `git reset --hard`。
- 不自动重启 OpenCode。
- 不碰 upstream；所有 remote write 仍只针对 ownership preflight 判定安全的 `origin`。
- bounded recovery 最多 2-3 轮，避免无限重试。
- 保留 lifecycle_finish 的最终职责：merge base branch、close issue、cleanup worktree。
- PR merge 与 local merge 两条路径都要保持可用。

软约束：

- 先把工具输出结构化，再改 prompt 行为，避免 prompt-only 猜字符串。
- 自动恢复只处理能被明确归因的状态；无法归因时 block 并给下一步建议。

## Approach

采用 **Bounded Autonomous Lifecycle Recovery**：

1. lifecycle 工具输出结构化 recovery hints：`failure_kind`、`safe_to_retry`、`recommended_next_action`、`issue_number`、`branch`、`worktree`、`candidates`、`conflict_files`。
2. primary / executor prompt 从 single-attempt halt 改成 bounded recovery loop：失败后先按 hint 尝试恢复，最多 2-3 次，再 block。
3. resolver / store 支持 stale record 识别、issue body reconstruct、ambiguous 消歧。
4. local merge 默认使用 temp merge worktree，不污染 main worktree。
5. cleanup blocker 对可安全归属的 lifecycle artifacts 做 backup/quarantine 后 retry。

核心原则：**工具负责分类与安全 hint，AI 负责恢复决策与重试 orchestration。**

## Architecture

### 层 1：结构化 failure model

新增 lifecycle recovery hint 类型，贯穿 `lifecycle_finish` / `lifecycle_commit` / `lifecycle_current` / `lifecycle_recovery_decision` 输出。

建议字段：

```text
status: success | blocked | failed | recovered
failure_kind:
  ambiguous_lifecycle
  stale_record
  record_missing
  invalid_issue_number
  dirty_base_worktree
  merge_conflict
  untracked_cleanup_blocker
  tracked_cleanup_blocker
  pr_checks_failed
  push_failed
  unknown
safe_to_retry: boolean
recommended_next_action:
  resume_issue
  clean_stale_records
  retry_finish
  use_temp_merge_worktree
  resolve_conflicts
  quarantine_artifacts
  ask_user
candidates?: issue records summary
conflict_files?: paths
backup_path?: path
```

### 层 2：resolver recovery

`resolver.current()` ambiguous 不再只是死路。新增 disambiguation 顺序：

1. 当前 branch 匹配 `issue/<N>-*` → 直接选对应 record。
2. 显式 issue_number 存在 → 优先 load / resume 该 issue。
3. 当前 cwd 等于某个 record.worktree → 选该 record。
4. GitHub issue body 有 lifecycle marker → reconstruct 或 refresh record。
5. stale candidates（GitHub issue closed、worktree missing、branch merged）标为 stale，不参与 active ambiguous。
6. 仍无法唯一确定 → block，列 candidates。

### 层 3：safe local merge

local merge 不再在主 worktree 执行 checkout / merge。改为：

1. preflight base branch 和 origin。
2. 创建 `/tmp/<repo>-merge-issue-<N>` temp worktree。
3. 在 temp worktree checkout base branch / fetch / merge issue branch。
4. 成功后 push base branch。
5. 失败且 conflict → 保留 temp worktree，返回 conflict files + recovery hint。
6. AI 可在 temp worktree 解决冲突、commit merge resolution，再 retry finish。

### 层 4：cleanup recovery

`cleanup-policy` 对 untracked blocker 分层：

- 明确属于当前 lifecycle 的 `thoughts/shared/designs` / `plans` / `atlas-deltas` 且已 record artifact → move 到 `thoughts/lifecycle/backups/issue-N/...`。
- duplicate leftovers / generated temp files → move 到 backup。
- 不明文件 / tracked dirty → block。

移动而不是删除，保证 recoverability。

### 层 5：prompt recovery loop

更新 brainstormer / planner / executor / commander 生命周期规则：

- lifecycle tool 失败时不立刻 halt。
- 读取 recovery hint。
- 执行最多 2-3 轮恢复动作。
- 每轮写 progress note（若可用）。
- 只有命中硬安全边界才 block 用户。

## Components

### `src/lifecycle/types.ts`

新增 `LifecycleRecoveryHint`、`LifecycleFailureKind`、`LifecycleRecommendedAction` 类型，并让 `FinishOutcome` / `CommitOutcome` / `CurrentOutcome` 可携带 hint。

### `src/tools/lifecycle/finish.ts`

格式化 markdown 时保留人类可读文本，同时输出稳定的 recovery section。异常 catch 时也要分类，不再只有 `## Lifecycle finish failed`。

### `src/tools/lifecycle/commit.ts`

修复 misleading header：commit 失败不再显示 `Lifecycle commit recorded`。push/stage/commit/no-op 分类输出 hint。

### `src/lifecycle/resolver.ts`

新增 `resolveExplicitOrRecover(issueNumber)` 与 stale candidate 分类。`current()` 在 ambiguous 时返回更多 candidate metadata，而不是只给编号。

### `src/tools/lifecycle/resume.ts`

支持 record 存在但 stale 时 force refresh / reconcile from issue body。

### `src/lifecycle/merge.ts`

local merge 改用 temp merge worktree；merge conflict 返回 conflict files，不污染主 worktree。

### `src/lifecycle/cleanup-classifier.ts` / `cleanup-policy.ts`

新增 lifecycle artifact quarantine 逻辑；tracked dirty 与 external worktree 仍 block。

### Agent prompts

更新：

- `src/agents/brainstormer.ts` lifecycle block
- `src/agents/planner.ts` ambiguous lifecycle 处理
- `src/agents/executor.ts` commit/finish recovery reporting
- `src/agents/commander.ts` operational merge/recovery summary
- `AGENTS.md` / global lifecycle policy 镜像

## Data Flow

```text
executor / primary 调 lifecycle_finish(issue_number)
  ↓
tool success?
  ├─ yes → report merged/closed/cleaned
  └─ no  → returns LifecycleRecoveryHint
          ↓
       primary reads hint
          ↓
       bounded recovery loop (max 3)
          ├─ ambiguous_lifecycle → disambiguate / clean stale candidates
          ├─ record_missing → lifecycle_resume(issue_number)
          ├─ dirty_base_worktree → retry finish using temp merge worktree
          ├─ merge_conflict → resolve in temp worktree, commit, retry
          ├─ untracked_cleanup_blocker → quarantine owned artifacts, retry cleanup
          └─ unsafe / unknown → block user
          ↓
       retry lifecycle_finish
          ↓
       success or final blocked report
```

## Error Handling

| Failure | 自动恢复 | Block 条件 |
|---|---|---|
| ambiguous lifecycle | 按 branch/worktree/explicit issue/body marker 消歧；stale records 标记 cleaned/aborted | 仍有多个 active 且无法归因 |
| record missing | `lifecycle_resume(issue_number)` 从 GitHub issue body reconstruct | issue 不存在或非 lifecycle issue |
| invalid issue number | normalize number；若 store mismatch 则 resume | 非正整数 / 无法恢复 |
| dirty base worktree | 使用 temp merge worktree | dirty 文件必须被用户保留且影响 merge source |
| merge conflict | 保留 temp worktree，AI 解析 conflict 后 retry | 冲突涉及无法判断的用户改动 |
| untracked cleanup blocker | move owned lifecycle artifacts to backup | 不明 untracked / tracked dirty |
| push failed | retry bounded；fetch 后普通 merge/retry | 需要 force push / auth 缺失 |
| PR checks failed | 报 checks 与 URL，block | CI failed 需要修代码 |

## Testing Strategy

- `tests/lifecycle/finish-recovery.test.ts`：failure hint 格式与 bounded retry 场景。
- `tests/lifecycle/resolver-recovery.test.ts`：ambiguous candidates、stale record、explicit issue 优先。
- `tests/lifecycle/merge-temp-worktree.test.ts`：dirty main worktree 时 local merge 使用 temp worktree；conflict files 返回。
- `tests/lifecycle/cleanup-quarantine.test.ts`：owned untracked artifacts backup，unknown untracked block。
- `tests/lifecycle/commit-recovery.test.ts`：stage/commit/push/no-op 分类，header 不误导。
- `tests/agents/lifecycle-recovery-prompt.test.ts`：brainstormer/planner/executor 不再含 single-attempt halt，含 bounded recovery loop。
- 回归：`tests/lifecycle/merge.test.ts`、`cleanup-policy.test.ts`、`recovery/inspect.test.ts` 继续通过。

## Open Questions

- stale record 自动标记为 `cleaned` 还是新增 `stale` state？倾向不扩 state，先写 recovery note + cleaned，降低迁移成本。
- conflict resolution 是否由 lifecycle tool 内部完成？不，AI / executor 完成，工具只暴露 temp worktree 与 conflict files。
- PR merge 路径遇到 conflict 是否也转 local temp merge？倾向只在 PR create/merge 明确 conflict 时给 AI fallback suggestion，不自动从 PR 模式切 local，避免绕过 GitHub checks。
- store path mismatch 是否应统一到 repo root 而非 plugin cwd？需要调查工具 deps.cwd 注入点，可能作为子任务修。
