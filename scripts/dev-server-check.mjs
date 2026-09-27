#!/usr/bin/env node
/**
 * dev-server-check — is whatever's answering this port actually today's
 * build? (BMPL-213 residual)
 *
 *   node scripts/dev-server-check.mjs 3000
 *   node scripts/dev-server-check.mjs 3001 --path /login
 *   node scripts/dev-server-check.mjs 3000 --kill
 *
 * `next dev` forks a listener separate from the shell that started it, so
 * stopping the tracked shell does not stop the server — and `curl`/a browser
 * kept returning 200 from the stale one while it served 404s on its own JS
 * chunks (bmpl-web hit this three times on 2026-09-26: once as a killed-shell
 * orphan, once across a branch switch, once when a `next build` wrote into a
 * running dev server's own `.next` directory). A restart looking successful
 * and a health check passing are both the wrong question — "did something
 * answer" is not "is it today's code".
 *
 * apps/web/e2e/support/server.ts solves this for the Playwright harness by
 * never touching the developer's own port at all (a dedicated port, refusing
 * to start on a non-empty one). It cannot help a developer running an
 * ordinary `pnpm dev` on the normal port, which is the case that keeps
 * costing people time — this script is that same PID-lookup/real-chunk logic,
 * pointed at whatever port you ask, for a human to run by hand. It is a
 * DELIBERATE, small duplication of that ~20-line OS primitive rather than a
 * shared import: server.ts is TypeScript consumed by Playwright's own
 * transform, this is a zero-build CLI script, and unifying them would need
 * build tooling disproportionate to the amount of logic involved. If the
 * duplicated logic here ever needs to change, change it in both places.
 *
 * VERDICTS (freshness -- Next.js dev servers, i.e. web/admin):
 *   FRESH   the page loaded and its own referenced static JS chunk also
 *           loaded as real JavaScript
 *   STALE   the page loaded but its own chunk did not (bmpl-web's exact
 *           shape) -- printed alongside the PID and the exact kill command
 *   UNKNOWN could not tell (unreachable, or not a Next.js response at all) --
 *           deliberately NOT read as a pass; an unresolvable check that
 *           reports success is worse than no check (see BMPL-211's
 *           category-count checker, same convention, same reason)
 *
 * VERDICTS (identity -- the API dev server, BMPL-226): freshness above
 * answers "is this stale content" and cannot answer "is this even the
 * commit I think it is" -- a server that survived a branch switch without a
 * restart serves a healthy 200 from `/api/health` that is lying about which
 * code is actually running, and nothing about that response looks wrong. So
 * when a port answers `/api/health` in the expected shape, this script asks
 * a different question instead of the freshness one, by comparing that
 * response's `commit` field to local `git rev-parse HEAD`:
 *   MATCH    the server's reported commit equals local HEAD
 *   MISMATCH the server reports a DIFFERENT commit -- typically a branch
 *            switch since the server was last started. NOT a dirty working
 *            tree: HEAD does not move on uncommitted edits, only on commit
 *            or checkout, so uncommitted local work is the normal case and
 *            is never reported as a mismatch
 *   UNKNOWN  the server reported no commit at all (an ordinary local
 *            `pnpm dev` boot today never sets RAILWAY_GIT_COMMIT_SHA or
 *            GIT_COMMIT_SHA, so this is the common case, not a failure of
 *            this check), or local HEAD could not be determined -- a
 *            MISMATCH and an UNKNOWN are different answers, and branding a
 *            server wrong because it could not be asked is the same defect
 *            as branding a booting server dead
 *
 * Exit codes: 0 nothing listening, or an all-clear verdict (FRESH / MATCH /
 * identity not applicable). 1 a confirmed problem (STALE or MISMATCH). 2 an
 * UNKNOWN on whichever dimension applied.
 *
 * NOT covered, and not worth building a detector for: two Next.js processes
 * (a `dev` and a `build`) writing the SAME `.next` directory concurrently.
 * That has no clean external signal the way a stale port does -- the fix is
 * a rule people follow (never run a build against an app while its own dev
 * server is running), not a check people run. Named here so it isn't lost,
 * not solved here.
 *
 * `--kill` re-derives the PID from the OS (not the one printed in the
 * verdict, in case it changed) and force-kills its whole process tree.
 * Windows-only (`netstat`/`taskkill`, matching this repo's dev platform); the
 * POSIX branch is best effort and not exercised here.
 */
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const port = Number.parseInt(args[0], 10);
if (!Number.isInteger(port) || port <= 0) {
  console.error('Usage: node scripts/dev-server-check.mjs <port> [--path /route] [--kill]');
  process.exitCode = 2;
  process.exit(2);
}
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const routePath = flag('path') ?? '/';
const doKill = args.includes('--kill');

function findPidOnPort(p) {
  if (process.platform !== 'win32') {
    try {
      const out = execFileSync('bash', ['-c', `lsof -ti:${p} | head -n1`], { encoding: 'utf8' }).trim();
      return out || null;
    } catch {
      return null;
    }
  }
  try {
    const out = execFileSync('netstat', ['-ano'], { encoding: 'utf8' });
    const line = out.split('\n').find((l) => l.includes(`:${p} `) && l.toUpperCase().includes('LISTENING'));
    if (!line) return null;
    const cols = line.trim().split(/\s+/);
    return cols[cols.length - 1] ?? null;
  } catch {
    return null;
  }
}

function killPid(pid) {
  try {
    if (process.platform === 'win32') {
      execFileSync('taskkill', ['/PID', pid, '/T', '/F'], { stdio: 'ignore' });
    } else {
      execFileSync('kill', ['-9', pid], { stdio: 'ignore' });
    }
  } catch {
    // already gone
  }
}

// A port answering `/api/health` in the expected shape is the API, not a
// Next.js dev server -- returns the parsed body, or null if this port isn't
// that (unreachable, non-JSON, or JSON missing the fields health.controller.ts
// always includes). null means "try the freshness check instead", not UNKNOWN.
async function tryFetchHealth(base) {
  try {
    const res = await fetch(`${base}/api/health`);
    if (!res.ok) return null;
    const body = await res.json();
    if (!body || typeof body !== 'object' || !('status' in body) || !('commit' in body)) return null;
    return body;
  } catch {
    return null;
  }
}

function localHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}

// health.commit is `null` (no RAILWAY_GIT_COMMIT_SHA / GIT_COMMIT_SHA) or a
// 7-char slice of a real SHA (health.controller.ts). Never trust '' either.
function evaluateIdentity(health) {
  const serverCommit = health.commit || null;
  if (!serverCommit) {
    return {
      identity: 'UNKNOWN',
      identityReason:
        'the server reported no commit (RAILWAY_GIT_COMMIT_SHA / GIT_COMMIT_SHA is unset -- the normal case for an ordinary local `pnpm dev` boot today, not a failure of this check)',
    };
  }
  const head = localHead();
  if (!head) {
    return { identity: 'UNKNOWN', identityReason: '`git rev-parse HEAD` failed -- not a git checkout, or git is unavailable' };
  }
  const headShort = head.slice(0, serverCommit.length);
  if (headShort === serverCommit) {
    return {
      identity: 'MATCH',
      identityReason: `server commit ${serverCommit} matches local HEAD ${head} (uncommitted local changes, if any, do not affect this -- HEAD only moves on commit or checkout)`,
    };
  }
  return {
    identity: 'MISMATCH',
    identityReason: `server reports commit ${serverCommit}, local HEAD is ${head.slice(0, 7)} -- a DIFFERENT COMMIT, the shape of a branch switch since the server was last started (not a dirty tree -- HEAD does not move on uncommitted edits)`,
  };
}

function reportKill(pid) {
  if (!doKill) return;
  const currentPid = findPidOnPort(port);
  if (currentPid) {
    console.log(`Killing PID ${currentPid}...`);
    killPid(currentPid);
  }
  const after = findPidOnPort(port);
  console.log(after ? `Port ${port} is still bound to PID ${after} after the kill attempt.` : `Port ${port} is now free.`);
}

async function main() {
  const pid = findPidOnPort(port);
  if (!pid) {
    console.log(`Nothing is listening on port ${port}.`);
    process.exitCode = 0;
    return;
  }
  console.log(`Port ${port} is bound to PID ${pid}.`);

  const base = `http://localhost:${port}`;
  const health = await tryFetchHealth(base);

  if (health) {
    const { identity, identityReason } = evaluateIdentity(health);
    console.log(`Identity: ${identity} (${identityReason})`);
    if (identity === 'MISMATCH') {
      console.log(`Recipe to free it: taskkill /PID ${pid} /T /F`);
    }
    reportKill(pid);
    process.exitCode = identity === 'MISMATCH' ? 1 : identity === 'UNKNOWN' ? 2 : 0;
    return;
  }

  let verdict = 'UNKNOWN';
  let reason = 'could not reach it';
  try {
    const res = await fetch(`${base}${routePath}`);
    if (!res.ok) {
      reason = `${routePath} returned HTTP ${res.status}`;
    } else {
      const html = await res.text();
      const chunkMatch = html.match(/\/_next\/static\/[^"'\\]+\.js/);
      if (!chunkMatch) {
        reason = `${routePath} responded but referenced no _next static chunk (not a Next.js page, or too early in startup)`;
      } else {
        const chunkRes = await fetch(`${base}${chunkMatch[0]}`);
        const contentType = chunkRes.headers.get('content-type') ?? '';
        if (chunkRes.ok && contentType.includes('javascript')) {
          verdict = 'FRESH';
          reason = `${routePath} loaded and its own chunk (${chunkMatch[0]}) returned real JavaScript`;
        } else {
          verdict = 'STALE';
          reason = `${routePath} loaded but its own chunk (${chunkMatch[0]}) returned HTTP ${chunkRes.status} -- root 200s, chunks don't`;
        }
      }
    }
  } catch (e) {
    reason = `could not reach ${routePath}: ${e.message}`;
  }

  console.log(`Verdict: ${verdict} (${reason})`);
  if (verdict === 'STALE') {
    console.log(`Recipe to free it: taskkill /PID ${pid} /T /F`);
  }

  reportKill(pid);

  process.exitCode = verdict === 'FRESH' ? 0 : verdict === 'STALE' ? 1 : 2;
}

main();
