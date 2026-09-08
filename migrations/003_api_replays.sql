CREATE TABLE IF NOT EXISTS api_replays (
  client_key_id TEXT NOT NULL,
  nonce TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY(client_key_id, nonce),
  FOREIGN KEY(client_key_id) REFERENCES api_clients(key_id)
);

CREATE INDEX IF NOT EXISTS idx_api_replays_created_at
  ON api_replays(created_at);
