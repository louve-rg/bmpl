const S3rver = require('s3rver');
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * TERM-S3DATA-HAZARD: same defect class as MDF-737 -- `.mdf704-s3data` lived
 * inside the worktree root, untracked, where a live S3rver held files open.
 * A `git clean -fdx` / `stash -u` on this worktree would hit it exactly like
 * it hit the old `.mdf704-pgdata`. Checked whether s3rver has a persistent:
 * false equivalent (it does: `resetOnClose`, default false) -- it was never
 * set here, so that second bug class does not apply; only the in-worktree
 * path does. Keyed the same way as the Postgres fix so both land in one PR.
 */
const worktreeRoot = path.resolve(__dirname, '..');
const worktreeKey = Buffer.from(worktreeRoot).toString('base64url');
const dataDir = path.join(os.homedir(), '.bmpl-local-infra', worktreeKey, 's3data');

async function main() {
  fs.mkdirSync(dataDir, { recursive: true });
  const instance = new S3rver({
    port: 9000,
    address: '127.0.0.1',
    silent: false,
    resetOnClose: false,
    directory: dataDir,
    configureBuckets: [
      { name: 'bmpl-documents', configs: [] },
      { name: 'bmpl-public', configs: [] },
    ],
  });
  await instance.run();
  console.log('READY. S3 endpoint=http://127.0.0.1:9000');

  process.on('SIGTERM', () => {
    instance.close(() => process.exit(0));
  });
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
