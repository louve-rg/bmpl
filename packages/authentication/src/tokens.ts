import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

/**
 * Opaque secret tokens for refresh sessions, email verification, and password
 * reset. The RAW token is delivered to the client/email exactly once; only its
 * SHA-256 hash is persisted, so a database leak cannot reconstruct live tokens.
 */
export function generateToken(bytes = 48): string {
  return randomBytes(bytes).toString('base64url');
}

export function hashToken(rawToken: string): string {
  return createHash('sha256').update(rawToken).digest('hex');
}

/** Constant-time comparison of two hashes. */
export function safeEqualHex(a: string, b: string): boolean {
  const ba = Buffer.from(a, 'hex');
  const bb = Buffer.from(b, 'hex');
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

export interface IssuedToken {
  raw: string;
  hash: string;
  expiresAt: Date;
}

export function issueToken(ttlMs: number, bytes = 48): IssuedToken {
  const raw = generateToken(bytes);
  return {
    raw,
    hash: hashToken(raw),
    expiresAt: new Date(Date.now() + ttlMs),
  };
}
