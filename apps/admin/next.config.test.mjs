import { afterEach, describe, expect, it } from 'vitest';

/**
 * BMPL-224: the /api rewrite proxy used to default to the PRODUCTION API
 * when ADMIN_PUBLIC_API_URL was absent — a developer who set the wrong
 * (web-app-shaped) env var name got a silently working admin console
 * pointed at production instead of an error telling them so. It must now
 * refuse instead of guessing.
 */

const ORIGINAL = process.env.ADMIN_PUBLIC_API_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.ADMIN_PUBLIC_API_URL;
  else process.env.ADMIN_PUBLIC_API_URL = ORIGINAL;
});

describe('admin next.config.mjs rewrite target', () => {
  it('refuses to build a rewrite when ADMIN_PUBLIC_API_URL is unset', async () => {
    const nextConfig = (await import('./next.config.mjs')).default;
    delete process.env.ADMIN_PUBLIC_API_URL;
    await expect(nextConfig.rewrites()).rejects.toThrow(/ADMIN_PUBLIC_API_URL is not set/);
  });

  it('still proxies to the configured API when the var is set', async () => {
    const nextConfig = (await import('./next.config.mjs')).default;
    process.env.ADMIN_PUBLIC_API_URL = 'http://localhost:4000';
    const rewrites = await nextConfig.rewrites();
    expect(rewrites).toEqual([{ source: '/api/:path*', destination: 'http://localhost:4000/api/:path*' }]);
  });
});
