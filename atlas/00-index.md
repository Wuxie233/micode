---
title: micode Atlas Index
tags: [atlas, index]
---
# micode Atlas Index

`micode` 是一个 TypeScript/Bun OpenCode plugin：它把 Brainstorm → Plan → Implement 工作流、domain-routed implementers、冻结 API 契约、Octto 浏览器问答、issue-driven lifecycle、Project Memory、Mindmodel 和 Atlas vault 组合成面向 OpenCode 开发者的 service-shaped agent 编排服务。

## Inferred Project Pitch

micode 为使用 OpenCode 的开发者和 agent 编排者提供一套“先澄清、再规划、再并行执行、最后审查与沉淀知识”的插件化工作流。

## Inferred Primary Users

主要用户是维护复杂代码库、希望让 AI agents 按项目约束协作、并需要跨会话连续性和交付可追踪性的开发者。

## Build Layer (10-impl)

- [[插件组合]]
- [[配置加载器]]
- [[Agent 注册表]]
- [[工作流 Agent]]
- [[Hooks 管线]]
- [[工具注册表]]
- [[子 Agent 派发工具]]
- [[Octto 会话系统]]
- [[Lifecycle 状态机]]
- [[Project Memory 存储]]
- [[Mindmodel 运行时]]
- [[Artifact 索引]]
- [[Atlas Vault 系统]]
- [[PTY 工具]]
- [[通知系统]]
- [[Skill Autopilot]]
- [[质量工具链]]
- [[Runtime Deploy 脚本]]

## Behavior Layer (20-behavior)

- [[头脑风暴到计划到实现工作流]]
- [[按领域路由执行]]
- [[冻结 API 契约]]
- [[Octto 浏览器问题流]]
- [[会话连续性账本]]
- [[Mindmodel 约束执行]]
- [[Atlas 命令]]
- [[Issue 驱动交付生命周期]]
- [[运行时部署工作流]]
- [[质量门禁]]
- [[知识库启动命令]]
- [[Project Memory 工作流]]
- [[专家评审路由]]

## Context Layer (30-context)

- [[OpenCode Plugin API]]
- [[Bun Runtime]]
- [[External CLI Integrations]]
- [[Local Runtime Checkout]]
- [[MCP Servers]]

## Decisions (40-decisions)

- [[纯 Agent 配置注册表]]
- [[Factory Hooks 与依赖注入]]
- [[Domain 路由与冻结契约]]
- [[Issue 驱动交付生命周期]]
- [[Atlas 作为 Obsidian Vault]]
- [[系统边界使用 Valibot]]
- [[Knowledge Bootstrap 串行三层重建]]
- [[Project Memory 与 Atlas 分层]]

## Risks (50-risks)

- [[运行时 Checkout 漂移]]
- [[远程 Git 所属误推]]
- [[子 Agent 失败与恢复漂移]]
- [[Atlas Wikilink 漂移]]
- [[模型配置缺口]]
- [[并发 Atlas 写入竞争]]
- [[知识层漂移]]

## Maintenance

- 本次 refresh-all 重建日志：`atlas/_meta/log/init-20260514T000000Z.md`。
- 旧维护日志保留在 `atlas/_meta/log/`，作为内部历史记录，不在用户层图谱中展开。
