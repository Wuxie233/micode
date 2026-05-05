---
tags: [atlas, decision]
---
# Factory Hooks with Dependency Injection

Hooks 采用 `createXHook(ctx)` 工厂函数，通过闭包保存状态和依赖，而不是使用业务 class 或全局单例。

## Rationale

- [[Hooks Pipeline]] 可以在 [[Plugin Composition]] 中按顺序装配。
- `PluginInput` 作为依赖入口，方便测试和隔离运行时资源。
- 闭包状态适合 cache、tracker、session cleanup 等轻量场景。

## Consequences

- hook 顺序是行为契约，调整顺序需要同步测试 chat、tool 和 event 阶段。
- cleanup 必须 best-effort，避免单个 hook 异常破坏整个 pipeline。
