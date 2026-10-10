import { ensurePortFree, startDevServer, stopDevServer, waitForRealReadiness, PORT } from './server';
import { OPS_PASSWORD } from './auth';

/**
 * Returning a teardown function (rather than a separate `globalTeardown`
 * config entry) keeps setup and teardown in the same process, so the server
 * handle never has to cross a process boundary via a PID file — see
 * ./server.ts for why the PID itself still gets re-derived from the OS
 * rather than trusted from this closure.
 *
 * globalSetup is config-level: it runs regardless of whether every test in
 * the file is going to skip (unlike a per-test fixture, a describe-level
 * `test.skip()` doesn't touch it). Every CI run has no UAT_OPS_PASSWORD, so
 * without this check, CI would still pay for starting a full `next dev`
 * server and waiting on it to become ready, for a server no test will ever
 * talk to -- a far bigger cost than the one chromium launch that the
 * describe-level skip in page-header-overflow.spec.ts already avoids (see
 * that file's own comment). Checked here, before anything starts.
 */
export default async function globalSetup() {
  if (!OPS_PASSWORD) return;

  if (!process.env.ADMIN_PUBLIC_API_URL) {
    throw new Error(
      'ADMIN_PUBLIC_API_URL is not set. Set it to a live API before running this suite, e.g. ' +
        'ADMIN_PUBLIC_API_URL=http://localhost:4001 pnpm --filter @bmpl/admin test:e2e',
    );
  }

  ensurePortFree(PORT);
  const server = startDevServer();

  let stderr = '';
  server.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForRealReadiness();
  } catch (e) {
    stopDevServer(server);
    throw new Error(`${(e as Error).message}\n--- dev server stderr ---\n${stderr}`);
  }

  return async () => {
    stopDevServer(server);
  };
}
