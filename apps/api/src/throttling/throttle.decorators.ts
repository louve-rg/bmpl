import { Throttle } from '@nestjs/throttler';

/**
 * Strict per-IP limit for sensitive auth/abuse-prone routes (login, register,
 * refresh, password reset, verification, signed-URL generation). Values are read
 * from env at module-load time (after dotenv runs in main.ts / test setup), so
 * they stay configurable without a code change.
 */
const TTL_MS = Number(process.env.THROTTLE_TTL_SECONDS ?? 60) * 1000;
const AUTH_LIMIT = Number(process.env.THROTTLE_AUTH_LIMIT ?? 10);

export const StrictThrottle = () =>
  Throttle({ default: { limit: AUTH_LIMIT, ttl: TTL_MS } });
