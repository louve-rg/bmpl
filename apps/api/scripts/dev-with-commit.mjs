/**
 * Dev boot wrapper — resolves GIT_COMMIT_SHA once, before the server starts,
 * then spawns the real dev command (BMPL-233).
 *
 * The dev-server identity check (scripts/dev-server-check.mjs, merged 5c62ae3)
 * and health.controller.ts already handle GIT_COMMIT_SHA correctly once it is
 * set — the gap was that nothing ever set it on an ordinary `pnpm dev` boot,
 * so the everyday verdict was UNKNOWN instead of MATCH. This closes that one
 * gap: populating the variable, nothing else.
 *
 * NEVER a placeholder: if HEAD cannot be resolved (not a git checkout, git
 * unavailable, a detached/corrupt state), GIT_COMMIT_SHA is left UNSET so the
 * check correctly reports UNKNOWN. Setting it to anything that is not a real
 * commit SHA would let the identity check misread "no information available"
 * as "a real, different commit" — manufacturing a false MISMATCH against a
 * server that is fine, exactly what health.controller.ts already refuses to
 * do by not falling back to APP_VERSION or the literal "dev".
 *
 * Resolved ONCE here, at boot — never at request time inside the API itself,
 * so the health endpoint stays a cheap liveness check.
 *
 * A no-op in production: Railway starts `node dist/main.js` directly
 * (apps/api/Dockerfile), never this script, and injects its own
 * RAILWAY_GIT_COMMIT_SHA, which both call sites still prefer first.
 */
import { execFileSync, spawn } from 'node:child_process';

function resolveHead() {
  try {
    const head = execFileSync('git', ['rev-parse', 'HEAD'], {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    }).trim();
    return head || null;
  } catch {
    return null;
  }
}

const head = resolveHead();
const env = { ...process.env };
if (head) {
  env.GIT_COMMIT_SHA = head;
  console.log(`[dev] GIT_COMMIT_SHA=${head.slice(0, 7)} (dev-server identity check will report MATCH/MISMATCH)`);
} else {
  delete env.GIT_COMMIT_SHA;
  console.log('[dev] could not resolve `git rev-parse HEAD` — GIT_COMMIT_SHA left unset, identity check will report UNKNOWN');
}

// shell: true so Windows cmd resolves the `nest.CMD` shim in node_modules/.bin
// the same way a bare `nest start --watch` invocation would.
const child = spawn('nest', ['start', '--watch'], { stdio: 'inherit', shell: true, env });
child.on('exit', (code, signal) => {
  if (signal) process.kill(process.pid, signal);
  else process.exitCode = code ?? 0;
});
