import { execFileSync, spawn, type ChildProcess } from 'node:child_process';
import path from 'node:path';

/**
 * The dev-server lifecycle this suite manages itself, rather than trusting
 * Playwright's built-in `webServer` option — same reasoning apps/web's own
 * e2e/support/server.ts records (BMPL-213/217), reused here rather than
 * re-derived because it is a real, previously-hit failure mode, not a
 * theoretical one: `next dev` forks a listener process separate from the
 * shell that launched it, so stopping the tracked shell does NOT stop the
 * server — a health check that only waits for a 200 can test yesterday's
 * build and pass. `ensurePortFree` refuses to start if anything is already
 * listening on PORT, and `waitForRealReadiness` confirms a real page
 * rendered (the login form's own email field) rather than stopping at "the
 * root document loaded".
 *
 * No dedicated e2e fixture page exists for admin (apps/web has one; this is
 * admin's first e2e spec, so there is no prior fixture to reuse). The real
 * /login page serves the same purpose here: it is a route every build must
 * render correctly, authentication included, so if it renders for real the
 * rest of the app is being served by the same running process.
 *
 * PORT is deliberately NOT 3001 (this app's normal `pnpm dev` port) and NOT
 * 3177 (apps/web's e2e port), so this harness can never collide with, or be
 * fooled by, anyone's own running dev server.
 *
 * CONTRAST_PORT exists for the same reason apps/web's own server.ts records
 * one: the contrast suite now runs as its own CI step, in the same job,
 * after the visual suite, and the port-teardown's POSIX path (below) was
 * found live (2026-10-21, PR #469) to leave PORT still bound when a second
 * same-job consumer tried to reuse it. A distinct port removes the
 * dependency on that teardown succeeding within this job, rather than
 * trusting it for the first time.
 */
export const PORT = 3178;
export const BASE_URL = `http://localhost:${PORT}`;
export const CONTRAST_PORT = 3180;
export const CONTRAST_BASE_URL = `http://localhost:${CONTRAST_PORT}`;

const ADMIN_ROOT = path.resolve(__dirname, '..', '..');

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
        `an existing 200 could be a stale process serving a broken build. Free the port and retry: ` +
        `taskkill /PID ${pid} /T /F`,
    );
  }
}

export function startDevServer(port: number = PORT): ChildProcess {
  return spawn('pnpm', ['exec', 'next', 'dev', '-p', String(port)], {
    cwd: ADMIN_ROOT,
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
 * Waits for more than "the root document responded". Confirms the real
 * /login page rendered its email field AND that a real static JS chunk the
 * page itself references also loads as JavaScript.
 */
export async function waitForRealReadiness(timeoutMs = 90_000, baseUrl: string = BASE_URL): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  let lastReason = 'no response yet';
  while (Date.now() < deadline) {
    const pageRes = await fetchOk(`${baseUrl}/login`);
    if (pageRes) {
      const html = await pageRes.text();
      if (!html.includes('login-email')) {
        lastReason = 'root document responded but the login form is missing';
      } else {
        const chunkMatch = html.match(/\/_next\/static\/[^"'\\]+\.js/);
        if (!chunkMatch) {
          lastReason = 'login form present but no static JS chunk reference found in the HTML';
        } else {
          const chunkRes = await fetchOk(`${baseUrl}${chunkMatch[0]}`);
          const contentType = chunkRes?.headers.get('content-type') ?? '';
          if (chunkRes && contentType.includes('javascript')) {
            return; // Real page, real asset. Genuinely ready.
          }
          lastReason = `login form present but its own static chunk did not load as JavaScript (${chunkMatch[0]})`;
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
export function stopDevServer(spawned: ChildProcess, port: number = PORT): void {
  try {
    spawned.kill();
  } catch {
    // best effort; the OS-level lookup below is what actually matters
  }
  for (let attempt = 0; attempt < 5; attempt++) {
    const pid = findPidOnPort(port);
    if (!pid) return;
    killPid(pid);
  }
  const stillThere = findPidOnPort(port);
  if (stillThere) {
    // eslint-disable-next-line no-console
    console.error(`e2e teardown: PID ${stillThere} is still bound to port ${port} after repeated kill attempts.`);
  }
}
