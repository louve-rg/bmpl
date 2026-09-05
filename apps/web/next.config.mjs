/**
 * Security headers applied to every response. A strict CSP is intentionally left
 * as report/planning (see docs/DEPLOYMENT.md) to avoid breaking Next's inline
 * runtime; the headers below are safe to enforce today.
 */
// Non-secret build identifier so a domain audit can prove the custom domain and
// the Vercel URL serve the same commit (Vercel injects VERCEL_GIT_COMMIT_SHA).
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
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },
];

/**
 * Normalize the API base so the /api proxy destination is ALWAYS a valid
 * absolute URL: default to the production API when unset, prepend https:// when
 * there's no scheme (a schemeless value makes Next treat the rewrite as an
 * internal path → 404), and strip a trailing slash / accidental "/api".
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
  // Do not ship JS source maps to the browser in production.
  productionBrowserSourceMaps: false,
  transpilePackages: ['@bmpl/shared', '@bmpl/validation'],
  images: {
    // Allow future public object-storage / CDN image domains (env-driven).
    remotePatterns: process.env.NEXT_PUBLIC_PUBLIC_ASSET_HOST
      ? [{ protocol: 'https', hostname: process.env.NEXT_PUBLIC_PUBLIC_ASSET_HOST }]
      : [],
  },
  async headers() {
    return [{ source: '/:path*', headers: securityHeaders }];
  },
  async rewrites() {
    // Same-origin proxy: the browser only talks to this origin; requests to
    // /api/* are proxied to the API so HTTP-only auth cookies stay first-party.
    const api = apiBase(process.env.NEXT_PUBLIC_API_URL);
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};

export default nextConfig;
