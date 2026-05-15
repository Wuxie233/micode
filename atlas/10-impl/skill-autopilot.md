---
title: Skill Autopilot
tags: [atlas, impl]
sources:
  - code:src/skill-autopilot/*
  - code:tests/skill-autopilot/*
---
# Skill Autopilot

`src/skill-autopilot/` 从项目材料或会话材料中挖掘 skill candidates，并经过安全 gates、原子写入、主权检查和推送保护。

## 职责

- 从 sources 中提取 candidate，并生成稳定 ID 与 slug。
- 通过 secret、PII、prompt injection、destructive、conflict marker、code verbatim 等 gates。
- 用 atomic writer、source hashes 和 overlap 检测维护 skill 文件。
- 通过 stale sweep 和 push guard 控制长期维护风险。

## 链接

- [[质量工具链]] 中的测试覆盖该模块的安全边界。
