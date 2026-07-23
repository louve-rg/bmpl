/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  // Consume workspace TS packages directly.
  transpilePackages: ['@bmpl/shared', '@bmpl/validation'],
  async rewrites() {
    // Proxy API calls through the web origin so HTTP-only cookies flow cleanly.
    const api = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:4000';
    return [{ source: '/api/:path*', destination: `${api}/api/:path*` }];
  },
};

export default nextConfig;
