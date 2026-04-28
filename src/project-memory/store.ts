import { Database } from "bun:sqlite";
import { existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";

import { config } from "@/utils/config";
import type { Entity, Entry, EntryType, Relation, Sensitivity, Source, Status } from "./types";
import { StatusValues } from "./types";

const ERR_NOT_INITIALIZED = "Project memory store not initialized";

const ENTITIES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS entities (
    project_id TEXT NOT NULL,
    id TEXT NOT NULL,
    kind TEXT NOT NULL,
    name TEXT NOT NULL,
    summary TEXT,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_entities_project_kind ON entities (project_id, kind);`;

const ENTRIES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS entries (
    project_id TEXT NOT NULL,
    id TEXT NOT NULL,
    entity_id TEXT NOT NULL,
    type TEXT NOT NULL,
    title TEXT NOT NULL,
    summary TEXT NOT NULL,
    status TEXT NOT NULL,
    sensitivity TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    updated_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_entries_project_status ON entries (project_id, status);
  CREATE INDEX IF NOT EXISTS idx_entries_project_type ON entries (project_id, type);
  CREATE INDEX IF NOT EXISTS idx_entries_entity ON entries (project_id, entity_id);
  CREATE VIRTUAL TABLE IF NOT EXISTS entries_fts USING fts5(
    id UNINDEXED,
    project_id UNINDEXED,
    title,
    summary
  );`;

const RELATIONS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS relations (
    project_id TEXT NOT NULL,
    id TEXT NOT NULL,
    from_id TEXT NOT NULL,
    to_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_relations_from ON relations (project_id, from_id);
  CREATE INDEX IF NOT EXISTS idx_relations_to ON relations (project_id, to_id);`;

const SOURCES_SCHEMA = `
  CREATE TABLE IF NOT EXISTS sources (
    project_id TEXT NOT NULL,
    id TEXT NOT NULL,
    entry_id TEXT NOT NULL,
    kind TEXT NOT NULL,
    pointer TEXT NOT NULL,
    excerpt TEXT,
    created_at INTEGER NOT NULL,
    PRIMARY KEY (project_id, id)
  );
  CREATE INDEX IF NOT EXISTS idx_sources_entry ON sources (project_id, entry_id);
  CREATE INDEX IF NOT EXISTS idx_sources_kind ON sources (project_id, kind);`;

const SEARCH_LIMIT = config.projectMemory.defaultLookupLimit;
const STATUS_SET = new Set<string>(StatusValues);
const EMPTY_STATUS_COUNTS: Record<Status, number> = {
  active: 0,
  superseded: 0,
  tentative: 0,
  hypothesis: 0,
  deprecated: 0,
};
const SENSITIVITY_RANK: Record<Sensitivity, number> = {
  public: 0,
  internal: 1,
  secret: 2,
};

export interface SearchEntriesOptions {
  readonly type?: EntryType;
  readonly status?: Status;
  readonly entityId?: string;
  readonly sensitivityCeiling?: "public" | "internal";
  readonly limit?: number;
}

export interface SearchHit {
  readonly entry: Entry;
  readonly score: number;
}

export interface ProjectMemoryStoreOptions {
  readonly dbDir?: string;
  readonly dbFileName?: string;
}

export interface ProjectMemoryStore {
  initialize(): Promise<void>;
  upsertEntity(entity: Entity): Promise<void>;
  upsertEntry(entry: Entry): Promise<void>;
  upsertRelation(relation: Relation): Promise<void>;
  upsertSource(source: Source): Promise<void>;
  loadEntity(projectId: string, id: string): Promise<Entity | null>;
  loadEntry(projectId: string, id: string): Promise<Entry | null>;
  loadSourcesForEntry(projectId: string, entryId: string): Promise<readonly Source[]>;
  searchEntries(projectId: string, query: string, options?: SearchEntriesOptions): Promise<readonly SearchHit[]>;
  countEntities(projectId: string): Promise<number>;
  countEntries(projectId: string): Promise<number>;
  countEntriesByStatus(projectId: string): Promise<Record<Status, number>>;
  countSources(projectId: string): Promise<number>;
  countMissingSources(projectId: string): Promise<number>;
  countStaleEntries(projectId: string, olderThanMs: number): Promise<number>;
  forgetEntry(projectId: string, entryId: string): Promise<void>;
  forgetEntity(projectId: string, entityId: string): Promise<void>;
  forgetSource(projectId: string, kind: string, pointer: string): Promise<void>;
  forgetProject(projectId: string): Promise<void>;
  close(): Promise<void>;
}

interface StoreState {
  db: Database | null;
  readonly dbPath: string;
}

interface EntityRow {
  readonly project_id: string;
  readonly id: string;
  readonly kind: Entity["kind"];
  readonly name: string;
  readonly summary: string | null;
  readonly created_at: number;
  readonly updated_at: number;
}

interface EntryRow {
  readonly project_id: string;
  readonly id: string;
  readonly entity_id: string;
  readonly type: EntryType;
  readonly title: string;
  readonly summary: string;
  readonly status: Status;
  readonly sensitivity: Sensitivity;
  readonly created_at: number;
  readonly updated_at: number;
}

interface SourceRow {
  readonly project_id: string;
  readonly id: string;
  readonly entry_id: string;
  readonly kind: Source["kind"];
  readonly pointer: string;
  readonly excerpt: string | null;
  readonly created_at: number;
}

interface SearchRow extends EntryRow {
  readonly rank: number;
}

interface CountRow {
  readonly count: number;
}

interface StatusCountRow {
  readonly status: string;
  readonly count: number;
}

interface IdRow {
  readonly id: string;
}

type SearchParams = [
  string,
  string,
  EntryType | null,
  EntryType | null,
  Status | null,
  Status | null,
  string | null,
  string | null,
  number | null,
  number | null,
  number,
];

function getInlineSchema(): string {
  return [ENTITIES_SCHEMA, ENTRIES_SCHEMA, RELATIONS_SCHEMA, SOURCES_SCHEMA].join("\n");
}

function escapeFtsQuery(query: string): string {
  return query
    .replace(/['"]/g, "")
    .split(/\s+/)
    .filter((term) => term.length > 0)
    .map((term) => `"${term}"`)
    .join(" OR ");
}

function requireDb(db: Database | null): Database {
  if (!db) throw new Error(ERR_NOT_INITIALIZED);
  return db;
}

function readSchema(): string {
  const schemaPath = join(dirname(import.meta.path), "schema.sql");
  try {
    return readFileSync(schemaPath, "utf-8");
  } catch {
    // Bundled plugin builds can omit the sibling SQL file.
    return getInlineSchema();
  }
}

function initializeDb(dbPath: string): Database {
  const dir = dirname(dbPath);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const database = new Database(dbPath);
  database.exec(readSchema());
  return database;
}

function initializeState(state: StoreState): void {
  if (state.db) {
    state.db.exec(readSchema());
    return;
  }
  state.db = initializeDb(state.dbPath);
}

function rowToEntity(row: EntityRow): Entity {
  return {
    projectId: row.project_id,
    id: row.id,
    kind: row.kind,
    name: row.name,
    summary: row.summary ?? undefined,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToEntry(row: EntryRow): Entry {
  return {
    projectId: row.project_id,
    id: row.id,
    entityId: row.entity_id,
    type: row.type,
    title: row.title,
    summary: row.summary,
    status: row.status,
    sensitivity: row.sensitivity,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function rowToSource(row: SourceRow): Source {
  return {
    projectId: row.project_id,
    id: row.id,
    entryId: row.entry_id,
    kind: row.kind,
    pointer: row.pointer,
    excerpt: row.excerpt ?? undefined,
    createdAt: row.created_at,
  };
}

function upsertEntityInDb(db: Database, entity: Entity): void {
  db.query<never, [string, string, Entity["kind"], string, string | null, number, number]>(
    `INSERT INTO entities (project_id, id, kind, name, summary, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, id) DO UPDATE SET
       kind = excluded.kind,
       name = excluded.name,
       summary = excluded.summary,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at`,
  ).run(
    entity.projectId,
    entity.id,
    entity.kind,
    entity.name,
    entity.summary ?? null,
    entity.createdAt,
    entity.updatedAt,
  );
}

function deleteEntryFts(db: Database, projectId: string, entryId: string): void {
  db.query<never, [string, string]>("DELETE FROM entries_fts WHERE project_id = ? AND id = ?").run(projectId, entryId);
}

function insertEntryFts(db: Database, entry: Entry): void {
  db.query<never, [string, string, string, string]>(
    "INSERT INTO entries_fts (id, project_id, title, summary) VALUES (?, ?, ?, ?)",
  ).run(entry.id, entry.projectId, entry.title, entry.summary);
}

function upsertEntryRow(db: Database, entry: Entry): void {
  db.query<never, [string, string, string, EntryType, string, string, Status, Sensitivity, number, number]>(
    `INSERT INTO entries (
       project_id, id, entity_id, type, title, summary, status, sensitivity, created_at, updated_at
     ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, id) DO UPDATE SET
       entity_id = excluded.entity_id,
       type = excluded.type,
       title = excluded.title,
       summary = excluded.summary,
       status = excluded.status,
       sensitivity = excluded.sensitivity,
       created_at = excluded.created_at,
       updated_at = excluded.updated_at`,
  ).run(
    entry.projectId,
    entry.id,
    entry.entityId,
    entry.type,
    entry.title,
    entry.summary,
    entry.status,
    entry.sensitivity,
    entry.createdAt,
    entry.updatedAt,
  );
}

function upsertEntryInDb(db: Database, entry: Entry): void {
  db.transaction(() => {
    deleteEntryFts(db, entry.projectId, entry.id);
    upsertEntryRow(db, entry);
    insertEntryFts(db, entry);
  })();
}

function upsertRelationInDb(db: Database, relation: Relation): void {
  db.query<never, [string, string, string, string, Relation["kind"], number]>(
    `INSERT INTO relations (project_id, id, from_id, to_id, kind, created_at)
     VALUES (?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, id) DO UPDATE SET
       from_id = excluded.from_id,
       to_id = excluded.to_id,
       kind = excluded.kind,
       created_at = excluded.created_at`,
  ).run(relation.projectId, relation.id, relation.fromId, relation.toId, relation.kind, relation.createdAt);
}

function upsertSourceInDb(db: Database, source: Source): void {
  db.query<never, [string, string, string, Source["kind"], string, string | null, number]>(
    `INSERT INTO sources (project_id, id, entry_id, kind, pointer, excerpt, created_at)
     VALUES (?, ?, ?, ?, ?, ?, ?)
     ON CONFLICT(project_id, id) DO UPDATE SET
       entry_id = excluded.entry_id,
       kind = excluded.kind,
       pointer = excluded.pointer,
       excerpt = excluded.excerpt,
       created_at = excluded.created_at`,
  ).run(
    source.projectId,
    source.id,
    source.entryId,
    source.kind,
    source.pointer,
    source.excerpt ?? null,
    source.createdAt,
  );
}

function loadEntityFromDb(db: Database, projectId: string, id: string): Entity | null {
  const row = db
    .query<EntityRow, [string, string]>("SELECT * FROM entities WHERE project_id = ? AND id = ?")
    .get(projectId, id);
  return row ? rowToEntity(row) : null;
}

function loadEntryFromDb(db: Database, projectId: string, id: string): Entry | null {
  const row = db
    .query<EntryRow, [string, string]>("SELECT * FROM entries WHERE project_id = ? AND id = ?")
    .get(projectId, id);
  return row ? rowToEntry(row) : null;
}

function loadSourcesFromDb(db: Database, projectId: string, entryId: string): Source[] {
  return db
    .query<SourceRow, [string, string]>("SELECT * FROM sources WHERE project_id = ? AND entry_id = ? ORDER BY id")
    .all(projectId, entryId)
    .map(rowToSource);
}

function sensitivityRank(ceiling: SearchEntriesOptions["sensitivityCeiling"]): number | null {
  return ceiling ? SENSITIVITY_RANK[ceiling] : null;
}

function searchEntriesInDb(db: Database, projectId: string, query: string, options: SearchEntriesOptions): SearchHit[] {
  const escaped = escapeFtsQuery(query);
  if (escaped.length === 0) return [];
  const ceiling = sensitivityRank(options.sensitivityCeiling);
  const rows = db
    .query<SearchRow, SearchParams>(SEARCH_SQL)
    .all(
      projectId,
      escaped,
      options.type ?? null,
      options.type ?? null,
      options.status ?? null,
      options.status ?? null,
      options.entityId ?? null,
      options.entityId ?? null,
      ceiling,
      ceiling,
      options.limit ?? SEARCH_LIMIT,
    );
  return rows.map((row) => ({ entry: rowToEntry(row), score: -row.rank }));
}

const SEARCH_SQL = `SELECT
  e.project_id,
  e.id,
  e.entity_id,
  e.type,
  e.title,
  e.summary,
  e.status,
  e.sensitivity,
  e.created_at,
  e.updated_at,
  bm25(entries_fts) AS rank
FROM entries_fts
JOIN entries e ON e.project_id = entries_fts.project_id AND e.id = entries_fts.id
WHERE e.project_id = ?
  AND entries_fts MATCH ?
  AND (? IS NULL OR e.type = ?)
  AND (? IS NULL OR e.status = ?)
  AND (? IS NULL OR e.entity_id = ?)
  AND (? IS NULL OR CASE e.sensitivity WHEN 'public' THEN 0 WHEN 'internal' THEN 1 ELSE 2 END <= ?)
ORDER BY rank
LIMIT ?`;

function countRows(db: Database, sql: string, projectId: string): number {
  return db.query<CountRow, [string]>(sql).get(projectId)?.count ?? 0;
}

function countEntitiesInDb(db: Database, projectId: string): number {
  return countRows(db, "SELECT count(*) AS count FROM entities WHERE project_id = ?", projectId);
}

function countEntriesInDb(db: Database, projectId: string): number {
  return countRows(db, "SELECT count(*) AS count FROM entries WHERE project_id = ?", projectId);
}

function countSourcesInDb(db: Database, projectId: string): number {
  return countRows(db, "SELECT count(*) AS count FROM sources WHERE project_id = ?", projectId);
}

function isStatus(status: string): status is Status {
  return STATUS_SET.has(status);
}

function countEntriesByStatusInDb(db: Database, projectId: string): Record<Status, number> {
  const counts = { ...EMPTY_STATUS_COUNTS };
  const rows = db
    .query<StatusCountRow, [string]>(
      "SELECT status, count(*) AS count FROM entries WHERE project_id = ? GROUP BY status",
    )
    .all(projectId);
  for (const row of rows) {
    if (isStatus(row.status)) counts[row.status] = row.count;
  }
  return counts;
}

function countMissingSourcesInDb(db: Database, projectId: string): number {
  return countRows(
    db,
    `SELECT count(*) AS count
     FROM entries
     WHERE project_id = ?
       AND NOT EXISTS (
         SELECT 1 FROM sources WHERE sources.project_id = entries.project_id AND sources.entry_id = entries.id
       )`,
    projectId,
  );
}

function countStaleEntriesInDb(db: Database, projectId: string, olderThanMs: number): number {
  const cutoff = Date.now() - olderThanMs;
  return (
    db
      .query<CountRow, [string, number]>(
        "SELECT count(*) AS count FROM entries WHERE project_id = ? AND updated_at < ?",
      )
      .get(projectId, cutoff)?.count ?? 0
  );
}

function deleteEntryRows(db: Database, projectId: string, entryId: string): void {
  db.query<never, [string, string]>("DELETE FROM sources WHERE project_id = ? AND entry_id = ?").run(
    projectId,
    entryId,
  );
  db.query<never, [string, string, string]>(
    "DELETE FROM relations WHERE project_id = ? AND (from_id = ? OR to_id = ?)",
  ).run(projectId, entryId, entryId);
  deleteEntryFts(db, projectId, entryId);
  db.query<never, [string, string]>("DELETE FROM entries WHERE project_id = ? AND id = ?").run(projectId, entryId);
}

function forgetEntryInDb(db: Database, projectId: string, entryId: string): void {
  db.transaction(() => deleteEntryRows(db, projectId, entryId))();
}

function forgetEntityInDb(db: Database, projectId: string, entityId: string): void {
  db.transaction(() => {
    const rows = db
      .query<IdRow, [string, string]>("SELECT id FROM entries WHERE project_id = ? AND entity_id = ?")
      .all(projectId, entityId);
    for (const row of rows) deleteEntryRows(db, projectId, row.id);
    db.query<never, [string, string]>("DELETE FROM entities WHERE project_id = ? AND id = ?").run(projectId, entityId);
  })();
}

function forgetSourceInDb(db: Database, projectId: string, kind: string, pointer: string): void {
  db.query<never, [string, string, string]>(
    "DELETE FROM sources WHERE project_id = ? AND kind = ? AND pointer = ?",
  ).run(projectId, kind, pointer);
}

function forgetProjectInDb(db: Database, projectId: string): void {
  db.transaction(() => {
    db.query<never, [string]>("DELETE FROM sources WHERE project_id = ?").run(projectId);
    db.query<never, [string]>("DELETE FROM relations WHERE project_id = ?").run(projectId);
    db.query<never, [string]>("DELETE FROM entries_fts WHERE project_id = ?").run(projectId);
    db.query<never, [string]>("DELETE FROM entries WHERE project_id = ?").run(projectId);
    db.query<never, [string]>("DELETE FROM entities WHERE project_id = ?").run(projectId);
  })();
}

function active(state: StoreState): Database {
  return requireDb(state.db);
}

function createStore(state: StoreState): ProjectMemoryStore {
  return {
    initialize: async () => initializeState(state),
    upsertEntity: async (entity) => upsertEntityInDb(active(state), entity),
    upsertEntry: async (entry) => upsertEntryInDb(active(state), entry),
    upsertRelation: async (relation) => upsertRelationInDb(active(state), relation),
    upsertSource: async (source) => upsertSourceInDb(active(state), source),
    loadEntity: async (projectId, id) => loadEntityFromDb(active(state), projectId, id),
    loadEntry: async (projectId, id) => loadEntryFromDb(active(state), projectId, id),
    loadSourcesForEntry: async (projectId, entryId) => loadSourcesFromDb(active(state), projectId, entryId),
    searchEntries: async (projectId, query, options = {}) =>
      searchEntriesInDb(active(state), projectId, query, options),
    countEntities: async (projectId) => countEntitiesInDb(active(state), projectId),
    countEntries: async (projectId) => countEntriesInDb(active(state), projectId),
    countEntriesByStatus: async (projectId) => countEntriesByStatusInDb(active(state), projectId),
    countSources: async (projectId) => countSourcesInDb(active(state), projectId),
    countMissingSources: async (projectId) => countMissingSourcesInDb(active(state), projectId),
    countStaleEntries: async (projectId, olderThanMs) => countStaleEntriesInDb(active(state), projectId, olderThanMs),
    forgetEntry: async (projectId, entryId) => forgetEntryInDb(active(state), projectId, entryId),
    forgetEntity: async (projectId, entityId) => forgetEntityInDb(active(state), projectId, entityId),
    forgetSource: async (projectId, kind, pointer) => forgetSourceInDb(active(state), projectId, kind, pointer),
    forgetProject: async (projectId) => forgetProjectInDb(active(state), projectId),
    close: async () => {
      state.db?.close();
      state.db = null;
    },
  };
}

export function createProjectMemoryStore(options: ProjectMemoryStoreOptions = {}): ProjectMemoryStore {
  const dbDir = options.dbDir ?? config.projectMemory.storageDir;
  const dbFileName = options.dbFileName ?? config.projectMemory.dbFileName;
  return createStore({ db: null, dbPath: join(dbDir, dbFileName) });
}
