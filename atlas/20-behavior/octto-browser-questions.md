---
tags: [atlas, behavior]
---
# Octto Browser Questions

Octto 是浏览器辅助的问答和 brainstorm 入口，让用户在 portal 中回答选择、文本、代码、diff、plan review 等问题。

## Mechanics

- 每个 Octto session 绑定创建它的 OpenCode conversation，跨 conversation 调用会被拒绝。
- 浏览器 UI 使用 draft-before-send，提交单题只保存草稿，点击 `Send N answer(s)` 才发送给 agent。
- `OCTTO_PUBLIC_BASE_URL` 可把 session 页面和 WebSocket 暴露到反向代理。
- auto-resume 在用户回答后把继续提示投回原会话。

## Links

- [[Octto Session System]] 实现 session、portal 和 WebSocket。
- [[Brainstorm Plan Implement Workflow]] 使用 Octto 做设计探索。
