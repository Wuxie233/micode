# Imports

## Rules
- Order imports with external deps first, then internal modules.
- Use node: protocol for built-in modules.
- Prefer barrel exports from index files.

## Examples

### Import Order
```ts
import { tool } from "@opencode-ai/plugin/tool";
import path from "node:path";

import { createSessionStore } from "./octto/session/sessions";
```

### Barrel Usage
```ts
import { tools } from "./tools";
```

### Node Protocol
```ts
import fs from "node:fs";
```

## Anti-patterns

### Mixed Order
```ts
// BAD: internal before external
import { tools } from "./tools";
import { tool } from "@opencode-ai/plugin/tool";
```

### Missing node: Prefix
```ts
// BAD: missing node: prefix
import path from "path";
```
