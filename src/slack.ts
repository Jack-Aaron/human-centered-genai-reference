import { createHmac, timingSafeEqual } from 'node:crypto';
import { config } from './config';

export type SlackValidation =
  | { kind: 'valid'; params: URLSearchParams }
  | { kind: 'invalid'; code: string };

function safeEqualText(left: string, right: string): boolean {
  const a = Buffer.from(left);
  const b = Buffer.from(right);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function validateSlackRequest(
  rawBody: Buffer,
  contentType?: string,
  timestampHeader?: string,
  signatureHeader?: string,
  nowMs = Date.now(),
): SlackValidation {
  if (!config.slackSigningSecret) {
    return { kind: 'invalid', code: 'SLACK_NOT_CONFIGURED' };
  }
  if (
    contentType?.split(';', 1)[0].trim().toLowerCase() !==
    'application/x-www-form-urlencoded'
  ) {
    return { kind: 'invalid', code: 'WRONG_CONTENT_TYPE' };
  }
  if (!timestampHeader || !/^\d{10}$/.test(timestampHeader) || !signatureHeader) {
    return { kind: 'invalid', code: 'INVALID_SIGNATURE' };
  }

  const timestampMs = Number.parseInt(timestampHeader, 10) * 1000;
  if (Math.abs(nowMs - timestampMs) > 5 * 60 * 1000) {
    return { kind: 'invalid', code: 'STALE_REQUEST' };
  }

  const base = `v0:${timestampHeader}:${rawBody.toString('utf8')}`;
  const expected = `v0=${createHmac('sha256', config.slackSigningSecret)
    .update(base)
    .digest('hex')}`;
  if (!safeEqualText(expected, signatureHeader)) {
    return { kind: 'invalid', code: 'INVALID_SIGNATURE' };
  }

  const params = new URLSearchParams(rawBody.toString('utf8'));
  if (config.slackTeamId && params.get('team_id') !== config.slackTeamId) {
    return { kind: 'invalid', code: 'WRONG_WORKSPACE' };
  }
  if (params.get('command') !== config.slackCommand) {
    return { kind: 'invalid', code: 'WRONG_COMMAND' };
  }

  return { kind: 'valid', params };
}
