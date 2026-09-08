#!/usr/bin/env node
import fs from 'node:fs';
import {
  createHash,
  randomBytes,
  sign,
} from 'node:crypto';

const url = process.env.GENAI_URL ?? 'http://127.0.0.1:3000/api/generate';
const keyId = process.env.GENAI_KEY_ID;
const privateKeyPath = process.env.GENAI_PRIVATE_KEY_PATH;

if (!keyId || !privateKeyPath) {
  console.error('Set GENAI_KEY_ID and GENAI_PRIVATE_KEY_PATH.');
  process.exit(2);
}

const body = Buffer.from('{}');
const timestamp = String(Math.floor(Date.now() / 1000));
const nonce = randomBytes(16).toString('hex');
const pathname = new URL(url).pathname;
const bodyHash = createHash('sha256').update(body).digest('hex');
const payload = Buffer.from(
  [keyId, timestamp, nonce, 'POST', pathname, bodyHash].join('\n'),
);
const privateKey = fs.readFileSync(privateKeyPath, 'utf8');
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
if (!response.ok) {
  console.error(`${response.status} ${JSON.stringify(data)}`);
  process.exit(1);
}

console.log(data.text);
