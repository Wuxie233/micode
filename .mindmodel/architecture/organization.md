# Project Organization

## Rules
- Use barrel exports in index files to expose module groups.
- Keep kebab-case filenames for modules.
- Organize domain areas in top-level folders under src/.

## Examples

### Barrel Export
```ts
export * from "./tools";
export * from "./hooks";
```

### Kebab-case File
```ts
import { autoCompact } from "./hooks/auto-compact";
```

### Domain Folder Usage
```ts
import { createServer } from "./octto/session/server";
```

## Anti-patterns

### Mixed File Naming
```ts
// BAD: camelCase filename
import { loadConfig } from "./utils/loadConfig";
```

### Missing Barrel Export
```ts
// BAD: bypasses module index
import { loadMindmodel } from "./utils/mindmodel/loader";
```
