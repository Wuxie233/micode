---
title: 知识层漂移
tags: [atlas, risk]
sources:
  - code:ARCHITECTURE.md
  - code:CODE_STYLE.md
  - code:.mindmodel/*
  - code:atlas/*
  - code:tests/agents/agents-md-knowledge-bootstrap.test.ts
---
# 知识层漂移

## Risk

`ARCHITECTURE.md`、`CODE_STYLE.md`、`.mindmodel/`、Atlas 和 Project Memory 分别由不同流程维护；如果其中一层更新而其他层未同步，agent 可能读取到互相矛盾的上下文。

## Mitigation

- `/all-rebuild` 按串行顺序重建三层，避免后续层读取旧材料。
- Drift-guard tests 检查关键 prompt 协议和 AGENTS.md 镜像一致性。
- 终态报告明确 Atlas status 与 Project Memory status。

## Links

- [[知识库启动命令]]
- [[Project Memory 与 Atlas 分层]]
