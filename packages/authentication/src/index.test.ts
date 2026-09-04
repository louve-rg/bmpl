import argon2 from 'argon2';
import { SignJWT } from 'jose';
import { afterEach, describe, expect, it, vi } from 'vitest';
import {
  generateToken,
  hashPassword,
  hashToken,
  issueToken,
  needsRehash,
  parseTtlMs,
  safeEqualHex,
  signAccessToken,
  verifyAccessToken,
  verifyPassword,
} from './index';

// Throwaway values for tests only — never real credentials or configuration.
const SECRET = 'test-only-secret-not-used-anywhere-real';
const CLAIMS = {
  sub: 'user-123',
  sid: 'session-456',
  activeRole: 'CUSTOMER',
  client: 'web',
};

describe('password hashing', () => {
  it('hashes with argon2id and verifies the same password', async () => {
    const hash = await hashPassword('correct horse battery staple');
    expect(hash.startsWith('$argon2id$')).toBe(true);
    expect(await verifyPassword(hash, 'correct horse battery staple')).toBe(true);
  });

  it('rejects a wrong password', async () => {
    const hash = await hashPassword('the-real-password');
    expect(await verifyPassword(hash, 'not-the-password')).toBe(false);
  });

  it('produces a different hash for the same password each time (salted)', async () => {
    const a = await hashPassword('same-password');
    const b = await hashPassword('same-password');
    expect(a).not.toBe(b);
    expect(await verifyPassword(a, 'same-password')).toBe(true);
    expect(await verifyPassword(b, 'same-password')).toBe(true);
  });

  it('returns false, not an exception, for a malformed stored hash', async () => {
    expect(await verifyPassword('not-an-argon2-hash', 'anything')).toBe(false);
    expect(await verifyPassword('', 'anything')).toBe(false);
  });

  it('does not ask to rehash a hash made with current parameters', async () => {
    const hash = await hashPassword('a-password');
    expect(needsRehash(hash)).toBe(false);
  });

  it('asks to rehash a hash made with weaker/older parameters', async () => {
    const legacy = await argon2.hash('a-password', {
      type: argon2.argon2id,
      memoryCost: 8_192,
      timeCost: 2,
      parallelism: 1,
    });
    // Still verifies (the hash encodes its own parameters)…
    expect(await verifyPassword(legacy, 'a-password')).toBe(true);
    // …but is flagged for upgrade to the current cost settings.
    expect(needsRehash(legacy)).toBe(true);
  });
});

describe('access tokens (JWT)', () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it('signs and verifies a round trip, preserving the claims', async () => {
    const token = await signAccessToken(CLAIMS, SECRET, '15m');
    const payload = await verifyAccessToken(token, SECRET);
    expect(payload.sub).toBe('user-123');
    expect(payload.sid).toBe('session-456');
    expect(payload.activeRole).toBe('CUSTOMER');
    expect(payload.client).toBe('web');
    expect(payload.iss).toBe('bmpl');
    expect(payload.aud).toBe('bmpl-api');
    expect(typeof payload.exp).toBe('number');
    expect(typeof payload.iat).toBe('number');
  });

  it('allows a null activeRole', async () => {
    const token = await signAccessToken({ ...CLAIMS, activeRole: null }, SECRET, '15m');
    const payload = await verifyAccessToken(token, SECRET);
    expect(payload.activeRole).toBeNull();
  });

  it('rejects a token after its TTL has elapsed', async () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
    const token = await signAccessToken(CLAIMS, SECRET, '15m');

    // Still valid one minute before expiry…
    vi.setSystemTime(new Date('2026-09-03T12:14:00Z'));
    await expect(verifyAccessToken(token, SECRET)).resolves.toBeTruthy();

    // …rejected one minute after.
    vi.setSystemTime(new Date('2026-09-03T12:16:00Z'));
    await expect(verifyAccessToken(token, SECRET)).rejects.toThrow();
  });

  it('rejects a token signed with a different secret', async () => {
    const token = await signAccessToken(CLAIMS, 'some-other-test-secret', '15m');
    await expect(verifyAccessToken(token, SECRET)).rejects.toThrow();
  });

  it('rejects a tampered token', async () => {
    const token = await signAccessToken(CLAIMS, SECRET, '15m');
    const [header, payload, signature] = token.split('.') as [string, string, string];
    // Flip a character in the payload; the signature no longer matches.
    const flipped = payload[0] === 'A' ? 'B' : 'A';
    const tampered = `${header}.${flipped}${payload.slice(1)}.${signature}`;
    await expect(verifyAccessToken(tampered, SECRET)).rejects.toThrow();
  });

  it('rejects a token from a different issuer or audience, even with the right secret', async () => {
    const encoder = new TextEncoder();
    const wrongIssuer = await new SignJWT(CLAIMS)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setIssuer('not-bmpl')
      .setAudience('bmpl-api')
      .setExpirationTime('15m')
      .sign(encoder.encode(SECRET));
    await expect(verifyAccessToken(wrongIssuer, SECRET)).rejects.toThrow();

    const wrongAudience = await new SignJWT(CLAIMS)
      .setProtectedHeader({ alg: 'HS256', typ: 'JWT' })
      .setIssuedAt()
      .setIssuer('bmpl')
      .setAudience('some-other-api')
      .setExpirationTime('15m')
      .sign(encoder.encode(SECRET));
    await expect(verifyAccessToken(wrongAudience, SECRET)).rejects.toThrow();
  });

  it('rejects garbage that is not a JWT at all', async () => {
    await expect(verifyAccessToken('definitely.not.a-jwt', SECRET)).rejects.toThrow();
    await expect(verifyAccessToken('', SECRET)).rejects.toThrow();
  });
});

describe('parseTtlMs', () => {
  it('parses every supported unit', () => {
    expect(parseTtlMs('250ms')).toBe(250);
    expect(parseTtlMs('45s')).toBe(45_000);
    expect(parseTtlMs('15m')).toBe(900_000);
    expect(parseTtlMs('12h')).toBe(43_200_000);
    expect(parseTtlMs('30d')).toBe(2_592_000_000);
  });

  it('tolerates surrounding and internal whitespace', () => {
    expect(parseTtlMs(' 15m ')).toBe(900_000);
    expect(parseTtlMs('15 m')).toBe(900_000);
  });

  it('throws on anything it cannot parse', () => {
    expect(() => parseTtlMs('15')).toThrow(/Invalid TTL/);
    expect(() => parseTtlMs('m')).toThrow(/Invalid TTL/);
    expect(() => parseTtlMs('-5m')).toThrow(/Invalid TTL/);
    expect(() => parseTtlMs('1.5h')).toThrow(/Invalid TTL/);
    expect(() => parseTtlMs('2w')).toThrow(/Invalid TTL/);
    expect(() => parseTtlMs('')).toThrow(/Invalid TTL/);
  });
});

describe('opaque tokens', () => {
  it('generates url-safe tokens of the expected length', () => {
    const token = generateToken();
    // 48 random bytes -> 64 base64url characters, no padding.
    expect(token).toMatch(/^[A-Za-z0-9_-]{64}$/);
    expect(generateToken(32)).toMatch(/^[A-Za-z0-9_-]{43}$/);
  });

  it('never generates the same token twice', () => {
    const seen = new Set(Array.from({ length: 100 }, () => generateToken()));
    expect(seen.size).toBe(100);
  });

  it('hashes deterministically with SHA-256', () => {
    // Known SHA-256 vector so the test fails if the algorithm ever changes.
    expect(hashToken('abc')).toBe(
      'ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad',
    );
    expect(hashToken('abc')).toBe(hashToken('abc'));
    expect(hashToken('abd')).not.toBe(hashToken('abc'));
  });

  it('the stored hash cannot be used as the raw token', () => {
    const raw = generateToken();
    const stored = hashToken(raw);
    expect(stored).not.toBe(raw);
    // Presenting the stored hash instead of the raw token must not match.
    expect(hashToken(stored)).not.toBe(stored);
  });

  it('compares hashes in constant time, including length mismatches', () => {
    const h = hashToken('abc');
    expect(safeEqualHex(h, h)).toBe(true);
    expect(safeEqualHex(h, hashToken('abd'))).toBe(false);
    expect(safeEqualHex(h, h.slice(0, 32))).toBe(false);
    expect(safeEqualHex('', '')).toBe(true);
  });

  it('issues a raw/hash pair whose hash matches the raw exactly once persisted', () => {
    const issued = issueToken(60_000);
    expect(issued.hash).toBe(hashToken(issued.raw));
    expect(safeEqualHex(issued.hash, hashToken(issued.raw))).toBe(true);
  });

  it('sets expiresAt to now plus the ttl', () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-09-03T12:00:00Z'));
    try {
      const issued = issueToken(15 * 60_000);
      expect(issued.expiresAt.toISOString()).toBe('2026-09-03T12:15:00.000Z');
    } finally {
      vi.useRealTimers();
    }
  });

  it('two issued tokens never collide', () => {
    const a = issueToken(1000);
    const b = issueToken(1000);
    expect(a.raw).not.toBe(b.raw);
    expect(a.hash).not.toBe(b.hash);
  });
});
