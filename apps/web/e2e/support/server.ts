import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

/**
 * The dev-server lifecycle the e2e suite manages itself, rather than trusting
 * Playwright's built-in `webServer` option — BMPL-213/217.
 *
 * bmpl-web hit this for real on 2026-09-26: `next dev` forks a listener
 * process separate from the shell that launched it, so stopping the tracked
 * shell did NOT stop the server. curl kept returning 200 from the stale
 * process while it served 404s on its own JS/CSS chunks — a health check
 * that answers a question next to the one you meant to ask. A suite that
 * starts its own server and only waits for a 200 can therefore test
 * yesterday's build and pass. Two things here exist specifically to close
 * that gap:
 *   1. `ensurePortFree` refuses to start if anything is already listening on
 *      PORT, rather than assuming an existing 200 means "our server, ready" —
 *      there is no way to tell a fresh listener from a stale one from the
 *      outside, so the only safe move is to insist on an empty port.
 *   2. `waitForRealReadiness` does not stop at "the root document loaded". It
 *      confirms the fixture page's own marker attribute is present AND that
 *      a real `_next/static/*.js` chunk the page references actually returns
 *      JavaScript — the exact shape of the failure bmpl-web hit (shell 200,
 *      chunk 404).
 *
 * PORT is deliberately NOT 3000 (the project's normal `pnpm dev` port), so
 * this harness can never collide with, or be fooled by, a developer's own
 * running dev server.
 */
export const PORT = 3177;
export const BASE_URL = `http://localhost:${PORT}`;
export const FIXTURE_PATH = '/e2e-test-fixtures/dialogs';
export const FIXTURE_READY_MARKER = 'data-e2e-fixture-ready';

const WEB_ROOT = path.resolve(__dirname, '..', '..');

/**
 * The PID actually bound to `port`, read from the OS rather than from
 * whatever process object we spawned — `next dev`'s own child is not
 * necessarily the process holding the socket. Windows-only (`netstat`),
 * matching this repo's development platform; the POSIX branch is a best
 * effort, not exercised or verified here.
 */
function findPidOnPort(port: number): string | null {
  if (process.platform !== 'win32') {
    try {
      const out = execFileSync('bash', ['-c', `lsof -ti:${port} | head -n1`], { encoding: 'utf8' }).trim();
      return out || null;
    } catch {
      return null;
    }
  }
  try {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
    const line = out.split('\n').find((l) => l.includes(`:${port} `) && l.toUpperCase().includes('LISTENING'));
    if (!line) return null;
    const cols = line.trim().split(/\s+/);
    return cols[cols.length - 1] ?? null;
  } catch {
    return null;
  }
}

function killPid(pid: string): void {
  try {
    if (process.platform === 'win32') {
      // /T kills the process tree: `next dev`'s real listener is a child of
      // whatever we spawned, not the spawned process itself.
      execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' });
    } else {
      execFileSync('kill', ['-9', pid], { stdio: 'ignore' });
    }
  } catch {
    // Already gone -- not an error.
  }
}

export function ensurePortFree(port: number): void {
  const pid = findPidOnPort(port);
  if (pid) {
    throw new Error(
      `Port ${port} already has a listener (PID ${pid}). This harness only trusts a server it started itself -- ` +
        `an existing 200 could be a stale process serving a broken build (BMPL-213). Free the port and retry: ` +
        `taskkill /PID ${pid} /T /F`,
    );
  }
}

export function startDevServer(): ChildProcess {
  return spawn('pnpm', ['exec', 'next', 'dev', '-p', String(PORT)], {
    cwd: WEB_ROOT,
    shell: true,
    stdio: 'pipe',
    env: { ...process.env, NODE_ENV: 'development' },
  });
}

async function fetchOk(url: string): Promise<Response | null> {
  try {
    const res = await fetch(url);
    return res.ok ? res : null;
  } catch {
    return null;
  }
}

/**
 * Waits for more than "the root document responded". Confirms the fixture
 * page rendered for real (its marker attribute is present) AND that a real
 * static JS chunk the page itself references also loads as JavaScript --
 * the two-part check that would have caught bmpl-web's stale-server incident
 * (root 200, chunks 404).
 */
export async function waitForRealReadiness(timeoutMs = 90_000): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastReason = 'no response yet';
  while (Date.now() < deadline) {
    const pageRes = await fetchOk(`${BASE_URL}${FIXTURE_PATH}`);
    if (pageRes) {
      const html = await pageRes.text();
      if (!html.includes(FIXTURE_READY_MARKER)) {
        lastReason = 'root document responded but the fixture marker is missing';
      } else {
        const chunkMatch = html.match(/\/_next\/static\/[^"'\\]+\.js/);
        if (!chunkMatch) {
          lastReason = 'fixture marker present but no static JS chunk reference found in the HTML';
        } else {
          const chunkRes = await fetchOk(`${BASE_URL}${chunkMatch[0]}`);
          const contentType = chunkRes?.headers.get('content-type') ?? '';
          if (chunkRes && contentType.includes('javascript')) {
            return; // Real page, real asset. Genuinely ready.
          }
          lastReason = `fixture marker present but its own static chunk did not load as JavaScript (${chunkMatch[0]})`;
        }
      }
    }
    await new Promise((r) => setTimeout(r, 500));
  }
  throw new Error(`Dev server never reached real readiness within ${timeoutMs}ms: ${lastReason}`);
}

/**
 * Kills whatever is actually bound to PORT right now -- re-read from the OS
 * rather than trusted from startup, because `next dev` can fork after we
 * looked. Confirms the port is free afterward rather than assuming the kill
 * worked.
 */
export function stopDevServer(spawned: ChildProcess): void {
  try {
    spawned.kill();
  } catch {
    // best effort; the OS-level lookup below is what actually matters
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const pid = findPidOnPort(PORT);
    if (!pid) return;
    killPid(pid);
  }
  const stillThere = findPidOnPort(PORT);
  if (stillThere) {
    // eslint-disable-next-line no-console
    console.error(`e2e teardown: PID ${stillThere} is still bound to port ${PORT} after repeated kill attempts.`);
  }
}
