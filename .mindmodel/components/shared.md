# Shared Components

## Rules
- Keep shared hooks in src/hooks and tools in src/tools.
- Reuse Octto session helpers across tools instead of duplicating.
- Keep utility helpers in src/utils and surface through index barrels.

## Examples

### Hook Usage
```ts
import { mindmodelInjector } from "./hooks/mindmodel-injector";
```

### Tool Factory
```ts
import { createQuestionTool } from "./tools/octto/factory";
```

### Utility Usage
```ts
import { createLogger } from "./utils/logger";
```

## Anti-patterns

### Duplicated Helpers
```ts
// BAD: re-implements shared helper
function createLogger() {}
```

### Cross-domain Tooling
```ts
// BAD: tools reaching into indexing internals
import { ingestMilestoneArtifact } from "../indexing/milestone-artifact-ingest";
```
