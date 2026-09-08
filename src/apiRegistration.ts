import { AppDb } from './db';
import {
  publicKeyFingerprint,
  verifyRegistrationSignature,
} from './apiAuth';

export const REGISTRATION_PATH = '/api/register';

interface RegistrationBody {
  key_id: string;
  public_key: string;
}

function parseRegistrationBody(rawBody: Buffer): RegistrationBody {
  let parsed: unknown;
  try {
    parsed = JSON.parse(rawBody.toString('utf8'));
  } catch {
    throw new Error('bad_request');
  }
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error('bad_request');
  }
  const object = parsed as Record<string, unknown>;
  const keys = Object.keys(object).sort();
  if (
    keys.length !== 2 ||
    keys[0] !== 'key_id' ||
    keys[1] !== 'public_key' ||
    typeof object.key_id !== 'string' ||
    typeof object.public_key !== 'string'
  ) {
    throw new Error('bad_request');
  }
  return { key_id: object.key_id, public_key: object.public_key };
}

export function registerPendingClient(
  db: AppDb,
  input: {
    rawBody: Buffer;
    contentType?: string;
    keyIdHeader?: string;
    timestampHeader?: string;
    nonceHeader?: string;
    signatureHeader?: string;
    method: string;
    path: string;
    nowMs?: number;
  },
): { keyId: string; fingerprint: string; status: 'pending' } {
  const body = parseRegistrationBody(input.rawBody);
  if (body.key_id !== input.keyIdHeader) throw new Error('unauthorized');

  const verified = verifyRegistrationSignature({
    ...input,
    publicKeyPem: body.public_key,
  });

  const fingerprint = publicKeyFingerprint(body.public_key);
  if (fingerprint !== verified.fingerprint || verified.keyId !== body.key_id) {
    throw new Error('unauthorized');
  }

  const existingClient = db.prepare(
    'SELECT 1 FROM api_clients WHERE key_id = ? OR fingerprint = ?',
  ).get(body.key_id, fingerprint);
  if (existingClient) throw new Error('registration_conflict');

  const existingRegistration = db.prepare(
    `SELECT key_id, fingerprint, status
       FROM api_client_registrations
      WHERE key_id = ? OR fingerprint = ?`,
  ).get(body.key_id, fingerprint) as
    | { key_id: string; fingerprint: string; status: string }
    | undefined;

  if (existingRegistration) {
    if (
      existingRegistration.key_id === body.key_id &&
      existingRegistration.fingerprint === fingerprint &&
      existingRegistration.status === 'pending'
    ) {
      return { keyId: body.key_id, fingerprint, status: 'pending' };
    }
    throw new Error('registration_conflict');
  }

  db.prepare(
    `INSERT INTO api_client_registrations(
       key_id, public_key_pem, fingerprint, status
     ) VALUES (?, ?, ?, 'pending')`,
  ).run(body.key_id, body.public_key, fingerprint);

  return { keyId: body.key_id, fingerprint, status: 'pending' };
}

export function approveRegistration(
  db: AppDb,
  keyId: string,
  dailyCap: number,
): void {
  db.transaction(() => {
    const row = db.prepare(
      `SELECT public_key_pem, fingerprint, status
         FROM api_client_registrations
        WHERE key_id = ?`,
    ).get(keyId) as
      | { public_key_pem: string; fingerprint: string; status: string }
      | undefined;
    if (!row || row.status !== 'pending') throw new Error('Pending registration not found');

    db.prepare(
      `INSERT INTO api_clients(
         key_id, public_key_pem, fingerprint, enabled, daily_cap
       ) VALUES (?, ?, ?, 1, ?)`,
    ).run(keyId, row.public_key_pem, row.fingerprint, dailyCap);

    db.prepare(
      `UPDATE api_client_registrations
          SET status = 'approved', reviewed_at = CURRENT_TIMESTAMP
        WHERE key_id = ?`,
    ).run(keyId);
  })();
}

export function rejectRegistration(db: AppDb, keyId: string): void {
  const result = db.prepare(
    `UPDATE api_client_registrations
        SET status = 'rejected', reviewed_at = CURRENT_TIMESTAMP
      WHERE key_id = ? AND status = 'pending'`,
  ).run(keyId);
  if (result.changes !== 1) throw new Error('Pending registration not found');
}
