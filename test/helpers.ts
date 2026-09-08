import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { generateKeyPairSync } from 'node:crypto';
import { openDb, AppDb } from '../src/db';
import { publicKeyFingerprint } from '../src/apiAuth';

export function tempDb(): { db: AppDb; dir: string } {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'genai-reference-'));
  const db = openDb(path.join(dir, 'test.sqlite'));
  return { db, dir };
}

export function removeTemp(dir: string): void {
  fs.rmSync(dir, { recursive: true, force: true });
}

export function testKeyPair(): {
  privateKeyPem: string;
  publicKeyPem: string;
} {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }).toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

export function insertClient(
  db: AppDb,
  keyId: string,
  publicKeyPem: string,
  dailyCap = 10,
): void {
  db.prepare(
    `INSERT INTO api_clients(key_id, public_key_pem, fingerprint, daily_cap)
     VALUES (?, ?, ?, ?)`,
  ).run(keyId, publicKeyPem, publicKeyFingerprint(publicKeyPem), dailyCap);
}
