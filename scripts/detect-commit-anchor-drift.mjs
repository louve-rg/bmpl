#!/usr/bin/env node
/**
 * detect-commit-anchor-drift — does every commit-hash anchor in
 * EDWARD-REQUIREMENTS.md and OWNER-RULINGS.md still point at a real commit
 * reachable from main, and how old is each one now? (BMPL-381)
 *
 * BMPL-379 found that none of this directory's four existing checkers read
 * either document, and — more importantly — that none of them COULD check
 * what actually went stale in them tonight: a prose claim ("Done", "no
 * staff screen", "still open") that was true once and silently stopped
 * being true. A script cannot decide whether prose is true. What it CAN
 * decide is whether the one machine-checkable fact next to that prose — the
 * commit hash the claim is anchored to — still exists and is still on
 * main's history, and how many commits have landed since. That is the
 * entire scope of this script, deliberately narrower than "is the document
 * correct."
 *
 *   node scripts/detect-commit-anchor-drift.mjs
 *   node scripts/detect-commit-anchor-drift.mjs --json
 *
 * NOT wired into CI (BMPL-381's own instruction: a new required check is a
 * merge-gate decision, not a side effect of writing the script). Runnable
 * standalone or by hand.
 *
 * DEPARTS FROM THE OTHER FOUR CHECKERS IN THIS DIRECTORY ON ONE POINT, BY
 * NECESSITY: each of those says "never runs git" as part of its own
 * read-only boundary, because checking a catalog against source files never
 * needs git. This script's entire job is commit ancestry and commit
 * distance, neither of which exists anywhere but git's own history — there
 * is no way to answer "is X an ancestor of main" or "how many commits since
 * X" by reading files. It still never WRITES anything: every git call below
 * is `cat-file -e`, `merge-base --is-ancestor` or `rev-list --count`, none
 * of which can modify a ref, the index or the working tree, and none are
 * run with a shell (execFileSync with an argument array, not a
 * string) so a hash-shaped token from a markdown file is passed as a single
 * argument and can never be interpreted as a second command.
 *
 * WHAT THIS CHECKS:
 *   Every backtick-wrapped token matching `[0-9a-f]{7,40}` (git's own
 *   abbreviated-or-full hash shape) anywhere in docs/EDWARD-REQUIREMENTS.md
 *   or docs/OWNER-RULINGS.md — regardless of whether it follows the words
 *   "as of": the two documents cite commits in both the new anchored style
 *   ("done as of `74cbcd6`") and the older bare style ("Merged `bad7b3f`
 *   (BMPL-175, PR #259)"), and a reader treats both as the same kind of
 *   claim — "this is the commit that makes the sentence next to it true" —
 *   so this script does too, rather than only policing the five rows that
 *   happen to use the newer phrase. For each distinct hash found:
 *     1. `git cat-file -e <hash>^{commit}` — does an object with this hash
 *        exist, and is it actually a commit (not a blob or tree that
 *        happens to share a short prefix)?
 *     2. `git merge-base --is-ancestor <hash> origin/main` — is it actually
 *        reachable from main's current tip, i.e. a real part of this
 *        repository's shipped history, not a dangling or foreign-branch
 *        commit?
 *     3. For every hash that passes both: `git rev-list --count
 *        <hash>..origin/main` — exactly how many commits have landed on
 *        main since. This number is the "visible age" anchoring exists to
 *        produce. It is reported for every anchor, new or old, because age
 *        is the fact a reader needs to decide how much to trust the prose
 *        next to it — not a verdict this script hands down.
 *   Every citing location (file:line) is kept per hash, so a hash cited in
 *   six places is one row in the report with six locations, not six rows.
 *
 * WHAT THIS DELIBERATELY DOES NOT CHECK:
 *   - Whether the PROSE next to an anchor is true. A valid, freshly-merged
 *     anchor on a FALSE sentence and an old, 40-commits-behind anchor on a
 *     still-true one both report identically on the one axis this script
 *     can see (resolvable, ancestor, age N) — this script has no opinion on
 *     either, by design. It converts silent decay into visible age; it does
 *     not and cannot convert prose into a checked fact.
 *   - Whether an anchor is the RIGHT commit for its claim — only that the
 *     hash exists and is reachable. A row anchored to a real but unrelated
 *     commit (a copy-paste mistake) passes this script exactly like a
 *     correct one; catching that requires reading the prose and the diff
 *     together, which is a human's job, not this script's.
 *   - Any document other than these two, named by exact path at the top of
 *     this file. Generalising to every document with commit citations is a
 *     separate, unasked question.
 *   - A citation that is a PR number (`PR #259`), a card id (`BMPL-175`) or
 *     any other non-hash reference. Only a backtick-wrapped hex token of
 *     plausible hash length is in scope; a PR/card number is a different
 *     kind of claim this script was not asked to verify and git has no
 *     ancestry relationship to check it against.
 *   - A token that happens to look hex-shaped but is not meant as a commit
 *     (checked empirically before shipping this: a scan of both documents
 *     today found zero such false positives — every backtick-wrapped
 *     7-to-40-character lowercase-hex token in either file is a real,
 *     intentional commit citation. If that stops being true later, this
 *     script will report the false positive as UNRESOLVABLE, which is a
 *     correct, visible failure rather than a silent wrong answer — but it
 *     will also need a human to recognise it as "not actually an anchor"
 *     rather than "a broken one.")
 *   - It does not, on its own, prove this repository's drift-check job
 *     (BMPL-220/BMPL-304/BMPL-211) has any gap — that question was BMPL-379's,
 *     answered separately. This script is the thing BMPL-379 concluded
 *     WOULD be mechanisable, not a continuation of that audit.
 *
 * OPERATIONAL CAVEAT FOR WHOEVER CONSIDERS WIRING THIS LATER (not acted on
 * here — BMPL-381 is explicit that wiring is a separate decision): this
 * script compares every anchor against `origin/main`, which must already be
 * fetched with enough history for `merge-base`/`rev-list` to walk back to
 * the anchor commit. `actions/checkout@v4`'s default `fetch-depth: 1` would
 * NOT be enough — every anchor would read as UNRESOLVABLE or as a merge-base
 * computation failure through no fault of the document. Wiring this needs
 * either `fetch-depth: 0` or a depth comfortably past the oldest anchor this
 * script finds.
 *
 * Exit codes:
 *   0  OK        every anchor found resolves to a real commit that is an
 *                ancestor of origin/main (age is reported regardless and
 *                never affects this)
 *   1  DRIFT     at least one anchor does not exist as a commit, or exists
 *                but is not reachable from origin/main
 *   2  UNKNOWN   a document could not be read, or origin/main itself could
 *                not be resolved — never folded into a pass
 */
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';

const args = process.argv.slice(2);
const asJson = args.includes('--json');

const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const MAIN_REF = 'origin/main';
const DOC_PATHS = ['docs/EDWARD-REQUIREMENTS.md', 'docs/OWNER-RULINGS.md'];
const HASH_RE = /`([0-9a-f]{7,40})`/g;

function git(gitArgs) {
  return execFileSync('git', gitArgs, { cwd: REPO_ROOT, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
}

function gitOk(gitArgs) {
  try {
    execFileSync('git', gitArgs, { cwd: REPO_ROOT, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

/** { hash -> [{file, line}] }, in first-seen order of hash. */
function findAnchors() {
  const byHash = new Map();
  for (const docPath of DOC_PATHS) {
    const full = path.join(REPO_ROOT, docPath);
    const text = readFileSync(full, 'utf8'); // throws if missing — caller treats as UNKNOWN
    const lines = text.split('\n');
    for (let i = 0; i < lines.length; i++) {
      let m;
      HASH_RE.lastIndex = 0;
      while ((m = HASH_RE.exec(lines[i])) !== null) {
        const hash = m[1];
        const list = byHash.get(hash) ?? [];
        list.push({ file: docPath, line: i + 1 });
        byHash.set(hash, list);
      }
    }
  }
  return byHash;
}

function classifyAnchor(hash) {
  if (!gitOk(['cat-file', '-e', `${hash}^{commit}`])) {
    return { status: 'UNRESOLVABLE' };
  }
  if (!gitOk(['merge-base', '--is-ancestor', hash, MAIN_REF])) {
    return { status: 'NOT-ON-MAIN' };
  }
  const countRaw = git(['rev-list', '--count', `${hash}..${MAIN_REF}`]);
  const commitsBehind = Number.parseInt(countRaw, 10);
  return { status: 'OK', commitsBehind };
}

function main() {
  let byHash;
  try {
    byHash = findAnchors();
  } catch (err) {
    console.error(`UNKNOWN: could not read one of ${DOC_PATHS.join(', ')} — ${err.message}`);
    process.exitCode = 2;
    return;
  }

  if (!gitOk(['rev-parse', '--verify', MAIN_REF])) {
    console.error(`UNKNOWN: could not resolve ${MAIN_REF} — is it fetched in this checkout?`);
    process.exitCode = 2;
    return;
  }

  const results = [];
  for (const [hash, locations] of byHash) {
    results.push({ hash, locations, ...classifyAnchor(hash) });
  }

  const unresolvable = results.filter((r) => r.status === 'UNRESOLVABLE');
  const notOnMain = results.filter((r) => r.status === 'NOT-ON-MAIN');
  const ok = results.filter((r) => r.status === 'OK').sort((a, b) => b.commitsBehind - a.commitsBehind);

  const drift = unresolvable.length > 0 || notOnMain.length > 0;
  const exitCode = drift ? 1 : 0;
  const status = drift ? 'DRIFT' : 'OK';

  const scope =
    `checks ONLY backtick-wrapped commit-hash-shaped tokens in ${DOC_PATHS.join(' and ')}, against ${MAIN_REF}'s real history — ` +
    `whether the hash exists and is reachable, and if so how many commits behind ${MAIN_REF} it now is. ` +
    `It never evaluates whether the prose next to an anchor is true, and never checks any other document.`;

  const summary = {
    distinctAnchors: results.length,
    totalCitations: results.reduce((n, r) => n + r.locations.length, 0),
    unresolvable: unresolvable.length,
    notOnMain: notOnMain.length,
    ok: ok.length,
    oldestCommitsBehind: ok.length > 0 ? ok[0].commitsBehind : null,
    newestCommitsBehind: ok.length > 0 ? ok[ok.length - 1].commitsBehind : null,
  };

  if (asJson) {
    console.log(JSON.stringify({ scope, summary, status, exitCode, unresolvable, notOnMain, ok }, null, 2));
  } else {
    console.log('detect-commit-anchor-drift');
    console.log(scope + '\n');
    console.log(
      `${DOC_PATHS.length} documents | ${summary.distinctAnchors} distinct anchors (${summary.totalCitations} citations) | ` +
        `${summary.ok} resolvable, ${summary.unresolvable} unresolvable, ${summary.notOnMain} not on ${MAIN_REF}\n`,
    );

    if (unresolvable.length > 0) {
      console.log(`UNRESOLVABLE — no commit object exists with this hash (${unresolvable.length}):`);
      for (const r of unresolvable) {
        console.log(`  ${r.hash}  (${r.locations.map((l) => `${l.file}:${l.line}`).join(', ')})`);
      }
      console.log('');
    }
    if (notOnMain.length > 0) {
      console.log(`NOT ON ${MAIN_REF} — a real commit, but not reachable from main's current tip (${notOnMain.length}):`);
      for (const r of notOnMain) {
        console.log(`  ${r.hash}  (${r.locations.map((l) => `${l.file}:${l.line}`).join(', ')})`);
      }
      console.log('');
    }
    if (ok.length > 0) {
      console.log(`OK — resolvable and on ${MAIN_REF}, sorted oldest first (${ok.length}):`);
      for (const r of ok) {
        console.log(`  ${r.hash}  ${r.commitsBehind} commit(s) behind  (${r.locations.map((l) => `${l.file}:${l.line}`).join(', ')})`);
      }
      console.log('');
    }

    console.log(`${status}: ${unresolvable.length} unresolvable, ${notOnMain.length} not on ${MAIN_REF}`);
    console.log(
      `\nexit ${exitCode} (0 OK, 1 DRIFT — an unresolvable or off-main anchor; 2 UNKNOWN. ` +
        `An OLD anchor never raises the exit code on its own — age is reported, not scored; a reader decides what to do with it.)`,
    );
  }

  process.exitCode = exitCode;
}

main();
