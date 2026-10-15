import { ensurePortFree, startDevServer, stopDevServer, waitForRealReadiness, PORT } from './server';

/**
 * Returning a teardown function (rather than a separate `globalTeardown`
 * config entry) keeps setup and teardown in the same process, so the server
 * handle never has to cross a process boundary via a PID file — see
 * ./server.ts for why the PID itself still gets re-derived from the OS
 * rather than trusted from this closure.
 *
 * The server now starts unconditionally, the same way apps/web's own
 * globalSetup always has. This used to gate on `OPS_PASSWORD` or
 * `SEED_SUPER_ADMIN_PASSWORD` being set, on the reasoning that every CI run
 * has neither, so without a gate CI would pay for a `next dev` server no
 * test would ever talk to. That reasoning held while every spec in this
 * suite needed a real login -- it stopped holding the day
 * product-detail-free-text-overflow.spec.ts was added: it needs no login at
 * all (a fake cookie plus its own self-hosted stub answering `/me` and the
 * product endpoint), so the gate was silently preventing the one spec that
 * could actually use this server from ever running, in any CI run, for
 * months -- found live, not assumed (MDF-266). The other seven spec files
 * keep skipping in CI exactly as before: four still need a real login
 * (page-header-overflow.spec.ts, master-detail-grid-overflow.spec.ts,
 * fieldset-min-width-audit.local-only.spec.ts,
 * user-detail-role-row-overflow.spec.ts) and skip on their own
 * describe-level `test.skip()` for the missing credential; three more
 * (order-detail-free-text-overflow.spec.ts, order-detail-header-overflow.spec.ts,
 * vendor-detail-rejection-reason-overflow.spec.ts) need no login but still
 * need the dashboard shell's own `/me` SSR call to succeed against a live
 * API, which CI doesn't have -- they already skip cleanly on that precondition
 * (their own `try`/`catch` around `goto`, same shape as this spec's own
 * guard below). Removing this gate only changes whether a server exists
 * under any of them, not whether they run.
 */
export default async function globalSetup() {
  if (!process.env.ADMIN_PUBLIC_API_URL) {
    throw new Error(
      'ADMIN_PUBLIC_API_URL is not set. Set it to a live API before running this suite, e.g. ' +
        'ADMIN_PUBLIC_API_URL=http://localhost:4000 pnpm --filter @bmpl/admin test:e2e',
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
