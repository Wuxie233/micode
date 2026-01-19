# Types

## Rules
- Use strict TypeScript types for tool payloads and schemas.
- Keep shared types in src/types modules.
- Prefer explicit interfaces for complex objects.

## Examples

### Shared Type
```ts
export interface SessionState {
  id: string;
  status: "open" | "closed";
}
```

### Schema Type
```ts
export interface MindmodelManifest {
  name: string;
  version: number;
}
```

### Typed Function
```ts
export function loadManifest(path: string): MindmodelManifest | null {
  return null;
}
```

## Anti-patterns

### Any Types
```ts
// BAD: avoids strict typing
export function loadManifest(path: string): any {
  return null;
}
```

### Inline Type Assertions
```ts
// BAD: avoids shared type
const manifest = payload as { name: string };
```
