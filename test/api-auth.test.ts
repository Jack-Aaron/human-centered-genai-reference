import { sign } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import {
  authenticateApiRequest,
  buildSigningPayload,
  claimReplay,
} from '../src/apiAuth';
import { insertClient, removeTemp, tempDb, testKeyPair } from './helpers';

const cleanup: string[] = [];
afterEach(() => {
  while (cleanup.length) removeTemp(cleanup.pop()!);
});

function signedInput(privateKeyPem: string, overrides: Partial<{
  keyId: string;
  timestamp: string;
  nonce: string;
  path: string;
}> = {}) {
  const keyId = overrides.keyId ?? 'demo-client';
  const timestamp = overrides.timestamp ?? '1788782400'; // 2026-09-07T12:00:00Z
  const nonce = overrides.nonce ?? '0123456789abcdef0123456789abcdef';
  const path = overrides.path ?? '/api/generate';
  const rawBody = Buffer.from('{}');
  const payload = buildSigningPayload({
    keyId,
    timestamp,
    nonce,
    method: 'POST',
    path,
    rawBody,
  });
  return {
    rawBody,
    contentType: 'application/json',
    keyIdHeader: keyId,
    timestampHeader: timestamp,
    nonceHeader: nonce,
    signatureHeader: sign(null, payload, privateKeyPem).toString('base64'),
    method: 'POST',
    path,
  };
}

describe('Ed25519 API authentication', () => {
  it('authenticates an exact signed request', () => {
    const { db, dir } = tempDb();
    cleanup.push(dir);
    const keys = testKeyPair();
    insertClient(db, 'demo-client', keys.publicKeyPem);

    const result = authenticateApiRequest(
      db,
      signedInput(keys.privateKeyPem),
      Date.parse('2026-09-07T12:00:00Z'),
    );
    expect(result).toMatchObject({ kind: 'authenticated', keyId: 'demo-client' });
    db.close();
  });

  it('binds signatures to path and body', () => {
    const { db, dir } = tempDb();
    cleanup.push(dir);
    const keys = testKeyPair();
    insertClient(db, 'demo-client', keys.publicKeyPem);
    const request = signedInput(keys.privateKeyPem);

    const result = authenticateApiRequest(
      db,
      { ...request, path: '/api/other' },
      Date.parse('2026-09-07T12:00:00Z'),
    );
    expect(result).toMatchObject({ kind: 'invalid', authResult: 'bad_signature' });
    db.close();
  });

  it('persists replay nonces after authentication', () => {
    const { db, dir } = tempDb();
    cleanup.push(dir);
    const keys = testKeyPair();
    insertClient(db, 'demo-client', keys.publicKeyPem);
    const result = authenticateApiRequest(
      db,
      signedInput(keys.privateKeyPem),
      Date.parse('2026-09-07T12:00:00Z'),
    );
    if (result.kind !== 'authenticated') throw new Error('expected authenticated request');

    expect(claimReplay(db, result)).toEqual({ kind: 'claimed' });
    expect(claimReplay(db, result)).toEqual({ kind: 'replay' });
    db.close();
  });
});
