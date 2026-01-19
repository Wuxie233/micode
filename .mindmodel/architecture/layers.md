# Architecture Layers

## Rules
- Keep entrypoint orchestration in src/index.ts.
- Keep hooks in src/hooks and tools in src/tools with clear boundaries.
- Keep Octto session logic under src/octto and indexing under src/indexing.

## Examples

### Entrypoint Wiring
```ts
import { tools } from "./tools";
import { hooks } from "./hooks";

export default { tools, hooks };
```

### Octto Session Layer
```ts
import { createSessionStore } from "./octto/session/sessions";

const sessions = createSessionStore();
```

### Indexing Layer
```ts
import { ingestMilestoneArtifact } from "./indexing/milestone-artifact-ingest";
```

## Anti-patterns

### Cross-layer Imports
```ts
// BAD: tools reaching into indexing internals
import { ingestMilestoneArtifact } from "../indexing/milestone-artifact-ingest";
```

### Entrypoint Logic Spread
```ts
// BAD: multiple entrypoints with duplicated wiring
export default { tools };
```
