import { describe, expect, it } from 'vitest';
import { createApiRateLimiter } from '../src/apiRateLimit';

describe('API request limiter', () => {
  it('limits each authenticated client independently', () => {
    const limit = createApiRateLimiter(2);
    const now = Date.parse('2026-09-07T12:00:10Z');

    expect(limit('alpha', now).allowed).toBe(true);
    expect(limit('alpha', now).allowed).toBe(true);
    expect(limit('alpha', now).allowed).toBe(false);
    expect(limit('beta', now).allowed).toBe(true);
  });
});
