// Non-secret build identifier, matching the one the web app already emits. A
// deployment audit could confirm which commit web and API were serving but not
// admin, which meant the admin console had to be verified by inference.
const COMMIT = (
  process.env.VERCEL_GIT_COMMIT_SHA ||
  process.env.NEXT_PUBLIC_COMMIT_SHA ||
  'dev'
).slice(0, 12);

const securityHeaders = [
  { key: 'X-BMPL-Commit', value: COMMIT },
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=()' },
  { key: 'Strict-Transport-Security', value: 'max-age=31536000; includeSubDomains; preload' },
  // The admin console must never be indexed.
  { key: 'X-Robots-Tag', value: 'noindex, nofollow' },
];

/**
 * Normalize the API base so the /api proxy destination is ALWAYS a valid
 * absolute URL. Without a scheme, Next treats the rewrite destination as an
 * internal same-host path and returns a 404 (the exact failure we hit). We:
 *  - default to the production API when the env var is absent (so a missing
 *    build-time value can't break the deployed proxy),
 *  - prepend https:// when the value has no scheme,
 *  - strip a trailing slash and an accidental trailing "/api" (avoids /api/api).
 */
function apiBase(raw) {
  const v = (raw || 'https://bmplapi-production.up.railway.app').trim();
  const withScheme = /^https?:\/\//i.test(v) ? v : `https://${v}`;
  return withScheme.replace(/\/+$/, '').replace(/\/api$/i, '');
}

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  productionBrowserSourceMaps: false,
  transpilePackages: ['@bmpl/shared', '@bmpl/validation'],
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    // Same-origin proxy to the API (keeps admin auth cookies first-party).
    const api = apiBase(process.env.ADMIN_PUBLIC_API_URL);
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};

export default nextConfig;
