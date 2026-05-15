---
title: Bun Runtime
tags: [atlas, context]
sources:
  - code:package.json
  - code:bun.lock
---
# Bun Runtime

Bun 是项目的测试、构建、SQLite、shell 和部分 runtime API 基础。

## 角色

- `bun build` 生成 `dist/index.js`。
- `bun test` 运行测试套件。
- `bun:sqlite` 支撑 [[Project Memory 存储]] 与 [[Artifact 索引]]。
- `bun-pty` 支撑 [[PTY 工具]]。

## 备注

Bun 版本或 API 行为变化可能影响 build、tests、SQLite 和 PTY 四类路径。
