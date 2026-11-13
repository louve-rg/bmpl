const { RedisMemoryServer } = require('redis-memory-server');

/**
 * MDF-704: Redis is OPTIONAL for local dev, documented here rather than
 * silently assumed. `redis-memory-server` ships its own prebuilt binary
 * (no machine-level install, same shape as embedded-postgres/s3rver), so
 * there is no licensing question on THIS package — the open question the
 * owner has not yet been asked is whether a Windows-native alternative
 * (e.g. Memurai) would ever be preferred, which only matters if the
 * terminal workflows this stack exists to test actually need Redis at all.
 *
 * Start the rest of the stack WITHOUT running this script to test that:
 * if the terminal specs (lookup/inbound/status/collect/handoff) pass clean
 * with REDIS_URL unset/unreachable, Redis is genuinely optional for those
 * paths and this script is a convenience, not a requirement.
 */
async function main() {
  const redisServer = new RedisMemoryServer({ instance: { port: 16380 } });
  const host = await redisServer.getHost();
  const port = await redisServer.getPort();
  console.log(`READY. REDIS_URL=redis://${host}:${port}`);

  process.on('SIGTERM', async () => {
    console.log('Stopping...');
    await redisServer.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
