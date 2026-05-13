---
title: 质量工具链
tags: [atlas, impl]
sources:
  - code:package.json
  - code:biome.json
  - code:eslint.config.js
  - code:lefthook.yml
  - code:.github/workflows/*
  - code:tests/*
---
# 质量工具链

质量工具链由 Bun scripts、Biome、ESLint、TypeScript、Lefthook、GitHub Actions 和 `tests/` 组成，是项目变更进入发布或运行时前的主要门禁。

## Responsibilities

- `bun run build` 将 `src/index.ts` 构建到 `dist/`。
- `bun run typecheck` 运行 `tsc --noEmit`。
- `bun run lint` 运行 Biome lint 与 ESLint。
- `bun run check` 组合 Biome check、ESLint、typecheck 和 Bun tests。
- `lefthook.yml` 在 pre-commit 对 staged files 执行格式和 lint 修复。

## Links

- [[质量门禁]] 描述用户可执行的验收路径。
