import { createHmac } from 'node:crypto';
import { afterEach, describe, expect, it } from 'vitest';
import { config } from '../src/config';
import { validateSlackRequest } from '../src/slack';

const original = {
  secret: config.slackSigningSecret,
  team: config.slackTeamId,
  command: config.slackCommand,
};

afterEach(() => {
  config.slackSigningSecret = original.secret;
  config.slackTeamId = original.team;
  config.slackCommand = original.command;
});

describe('Slack request verification', () => {
  it('validates the raw body, timestamp, workspace and command', () => {
    config.slackSigningSecret = 'test-secret';
    config.slackTeamId = 'T123';
    config.slackCommand = '/generate';
    const timestamp = '1788782400';
    const body = Buffer.from('team_id=T123&command=%2Fgenerate&user_id=U1');
    const signature = `v0=${createHmac('sha256', 'test-secret')
      .update(`v0:${timestamp}:${body.toString('utf8')}`)
      .digest('hex')}`;

    expect(
      validateSlackRequest(
        body,
        'application/x-www-form-urlencoded',
        timestamp,
        signature,
        Date.parse('2026-09-07T12:00:00Z'),
      ).kind,
    ).toBe('valid');
  });
});
