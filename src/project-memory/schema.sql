-- src/project-memory/schema.sql
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
CREATE INDEX IF NOT EXISTS idx_entities_project_kind ON entities (project_id, kind);

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
);

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
CREATE INDEX IF NOT EXISTS idx_relations_to ON relations (project_id, to_id);

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
CREATE INDEX IF NOT EXISTS idx_sources_kind ON sources (project_id, kind);
