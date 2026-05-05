---
tags: [atlas, context]
---
# Bun Runtime

Bun 是 micode 的运行时、构建目标和测试运行器，`package.json` 的 `module` 与 `main` 都指向 `dist/index.js`。

## Notes

- `bun run build` 使用 `bun build src/index.ts --target bun`。
- `bun:test` 驱动 `tests/` 中的行为测试。
- `bun:sqlite` 支撑 [[Artifact Indexing]] 和 [[Project Memory Store]] 的本地存储。
- `bun-pty` 是可选依赖，由 [[PTY Tools]] 在运行时加载。
