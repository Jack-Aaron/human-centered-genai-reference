import { afterEach, describe, expect, it } from 'vitest';
import { normalizeText } from '../src/normalize';
import { attemptPull, checkPullGate } from '../src/queue';
import { removeTemp, tempDb } from './helpers';

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length) removeTemp(cleanup.pop()!);
});

function state(db: ReturnType<typeof tempDb>['db'], key: string, value: string) {
  db.prepare('UPDATE state SET value = ? WHERE key = ?').run(value, key);
}

describe('candidate queue', () => {
  it('rejects external-corpus collisions and serves a novel candidate', () => {
    const { db, dir } = tempDb();
    cleanup.push(dir);
    state(db, 'global_cooldown_seconds', '0');

    db.prepare(
      `INSERT INTO candidates(text, normalized_text) VALUES (?, ?)`,
    ).run(
      'REFERENCE ITEM ALPHA',
      normalizeText('REFERENCE ITEM ALPHA'),
    );

    const corpus = new Set([
      normalizeText('REFERENCE ITEM ALPHA'),
    ]);
    const nowMs = Date.parse(
      '2026-09-07T12:00:00Z',
    );

    const collisionResult = attemptPull(
      db,
      corpus,
      {},
      nowMs,
    );

    expect(collisionResult).toEqual({
      kind: 'empty',
    });

    const rejected = db.prepare(
      `SELECT status FROM candidates WHERE normalized_text = ?`,
    ).get(
      normalizeText('REFERENCE ITEM ALPHA'),
    ) as { status: string };

    expect(rejected.status).toBe('rejected');

    db.prepare(
      `INSERT INTO candidates(text, normalized_text) VALUES (?, ?)`,
    ).run(
      'NOVEL ITEM',
      normalizeText('NOVEL ITEM'),
    );

    const novelResult = attemptPull(
      db,
      corpus,
      {},
      nowMs,
    );

    expect(novelResult).toMatchObject({
      kind: 'served',
      text: 'NOVEL ITEM',
    });

    db.close();
  });

  it('enforces the global cooldown', () => {
    const { db, dir } = tempDb();
    cleanup.push(dir);
    state(db, 'global_cooldown_seconds', '10');
    state(db, 'last_successful_pull_at', '2026-09-07T12:00:00.000Z');

    expect(
      checkPullGate(db, {}, Date.parse('2026-09-07T12:00:05Z')),
    ).toEqual({
      kind: 'blocked',
      code: 'cooldown',
      text: 'COOLDOWN_5_SECONDS',
    });
    db.close();
  });

  it('resets daily accounting logically when the UTC date changes', () => {
    const { db, dir } = tempDb();
    cleanup.push(dir);
    state(db, 'daily_pull_date', '2026-09-06');
    state(db, 'daily_pull_count', '999');
    state(db, 'global_daily_cap', '1');
    state(db, 'global_cooldown_seconds', '0');

    expect(
      checkPullGate(db, {}, Date.parse('2026-09-07T00:00:01Z')),
    ).toEqual({ kind: 'eligible' });
    db.close();
  });
});
