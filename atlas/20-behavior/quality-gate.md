---
title: 质量门禁
tags: [atlas, behavior]
sources:
  - code:package.json
  - code:biome.json
  - code:eslint.config.js
  - code:lefthook.yml
  - code:.github/workflows/quality-gate.yml
  - code:tests/*
---
# 质量门禁

micode 的质量门禁结合格式化、lint、类型检查、Bun tests、reviewer prompt 和 CI workflow，确保 agent 产物不会只停留在表面完成。

## 机制

- `bun run check` 是完整本地 gate：Biome check、ESLint、typecheck、Bun tests。
- `bun run build` 校验 runtime bundle 能从 `src/index.ts` 构建到 `dist/`。
- `lefthook` 在 pre-commit 对 staged files 做自动修复。
- GitHub Actions 在 PR 和 main push 上运行质量 gate。
- reviewer 在 executor 循环中按任务做只读审查。

## 链接

- [[质量工具链]] 提供命令和配置。
