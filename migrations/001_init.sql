CREATE TABLE IF NOT EXISTS candidates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  text TEXT NOT NULL,
  normalized_text TEXT NOT NULL UNIQUE,
  status TEXT NOT NULL DEFAULT 'approved_unused'
    CHECK (status IN ('approved_unused', 'shown', 'rejected', 'maybe')),
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  shown_at TEXT,
  shown_count INTEGER NOT NULL DEFAULT 0,
  notes TEXT
);

CREATE TABLE IF NOT EXISTS state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS request_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  route TEXT NOT NULL,
  outcome TEXT NOT NULL,
  client_key_id TEXT,
  candidate_id INTEGER,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY(candidate_id) REFERENCES candidates(id)
);
