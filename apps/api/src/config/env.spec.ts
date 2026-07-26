import { describe, expect, it } from 'vitest';
import { cookiesSecure, listenPort, loadEnv, storageEnabled } from './env';

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
