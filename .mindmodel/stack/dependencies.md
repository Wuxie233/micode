# Dependencies

## Rules
- Use approved external deps: @opencode-ai/sdk, @opencode-ai/plugin, @opencode-ai/plugin/tool, valibot, yaml, bun:sqlite, bun-pty.
- Import internal modules from ./tools, ./types, ./hooks, ./utils, and ../octto using explicit paths.
- Use node: protocol for built-in Node modules.

## Examples

### External Tool Import
```ts
import { tool } from "@opencode-ai/plugin/tool";
```

### Internal Module Import
```ts
import { loadMindmodel } from "./utils/mindmodel";
```

### Node Built-in Import
```ts
import path from "node:path";
```

## Anti-patterns

### Unapproved Dependency
```ts
// BAD: unapproved runtime dependency
import axios from "axios";
```

### Deep Relative Paths
```ts
// BAD: brittle parent traversals
import { config } from "../../../utils/config";
```
