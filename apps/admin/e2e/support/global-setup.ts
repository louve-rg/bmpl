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
 * `test.skip()` doesn't touch it). Every CI run has no UAT_OPS_PASSWORD and
 * no SEED_SUPER_ADMIN_PASSWORD, so without this check, CI would still pay
 * for starting a full `next dev` server and waiting on it to become ready,
 * for a server no test will ever talk to -- a far bigger cost than the one
 * chromium launch that each spec's own describe-level skip already avoids
 * (see page-header-overflow.spec.ts's and master-detail-grid-overflow.spec.ts's
 * own comments). Checked here, before anything starts.
 *
 * This gate used to check ONLY `OPS_PASSWORD`, back when it was the one
 * credential any local-only spec in this suite needed. It stayed narrow
 * after a second spec (master-detail-grid-overflow.spec.ts) was added that
 * needs SEED_SUPER_ADMIN_PASSWORD instead -- that spec's own describe-level
 * skip correctly read ITS credential, but the shared server this whole file
 * (not per-spec) is responsible for starting never came up, because this
 * check never looked at it: every test in the file still "ran" and then
 * individually skipped once `loginOk` stayed false, with no page ever
 * reachable (`ERR_CONNECTION_REFUSED`, not a login failure) -- found live,
 * not assumed, while first verifying that new spec actually exercises the
 * grid-cols-1 fix end to end. Any credential a spec in this suite might use
 * needs to be named here, or that spec's server silently never starts.
 */
export default async function globalSetup() {
  if (!OPS_PASSWORD && !process.env.SEED_SUPER_ADMIN_PASSWORD) return;

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
