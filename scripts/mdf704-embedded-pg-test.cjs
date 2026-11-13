const EmbeddedPostgres = require('embedded-postgres').default;
const fs = require('fs');
const os = require('os');
const path = require('path');

/**
 * MDF-737: the data directory must NEVER sit inside the git worktree.
 * Tonight's incident (TERM-PGDATA-HAZARD) — `.mdf704-pgdata` lived at the
 * worktree root, untracked; `git stash push -u` cleaned it mid-run while
 * Postgres had it open, corrupting a live cluster with no backup. Gitignore
 * would not have prevented this (`git clean -fdx` / `stash -u` ignore it).
 * Keyed by the worktree's own absolute path (not a fixed name) so a fresh
 * checkout of this same worktree directory finds its own prior data again,
 * and a DIFFERENT worktree running this same script never collides with it.
 * Outside the worktree entirely also means outside `apps/api/tsconfig.json`'s
 * watched tree (`include: ["src"]`) by construction — never a restart trigger.
 */
const worktreeRoot = path.resolve(__dirname, '..');
const worktreeKey = Buffer.from(worktreeRoot).toString('base64url');
const dataDir = path.join(os.homedir(), '.bmpl-local-infra', worktreeKey, 'pgdata');

async function main() {
  fs.mkdirSync(path.dirname(dataDir), { recursive: true });
  const alreadyInitialised = fs.existsSync(path.join(dataDir, 'PG_VERSION'));

  const pg = new EmbeddedPostgres({
    databaseDir: dataDir,
    user: 'bmpl',
    password: 'bmpl_dev_password',
    port: 15433,
    persistent: true,
    initdbFlags: ['--encoding=UTF8', '--locale=C'],
  });

  if (alreadyInitialised) {
    console.log(`Reusing existing cluster at ${dataDir}`);
  } else {
    console.log(`Initializing new cluster at ${dataDir}...`);
    await pg.initialise();
  }
  console.log('Starting...');
  await pg.start();
  console.log('Creating database...');
  try {
    await pg.createDatabase('bmpl');
  } catch (e) {
    if (!/already exists/i.test(String(e.message ?? e))) throw e;
    console.log('Database "bmpl" already exists, skipping create.');
  }
  console.log('READY. DATABASE_URL=postgresql://bmpl:bmpl_dev_password@localhost:15433/bmpl');

  // Keep running until explicitly killed, so the caller can run prisma
  // migrate / the API against it, then send SIGTERM to stop cleanly.
  process.on('SIGTERM', async () => {
    console.log('Stopping...');
    await pg.stop();
    process.exit(0);
  });
}

main().catch((err) => {
  console.error('FAILED:', err);
  process.exit(1);
});
