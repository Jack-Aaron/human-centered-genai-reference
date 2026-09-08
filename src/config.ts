import path from 'node:path';
import dotenv from 'dotenv';

dotenv.config({ quiet: true });

function intEnv(name: string, fallback: number): number {
  const raw = process.env[name];
  if (!raw) return fallback;
  const value = Number.parseInt(raw, 10);
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${name} must be a non-negative integer`);
  }
  return value;
}

function resolveFromCwd(value: string): string {
  return path.resolve(process.cwd(), value);
}

export const config = {
  host: process.env.HOST ?? '127.0.0.1',
  port: intEnv('PORT', 3000),
  dbPath: resolveFromCwd(process.env.DB_PATH ?? './data/app.sqlite'),
  migrationsPath: resolveFromCwd('./migrations'),

  globalCooldownSeconds: intEnv('GLOBAL_COOLDOWN_SECONDS', 10),
  globalDailyCap: intEnv('GLOBAL_DAILY_CAP', 50),
  apiClientDailyCap: intEnv('API_CLIENT_DAILY_CAP', 20),
  apiClientRateLimitPerMinute: intEnv(
    'API_CLIENT_RATE_LIMIT_PER_MINUTE',
    60,
  ),
  maxRequestBytes: intEnv('MAX_REQUEST_BYTES', 8192),
  authMaxClockSkewSeconds: intEnv('AUTH_MAX_CLOCK_SKEW_SECONDS', 300),

  externalCorpusUrl:
    process.env.EXTERNAL_CORPUS_URL ?? 'file://./data/sample-corpus.html',
  corpusSnapshotPath: resolveFromCwd(
    process.env.CORPUS_SNAPSHOT_PATH ?? './data/corpus-snapshot.json',
  ),
  corpusMinEntries: intEnv('CORPUS_MIN_ENTRIES', 3),
  corpusMaxBytes: intEnv('CORPUS_MAX_BYTES', 1024 * 1024),
  corpusFetchTimeoutMs: intEnv('CORPUS_FETCH_TIMEOUT_MS', 5000),
  corpusMaxAgeSeconds: intEnv('CORPUS_MAX_AGE_SECONDS', 3600),

  slackSigningSecret: process.env.SLACK_SIGNING_SECRET ?? '',
  slackTeamId: process.env.SLACK_TEAM_ID ?? '',
  slackCommand: process.env.SLACK_COMMAND ?? '/generate',
};
