import fs from 'node:fs';
import path from 'node:path';
import Database from 'better-sqlite3';
import { config } from './config';

export type AppDb = Database.Database;

function applyMigrations(db: AppDb): void {
  db.exec(`
    CREATE TABLE IF NOT EXISTS schema_migrations (
      name TEXT PRIMARY KEY,
      applied_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );
  `);

  const files = fs
    .readdirSync(config.migrationsPath)
    .filter((name: string) => /^\d+.*\.sql$/.test(name))
    .sort();

  const hasMigration = db.prepare(
    'SELECT 1 FROM schema_migrations WHERE name = ?',
  );
  const recordMigration = db.prepare(
    'INSERT INTO schema_migrations(name) VALUES (?)',
  );

  for (const name of files) {
    if (hasMigration.get(name)) continue;
    const sql = fs.readFileSync(
      path.join(config.migrationsPath, name),
      'utf8',
    );
    db.transaction(() => {
      db.exec(sql);
      recordMigration.run(name);
    })();
  }
}

function seedState(db: AppDb): void {
  const insert = db.prepare(
    'INSERT OR IGNORE INTO state(key, value) VALUES (?, ?)',
  );
  insert.run('enabled', 'true');
  insert.run('last_successful_pull_at', '');
  insert.run('daily_pull_count', '0');
  insert.run('daily_pull_date', '');
  insert.run('global_cooldown_seconds', String(config.globalCooldownSeconds));
  insert.run('global_daily_cap', String(config.globalDailyCap));
}

export function openDb(dbPath = config.dbPath): AppDb {
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new Database(dbPath);
  db.pragma('journal_mode = WAL');
  db.pragma('foreign_keys = ON');
  db.pragma('busy_timeout = 5000');
  applyMigrations(db);
  seedState(db);
  return db;
}
