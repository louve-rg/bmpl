import { afterEach, describe, expect, it } from 'vitest';

/**
 * BMPL-227: the /api rewrite proxy used to default to the PRODUCTION API
 * when NEXT_PUBLIC_API_URL was absent — a misconfigured preview or a local
 * build got a silently working web app pointed at production instead of an
 * error telling them so. It must now refuse instead of guessing.
 */

const ORIGINAL = process.env.NEXT_PUBLIC_API_URL;

afterEach(() => {
  if (ORIGINAL === undefined) delete process.env.NEXT_PUBLIC_API_URL;
  else process.env.NEXT_PUBLIC_API_URL = ORIGINAL;
});

describe('web next.config.mjs rewrite target', () => {
  it('refuses to build a rewrite when NEXT_PUBLIC_API_URL is unset', async () => {
    const nextConfig = (await import('./next.config.mjs')).default;
    delete process.env.NEXT_PUBLIC_API_URL;
    await expect(nextConfig.rewrites()).rejects.toThrow(/NEXT_PUBLIC_API_URL is not set/);
  });

  it('still proxies to the configured API when the var is set', async () => {
    const nextConfig = (await import('./next.config.mjs')).default;
    process.env.NEXT_PUBLIC_API_URL = 'http://localhost:4000';
    const rewrites = await nextConfig.rewrites();
    expect(rewrites).toEqual([{ source: '/api/:path*', destination: 'http://localhost:4000/api/:path*' }]);
  });
});
