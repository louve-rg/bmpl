/**
 * Global setup for the integration suite. Runs ONCE before any test worker.
 *
 * Hard requirement: TEST_DATABASE_URL must be set. If it is missing the whole
 * run FAILS with a clear message — the suite is never silently skipped, so a
 * green run always means the workflows actually executed against real Postgres.
 */
import { execSync } from 'node:child_process';
import { resolve } from 'node:path';
import { config as loadDotenv } from 'dotenv';

export default function globalSetup() {
  loadDotenv({ path: resolve(process.cwd(), '../../.env') });
  const testUrl = process.env.TEST_DATABASE_URL;
  if (!testUrl) {
    throw new Error(
      '\n\n[integration] TEST_DATABASE_URL is not set.\n' +
        'Integration tests require a disposable PostgreSQL database (and MinIO for\n' +
        'storage tests). Set TEST_DATABASE_URL, e.g.\n' +
        '  TEST_DATABASE_URL="postgresql://bmpl:***@localhost:5432/bmpl_test?schema=public"\n' +
        'then re-run:  pnpm --filter @bmpl/api test:integration\n',
    );
  }

  // Ensure the test database schema matches the committed migrations.
  const dbDir = resolve(process.cwd(), '../../packages/database');
  execSync('pnpm exec prisma migrate deploy', {
    cwd: dbDir,
    stdio: 'inherit',
    env: { ...process.env, DATABASE_URL: testUrl, DIRECT_URL: testUrl },
  });
}
