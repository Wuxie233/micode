# Database / Persistence Stack

## Rules

- **SQLite via `bun:sqlite`** for: project memory (decisions/lessons/risks), brainstorm sessions, artifact FTS, milestone index.
- **Filesystem JSON** for: lifecycle records (`thoughts/lifecycle/*.json`), Octto session state (`thoughts/octto/sessions/`), ledgers (`thoughts/ledgers/`), designs/plans.
- **Never mix**: SQL-backed stores are for search/durable memory; filesystem JSON is for single-task artifacts that do not need querying.
- Each SQLite store is encapsulated behind a `createXStore(db)` factory returning a typed interface. Callers never access `db` directly.
- Schema migrations are run at store initialization. Keep the SQL schema file alongside the store (e.g., `schema.sql` adjacent to `store.ts`).
- Bun SQLite is synchronous by default; use `.run()` for writes and `.query().all()` / `.query().get()` for reads. Do not use async wrappers unless explicitly needed.
- **Project memory** is keyed by `projectId` (derived from `git remote get-url origin`). Stores survive worktree cleanup — never assume `thoughts/` persists.

## Examples

### Store factory pattern

```typescript
// src/project-memory/store.ts — pattern for all SQLite stores
import { Database } from "bun:sqlite";

export interface ProjectMemoryStore {
  readonly loadEntity: (projectId: string, entityId: string) => Promise<Entity | null>;
  readonly searchEntries: (projectId: string, query: string, limit: number) => Promise<SearchHit[]>;
  // ... more typed methods
}

export function createProjectMemoryStore(db: Database): ProjectMemoryStore {
  // Run migrations once at init
  db.exec(schemaSQL);
  return {
    loadEntity: async (projectId, entityId) => { /* query */ },
    searchEntries: async (projectId, query, limit) => { /* FTS query */ },
  };
}
```

### Filesystem JSON for lifecycle artifacts

```typescript
// src/lifecycle/store.ts — file-backed, not SQLite
import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { parseLifecycleRecord } from "./schemas";

export async function loadRecord(dir: string, issueNumber: number) {
  const path = join(dir, `thoughts/lifecycle/${issueNumber}.json`);
  try {
    const raw = JSON.parse(await readFile(path, "utf-8"));
    return parseLifecycleRecord(raw);
  } catch {
    return { ok: false, issues: ["not found"] };
  }
}
```

### Stable ID derivation (SHA-1 digest)

```typescript
// src/project-memory/promote.ts — deterministic IDs, no random UUIDs
import { createHash } from "node:crypto";

function digestFor(value: string): string {
  return createHash("sha1").update(value).digest("hex").slice(0, 12);
}

function stableId(prefix: string, parts: readonly string[]): string {
  return `${prefix}_${digestFor(parts.join("\0"))}`;
}
```

## Anti-patterns

### Accessing db directly from callers

```typescript
// BAD: bypasses store encapsulation
import { db } from "@/project-memory/store";
db.query("SELECT * FROM entries").all();

// GOOD: use the typed store interface
const store = createProjectMemoryStore(db);
const hits = await store.searchEntries(projectId, query, 10);
```

### Using random UUIDs for entry IDs

```typescript
// BAD: breaks idempotency; duplicate promote creates duplicate records
import { randomUUID } from "node:crypto";
const id = randomUUID();

// GOOD: derive ID deterministically from content hash
const id = stableId("entry", [projectId, entityId, sourcePointer, title]);
```
