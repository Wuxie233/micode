---
tags: [atlas, impl]
---
# Quality Tooling

`package.json`、`biome.json`、`eslint.config.js`、`tsconfig*.json`、`lefthook.yml` 与 `.github/workflows/` 定义 micode 的质量门禁和构建规则。

## Responsibilities

- `bun run check` 串联 `biome check .`、`eslint .`、`bun run typecheck` 和 `bun test`。
- Biome 负责格式化、import organize 和基础 lint。
- ESLint 负责 TypeScript 类型规则、复杂度、无业务 class、无 `any`、命名约束和 sonarjs 规则。
- Lefthook 在 pre-commit 阶段自动修复并暂存 Biome/ESLint 结果。
- GitHub Actions 在 PR、main push 和 release 中运行质量门禁。

## Links

- 实现 [[Quality Gate]]。
- [[Factory Hooks with Dependency Injection]] 和项目代码风格由该层约束。
