# Naming

## Rules
- Use kebab-case for filenames.
- Use camelCase for functions and variables.
- Use SCREAMING_SNAKE_CASE for constants.

## Examples

### File Name
```ts
import { autoCompact } from "./hooks/auto-compact";
```

### Function Name
```ts
function createSessionStore() {}
```

### Constant Name
```ts
const MAX_RETRIES = 3;
```

## Anti-patterns

### PascalCase File
```ts
// BAD: PascalCase filename
import { load } from "./Hooks/AutoCompact";
```

### Lowercase Constant
```ts
// BAD: constant should be uppercase
const max_retries = 3;
```
