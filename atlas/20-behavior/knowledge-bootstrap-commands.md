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

## Mechanics

- `/all-init` 是 missing-only，只补齐缺失层。
- `/all-rebuild` 是 refresh-all，确认后串行覆盖重建三层。
- `/all-status` 只读检查三层存在性、Atlas 健康度和 Project Memory 摘要。
- `/all-init`、`/all-rebuild`、`/all-status` 是 bootstrap-only flows，不要求 lifecycle ownership preflight，不启动 lifecycle，不创建 GitHub issue 或 lifecycle branch，也不运行 ownership preflight。
- 三层必须串行，因为 Mindmodel 读取 `ARCHITECTURE.md` / `CODE_STYLE.md`，Atlas 又读取 `.mindmodel/`。
- `intent.pitch`、`intent.user`、`intent.shape` 不由入口问卷统一收集；atlas-initializer 可从 README / package.json / ARCHITECTURE.md 推断，三者全空白时最多问 1 个关键问题。

## Links

- [[Knowledge Bootstrap 串行三层重建]] 记录该设计。
