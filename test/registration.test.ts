import { sign } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { buildSigningPayload } from '../src/apiAuth';
import {
  approveRegistration,
  registerPendingClient,
} from '../src/apiRegistration';
import { removeTemp, tempDb, testKeyPair } from './helpers';

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length) removeTemp(cleanup.pop()!);
});

describe('proof-of-possession registration', () => {
  it('creates a pending identity and requires explicit approval', () => {
    const { db, dir } = tempDb();
    cleanup.push(dir);
    const keys = testKeyPair();
    const keyId = 'new-client';
    const body = Buffer.from(
      JSON.stringify({ key_id: keyId, public_key: keys.publicKeyPem }),
    );
    const timestamp = '1788782400';
    const nonce = 'abcdefabcdefabcdefabcdefabcdefab';
    const payload = buildSigningPayload({
      keyId,
      timestamp,
      nonce,
      method: 'POST',
      path: '/api/register',
      rawBody: body,
    });
    const signature = sign(null, payload, keys.privateKeyPem).toString('base64');

    const result = registerPendingClient(db, {
      rawBody: body,
      contentType: 'application/json',
      keyIdHeader: keyId,
      timestampHeader: timestamp,
      nonceHeader: nonce,
      signatureHeader: signature,
      method: 'POST',
      path: '/api/register',
      nowMs: Date.parse('2026-09-07T12:00:00Z'),
    });
    expect(result.status).toBe('pending');
    expect(db.prepare('SELECT 1 FROM api_clients WHERE key_id = ?').get(keyId)).toBeUndefined();

    approveRegistration(db, keyId, 7);
    const client = db.prepare(
      'SELECT enabled, daily_cap FROM api_clients WHERE key_id = ?',
    ).get(keyId) as { enabled: number; daily_cap: number };
    expect(client).toEqual({ enabled: 1, daily_cap: 7 });
    db.close();
  });
});
