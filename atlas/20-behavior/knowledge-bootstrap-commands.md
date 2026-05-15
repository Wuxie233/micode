---
title: 知识库启动命令
tags: [atlas, behavior]
sources:
  - code:src/agents/knowledge-bootstrap-orchestrator.ts
  - code:src/tools/knowledge-bootstrap/*
  - code:AGENTS.md
---
# 知识库启动命令

`/all-init`、`/all-rebuild` 和 `/all-status` 是三层项目知识库的统一入口，串联 `/init` 文档、`.mindmodel/` 和 `atlas/`。

## 机制

- `/all-init` 是 missing-only，只补齐缺失层。
- `/all-rebuild` 是 refresh-all，确认后串行覆盖重建三层。
- `/all-status` 只读检查三层存在性、Atlas 健康度和 Project Memory 摘要。
- 三层必须串行，因为 Mindmodel 读取 `ARCHITECTURE.md` / `CODE_STYLE.md`，Atlas 又读取 `.mindmodel/`。
- `intent.pitch`、`intent.user`、`intent.shape` 由入口一次收集并下传，避免子流程重复询问。

## 链接

- [[Knowledge Bootstrap 串行三层重建]] 记录该设计。
