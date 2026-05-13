# Ops: Database & Persistence

## Rules

- **SQLite is the durable store** for: project memory entries, brainstorm sessions, artifact FTS, milestone index. Use `bun:sqlite` — it is synchronous and built into Bun.
- **Store encapsulation**: every SQLite-backed feature exports a `createXStore(db: Database): XStore` factory. The `Database` instance is created once at plugin init in `src/index.ts` and injected.
- **Schema initialization**: call `db.exec(schemaSQL)` in the store factory before returning the interface. Keep `schema.sql` adjacent to `store.ts` and import it as a raw string.
- **FTS5 for search**: project memory uses SQLite FTS5 virtual table for full-text search over `title + summary`. Use `MATCH` queries with the `bm25()` ranking function.
- **Deterministic IDs**: use SHA-1 digest of stable parts (projectId + entityName + pointer + title), not random UUIDs. Enables idempotent re-promote without duplicates.
- **Project identity**: all records are scoped by `projectId = digestFor(git remote get-url origin)`. This makes stores portable across worktrees of the same repo.
- **Filesystem artifacts**: lifecycle records, Octto sessions, ledgers, designs, plans are stored as JSON/Markdown in `thoughts/`. These are NOT indexed in SQLite. Do not put them in the DB.
- **Secret detection before insert**: run `detectSecret(value)` on any string being promoted to Project Memory. Reject strings that contain secrets.

## Examples

### Store factory with schema init

```typescript
// src/project-memory/store.ts
import { Database } from "bun:sqlite";
import schemaSQL from "./schema.sql" with { type: "text" };

export function createProjectMemoryStore(db: Database): ProjectMemoryStore {
  db.exec(schemaSQL);   // idempotent: CREATE TABLE IF NOT EXISTS ...
  return {
    loadEntity: (projectId, entityId) => {
      return db.query<Entity, [string, string]>(
        "SELECT * FROM entities WHERE project_id = ? AND id = ?"
      ).get(projectId, entityId) ?? null;
    },
    searchEntries: (projectId, query, limit) => {
      return db.query<SearchHit, [string, string, number]>(
        `SELECT e.*, bm25(entries_fts) as score
         FROM entries_fts fts JOIN entries e ON fts.rowid = e.rowid
         WHERE fts.project_id = ? AND entries_fts MATCH ?
         ORDER BY score LIMIT ?`
      ).all(projectId, query, limit);
    },
  };
}
```

### Deterministic ID generation

```typescript
// src/project-memory/promote.ts
import { createHash } from "node:crypto";

const ID_HASH_CHARS = 12;

function digestFor(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, ID_HASH_CHARS);
}

function stableId(prefix: string, parts: readonly string[]): string {
  return `${prefix}_${digestFor(parts.join("\0"))}`;
}

// Usage:
const entityId = stableId("ent", [projectId, entityName]);
const entryId  = stableId("entry", [projectId, entityId, sourcePointer, title]);
```

### Secret detection before insert

```typescript
// src/project-memory/promote.ts
import { detectSecret } from "@/utils/secret-detect";

for (const candidate of candidates) {
  const secretHit = detectSecret(candidate.summary);
  if (secretHit) {
    rejected.push({ title: candidate.title, reason: `secret: ${secretHit}` });
    continue;
  }
  // safe to insert
  await store.insertEntry(...);
}
```

## Anti-patterns

### Direct db access from callers

```typescript
// BAD: caller queries DB directly, bypassing the store interface
import db from "@/project-memory/store";
const rows = db.query("SELECT * FROM entries WHERE ...").all();

// GOOD: use the typed store interface exclusively
const hits = await store.searchEntries(projectId, query, 10);
```

### Random UUID for entry IDs

```typescript
// BAD: randomUUID breaks idempotency — duplicate promote creates duplicate rows
import { randomUUID } from "node:crypto";
const id = randomUUID();

// GOOD: SHA-1 digest — same inputs → same ID → upsert is idempotent
const id = stableId("entry", [projectId, entityId, pointer, title]);
```

### Storing design/plan files in SQLite

```typescript
// BAD: plans are filesystem artifacts, not DB records
db.exec(`INSERT INTO plans (path, content) VALUES (?, ?)`, [planPath, content]);

// GOOD: write to thoughts/shared/plans/*.md, index path in SQLite FTS only
await writeFile(planPath, content);
db.exec(`INSERT INTO artifact_index (path, kind) VALUES (?, ?)`, [planPath, "plan"]);
```
