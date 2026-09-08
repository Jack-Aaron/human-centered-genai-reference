import {
  createHash,
  createPublicKey,
  timingSafeEqual,
  verify,
} from 'node:crypto';
import { AppDb } from './db';
import { config } from './config';

const KEY_ID_RE = /^[a-z0-9._-]{1,64}$/;
const NONCE_RE = /^[a-f0-9]{32}$/;

export interface SignedRequestInput {
  rawBody: Buffer;
  contentType?: string;
  keyIdHeader?: string;
  timestampHeader?: string;
  nonceHeader?: string;
  signatureHeader?: string;
  method: string;
  path: string;
}

export interface AuthenticatedRequest {
  kind: 'authenticated';
  keyId: string;
  nonce: string;
  timestamp: number;
}

export interface InvalidAuthentication {
  kind: 'invalid';
  status: number;
  error: 'bad_request' | 'unauthorized';
  authResult: string;
  presentedKeyId?: string;
}

export type AuthenticationResult =
  | AuthenticatedRequest
  | InvalidAuthentication;

export function sha256Hex(data: Buffer | string): string {
  return createHash('sha256').update(data).digest('hex');
}

export function buildSigningPayload(input: {
  keyId: string;
  timestamp: string;
  nonce: string;
  method: string;
  path: string;
  rawBody: Buffer;
}): Buffer {
  return Buffer.from(
    [
      input.keyId,
      input.timestamp,
      input.nonce,
      input.method.toUpperCase(),
      input.path,
      sha256Hex(input.rawBody),
    ].join('\n'),
    'utf8',
  );
}

export function publicKeyFingerprint(publicKeyPem: string): string {
  const key = createPublicKey(publicKeyPem);
  if (key.asymmetricKeyType !== 'ed25519') {
    throw new Error('Public key must be Ed25519');
  }
  const der = key.export({ type: 'spki', format: 'der' });
  const digest = createHash('sha256').update(der).digest('base64');
  return `SHA256:${digest.replace(/=+$/u, '')}`;
}

function decodeCanonicalBase64(value: string): Buffer | undefined {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(value) || value.length % 4 !== 0) {
    return undefined;
  }
  let decoded: Buffer;
  try {
    decoded = Buffer.from(value, 'base64');
  } catch {
    return undefined;
  }
  const roundTrip = decoded.toString('base64');
  if (
    roundTrip.length !== value.length ||
    !timingSafeEqual(Buffer.from(roundTrip), Buffer.from(value))
  ) {
    return undefined;
  }
  return decoded;
}

function basicSignedRequestValidation(
  input: SignedRequestInput,
  nowMs: number,
):
  | {
      ok: true;
      keyId: string;
      timestamp: string;
      timestampNumber: number;
      nonce: string;
      signature: Buffer;
    }
  | { ok: false; result: InvalidAuthentication } {
  if (input.contentType?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    return {
      ok: false,
      result: { kind: 'invalid', status: 400, error: 'bad_request', authResult: 'wrong_content_type' },
    };
  }

  if (!input.rawBody.equals(Buffer.from('{}'))) {
    return {
      ok: false,
      result: { kind: 'invalid', status: 400, error: 'bad_request', authResult: 'wrong_body' },
    };
  }

  const keyId = input.keyIdHeader ?? '';
  const timestamp = input.timestampHeader ?? '';
  const nonce = input.nonceHeader ?? '';
  const signatureText = input.signatureHeader ?? '';

  if (!KEY_ID_RE.test(keyId) || !/^\d{10,13}$/.test(timestamp) || !NONCE_RE.test(nonce)) {
    return {
      ok: false,
      result: {
        kind: 'invalid',
        status: 401,
        error: 'unauthorized',
        authResult: 'malformed_auth',
        presentedKeyId: KEY_ID_RE.test(keyId) ? keyId : undefined,
      },
    };
  }

  const timestampNumber = Number.parseInt(timestamp, 10);
  const requestMs = timestamp.length === 13 ? timestampNumber : timestampNumber * 1000;
  if (Math.abs(nowMs - requestMs) > config.authMaxClockSkewSeconds * 1000) {
    return {
      ok: false,
      result: {
        kind: 'invalid',
        status: 401,
        error: 'unauthorized',
        authResult: 'stale_timestamp',
        presentedKeyId: keyId,
      },
    };
  }

  const signature = decodeCanonicalBase64(signatureText);
  if (!signature || signature.length !== 64) {
    return {
      ok: false,
      result: {
        kind: 'invalid',
        status: 401,
        error: 'unauthorized',
        authResult: 'malformed_signature',
        presentedKeyId: keyId,
      },
    };
  }

  return { ok: true, keyId, timestamp, timestampNumber, nonce, signature };
}

export function authenticateApiRequest(
  db: AppDb,
  input: SignedRequestInput,
  nowMs = Date.now(),
): AuthenticationResult {
  const basic = basicSignedRequestValidation(input, nowMs);
  if (basic.ok === false) return basic.result;

  const client = db.prepare(
    `SELECT public_key_pem, enabled
       FROM api_clients
      WHERE key_id = ?`,
  ).get(basic.keyId) as
    | { public_key_pem: string; enabled: number }
    | undefined;

  if (!client || client.enabled !== 1) {
    return {
      kind: 'invalid',
      status: 401,
      error: 'unauthorized',
      authResult: 'unknown_or_disabled_key',
      presentedKeyId: basic.keyId,
    };
  }

  const payload = buildSigningPayload({
    keyId: basic.keyId,
    timestamp: basic.timestamp,
    nonce: basic.nonce,
    method: input.method,
    path: input.path,
    rawBody: input.rawBody,
  });

  let valid = false;
  try {
    valid = verify(null, payload, createPublicKey(client.public_key_pem), basic.signature);
  } catch {
    valid = false;
  }

  if (!valid) {
    return {
      kind: 'invalid',
      status: 401,
      error: 'unauthorized',
      authResult: 'bad_signature',
      presentedKeyId: basic.keyId,
    };
  }

  return {
    kind: 'authenticated',
    keyId: basic.keyId,
    nonce: basic.nonce,
    timestamp: basic.timestampNumber,
  };
}

export function claimReplay(
  db: AppDb,
  authenticated: AuthenticatedRequest,
): { kind: 'claimed' } | { kind: 'replay' } {
  db.prepare(
    `DELETE FROM api_replays
      WHERE created_at < datetime('now', '-1 day')`,
  ).run();

  try {
    db.prepare(
      `INSERT INTO api_replays(client_key_id, nonce)
       VALUES (?, ?)`,
    ).run(authenticated.keyId, authenticated.nonce);
    return { kind: 'claimed' };
  } catch (error) {
    if (
      error instanceof Error &&
      /UNIQUE constraint failed/u.test(error.message)
    ) {
      return { kind: 'replay' };
    }
    throw error;
  }
}

export function verifyRegistrationSignature(input: {
  rawBody: Buffer;
  contentType?: string;
  keyIdHeader?: string;
  timestampHeader?: string;
  nonceHeader?: string;
  signatureHeader?: string;
  publicKeyPem: string;
  method: string;
  path: string;
  nowMs?: number;
}): { keyId: string; fingerprint: string } {
  if (input.contentType?.split(';', 1)[0].trim().toLowerCase() !== 'application/json') {
    throw new Error('bad_request');
  }

  const keyId = input.keyIdHeader ?? '';
  const timestamp = input.timestampHeader ?? '';
  const nonce = input.nonceHeader ?? '';
  const signatureText = input.signatureHeader ?? '';
  if (!KEY_ID_RE.test(keyId) || !/^\d{10,13}$/.test(timestamp) || !NONCE_RE.test(nonce)) {
    throw new Error('unauthorized');
  }

  const nowMs = input.nowMs ?? Date.now();
  const numeric = Number.parseInt(timestamp, 10);
  const requestMs = timestamp.length === 13 ? numeric : numeric * 1000;
  if (Math.abs(nowMs - requestMs) > config.authMaxClockSkewSeconds * 1000) {
    throw new Error('unauthorized');
  }

  const signature = decodeCanonicalBase64(signatureText);
  if (!signature || signature.length !== 64) throw new Error('unauthorized');

  const publicKey = createPublicKey(input.publicKeyPem);
  if (publicKey.asymmetricKeyType !== 'ed25519') throw new Error('bad_request');

  const payload = buildSigningPayload({
    keyId,
    timestamp,
    nonce,
    method: input.method,
    path: input.path,
    rawBody: input.rawBody,
  });
  if (!verify(null, payload, publicKey, signature)) throw new Error('unauthorized');

  return { keyId, fingerprint: publicKeyFingerprint(input.publicKeyPem) };
}
