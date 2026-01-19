# Error Handling

## Rules
- Wrap IO and parsing in try/catch blocks.
- Use log.warn or log.error with module prefix for failures.
- Return safe defaults or propagate errors with context.

## Examples

### Safe Parse
```ts
try {
  return parseManifest(raw);
} catch (error) {
  log.warn("mindmodel.loader", "Failed to parse manifest", error);
  return null;
}
```

### Error Context
```ts
try {
  await sessions.close(sessionId);
} catch (error) {
  log.error("octto.sessions", "Failed to close session", error);
  throw error;
}
```

### Recoverable Failure
```ts
try {
  return await readFile(path);
} catch (error) {
  log.warn("utils.config", "Config missing", error);
  return defaultConfig;
}
```

## Anti-patterns

### Console Logging
```ts
// BAD: console logging bypasses logger
console.warn("Failed to parse");
```

### Swallowing Errors
```ts
// BAD: ignores error state
try {
  await doWork();
} catch {}
```
