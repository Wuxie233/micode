# Logging

## Rules
- Use the shared logger with module-prefixed scopes.
- Use log.info for lifecycle events, log.warn for recoverable issues, log.error for failures.
- Include error objects as trailing parameters when available.

## Examples

### Module-scoped Logger
```ts
log.info("octto.server", "Websocket server started");
```

### Warning With Error
```ts
log.warn("mindmodel.loader", "Invalid manifest", error);
```

### Error With Context
```ts
log.error("hooks.auto-compact", "Auto-compact failed", error);
```

## Anti-patterns

### Console Output
```ts
// BAD: console logging in runtime code
console.error("Failed to load");
```

### Missing Scope
```ts
// BAD: logger without module scope
log.info("Started");
```
