import { beforeAll, describe, expect, it } from 'vitest';

/**
 * BMPL-227: apps/web/lib/server-api.ts used to default to the PRODUCTION
 * API when NEXT_PUBLIC_API_URL was absent, independently of the identical
 * hazard in next.config.mjs's rewrite proxy (server components fetch
 * directly, not through the rewrite). It must refuse instead of guessing.
 *
 * The module computes its API base at import time, so NEXT_PUBLIC_API_URL
 * must already be set before the dynamic import below — otherwise importing
 * the module itself throws, which is the correct real-world behavior but
 * would fail this whole test file rather than exercising `apiBase` directly.
 */
let apiBase: (raw?: string) => string;

beforeAll(async () => {
  process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000';
  ({ apiBase } = await import('./server-api'));
});

describe('web server-api apiBase', () => {
  it('refuses to default to the production API when the value is absent', () => {
    expect(() => apiBase(undefined)).toThrow(/NEXT_PUBLIC_API_URL is not set/);
    expect(() => apiBase('')).toThrow(/NEXT_PUBLIC_API_URL is not set/);
  });

  it('adds a scheme when the value has none', () => {
    expect(apiBase('localhost:4000')).toBe('https://localhost:4000');
  });

  it('strips a trailing slash and an accidental trailing /api', () => {
    expect(apiBase('http://localhost:4000/')).toBe('http://localhost:4000');
    expect(apiBase('http://localhost:4000/api')).toBe('http://localhost:4000');
  });
});
