---
title: 子 Agent 失败与恢复漂移
tags: [atlas, risk]
sources:
  - code:src/tools/spawn-agent/*
  - code:src/tools/resume-subagent.ts
  - code:tests/integration/spawn-agent-allsettled.test.ts
---
# 子 Agent 失败与恢复漂移

## 风险

并行 subagent 可能出现 transient、task_error 或 blocked；如果 coordinator 盲目重派，可能丢失已收集证据或产生互相矛盾的上下文。

## 缓解措施

- `spawn_agent` 使用 all-settled 返回每个任务状态。
- 对可恢复失败优先 `resume_subagent`，而不是新开 session。
- 在综合结果时明确跳过、恢复或重派的原因。

## 链接

- [[子 Agent 派发工具]]
