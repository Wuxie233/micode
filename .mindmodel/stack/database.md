# Database Stack

## Rules
- Use bun:sqlite for local persistence and state stores.
- Use prepared statements or parameterized queries for writes.
- Initialize schema and indexes during startup.

## Examples

### Create Database Connection
```ts
import { Database } from "bun:sqlite";

const db = new Database("./data/state.sqlite");
```

### Parameterized Query
```ts
const insert = db.query("INSERT INTO sessions (id, data) VALUES (?, ?)");
insert.run(sessionId, payload);
```

### Schema Initialization
```ts
db.exec(`
  CREATE TABLE IF NOT EXISTS sessions (
    id TEXT PRIMARY KEY,
    data TEXT NOT NULL
  )
`);
```

## Anti-patterns

### Raw String Interpolation
```ts
// BAD: SQL injection risk
const rows = db.query(`SELECT * FROM sessions WHERE id = '${id}'`).all();
```

### Using Non-standard SQLite Libraries
```ts
// BAD: bypasses bun:sqlite
import sqlite3 from "sqlite3";
```
