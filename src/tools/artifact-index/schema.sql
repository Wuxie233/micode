-- src/tools/artifact-index/schema.sql
-- Artifact Index Schema for SQLite + FTS5

-- Handoffs table
CREATE TABLE IF NOT EXISTS handoffs (
    id TEXT PRIMARY KEY,
    session_name TEXT,
    file_path TEXT UNIQUE NOT NULL,
    task_summary TEXT,
    what_worked TEXT,
    what_failed TEXT,
    learnings TEXT,
    outcome TEXT CHECK(outcome IN ('SUCCEEDED', 'PARTIAL_PLUS', 'PARTIAL_MINUS', 'FAILED', 'UNKNOWN')),
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Plans table
CREATE TABLE IF NOT EXISTS plans (
    id TEXT PRIMARY KEY,
    title TEXT,
    file_path TEXT UNIQUE NOT NULL,
    overview TEXT,
    approach TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Ledgers table
CREATE TABLE IF NOT EXISTS ledgers (
    id TEXT PRIMARY KEY,
    session_name TEXT,
    file_path TEXT UNIQUE NOT NULL,
    goal TEXT,
    state_now TEXT,
    key_decisions TEXT,
    created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
    indexed_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- FTS5 virtual tables for full-text search
CREATE VIRTUAL TABLE IF NOT EXISTS handoffs_fts USING fts5(
    id,
    session_name,
    task_summary,
    what_worked,
    what_failed,
    learnings,
    content='handoffs',
    content_rowid='rowid'
);

CREATE VIRTUAL TABLE IF NOT EXISTS plans_fts USING fts5(
    id,
    title,
    overview,
    approach,
    content='plans',
    content_rowid='rowid'
);

CREATE VIRTUAL TABLE IF NOT EXISTS ledgers_fts USING fts5(
    id,
    session_name,
    goal,
    state_now,
    key_decisions,
    content='ledgers',
    content_rowid='rowid'
);

-- Triggers to keep FTS in sync
CREATE TRIGGER IF NOT EXISTS handoffs_ai AFTER INSERT ON handoffs BEGIN
    INSERT INTO handoffs_fts(rowid, id, session_name, task_summary, what_worked, what_failed, learnings)
    VALUES (NEW.rowid, NEW.id, NEW.session_name, NEW.task_summary, NEW.what_worked, NEW.what_failed, NEW.learnings);
END;

CREATE TRIGGER IF NOT EXISTS handoffs_ad AFTER DELETE ON handoffs BEGIN
    INSERT INTO handoffs_fts(handoffs_fts, rowid, id, session_name, task_summary, what_worked, what_failed, learnings)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.session_name, OLD.task_summary, OLD.what_worked, OLD.what_failed, OLD.learnings);
END;

CREATE TRIGGER IF NOT EXISTS handoffs_au AFTER UPDATE ON handoffs BEGIN
    INSERT INTO handoffs_fts(handoffs_fts, rowid, id, session_name, task_summary, what_worked, what_failed, learnings)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.session_name, OLD.task_summary, OLD.what_worked, OLD.what_failed, OLD.learnings);
    INSERT INTO handoffs_fts(rowid, id, session_name, task_summary, what_worked, what_failed, learnings)
    VALUES (NEW.rowid, NEW.id, NEW.session_name, NEW.task_summary, NEW.what_worked, NEW.what_failed, NEW.learnings);
END;

CREATE TRIGGER IF NOT EXISTS plans_ai AFTER INSERT ON plans BEGIN
    INSERT INTO plans_fts(rowid, id, title, overview, approach)
    VALUES (NEW.rowid, NEW.id, NEW.title, NEW.overview, NEW.approach);
END;

CREATE TRIGGER IF NOT EXISTS plans_ad AFTER DELETE ON plans BEGIN
    INSERT INTO plans_fts(plans_fts, rowid, id, title, overview, approach)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.title, OLD.overview, OLD.approach);
END;

CREATE TRIGGER IF NOT EXISTS plans_au AFTER UPDATE ON plans BEGIN
    INSERT INTO plans_fts(plans_fts, rowid, id, title, overview, approach)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.title, OLD.overview, OLD.approach);
    INSERT INTO plans_fts(rowid, id, title, overview, approach)
    VALUES (NEW.rowid, NEW.id, NEW.title, NEW.overview, NEW.approach);
END;

CREATE TRIGGER IF NOT EXISTS ledgers_ai AFTER INSERT ON ledgers BEGIN
    INSERT INTO ledgers_fts(rowid, id, session_name, goal, state_now, key_decisions)
    VALUES (NEW.rowid, NEW.id, NEW.session_name, NEW.goal, NEW.state_now, NEW.key_decisions);
END;

CREATE TRIGGER IF NOT EXISTS ledgers_ad AFTER DELETE ON ledgers BEGIN
    INSERT INTO ledgers_fts(ledgers_fts, rowid, id, session_name, goal, state_now, key_decisions)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.session_name, OLD.goal, OLD.state_now, OLD.key_decisions);
END;

CREATE TRIGGER IF NOT EXISTS ledgers_au AFTER UPDATE ON ledgers BEGIN
    INSERT INTO ledgers_fts(ledgers_fts, rowid, id, session_name, goal, state_now, key_decisions)
    VALUES ('delete', OLD.rowid, OLD.id, OLD.session_name, OLD.goal, OLD.state_now, OLD.key_decisions);
    INSERT INTO ledgers_fts(rowid, id, session_name, goal, state_now, key_decisions)
    VALUES (NEW.rowid, NEW.id, NEW.session_name, NEW.goal, NEW.state_now, NEW.key_decisions);
END;
