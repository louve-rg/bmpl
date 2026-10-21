import { ensurePortFree, startDevServer, stopDevServer, waitForRealReadiness, CONTRAST_PORT, CONTRAST_BASE_URL } from './server';

/**
 * Same lifecycle as global-setup.ts, pinned to CONTRAST_PORT instead of
 * PORT -- see apps/web's own global-setup.contrast.ts for the full
 * reasoning (found live, 2026-10-21, PR #469: the visual suite's server
 * teardown left PORT still bound when this suite's step started later in
 * the same CI job). Keeps the ADMIN_PUBLIC_API_URL guard from
 * global-setup.ts unchanged -- this suite needs a live API exactly as the
 * plain e2e suite does.
 */
export default async function globalSetup() {
  if (!process.env.ADMIN_PUBLIC_API_URL) {
    throw new Error(
      'ADMIN_PUBLIC_API_URL is not set. Set it to a live API before running this suite, e.g. ' +
        'ADMIN_PUBLIC_API_URL=http://localhost:4000 pnpm --filter @bmpl/admin test:contrast',
    );
  }

  ensurePortFree(CONTRAST_PORT);
  const server = startDevServer(CONTRAST_PORT);

  let stderr = '';
  server.stderr?.on('data', (chunk) => {
    stderr += String(chunk);
  });

  try {
    await waitForRealReadiness(90_000, CONTRAST_BASE_URL);
  } catch (e) {
    stopDevServer(server, CONTRAST_PORT);
    throw new Error(`${(e as Error).message}\n--- dev server stderr ---\n${stderr}`);
  }

  return async () => {
    stopDevServer(server, CONTRAST_PORT);
  };
}
