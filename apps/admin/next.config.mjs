// Non-secret build identifier, matching the one the web app already emits. A
// deployment audit could confirm which commit web and API were serving but not
// admin, which meant the admin console had to be verified by inference.
// RAW_COMMIT is '' when the build has no commit identity (a local build) — the
// header degrades to 'dev', while GET /health reports null so an unknown build
// stays reportable AS unknown rather than as a value.
const RAW_COMMIT =
  process.env.VERCEL_GIT_COMMIT_SHA || process.env.NEXT_PUBLIC_COMMIT_SHA || '';
const COMMIT = (RAW_COMMIT || 'dev').slice(0, 12);

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
  // Baked into the bundle at build time so GET /health answers from the build
  // itself, independent of what the runtime environment happens to expose. One
  // computation (RAW_COMMIT above) feeds both the header and the endpoint, so
  // the two channels cannot disagree about which commit this build is.
  env: { BMPL_BUILD_COMMIT: RAW_COMMIT },
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
