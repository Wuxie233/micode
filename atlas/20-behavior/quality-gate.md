---
tags: [atlas, behavior]
---
# Quality Gate

质量门禁把格式化、lint、类型检查和测试串成统一入口，保证提交前和 CI 中的行为一致。

## Mechanics

- `bun run check` 运行 `biome check .`、`eslint .`、`bun run typecheck` 和 `bun test`。
- `bun run build` 把 `src/index.ts` 构建到 `dist/`，target 是 Bun。
- `lefthook.yml` 在 pre-commit 阶段运行自动修复和暂存。
- GitHub Actions 在 PR、main push 和 release 中运行质量门禁。

## Links

- [[Quality Tooling]] 定义脚本和配置。
