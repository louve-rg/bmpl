import { describe, expect, it } from 'vitest';
import { cookiesSecure, corsOrigins, listenPort, loadEnv, normalizeOrigin, storageEnabled } from './env';

const STRONG = 'a'.repeat(64);
const base = {
  DATABASE_URL: 'postgresql://u:p@db:5432/bmpl?schema=public',
  JWT_ACCESS_SECRET: STRONG,
  JWT_REFRESH_SECRET: 'b'.repeat(64),
  COOKIE_SECRET: 'c'.repeat(64),
};

describe('loadEnv — required variables', () => {
  it('accepts a minimal valid production env (no storage vars)', () => {
    const env = loadEnv({ ...base, NODE_ENV: 'production', PORT: '8080' } as NodeJS.ProcessEnv);
    expect(env.NODE_ENV).toBe('production');
    expect(listenPort(env)).toBe(8080); // Railway PORT wins over API_PORT
    expect(cookiesSecure(env)).toBe(true); // secure cookies in production
  });

  it('throws when DATABASE_URL is missing', () => {
    const { DATABASE_URL, ...rest } = base;
    void DATABASE_URL;
    expect(() => loadEnv(rest as NodeJS.ProcessEnv)).toThrow(/DATABASE_URL/);
  });

  it.each(['JWT_ACCESS_SECRET', 'JWT_REFRESH_SECRET', 'COOKIE_SECRET'])(
    'throws when %s is missing',
    (key) => {
      const env = { ...base } as Record<string, string>;
      delete env[key];
      expect(() => loadEnv(env as NodeJS.ProcessEnv)).toThrow(new RegExp(key));
    },
  );

  it('refuses dev placeholder secrets in production', () => {
    expect(() =>
      loadEnv({
        ...base,
        NODE_ENV: 'production',
        JWT_ACCESS_SECRET: 'dev-only-change-me-secret-000000',
      } as NodeJS.ProcessEnv),
    ).toThrow(/dev placeholder secrets/);
  });

  it('defaults PORT to API_PORT (4000) when PORT is unset', () => {
    const env = loadEnv(base as NodeJS.ProcessEnv);
    expect(listenPort(env)).toBe(4000);
  });

  it('does NOT crash on blank / bare-host / invalid URL vars (regression: Railway boot)', () => {
    const env = loadEnv({
      ...base,
      NODE_ENV: 'production',
      API_URL: '', // blank → falls back to default
      NEXT_PUBLIC_SITE_URL: 'dev.bzemarketplace.com', // bare host → https:// prefixed
      ADMIN_SITE_URL: 'not a url', // invalid → falls back to default
    } as NodeJS.ProcessEnv);
    expect(env.API_URL).toBe('http://localhost:4000');
    expect(env.NEXT_PUBLIC_SITE_URL).toBe('https://dev.bzemarketplace.com');
    expect(env.ADMIN_SITE_URL).toBe('http://localhost:3001');
  });
});

describe('normalizeOrigin / corsOrigins — allow-list matching is drift-proof', () => {
  it('collapses cosmetic differences to a canonical scheme://host[:port]', () => {
    expect(normalizeOrigin('https://www.bzemarketplace.com/')).toBe('https://www.bzemarketplace.com');
    expect(normalizeOrigin('HTTPS://WWW.BZEMARKETPLACE.COM')).toBe('https://www.bzemarketplace.com');
    expect(normalizeOrigin('https://www.bzemarketplace.com/cart')).toBe('https://www.bzemarketplace.com');
    expect(normalizeOrigin('  https://www.bzemarketplace.com  ')).toBe('https://www.bzemarketplace.com');
  });

  it('parses a comma-separated CORS_ORIGINS into normalized entries (trailing slash / case tolerated)', () => {
    const env = loadEnv({
      ...base,
      CORS_ORIGINS: 'https://www.bzemarketplace.com/, https://BZEMARKETPLACE.com , https://bmpl-web.vercel.app',
    } as NodeJS.ProcessEnv);
    expect(corsOrigins(env)).toEqual([
      'https://www.bzemarketplace.com',
      'https://bzemarketplace.com',
      'https://bmpl-web.vercel.app',
    ]);
  });
});

describe('storageEnabled — storage is optional', () => {
  it('is DISABLED for the default (minio) in production → API starts without storage', () => {
    const env = loadEnv({ ...base, NODE_ENV: 'production' } as NodeJS.ProcessEnv);
    expect(env.STORAGE_PROVIDER).toBe('minio'); // default
    expect(storageEnabled(env)).toBe(false);
  });

  it('is DISABLED when explicitly none', () => {
    const env = loadEnv({ ...base, STORAGE_PROVIDER: 'none' } as NodeJS.ProcessEnv);
    expect(storageEnabled(env)).toBe(false);
  });

  it('is ENABLED for minio in local development', () => {
    const env = loadEnv({ ...base, NODE_ENV: 'development' } as NodeJS.ProcessEnv);
    expect(storageEnabled(env)).toBe(true);
  });

  it('is ENABLED for r2 (real cloud storage)', () => {
    const env = loadEnv({ ...base, NODE_ENV: 'production', STORAGE_PROVIDER: 'r2' } as NodeJS.ProcessEnv);
    expect(storageEnabled(env)).toBe(true);
  });
});

/**
 * The temporary UAT funding switch.
 *
 * Its whole safety story is "absent means off", so absence, blankness and the
 * literal word "false" all have to reach the same answer. A flag that is only
 * off when set correctly is not a kill switch.
 */
describe('loadEnv — self-service test funding is off unless switched on', () => {
  it('is off when the variable is absent entirely', () => {
    expect(loadEnv(base as NodeJS.ProcessEnv).ENABLE_SELF_SERVICE_TEST_FUNDING).toBe(false);
  });

  it('is off for the word "false", and on only for "true"', () => {
    const read = (v: string) =>
      loadEnv({ ...base, ENABLE_SELF_SERVICE_TEST_FUNDING: v } as NodeJS.ProcessEnv)
        .ENABLE_SELF_SERVICE_TEST_FUNDING;
    expect(read('false')).toBe(false);
    expect(read('true')).toBe(true);
  });

  it('caps the grant at BZ$250 however large the variable says', () => {
    // A fat-fingered deployment must not be able to mint more than the policy.
    expect(() =>
      loadEnv({ ...base, SELF_SERVICE_TEST_FUNDING_AMOUNT_MINOR: '1000000' } as NodeJS.ProcessEnv),
    ).toThrow(/SELF_SERVICE_TEST_FUNDING_AMOUNT_MINOR/);
    expect(loadEnv(base as NodeJS.ProcessEnv).SELF_SERVICE_TEST_FUNDING_AMOUNT_MINOR).toBe(25_000);
  });

  it('reads a blank expiry as no expiry rather than refusing to boot', () => {
    // Clearing a value by emptying it is what an operator naturally does, and
    // the API refusing to start over it would punish the safe direction.
    const env = loadEnv({ ...base, SELF_SERVICE_TEST_FUNDING_EXPIRES_AT: '  ' } as NodeJS.ProcessEnv);
    expect(env.SELF_SERVICE_TEST_FUNDING_EXPIRES_AT).toBeUndefined();
  });

  it('still rejects an expiry that is not a timestamp', () => {
    expect(() =>
      loadEnv({ ...base, SELF_SERVICE_TEST_FUNDING_EXPIRES_AT: 'next Tuesday' } as NodeJS.ProcessEnv),
    ).toThrow(/SELF_SERVICE_TEST_FUNDING_EXPIRES_AT/);
  });
});
