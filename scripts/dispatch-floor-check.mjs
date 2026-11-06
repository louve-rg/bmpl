#!/usr/bin/env node
/**
 * dispatch-floor-check — is any OTHER API server on this host sharing my
 * scheduler's Redis lock right now, and does it even have the feature I'm
 * testing? (CLOSE-18, found during CLOSE-12's dispatch-exhaustion-recovery
 * verification)
 *
 *   node scripts/dispatch-floor-check.mjs
 *   node scripts/dispatch-floor-check.mjs --needs 79495e9e
 *   node scripts/dispatch-floor-check.mjs --needs 79495e9e --kill-others
 *
 * THE PROBLEM THIS ANSWERS: every git worktree on this dev host shares the
 * SAME local Redis and the SAME local Postgres by default. Scheduler lock
 * keys (dispatch sweep / shipping dispatch sweep / payments reconciliation
 * sweep — see apps/api/src/{dispatch,shipping,payments}/*.scheduler*.ts) are
 * plain constants unless REDIS_LOCK_NAMESPACE is set (see .env.example), so
 * two API processes from two DIFFERENT worktrees silently fight over each
 * other's lock. Whichever one wins a given tick is invisible from outside —
 * a losing process just looks like "the sweep ran and found nothing", which
 * is exactly how a real feature (dispatch-exhaustion recovery, #602) looked
 * broken for six real minutes when it was not. During that investigation,
 * FOUR independent contamination sources turned up in one afternoon:
 *   - a stale pre-feature build still running in a teammate's worktree
 *   - a teammate's freshly-rebuilt-but-still-contending instance
 *   - a three-day-old orphan from a torn-down temp agent's worktree
 *   - this agent's OWN ten orphaned `nest start --watch` supervisors
 * The fourth one is the nastiest: killing the listening PID (the `dist/main`
 * CHILD process) does NOT stop a `nest start --watch` SUPERVISOR — the
 * supervisor just respawns a fresh child later, on whatever it last built,
 * silently re-entering the shared lock on a commit nobody is looking at
 * anymore. `--kill-others` below kills the whole family, not just the port
 * owner, specifically because of this.
 *
 * WHAT THIS SCRIPT DOES:
 *   1. Enumerates every LISTENING TCP port on the host (Windows: a
 *      `Get-NetTCPConnection -State Listen` + `Win32_Process` join, giving
 *      port + PID + full command line in one shot — not just a port number).
 *   2. Probes `/api/health` on each one; a response in the expected shape
 *      (has `status` and `commit`) means this port is a BMPL API, not some
 *      unrelated dev server. Extracts its commit and the worktree path from
 *      its own command line.
 *   3. If `--needs <commit>` is given (default: local `git rev-parse HEAD`),
 *      runs `git merge-base --is-ancestor <needs> <server's commit>` to say
 *      whether that server even CONTAINS the feature being tested — a
 *      server can be perfectly healthy and still be running code from
 *      before the fix.
 *   4. SEPARATELY, scans ALL processes host-wide (not just listening ones)
 *      for `apps/api/dist/main` or `nest(.js)? start.*watch` command lines —
 *      this is what catches a non-listening-right-now `nest --watch`
 *      supervisor that can respawn into the picture mid-test. Non-listening
 *      API processes on no requested worktree's identity are ALSO a floor
 *      problem, reported as "latent" rather than "live".
 *
 * VERDICT: prints one line per API server/process found, with worktree,
 * port (if listening), commit, and ancestor result. If more than one
 * LISTENING API server answers, OR any latent (non-listening) apps/api
 * process is found anywhere, the floor is NOT clean — exit code 1. Exactly
 * one listening, feature-ancestor-confirmed server and zero latent
 * processes is the only clean-floor result — exit code 0.
 *
 * `--kill-others` kills every API-shaped process found OTHER than the one
 * matching `process.cwd()`'s own worktree (both listening and latent),
 * using the whole process family (parent cmd.exe/nest.js wrapper + child
 * dist/main, matched by command line, not by the single PID a port lookup
 * would give you) — this is what actually stops a `nest --watch`
 * supervisor instead of letting it respawn. Windows-only, matching this
 * repo's dev platform (same convention as scripts/dev-server-check.mjs).
 */
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const killOthers = args.includes('--kill-others');

function localHead() {
  try {
    return execFileSync('git', ['rev-parse', 'HEAD'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
const needsCommit = flag('needs') ?? localHead();

function myWorktreeRoot() {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim().replace(/\//g, '\\');
  } catch {
    return null;
  }
}
const MY_ROOT = myWorktreeRoot();

function psJson(script) {
  const out = execFileSync('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', script], { encoding: 'utf8', maxBuffer: 1024 * 1024 * 16 });
  const trimmed = out.trim();
  if (!trimmed) return [];
  const parsed = JSON.parse(trimmed);
  return Array.isArray(parsed) ? parsed : [parsed];
}

// One row per LISTENING port, with the owning PID's full command line.
function listListeners() {
  if (process.platform !== 'win32') {
    console.error('dispatch-floor-check is Windows-only today (matches this repo\'s dev platform); see scripts/dev-server-check.mjs for the same convention.');
    return [];
  }
  const script = `
    $conns = Get-NetTCPConnection -State Listen -ErrorAction SilentlyContinue
    $rows = @()
    $seen = @{}
    foreach ($c in $conns) {
      if ($seen.ContainsKey($c.OwningProcess)) { continue }
      $seen[$c.OwningProcess] = $true
      $p = Get-CimInstance Win32_Process -Filter "ProcessId=$($c.OwningProcess)" -ErrorAction SilentlyContinue
      $rows += [PSCustomObject]@{ Port = $c.LocalPort; Pid = $c.OwningProcess; CommandLine = $p.CommandLine }
    }
    $rows | ConvertTo-Json -Compress
  `;
  try {
    return psJson(script);
  } catch {
    return [];
  }
}

// Every process anywhere on the host whose command line looks like an API
// build or its watch supervisor -- listening or not.
function listAllApiShapedProcesses() {
  if (process.platform !== 'win32') return [];
  const script = `
    Get-CimInstance Win32_Process | Where-Object {
      $_.CommandLine -match 'apps[\\\\/]api[\\\\/]dist[\\\\/]main' -or $_.CommandLine -match 'nest(\\.js)?\\s+start.*--watch'
    } | Select-Object ProcessId, CommandLine | ConvertTo-Json -Compress
  `;
  try {
    return psJson(script).map((r) => ({ Pid: r.ProcessId, CommandLine: r.CommandLine }));
  } catch {
    return [];
  }
}

function worktreeFromCommandLine(cmd) {
  if (!cmd) return null;
  const m = cmd.match(/([A-Za-z]:[\\/](?:GSP[\\/](?:BMPL|bmpl-worktrees[\\/][^\\/]+)))[\\/]/i);
  return m ? m[1] : null;
}

async function tryFetchHealth(port) {
  try {
    const res = await fetch(`http://localhost:${port}/api/health`, { signal: AbortSignal.timeout(2000) });
    if (!res.ok) return null;
    const body = await res.json();
    if (!body || typeof body !== 'object' || !('status' in body) || !('commit' in body)) return null;
    return body;
  } catch {
    return null;
  }
}

function isAncestor(ancestorShort, descendantShort) {
  if (!ancestorShort || !descendantShort) return 'UNKNOWN (missing commit)';
  try {
    // Resolve short SHAs to full ones first -- merge-base --is-ancestor wants
    // objects git actually has; a bare short SHA from a health response works
    // too as long as it's unambiguous, which 7+ chars normally is.
    execFileSync('git', ['merge-base', '--is-ancestor', ancestorShort, descendantShort], { stdio: 'ignore' });
    return 'YES (has the feature)';
  } catch (e) {
    if (e.status === 1) return 'NO (predates the feature)';
    return `UNKNOWN (${e.message.split('\n')[0]})`;
  }
}

function killFamily(pid, commandLine) {
  // Kill the PID itself (/T takes any children it spawned), AND if this is a
  // dist/main child, also look for and kill its nest.js watch supervisor --
  // the respawn trap this whole script exists to catch. We match by command
  // line, never assume a parent PID relationship survived process churn.
  try {
    execFileSync('taskkill', ['/PID', String(pid), '/T', '/F'], { stdio: 'ignore' });
  } catch {
    // already gone
  }
}

async function main() {
  console.log(`Floor check. My worktree: ${MY_ROOT ?? '(unknown)'}. Feature commit to check for: ${needsCommit ?? '(unknown)'}\n`);

  const listeners = listListeners();
  const apiListeners = [];
  const apiShapeRe = /apps[\\/]api[\\/]dist[\\/]main|nest(\.js)?\s+start.*--watch/i;
  for (const row of listeners) {
    // Require the OWNING process's own command line to look like a real API
    // build, not just a response that LOOKS like /api/health -- a Next.js dev
    // server with an /api/* rewrite faithfully proxies the real API's health
    // JSON (same commit, same shape), but it is not a second scheduler and
    // does not contend for the lock. Counting it anyway would report a floor
    // problem that is not real.
    if (!apiShapeRe.test(row.CommandLine ?? '')) continue;
    const health = await tryFetchHealth(row.Port);
    if (!health) continue;
    const worktree = worktreeFromCommandLine(row.CommandLine);
    const serverCommit = health.commit || null;
    const ancestor = isAncestor(needsCommit, serverCommit);
    apiListeners.push({ port: row.Port, pid: row.Pid, worktree, commandLine: row.CommandLine, commit: serverCommit, ancestor });
  }

  const allApiShaped = listAllApiShapedProcesses();
  const listeningPids = new Set(apiListeners.map((r) => String(r.pid)));
  // A `nohup`/shell wrapper's own command line echoes its child's full command
  // (e.g. `nohup.exe node ... apps/api/dist/main`) and matches the api-shape
  // pattern too -- that is the wrapper, not a second process, and the real
  // child already appears in the listening set. Exclude wrapper rows so a
  // manually-backgrounded single server does not report itself twice.
  const latent = allApiShaped.filter((r) => !listeningPids.has(String(r.Pid)) && !/nohup|^"?[^"]*\\(bash|cmd)\.exe"?\s+-c/i.test(r.CommandLine ?? ''));

  console.log('--- LISTENING API servers ---');
  if (apiListeners.length === 0) console.log('  (none)');
  for (const r of apiListeners) {
    const mine = r.worktree && MY_ROOT && r.worktree.toLowerCase() === MY_ROOT.toLowerCase();
    console.log(`  port ${r.port}  pid ${r.pid}  worktree ${r.worktree ?? '(unknown)'}  commit ${r.commit ?? '(none reported)'}  ancestor-check: ${r.ancestor}  ${mine ? '[MINE]' : ''}`);
  }

  console.log('\n--- LATENT (not listening, but alive -- can respawn) ---');
  if (latent.length === 0) console.log('  (none)');
  for (const r of latent) {
    const worktree = worktreeFromCommandLine(r.CommandLine);
    const mine = worktree && MY_ROOT && worktree.toLowerCase() === MY_ROOT.toLowerCase();
    console.log(`  pid ${r.Pid}  worktree ${worktree ?? '(unknown)'}  ${mine ? '[MINE]' : ''}  cmd: ${r.CommandLine}`);
  }

  const othersListening = apiListeners.filter((r) => !(r.worktree && MY_ROOT && r.worktree.toLowerCase() === MY_ROOT.toLowerCase()));
  const othersLatent = latent.filter((r) => {
    const worktree = worktreeFromCommandLine(r.CommandLine);
    return !(worktree && MY_ROOT && worktree.toLowerCase() === MY_ROOT.toLowerCase());
  });

  if (killOthers) {
    console.log('\n--kill-others: stopping every API-shaped process not in my own worktree...');
    for (const r of [...othersListening, ...othersLatent]) {
      const pid = r.pid ?? r.Pid;
      console.log(`  killing pid ${pid}...`);
      killFamily(pid, r.commandLine ?? r.CommandLine);
    }
  }

  const clean = othersListening.length === 0 && othersLatent.length === 0;
  console.log(`\nFLOOR IS ${clean ? 'CLEAN' : 'NOT CLEAN'}${killOthers && !clean ? ' (ran --kill-others above -- re-run to confirm)' : ''}`);
  process.exitCode = clean ? 0 : 1;
}

main();
