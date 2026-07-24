/**
 * Security headers applied to every response. A strict CSP is intentionally left
 * as report/planning (see docs/DEPLOYMENT.md) to avoid breaking Next's inline
 * runtime; the headers below are safe to enforce today.
 */
const securityHeaders = [
  { key: 'X-Content-Type-Options', value: 'nosniff' },
  { key: 'X-Frame-Options', value: 'DENY' },
  { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
  { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(self)' },
  {
    key: 'Strict-Transport-Security',
    value: 'max-age=31536000; includeSubDomains; preload',
  },
];

/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
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
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};

export default nextConfig;
