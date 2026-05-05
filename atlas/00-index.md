---
tags: [atlas, index]
---
# micode Atlas Index

`micode` 是一个 TypeScript OpenCode plugin，提供 Brainstorm、Plan、Implement 工作流、项目上下文 hooks、浏览器问答、子代理并行、生命周期交付、项目记忆和 Atlas vault。

## Build Layer (10-impl)

- [[Plugin Composition]]
- [[Config Loader]]
- [[Agent Registry]]
- [[Workflow Agents]]
- [[Hooks Pipeline]]
- [[Tools Registry]]
- [[Spawn Agent Tool]]
- [[Octto Session System]]
- [[Lifecycle State Machine]]
- [[Project Memory Store]]
- [[Mindmodel Runtime]]
- [[Artifact Indexing]]
- [[Atlas Vault System]]
- [[PTY Tools]]
- [[Notifications]]
- [[Skill Autopilot]]
- [[Quality Tooling]]
- [[Runtime Deploy Script]]

## Behavior Layer (20-behavior)

- [[Brainstorm Plan Implement Workflow]]
- [[Domain Routed Execution]]
- [[Frozen API Contracts]]
- [[Octto Browser Questions]]
- [[Session Continuity Ledgers]]
- [[Mindmodel Constraint Enforcement]]
- [[Atlas Commands]]
- [[Issue Driven Lifecycle]]
- [[Runtime Deploy Workflow]]
- [[Quality Gate]]

## Context Layer (30-context)

- [[OpenCode Plugin API]]
- [[Bun Runtime]]
- [[External CLI Integrations]]
- [[Local Runtime Checkout]]
- [[MCP Servers]]

## Decisions (40-decisions)

- [[Pure Agent Config Registry]]
- [[Factory Hooks with Dependency Injection]]
- [[Domain Routing with Frozen Contracts]]
- [[Issue Driven Delivery Lifecycle]]
- [[Atlas as Obsidian Vault]]
- [[Valibot at System Boundaries]]

## Risks (50-risks)

- [[Runtime Checkout Drift]]
- [[Remote Git Ownership Mistakes]]
- [[Subagent Failure and Resume Drift]]
- [[Atlas Wikilink Drift]]
- [[Model Configuration Gaps]]
- [[Concurrent Atlas Write Race]]

## Maintenance

- 维护日志保存在 `atlas/_meta/log/init-20260505T165726Z.md`，该目录作为内部运行记录，不在用户层图谱中展开。
