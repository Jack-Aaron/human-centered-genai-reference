#!/usr/bin/env node
import fs from 'node:fs';
import {
  createHash,
  createPublicKey,
  randomBytes,
  sign,
} from 'node:crypto';

const url = process.env.GENAI_REGISTRATION_URL ?? 'http://127.0.0.1:3000/api/register';
const keyId = process.env.GENAI_KEY_ID;
const privateKeyPath = process.env.GENAI_PRIVATE_KEY_PATH;

if (!keyId || !privateKeyPath) {
  console.error('Set GENAI_KEY_ID and GENAI_PRIVATE_KEY_PATH.');
  process.exit(2);
}

const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
const publicKey = createPublicKey(privateKey).export({ type: 'spki', format: 'pem' });
const body = Buffer.from(
  JSON.stringify({ key_id: keyId, public_key: publicKey.toString() }),
);
const timestamp = String(Math.floor(Date.now() / 1000));
const nonce = randomBytes(16).toString('hex');
const pathname = new URL(url).pathname;
const bodyHash = createHash('sha256').update(body).digest('hex');
const payload = Buffer.from(
  [keyId, timestamp, nonce, 'POST', pathname, bodyHash].join('\n'),
);
const signature = sign(null, payload, privateKey).toString('base64');

const response = await fetch(url, {
  method: 'POST',
  headers: {
    'content-type': 'application/json',
    'x-genai-key-id': keyId,
    'x-genai-timestamp': timestamp,
    'x-genai-nonce': nonce,
    'x-genai-signature': signature,
  },
  body,
});

const data = await response.json();
console.log(JSON.stringify(data, null, 2));
if (!response.ok) process.exit(1);
