# Validation

## Rules
- Validate YAML or JSON payloads with valibot schemas.
- Keep schemas in dedicated types modules.
- Surface schema errors via log.warn and return safe defaults.

## Examples

### Schema Validation
```ts
import { parse } from "valibot";
import { manifestSchema } from "./mindmodel/types";

const manifest = parse(manifestSchema, data);
```

### Dedicated Schema Module
```ts
export const manifestSchema = object({
  name: string(),
  version: number()
});
```

### Validation Gate
```ts
try {
  return parse(schema, payload);
} catch (error) {
  log.warn("mindmodel.types", "Schema validation failed", error);
  return null;
}
```

## Anti-patterns

### Skipping Validation
```ts
// BAD: uses raw payload
return payload as Manifest;
```

### Inline Schema Sprawl
```ts
// BAD: inline schema in function body
const schema = object({ name: string() });
```
