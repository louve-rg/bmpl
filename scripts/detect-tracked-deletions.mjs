#!/usr/bin/env node
/**
 * detect-tracked-deletions — did a checkout just lose tracked files? (BMPL-209)
 *
 * On 2026-09-26 three checkouts on this floor (two agent worktrees and the
 * MAIN checkout at C:/GSP/BMPL) silently lost hundreds of tracked files each,
 * including every workspace package.json in the main checkout's case, which
 * flattened every pnpm install on the floor and was misdiagnosed as a
 * concurrency problem for days. All three were found by accident, or by an
 * agent being blocked — never by anything watching. This is the thing that
 * watches.
 *
 *   node scripts/detect-tracked-deletions.mjs
 *   node scripts/detect-tracked-deletions.mjs --json
 *   node scripts/detect-tracked-deletions.mjs --threshold 50
 *
 * Read-only. It runs `git status` in every checkout linked to this repo and
 * reports; it never repairs, restores, prunes or deletes anything, and it
 * never runs `git add`, `git checkout` or any other command that would touch
 * a working tree. That boundary is deliberate: a self-healing script here is
 * how a wrong diagnosis becomes data loss, which is exactly what nearly
 * happened once already this week.
 *
 * THE SEPARATION PROBLEM, named rather than hidden:
 *
 * An agent legitimately deleting files as part of its own scoped work (a
 * rename, a removed fixture, a refactor) must not be a false positive — that
 * is normal, healthy activity in every worktree but one. This script does
 * NOT try to tell "legitimate deletion" apart from "damage" by guessing at
 * intent. It uses two signals that are cheap, and that were true in all
 * three real incidents without exception:
 *
 *   1. CANARY PATHS. No scoped task ever needs to delete a workspace
 *      manifest — package.json (any package or app), pnpm-workspace.yaml,
 *      pnpm-lock.yaml, turbo.json or tsconfig.base.json. These are exactly
 *      the files whose disappearance is what breaks pnpm's view of the
 *      workspace and flattens every install (the mechanism BMPL-191/193
 *      finally identified). If ANY of these show as deleted in ANY
 *      checkout, that is reported CRITICAL regardless of how many files
 *      moved — this is a near-zero-false-positive signal, because deleting
 *      a manifest is never a step in ordinary feature work, and if an agent
 *      genuinely needs to delete one deliberately (retiring a package), that
 *      is rare and important enough to be worth a human's attention anyway.
 *
 *   2. THE MAIN CHECKOUT ITSELF. C:/GSP/BMPL (or whichever checkout holds
 *      the real .git directory rather than a linked-worktree pointer) is
 *      fast-forwarded, never edited directly and never holds a merged
 *      feature branch mid-flight. Its working tree should always exactly
 *      match HEAD. ANY uncommitted deletion there — even one file — is
 *      reported CRITICAL, because there is no legitimate task that produces
 *      one. (Known edge case: a manual conflicted merge run directly in the
 *      main checkout could show a deletion mid-resolution. That has never
 *      been this floor's workflow — merges land as ordinary fast-forwards —
 *      so the default stays CRITICAL; the report names the exact paths so a
 *      human can tell in seconds which case it is.)
 *
 * A large deletion batch in an AGENT worktree that touches no canary path is
 * NOT flagged as CRITICAL — that is indistinguishable from a big legitimate
 * restructure without reading the diff, and this tool deliberately does not
 * try. It is reported WARNING once it clears --threshold (default 30 files)
 * purely so a human notices the size and can glance at it, not because size
 * alone proves anything.
 *
 * WHAT THIS DELIBERATELY IGNORES:
 *   - Untracked new files (git status -uno) — nothing here was ever tracked,
 *     so nothing here can have been "lost".
 *   - Deletions already committed to history (a file legitimately removed by
 *     a merged PR) — this only looks at uncommitted working-tree state.
 *   - A small ordinary deletion in a non-main worktree touching no canary
 *     path — normal work, listed for visibility but not scored.
 *   - A rename that touches a canary path (old path deleted, new path
 *     added) is reported INFO, not CRITICAL: the content survives somewhere
 *     in the same checkout, which is a materially different situation from
 *     the file simply vanishing. It is still named in the report.
 *
 * Exit codes (so a caller can script on severity, not just "nonzero"):
 *   0  OK       nothing above threshold, no canary hit, main checkout clean
 *   1  WARNING  a large deletion batch in some worktree, no canary hit
 *   2  CRITICAL a canary path was deleted somewhere, and/or the main
 *               checkout has any uncommitted deletion at all
 *
 * Discovery: every checkout is found via `git worktree list --porcelain`,
 * so this never needs to hardcode which worktrees exist on the floor today
 * — it adapts automatically as agents and temps are provisioned and reaped.
 * If a listed worktree's directory is gone (a reaped temp whose entry is
 * still registered), that is reported as its own line, not a crash.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, statSync } from 'node:fs';
import path from 'node:path';

const args = process.argv.slice(2);
const flag = (name) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? (args[i + 1] ?? '') : undefined;
};
const has = (name) => args.includes(`--${name}`);

const THRESHOLD = Number.parseInt(flag('threshold') ?? '30', 10);
const asJson = has('json');

const CANARY_PATTERNS = [
  /(^|\/)package\.json$/,
  /^pnpm-workspace\.yaml$/,
  /^pnpm-lock\.yaml$/,
  /^turbo\.json$/,
  /^tsconfig\.base\.json$/,
];
const isCanary = (p) => CANARY_PATTERNS.some((re) => re.test(p));

/** Read-only git; returns stdout or null (never throws, never mutates). */
function git(cwd, ...argv) {
  try {
    return execFileSync('git', argv, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    return { __error: e?.stderr?.toString?.().trim() || e?.message || String(e) };
  }
}

function listWorktrees() {
  const out = git(process.cwd(), 'worktree', 'list', '--porcelain');
  if (out == null || typeof out !== 'string') {
    throw new Error('git worktree list failed — is this run from inside the repo?');
  }
  const worktrees = [];
  let cur = null;
  for (const line of out.split('\n')) {
    if (line.startsWith('worktree ')) {
      if (cur) worktrees.push(cur);
      cur = { path: line.slice('worktree '.length).trim(), branch: null, detached: false };
    } else if (line.startsWith('branch ')) {
      cur.branch = line.slice('branch '.length).replace(/^refs\/heads\//, '');
    } else if (line.trim() === 'detached') {
      cur.detached = true;
    }
  }
  if (cur) worktrees.push(cur);
  return worktrees;
}

/** The main checkout holds a real .git DIRECTORY; a linked worktree's .git is a FILE (a gitdir: pointer). */
function isMainCheckout(worktreePath) {
  const gitPath = path.join(worktreePath, '.git');
  try {
    return statSync(gitPath).isDirectory();
  } catch {
    return false;
  }
}

/**
 * Parses `git status --porcelain=1 -z -uno` (NUL-delimited, so paths with
 * spaces or unusual characters can never be mis-split or silently quoted).
 * Returns { deletions: string[], renames: {from, to}[] }.
 */
function parseStatusZ(raw) {
  const deletions = [];
  const renames = [];
  const fields = raw.split('\0').filter((f) => f.length > 0);
  let i = 0;
  while (i < fields.length) {
    const entry = fields[i];
    const xy = entry.slice(0, 2);
    const p = entry.slice(3);
    const isRenameOrCopy = xy[0] === 'R' || xy[0] === 'C' || xy[1] === 'R' || xy[1] === 'C';
    if (isRenameOrCopy) {
      // porcelain -z emits the NEW path in this record, then the ORIGINAL path as its own field
      const from = fields[i + 1];
      renames.push({ from, to: p });
      i += 2;
      continue;
    }
    if (xy.includes('D')) deletions.push(p);
    i += 1;
  }
  return { deletions, renames };
}

function checkWorktree(wt) {
  const result = { path: wt.path, branch: wt.branch, detached: wt.detached, main: false, status: 'OK' };

  if (!existsSync(wt.path)) {
    result.status = 'MISSING';
    result.note = 'registered as a worktree but the directory does not exist (likely a reaped temp — cheap to prune, not this script\'s job)';
    return result;
  }

  result.main = isMainCheckout(wt.path);

  const raw = git(wt.path, 'status', '--porcelain=1', '-z', '-uno');
  if (raw && typeof raw === 'object' && raw.__error) {
    result.status = 'CRITICAL';
    result.note = `git status failed in this checkout: ${raw.__error}`;
    return result;
  }

  const { deletions, renames } = parseStatusZ(raw ?? '');
  const canaryDeletions = deletions.filter(isCanary);
  const canaryRenames = renames.filter((r) => isCanary(r.from));

  result.deletedCount = deletions.length;
  result.deletedPaths = deletions;
  result.canaryDeletions = canaryDeletions;
  result.canaryRenames = canaryRenames;

  if (result.main && deletions.length > 0) {
    result.status = 'CRITICAL';
    result.note = 'main checkout has uncommitted tracked-file deletions — this checkout is fast-forward-only and should never have local modifications';
  } else if (canaryDeletions.length > 0) {
    result.status = 'CRITICAL';
    result.note = 'a workspace manifest file was deleted — never a step in ordinary scoped work';
  } else if (deletions.length >= THRESHOLD) {
    result.status = 'WARNING';
    result.note = `${deletions.length} tracked files deleted in one working tree — may be a legitimate large restructure, worth a glance`;
  } else if (deletions.length > 0) {
    result.status = 'OK';
    result.note = `${deletions.length} tracked deletion(s), no canary path, below threshold — looks like ordinary scoped work`;
  } else {
    result.status = 'OK';
  }

  return result;
}

function main() {
  const worktrees = listWorktrees();
  const results = worktrees.map(checkWorktree);

  const exitCode = results.some((r) => r.status === 'CRITICAL')
    ? 2
    : results.some((r) => r.status === 'WARNING' || r.status === 'MISSING')
      ? 1
      : 0;

  if (asJson) {
    console.log(JSON.stringify({ threshold: THRESHOLD, results, exitCode }, null, 2));
  } else {
    console.log(`detect-tracked-deletions — ${results.length} checkout(s), threshold=${THRESHOLD}\n`);
    for (const r of results) {
      const tag = r.main ? ' [MAIN]' : '';
      const branch = r.detached ? '(detached)' : r.branch ?? '(unknown branch)';
      console.log(`${r.status.padEnd(8)} ${r.path}${tag}  ${branch}`);
      if (r.note) console.log(`         ${r.note}`);
      if (r.canaryDeletions?.length) {
        console.log(`         canary paths deleted: ${r.canaryDeletions.join(', ')}`);
      }
      if (r.canaryRenames?.length) {
        console.log(`         canary paths renamed (info only, content survives): ${r.canaryRenames.map((x) => `${x.from} -> ${x.to}`).join(', ')}`);
      }
      if (r.status !== 'OK' && r.status !== 'MISSING' && r.deletedPaths?.length && r.deletedPaths.length <= 20) {
        console.log(`         deleted: ${r.deletedPaths.join(', ')}`);
      } else if (r.deletedPaths?.length > 20) {
        console.log(`         deleted: ${r.deletedPaths.slice(0, 20).join(', ')}, ... (${r.deletedPaths.length} total)`);
      }
    }
    console.log(`\nexit ${exitCode} (0 OK, 1 WARNING/MISSING, 2 CRITICAL)`);
  }

  process.exit(exitCode);
}

main();
