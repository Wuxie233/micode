# 模块解耦与高复用 (Coupling and Reuse Philosophy)

This file is the SINGLE source of truth for module decoupling and reuse philosophy in this project.
AGENTS.md and agent prompts MUST reference this file rather than re-state the philosophy, to avoid drift.

## Rules

- 低耦合优先：模块之间通过显式接口、纯数据或工厂参数通信，禁止跨模块抓取私有状态或内部实现。
- 模块化分层：每个 src/ 子目录承担一个明确职责（agents 管 prompt、hooks 管生命周期、tools 管工具、utils 管纯工具函数），不混业务逻辑。
- 高复用："轮子"先行：业务功能由可复用的小工厂、小工具、共享 hook 拼装，而不是为每个需求新写一段一次性业务代码。
- 新轮子必须有正当性：只有当现有工具无法表达新需求且预期会被多处使用时，才允许新增公共抽象；其他情况优先扩展或组合现有工具。
- 三个使用阶段必须沿用同一份约束：
  1. brainstormer/architect 阶段：设计文档显式列出受影响的耦合面与可复用点，禁止"先做了再说"的临时业务堆积。
  2. planner 阶段：每个 task 标注它修改/新增的耦合面、复用了哪些现有工具、是否引入新轮子；引入新轮子时给出依据。
  3. reviewer 阶段：审查实现是否复用现有工具、是否引入了不必要的新抽象、是否泄露了私有状态或绕过了模块边界。

## Examples

### Reuse an existing utility instead of duplicating
```ts
// GOOD: business code composes existing wheels
import { extractErrorMessage } from "@/utils/errors";
import { createLogger } from "@/utils/logger";

const log = createLogger("payments");

export function chargeUser(input: ChargeInput) {
  try {
    return processCharge(input);
  } catch (error) {
    log.error("charge failed", { reason: extractErrorMessage(error) });
    throw error;
  }
}
```

### Communicate across modules via explicit injected interfaces
```ts
// GOOD: hook factory takes ctx, no hidden singleton coupling
export function createSomeHook(ctx: PluginInput) {
  return {
    onEvent: async (event: Event) => {
      await ctx.client.session.message(event.sessionID, { text: "ok" });
    },
  };
}
```

### Extend an existing wheel rather than create a new one
```ts
// GOOD: reuse the shared schema-driven validator with a new pipe step
import * as v from "valibot";
import { ConfigSchema } from "@/config-loader";

const StrictConfigSchema = v.pipe(ConfigSchema, v.check((c) => c.timeoutMs > 0, "timeout must be positive"));
```

## Anti-patterns

### Shotgun business logic (散弹式业务堆积)
```ts
// BAD: each new requirement adds a new ad-hoc handler with copy-pasted glue
export function handleNewRequirementA(input: unknown) {
  const log = console.log; // duplicated logger
  try {
    /* one-shot business code, no reuse */
  } catch (error) {
    log("err", error instanceof Error ? error.message : String(error));
  }
}
```

### Utility duplication (工具重复)
```ts
// BAD: re-implements an existing helper
function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}
// already exists as extractErrorMessage in @/utils/errors
```

### Future-proof abstraction (过度抽象 / future-proof abstraction)
```ts
// BAD: introduces a generic registry plus plugin interface for ONE current caller
export interface PaymentProcessorPlugin<TIn, TOut> {
  readonly id: string;
  readonly version: number;
  process(input: TIn): Promise<TOut>;
}
export class PaymentProcessorRegistry { /* ... only used by stripe today ... */ }
```

### Private-state coupling (私有状态耦合)
```ts
// BAD: reaches into another module's internal cache through a non-exported path
import { _internalCache } from "@/octto/session/sessions";
_internalCache.clear();
```
