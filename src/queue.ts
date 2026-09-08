import { AppDb } from './db';

export type GateResult =
  | { kind: 'eligible' }
  | { kind: 'blocked'; code: string; text: string };

export type PullResult =
  | { kind: 'served'; id: number; text: string }
  | { kind: 'blocked'; code: string; text: string }
  | { kind: 'empty' };

function utcDate(nowMs: number): string {
  return new Date(nowMs).toISOString().slice(0, 10);
}

function getState(db: AppDb, key: string): string {
  const row = db.prepare('SELECT value FROM state WHERE key = ?').get(key) as
    | { value: string }
    | undefined;
  if (!row) throw new Error(`Missing state key: ${key}`);
  return row.value;
}

function setState(db: AppDb, key: string, value: string): void {
  db.prepare(
    `UPDATE state
       SET value = ?, updated_at = CURRENT_TIMESTAMP
     WHERE key = ?`,
  ).run(value, key);
}

function globalCountForToday(db: AppDb, today: string): number {
  return getState(db, 'daily_pull_date') === today
    ? Number.parseInt(getState(db, 'daily_pull_count'), 10)
    : 0;
}

function clientForToday(
  db: AppDb,
  keyId: string,
  today: string,
): { enabled: boolean; count: number; cap: number } | undefined {
  const row = db.prepare(
    `SELECT enabled, daily_count, daily_date, daily_cap
       FROM api_clients
      WHERE key_id = ?`,
  ).get(keyId) as
    | {
        enabled: number;
        daily_count: number;
        daily_date: string;
        daily_cap: number;
      }
    | undefined;

  if (!row) return undefined;
  return {
    enabled: row.enabled === 1,
    count: row.daily_date === today ? row.daily_count : 0,
    cap: row.daily_cap,
  };
}

export function checkPullGate(
  db: AppDb,
  options: { clientKeyId?: string } = {},
  nowMs = Date.now(),
): GateResult {
  if (getState(db, 'enabled') !== 'true') {
    return { kind: 'blocked', code: 'disabled', text: 'SERVICE_DISABLED' };
  }

  const today = utcDate(nowMs);
  const globalCap = Number.parseInt(getState(db, 'global_daily_cap'), 10);
  if (globalCountForToday(db, today) >= globalCap) {
    return {
      kind: 'blocked',
      code: 'global_daily_limit',
      text: 'GLOBAL_DAILY_LIMIT',
    };
  }

  if (options.clientKeyId) {
    const client = clientForToday(db, options.clientKeyId, today);
    if (!client || !client.enabled) {
      return { kind: 'blocked', code: 'client_disabled', text: 'CLIENT_DISABLED' };
    }
    if (client.count >= client.cap) {
      return {
        kind: 'blocked',
        code: 'client_daily_limit',
        text: 'CLIENT_DAILY_LIMIT',
      };
    }
  }

  const last = getState(db, 'last_successful_pull_at');
  if (last) {
    const lastMs = Date.parse(last);
    const cooldown = Number.parseInt(
      getState(db, 'global_cooldown_seconds'),
      10,
    );
    const remainingMs = lastMs + cooldown * 1000 - nowMs;
    if (remainingMs > 0) {
      const seconds = Math.ceil(remainingMs / 1000);
      return {
        kind: 'blocked',
        code: 'cooldown',
        text: `COOLDOWN_${seconds}_SECONDS`,
      };
    }
  }

  return { kind: 'eligible' };
}

export function attemptPull(
  db: AppDb,
  corpus: Set<string>,
  options: { clientKeyId?: string } = {},
  nowMs = Date.now(),
): PullResult {
  return db.transaction((): PullResult => {
    const gate = checkPullGate(db, options, nowMs);
    if (gate.kind !== 'eligible') return gate;

    let selected:
      | { id: number; text: string; normalized_text: string }
      | undefined;

    for (;;) {
      selected = db.prepare(
        `SELECT id, text, normalized_text
           FROM candidates
          WHERE status = 'approved_unused'
          ORDER BY RANDOM()
          LIMIT 1`,
      ).get() as typeof selected;

      if (!selected) return { kind: 'empty' };

      if (corpus.has(selected.normalized_text)) {
        db.prepare(
          `UPDATE candidates
              SET status = 'rejected', notes = 'external-corpus collision'
            WHERE id = ?`,
        ).run(selected.id);
        continue;
      }
      break;
    }

    const nowIso = new Date(nowMs).toISOString();
    const today = utcDate(nowMs);

    db.prepare(
      `UPDATE candidates
          SET status = 'shown', shown_at = ?, shown_count = shown_count + 1
        WHERE id = ?`,
    ).run(nowIso, selected.id);

    const currentGlobalCount = globalCountForToday(db, today);
    setState(db, 'daily_pull_date', today);
    setState(db, 'daily_pull_count', String(currentGlobalCount + 1));
    setState(db, 'last_successful_pull_at', nowIso);

    if (options.clientKeyId) {
      const row = clientForToday(db, options.clientKeyId, today);
      if (!row) throw new Error('Authenticated client disappeared during pull');
      db.prepare(
        `UPDATE api_clients
            SET daily_date = ?, daily_count = ?, updated_at = CURRENT_TIMESTAMP
          WHERE key_id = ?`,
      ).run(today, row.count + 1, options.clientKeyId);
    }

    db.prepare(
      `INSERT INTO request_log(route, outcome, client_key_id, candidate_id)
       VALUES (?, 'served', ?, ?)`,
    ).run(
      options.clientKeyId ? '/api/generate' : '/slack/',
      options.clientKeyId ?? null,
      selected.id,
    );

    return { kind: 'served', id: selected.id, text: selected.text };
  })();
}
