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

/**
 * MDF-1184: the terminal lookup-by-code route's own per-IP limit — distinct
 * from StrictThrottle's auth-route number. The storage key already includes
 * the controller class and handler name (@nestjs/throttler's
 * ThrottlerGuard.generateKey), so this route has always had its own counter,
 * never shared with login/register/handoff/depart/etc — StrictThrottle's
 * 10/min was simply the wrong number for this route's shape, not a shared
 * budget being spent by it.
 *
 * 30/min per IP: several terminal clerks on one office connection,
 * processing a line-haul truck's worth of parcels together (a real surge,
 * not an edge case), each parcel needing one lookup before its handoff —
 * that reaches 10/min in ordinary busy operation. 30 gives that surge real
 * headroom while keeping full-codespace enumeration (10,000 values) at
 * ~5.5 hours for one address — and complements, rather than duplicates,
 * ShipmentService.checkLookupRate's per-USER 20/min: that limiter bounds any
 * one account regardless of address, so this per-IP number only ever binds
 * when several accounts share one connection, which is the legitimate
 * office case. See the PR body (MDF-1184) for the full reasoning.
 */
const TERMINAL_LOOKUP_LIMIT = Number(process.env.THROTTLE_TERMINAL_LOOKUP_LIMIT ?? 30);

export const TerminalLookupThrottle = () =>
  Throttle({ default: { limit: TERMINAL_LOOKUP_LIMIT, ttl: TTL_MS } });
