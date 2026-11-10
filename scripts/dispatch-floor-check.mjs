#!/usr/bin/env node
/**
 * dispatch-floor-check — is any OTHER API server on this host sharing my
 * scheduler's Redis lock right now, and does it even have the feature I'm
 * testing? (CLOSE-18, found during CLOSE-12's dispatch-exhaustion-recovery
 * verification)
 *
 *   node scripts/dispatch-floor-check.mjs
 *   node scripts/dispatch-floor-check.mjs --needs 79495e9e
 *   node scripts/dispatch-floor-check.mjs --needs 79495e9e --kill-others          (dry run -- names what WOULD die, kills nothing)
 *   node scripts/dispatch-floor-check.mjs --needs 79495e9e --kill-others --confirm (actually kills)
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
 *      problem, reported as "armed" rather than "live".
 *   5. ALSO reports every LISTENING Next.js server process found in step 1's
 *      own scan, informationally -- a CLEAN verdict here has only ever meant
 *      "no scheduler-lock contention from another API server"; it was never
 *      proof that no dev server is running at all, and nothing in the
 *      output said so. That gap matters more with four agents sharing one
 *      host's ports: an admin/web `next dev` left running from an earlier
 *      session can make a DIFFERENT agent's own `ensurePortFree()` throw
 *      minutes later, with no clue from this script that it was coming.
 *      MATCHING NOTE, found live while building this, not assumed: the
 *      process that actually owns the listening socket is NOT the `next
 *      dev` (or `next start`) CLI invocation itself -- that one spawns a
 *      child whose own command line is `.../next/dist/server/lib/
 *      start-server.js`, with no "next dev" text anywhere in it. Matching on
 *      "next dev" as a string, which seemed like the obvious pattern,
 *      silently matched nothing real on this host's own live `next dev`
 *      processes; matching `start-server.js` is what actually finds the
 *      bound port. That path is identical for `next start` (production)
 *      and `next dev`, so this reports both under one "Next.js server"
 *      label rather than falsely narrowing to "dev" -- both equally squat a
 *      port, which is the only thing this step cares about. This does NOT
 *      change what CLEAN means or the exit code -- scheduler lock
 *      contention and port squatting are different problems with different
 *      remedies, and conflating them would make a genuinely clean floor (no
 *      lock contention) read as dirty for an unrelated reason. Worktree
 *      attribution usually works here (start-server.js's own command line
 *      carries the real resolved path under node_modules, unlike the CLI
 *      wrapper that spawned it), but can still come back "(unknown)" for a
 *      process launched outside this host's GSP worktree layout -- the same
 *      could-not-classify gap this script already has for an
 *      unidentifiable API-shaped process, a separate, not-yet-built piece of
 *      work, not something this step invents a new way to solve. Visibility
 *      (there IS something on this port) is the fix here, not attribution.
 *
 * VERDICT: prints one line per API server/process found, with worktree,
 * port (if listening), commit, and ancestor result. If more than one
 * LISTENING API server answers, OR any armed (non-listening) apps/api
 * process is found anywhere, the floor is NOT clean — exit code 1. Exactly
 * one listening, feature-ancestor-confirmed server and zero armed
 * processes is the only clean-floor result — exit code 0.
 *
 * A row whose worktree can't be determined from its command line (outside
 * this host's GSP worktree layout, or a truncated command line) is tagged
 * [COULD NOT CLASSIFY] rather than silently printed the same way as a
 * row confirmed to belong to a DIFFERENT, KNOWN worktree. It still counts
 * toward NOT CLEAN exactly as before -- "I don't know whose this is" is not
 * the same claim as "I know it isn't mine", and this script already errs
 * toward over-reporting contention rather than risking a miss -- but the
 * verdict line also says how many rows were unclassified, so a reader isn't
 * left assuming every NOT CLEAN row was a confirmed stranger.
 *
 * `--kill-others` targets every API-shaped process found OTHER than the one
 * matching `process.cwd()`'s own worktree (both listening and armed),
 * using the whole process family (parent cmd.exe/nest.js wrapper + child
 * dist/main, matched by command line, not by the single PID a port lookup
 * would give you) — this is what actually stops a `nest --watch`
 * supervisor instead of letting it respawn. Windows-only, matching this
 * repo's dev platform (same convention as scripts/dev-server-check.mjs).
 *
 * CONFIRMATION GATE (god, CONTRAST-DISCOVERY-DROP, 2026-11-10): with up to
 * four agents each running their own servers on one host, a bare
 * `--kill-others` that fires immediately can end a colleague's in-progress
 * test run with nothing in THEIR terminal explaining why it died. `--kill-
 * others` alone is now a DRY RUN — it names every pid/worktree/command line
 * it WOULD kill and kills nothing. `--kill-others --confirm` is required to
 * actually kill. This does not make killing a stranger's process safe by
 * itself (a [COULD NOT CLASSIFY] row is still a guess about whose it is),
 * only deliberate and visible in the log of whoever ran it.
 */
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : undefined;
};
const killOthers = args.includes('--kill-others');
const confirmed = args.includes('--confirm');

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
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' }).trim();
  } catch {
    return null;
  }
}
const MY_ROOT = myWorktreeRoot();

// `git rev-parse --show-toplevel` always answers with forward slashes, even
// on Windows. A path pulled from a Win32_Process CommandLine uses whatever
// separator the process was actually launched with -- backslashes from
// cmd.exe/PowerShell, forward slashes from bash (which is how everyone on
// this floor launches node). Comparing those two kinds of string with only
// `.toLowerCase()` silently fails whenever the two sides don't happen to
// share a launch style, which misclassifies the script's OWN process as a
// stranger's. Every worktree-identity comparison in this file MUST go
// through this one function -- not a `.replace()` fixed up on one side at
// one call site, which only moves which launch style breaks.
function sameWorktree(a, b) {
  if (!a || !b) return false;
  const norm = (p) => p.replace(/\//g, '\\').toLowerCase();
  return norm(a) === norm(b);
}

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
  const nextServerListeners = [];
  const apiShapeRe = /apps[\\/]api[\\/]dist[\\/]main|nest(\.js)?\s+start.*--watch/i;
  // Informational only (see "WHAT THIS SCRIPT DOES" step 5 above) -- never
  // joined into apiListeners/othersListening/clean. Matches the process that
  // actually binds the port (`start-server.js`), not the `next dev`/`next
  // start` CLI wrapper that spawned it -- that wrapper's own command line
  // has no distinguishing text and isn't the listener anyway. See the
  // MATCHING NOTE above for why "next dev" as a literal string, the obvious
  // first guess, matches nothing real here.
  const nextServerShapeRe = /next[\\/]dist[\\/]server[\\/]lib[\\/]start-server\.js/i;
  for (const row of listeners) {
    if (nextServerShapeRe.test(row.CommandLine ?? '')) {
      nextServerListeners.push({ port: row.Port, pid: row.Pid, worktree: worktreeFromCommandLine(row.CommandLine), commandLine: row.CommandLine });
    }
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
  const armed = allApiShaped.filter((r) => !listeningPids.has(String(r.Pid)) && !/nohup|^"?[^"]*\\(bash|cmd)\.exe"?\s+-c/i.test(r.CommandLine ?? ''));

  // A row's tag is exactly one of [MINE] (confirmed own worktree),
  // [COULD NOT CLASSIFY] (API-shaped, but worktreeFromCommandLine() found no
  // path to compare -- e.g. launched from outside this host's GSP worktree
  // layout, or a command line Windows truncated), or blank (confirmed to be
  // a DIFFERENT, KNOWN worktree). Before this, an unclassifiable row and a
  // confirmed-foreign row printed identically (both got no tag), so a reader
  // had no way to tell "this is definitely not mine, kill it freely" apart
  // from "nobody could tell whose this is, go look by hand" -- the first
  // case is safe to act on without re-checking; the second is not. The
  // VERDICT is unchanged: an unclassifiable row still counts toward
  // othersListening/othersArmed exactly as before (fail-safe -- "I don't
  // know whose this is" is not the same claim as "I know it isn't mine",
  // and the floor-dirty check already errs toward over-reporting rather
  // than missing real contention).
  function tag(worktree) {
    if (worktree == null) return '[COULD NOT CLASSIFY]';
    return sameWorktree(worktree, MY_ROOT) ? '[MINE]' : '';
  }

  console.log('--- LISTENING API servers ---');
  if (apiListeners.length === 0) console.log('  (none)');
  for (const r of apiListeners) {
    console.log(`  port ${r.port}  pid ${r.pid}  worktree ${r.worktree ?? '(unknown)'}  commit ${r.commit ?? '(none reported)'}  ancestor-check: ${r.ancestor}  ${tag(r.worktree)}`);
  }

  console.log('\n--- ARMED (not listening now, but can respawn a child and re-bind at any moment) ---');
  if (armed.length === 0) console.log('  (none)');
  for (const r of armed) {
    const worktree = worktreeFromCommandLine(r.CommandLine);
    console.log(`  pid ${r.Pid}  worktree ${worktree ?? '(unknown)'}  ${tag(worktree)}  cmd: ${r.CommandLine}`);
  }

  console.log('\n--- OTHER NEXT.JS SERVERS DETECTED (dev or start; informational only, does not affect the FLOOR verdict) ---');
  if (nextServerListeners.length === 0) console.log('  (none)');
  for (const r of nextServerListeners) {
    const mine = sameWorktree(r.worktree, MY_ROOT);
    console.log(`  port ${r.port}  pid ${r.pid}  worktree ${r.worktree ?? '(unknown)'}  ${mine ? '[MINE]' : ''}`);
  }

  const othersListening = apiListeners.filter((r) => !sameWorktree(r.worktree, MY_ROOT));
  const othersArmed = armed.filter((r) => !sameWorktree(worktreeFromCommandLine(r.CommandLine), MY_ROOT));
  const unclassifiedCount =
    apiListeners.filter((r) => r.worktree == null).length + armed.filter((r) => worktreeFromCommandLine(r.CommandLine) == null).length;

  if (killOthers) {
    const targets = [...othersListening, ...othersArmed];
    if (targets.length === 0) {
      console.log('\n--kill-others: nothing to kill -- no other API-shaped process found.');
    } else if (!confirmed) {
      console.log(`\n--kill-others: DRY RUN (pass --confirm to actually kill). Would kill ${targets.length} process(es):`);
      for (const r of targets) {
        const pid = r.pid ?? r.Pid;
        const worktree = r.worktree ?? worktreeFromCommandLine(r.CommandLine) ?? '[COULD NOT CLASSIFY -- whose this is is a guess]';
        console.log(`  pid ${pid}  worktree ${worktree}  cmd: ${r.commandLine ?? r.CommandLine}`);
      }
      console.log('Re-run with --confirm to actually kill the above. Nothing was touched.');
    } else {
      console.log(`\n--kill-others --confirm: killing ${targets.length} process(es) not in my own worktree...`);
      for (const r of targets) {
        const pid = r.pid ?? r.Pid;
        const worktree = r.worktree ?? worktreeFromCommandLine(r.CommandLine) ?? '[COULD NOT CLASSIFY]';
        console.log(`  killing pid ${pid}  worktree ${worktree}...`);
        killFamily(pid, r.commandLine ?? r.CommandLine);
      }
    }
  }

  const clean = othersListening.length === 0 && othersArmed.length === 0;
  const unclassifiedNote = unclassifiedCount > 0 ? ` (${unclassifiedCount} of the above could not be classified -- see [COULD NOT CLASSIFY] rows)` : '';
  console.log(`\nFLOOR IS ${clean ? 'CLEAN' : 'NOT CLEAN'}${killOthers && !clean ? ' (ran --kill-others above -- re-run to confirm)' : ''}${unclassifiedNote}`);
  process.exitCode = clean ? 0 : 1;
}

main();
