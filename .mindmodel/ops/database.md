# Database Operations

## Rules
- Initialize SQLite schema before processing sessions or artifacts.
- Keep DB access within dedicated store modules.
- Close database connections during shutdown hooks.

## Examples

### Schema Setup
```ts
export function initDatabase(db: Database) {
  db.exec("CREATE TABLE IF NOT EXISTS sessions (id TEXT PRIMARY KEY)");
}
```

### Store Module
```ts
export function createSessionStore(db: Database) {
  return {
    load: (id: string) => db.query("SELECT * FROM sessions WHERE id = ?").get(id)
  };
}
```

### Shutdown Hook
```ts
export function shutdown(db: Database) {
  db.close();
}
```

## Anti-patterns

### Inline DB Access
```ts
// BAD: ad-hoc DB usage inside tools
const db = new Database("./db.sqlite");
```

### Missing Cleanup
```ts
// BAD: DB never closed
export function start() {}
```
