import * as fs from 'node:fs';
import { ensurePortFree, startDevServer, stopDevServer, waitForRealReadiness, CONTRAST_PORT, CONTRAST_BASE_URL } from './server';
import { SWEEP_RESULTS_NDJSON_PATH } from './contrast-sweep';

/**
 * Same lifecycle as global-setup.ts, pinned to CONTRAST_PORT instead of
 * PORT -- found live (2026-10-21, PR #469's first real run) that the visual
 * suite's own server teardown, which the plain e2e and visual configs both
 * share via global-setup.ts, left PORT (3177) still bound by the time this
 * suite's step started later in the same CI job: EADDRINUSE on a fresh
 * `next dev -p 3177`, the sweep never ran, and the job's failure was read as
 * a contrast result that it was not. A distinct port removes the dependency
 * on that teardown succeeding within this job, rather than trusting it for
 * the first time under a second same-job consumer -- see server.ts's own
 * CONTRAST_PORT comment.
 */
export default async function globalSetup() {
  // Truncated exactly once per `playwright test` invocation, here rather
  // than in contrast-sweep.ts itself (god, 2026-10-22, MDF-376): a worker
  // restart after a failed test resets that module's state, so a module-
  // level "have I cleared it yet" flag would either never fire or fire on
  // every restart. Global setup runs once regardless of worker restarts.
  fs.rmSync(SWEEP_RESULTS_NDJSON_PATH, { force: true });

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
