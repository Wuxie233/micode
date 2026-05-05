---
tags: [atlas, impl]
---
# Skill Autopilot

`src/skill-autopilot/` 从 lifecycle journal、records 和 ledgers 中挖掘可复用 procedure candidate，并在安全门禁通过后写入 `.opencode/skills/<name>/SKILL.md`。

## Responsibilities

- `runAutopilot` 检查 project identity、写入边界、并发锁和候选策略。
- candidate miner 从已批准流程和 ledgers 中抽取可复用步骤。
- policy 根据 recurrence、issue 覆盖、敏感级别和已有 skill 决定 create、patch 或 skip。
- security pipeline 检查 schema、PII、prompt injection、destructive 操作、代码照搬、冲突标记和长度。
- writer 做原子写入，stale sweep 标记失效 skill。

## Links

- 与 [[Lifecycle State Machine]] 和 [[Project Memory Store]] 共享历史上下文。
- [[Valibot at System Boundaries]] 覆盖其 schema gate 思路。
