import { ensurePortFree, startDevServer, stopDevServer, waitForRealReadiness, PORT } from './server';

/**
 * Returning a teardown function (rather than a separate `globalTeardown`
 * config entry) keeps setup and teardown in the same process, so the server
 * handle never has to cross a process boundary via a PID file — see
 * ./server.ts for why the PID itself still gets re-derived from the OS
 * rather than trusted from this closure.
 */
export default async function globalSetup() {
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
