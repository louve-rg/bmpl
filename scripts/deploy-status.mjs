#!/usr/bin/env node
/**
 * deploy-status — is production actually running what main says? (BMPL-66)
 *
 * Compares the commit the production API reports from GET /api/health
 * against origin/main, and names both. Read-only: it observes, never
 * deploys, and changes nothing anywhere.
 *
 *   node scripts/deploy-status.mjs
 *   node scripts/deploy-status.mjs --web-route /dashboard/passenger
 *   node scripts/deploy-status.mjs --json
 *
 * Verdicts and exit codes:
 *   CURRENT  (0) production's commit is main's head
 *   BEHIND   (1) production runs an ancestor of main — both commits named,
 *                and with a local repo the undelivered commits are listed
 *   UNKNOWN  (2) a question could not be ANSWERED (endpoint unreachable,
 *                malformed health payload, git unreachable). Deliberately
 *                distinct from BEHIND: an empty answer is not a negative
 *                answer, and conflating them is how a stale deploy hid
 *                twice before this script existed.
 *   DIVERGED (3) production reports a commit that is NOT in origin/main's
 *                history (a rollback or branch build) — also not BEHIND,
 *                because "older than main" would be a guess.
 *
 * NOT a CI gate, on purpose: a just-merged commit legitimately shows
 * BEHIND until Railway finishes its deploy, so wiring this to fail a
 * pipeline would page on every merge and be ignored within a day. Run it
 * when you want the answer; nothing runs it at you.
 *
 * The optional web probe answers the separate question "did a route ship
 * on the web deployment?" — web deploys independently of the API and they
 * diverge legitimately. It follows one rule, learned the hard way:
 *
 *   A PROBE WITHOUT A CONTROL IS A GUESS. On this deployment a logged-out
 *   request to /dashboard/<anything> 307s to /login whether the route
 *   exists or not — the auth gate answers before the router, so "it
 *   redirected" once passed for "it shipped" and reached a status report
 *   as fact. Every probe here is therefore paired with a sibling path
 *   that certainly does not exist, and ONLY A DIFFERENCE between the two
 *   answers is treated as evidence. Identical answers mean the probe
 *   cannot see past the gate — and it says so instead of guessing.
 */
import { execFileSync } from 'node:child_process';

const DEFAULTS = {
  apiBase: 'https://bmplapi-production.up.railway.app',
  webBase: 'https://www.bzemarketplace.com',
  remote: 'https://github.com/louve-rg/bmpl.git',
  timeoutMs: 10_000,
};

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? '') : undefined;
};
const has = (name) => args.includes(`--${name}`);

const apiBase = flag('api-base') ?? DEFAULTS.apiBase;
const webBase = flag('web-base') ?? DEFAULTS.webBase;
const remote = flag('remote') ?? DEFAULTS.remote;
/**
 * Route paths may arrive mangled: Git Bash (MSYS) rewrites a leading-slash
 * argument into a Windows path (`/dashboard/x` -> `C:/Program Files/Git/dashboard/x`).
 * Undo that, and accept the slashless form (`dashboard/x`) as the safe spelling.
 */
function normalizeRoute(r) {
  if (!r) return r;
  const msys = r.match(/^[A-Za-z]:(?:\/[^/]+)*?\/Git(\/.*)$/);
  if (msys) r = msys[1];
  return r.startsWith('/') ? r : `/${r}`;
}
const webRoute = normalizeRoute(flag('web-route'));
const asJson = has('json');

/** Read-only git; returns stdout or null (never throws). */
function git(...argv) {
  try {
    return execFileSync('git', argv, { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    return null;
  }
}

async function fetchJson(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), DEFAULTS.timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: 'follow' });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { body: await res.json() };
  } catch (e) {
    return { error: e?.cause?.code ?? e?.name ?? String(e) };
  } finally {
    clearTimeout(t);
  }
}

/** origin/main's head, asked of the remote itself so a stale local fetch cannot lie. */
function mainHead() {
  const out = git('ls-remote', remote, 'refs/heads/main');
  const sha = out?.split(/\s/)[0];
  return sha && /^[0-9a-f]{40}$/.test(sha) ? sha : null;
}

/** True if this process runs inside a git work tree (enables ancestry + listing). */
function inRepo() {
  return git('rev-parse', '--is-inside-work-tree') === 'true';
}

function classify(prodCommit, main) {
  if (main.startsWith(prodCommit) || prodCommit.startsWith(main)) return { verdict: 'CURRENT' };
  if (!inRepo()) {
    // Without local history we know the commits differ but not their relation.
    return { verdict: 'BEHIND', note: 'commits differ; run inside a repo checkout to confirm ancestry and list what is undelivered', unconfirmed: true };
  }
  // Resolve the (possibly short) production commit locally; fetch main quietly
  // so ancestry is judged against the remote's real head, not a stale one.
  git('fetch', '--quiet', remote, 'main');
  const full = git('rev-parse', '--verify', `${prodCommit}^{commit}`);
  if (!full) return { verdict: 'DIVERGED', note: `production's commit ${prodCommit} is not in this repository's history` };
  const ancestor = git('merge-base', '--is-ancestor', full, main) !== null;
  if (!ancestor) return { verdict: 'DIVERGED', note: `production's commit ${prodCommit} is not an ancestor of origin/main` };
  const count = git('rev-list', '--count', `${full}..${main}`);
  const missing = git('log', '--oneline', `${full}..${main}`);
  return { verdict: 'BEHIND', count: count ? Number(count) : null, missing: missing ? missing.split('\n') : [] };
}

async function head(url) {
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), DEFAULTS.timeoutMs);
  try {
    const res = await fetch(url, { signal: ctl.signal, redirect: 'manual' });
    return { status: res.status };
  } catch (e) {
    return { error: e?.cause?.code ?? e?.name ?? String(e) };
  } finally {
    clearTimeout(t);
  }
}

/**
 * "Did this route ship?" — asked honestly. A logged-out probe alone cannot
 * answer it when an auth layer intercepts the whole prefix (on this
 * deployment /dashboard/* 307s to /login for routes that CANNOT exist —
 * verified 2026-09-05). So every probe carries its own control: the same
 * request against a sibling path that certainly does not exist. Only a
 * DIFFERENCE between target and control is evidence; identical answers mean
 * the probe cannot see past the gate, and says so.
 */
async function probeWeb(route) {
  const control = `${route.replace(/\/$/, '')}-bmpl66-control-${Math.random().toString(36).slice(2, 10)}`;
  const target = await head(`${webBase}${route}`);
  const ctl = await head(`${webBase}${control}`);
  if (target.error || ctl.error) {
    return { verdict: 'UNKNOWN', detail: `unreachable: ${target.error ?? ctl.error}` };
  }
  if (target.status === 404) return { verdict: 'NOT_SHIPPED', detail: `404 — no such route on this deployment (control: ${ctl.status})` };
  if (target.status === ctl.status) {
    return {
      verdict: 'UNKNOWN',
      detail: `both the route and a route that cannot exist answer ${target.status} — a gate answers before the router, so a logged-out probe cannot tell`,
    };
  }
  const shipped = target.status === 200 || [301, 302, 307, 308].includes(target.status);
  return shipped
    ? { verdict: 'SHIPPED', detail: `route answers ${target.status} while the control answers ${ctl.status} — the route exists` }
    : { verdict: 'UNKNOWN', detail: `route ${target.status} vs control ${ctl.status} — answers neither shipped nor missing` };
}

const EXIT = { CURRENT: 0, BEHIND: 1, UNKNOWN: 2, DIVERGED: 3 };

async function main() {
  const result = { api: {}, web: null };

  const health = await fetchJson(`${apiBase}/api/health`);
  const mainSha = mainHead();

  if (health.error || typeof health.body?.commit !== 'string' || !health.body.commit) {
    result.api = {
      verdict: 'UNKNOWN',
      reason: health.error ? `health endpoint unanswerable (${health.error})` : 'health payload carries no commit',
      main: mainSha,
    };
  } else if (!mainSha) {
    result.api = {
      verdict: 'UNKNOWN',
      reason: 'could not read origin/main from the remote',
      production: health.body.commit,
    };
  } else {
    const c = classify(health.body.commit, mainSha);
    result.api = {
      verdict: c.verdict,
      production: health.body.commit,
      main: mainSha.slice(0, 7),
      startedAt: health.body.startedAt ?? null,
      uptimeSeconds: typeof health.body.uptime === 'number' ? Math.round(health.body.uptime) : null,
      ...(c.count != null ? { commitsBehind: c.count } : {}),
      ...(c.missing?.length ? { undelivered: c.missing } : {}),
      ...(c.note ? { note: c.note } : {}),
    };
  }

  if (webRoute) result.web = { route: webRoute, base: webBase, ...(await probeWeb(webRoute)) };

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const a = result.api;
    if (a.verdict === 'CURRENT') console.log(`CURRENT — production runs ${a.production}, which is origin/main (${a.main})`);
    else if (a.verdict === 'BEHIND') console.log(`BEHIND — production runs ${a.production}, origin/main is ${a.main}${a.commitsBehind != null ? ` (${a.commitsBehind} commit${a.commitsBehind === 1 ? '' : 's'} behind)` : ''}`);
    else if (a.verdict === 'DIVERGED') console.log(`DIVERGED — production runs ${a.production}, origin/main is ${a.main}`);
    else console.log(`UNKNOWN — ${a.reason}`);
    if (a.startedAt) console.log(`  deployed instance started ${a.startedAt} (uptime ${a.uptimeSeconds}s)`);
    if (a.note) console.log(`  note: ${a.note}`);
    for (const line of a.undelivered ?? []) console.log(`  undelivered: ${line}`);
    if (result.web) console.log(`WEB ${result.web.verdict} — ${result.web.route} on ${result.web.base}: ${result.web.detail}`);
  }

  process.exitCode = EXIT[result.api.verdict] ?? EXIT.UNKNOWN;
}

main();
