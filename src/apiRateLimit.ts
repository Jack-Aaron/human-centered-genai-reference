export function createApiRateLimiter(limitPerMinute: number) {
  const windows = new Map<string, { minute: number; count: number }>();

  return (keyId: string, nowMs = Date.now()) => {
    if (limitPerMinute <= 0) {
      return { allowed: false, retryAfterSeconds: 60 };
    }

    const minute = Math.floor(nowMs / 60_000);
    const current = windows.get(keyId);
    if (!current || current.minute !== minute) {
      windows.set(keyId, { minute, count: 1 });
      return { allowed: true, retryAfterSeconds: 0 };
    }

    if (current.count >= limitPerMinute) {
      const nextMinuteMs = (minute + 1) * 60_000;
      return {
        allowed: false,
        retryAfterSeconds: Math.max(1, Math.ceil((nextMinuteMs - nowMs) / 1000)),
      };
    }

    current.count += 1;
    return { allowed: true, retryAfterSeconds: 0 };
  };
}
