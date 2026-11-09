#!/usr/bin/env node
/**
 * deploy-status — is production actually running what main says, for ALL
 * THREE services? (BMPL-66, extended by BMPL-316)
 *
 * Compares the commit each of the API, web and admin origins actually serves
 * against origin/main, and names both. Read-only: it observes, never
 * deploys, and changes nothing anywhere.
 *
 *   node scripts/deploy-status.mjs
 *   node scripts/deploy-status.mjs --web-route /dashboard/passenger   # PROBE one web route
 *   node scripts/deploy-status.mjs --json
 *
 * BMPL-316: web and admin are now checked BY DEFAULT, not behind an opt-in
 * flag. The gap that dispatch existed to close: an operator who ran the
 * plain command (no flag) got an answer about the API alone and could easily
 * read that as "deployment is fine" — which is exactly how two customer-
 * facing apps went unchecked while their owner watched the API constantly.
 * The admin console has no separate flag at all; it did not exist as a
 * concept for this script before today. (`--web` is no longer needed and is
 * accepted-but-ignored for anyone with the old habit — the check it used to
 * gate now always runs.)
 *
 * Web and admin builds are MEASURED (BMPL-67): each origin's unauthenticated
 * /health reports the commit BAKED INTO THE BUILD BEING SERVED, not inferred
 * from behaviour the way --web-route is. UNKNOWN (endpoint unreachable, or a
 * build with no commit identity) is never reported as agreement: "cannot
 * verify" and "stale" are different answers and the reader must always know
 * which one they got.
 *
 * THE PART THAT MATTERS MOST (BMPL-316's own trigger): a commit COUNT behind
 * main is true by arithmetic and can still be substantively misleading — a
 * real diff done by hand this morning changed a report to the owner from
 * "nineteen commits behind" to "one", because eighteen of them never touched
 * anything web builds from. Vercel's own rebuild decision for each app is
 * not a mystery this script has to guess at or re-derive as a glob list: it
 * is `apps/web/vercel.json` and `apps/admin/vercel.json`'s own
 * `ignoreCommand`, and both read `turbo query affected --base=<sha>
 * --packages <name>` — this script runs the IDENTICAL query, so its
 * NOTHING_TO_DELIVER verdict for web/admin is not an approximation of
 * Vercel's rule, it is the same rule. (The API side of this refinement
 * predates BMPL-316 and is unchanged: railway.json's own watchPatterns,
 * still read from origin/main, never hardcoded.)
 *
 * Verdicts and exit codes (API; web/admin share the same verdict vocabulary
 * but are reported, never scored — see below):
 *   CURRENT  (0) production's commit is main's head
 *   BEHIND   (1) production is MISSING SOMETHING IT SHOULD HAVE: it runs an
 *                ancestor of main and the delta touches files the deployment
 *                actually builds from (railway.json watchPatterns for the
 *                API; `turbo query affected` against the app's own package
 *                for web/admin — see above, both read live, never
 *                hardcoded). Both commits named; inside a repo the
 *                undelivered commits are listed, each labelled [api]/
 *                [unwatched] (API) or left unlabelled (web/admin, where
 *                turbo already answered per-commit affectedness is not
 *                cheaply available the same way)
 *   NOTHING_TO_DELIVER (0) main has moved, but only in ways this deployment
 *                would never build (web-only, docs-only merges, or — for
 *                web/admin — a change outside that app's own dependency
 *                graph). The platform is right not to deploy, so this is a
 *                calm verdict — if it said BEHIND on every routine unrelated
 *                merge, BEHIND would stop being believed on the day it
 *                matters. Outside a repo, or when the affectedness query
 *                itself cannot be answered, this refinement is never
 *                claimed: the script degrades to plain BEHIND with a note,
 *                because saying less is honest and guessing is not
 *   UNKNOWN  (2) a question could not be ANSWERED (endpoint unreachable,
 *                malformed health payload, git unreachable). Deliberately
 *                distinct from BEHIND: an empty answer is not a negative
 *                answer, and conflating them is how a stale deploy hid
 *                twice before this script existed.
 *   DIVERGED (3) production reports a commit that is NOT in origin/main's
 *                history (a rollback or branch build) — also not BEHIND,
 *                because "older than main" would be a guess.
 *
 * Exit codes beyond this point remain the API's serve-state alone (the
 * EXIT map below), UNCHANGED by BMPL-316 — this was a deliberate design
 * question, not an oversight carried forward. Web and admin results are
 * always reported now, but still never scored: this tool answers "what is
 * deployed", not "is the fleet healthy", and folding three
 * independently-deploying services into one exit code would hide which one
 * needs attention behind a single bit. FLOOR-7 (below) adds a SECOND,
 * independent axis to the exit code — see that section for why serve-state
 * alone cannot cover it.
 *
 * FLOOR-7 — GITHUB DEPLOYMENT STATUS (this script's actual defect, not an
 * extension for its own sake): everything above asks "what commit does
 * production currently SERVE". It cannot distinguish "no deploy is in
 * flight, so merging is safe" from "a deploy ran and FAILED, production is
 * still serving whatever it served before" — both look identical from the
 * serving side, because a failed Railway deploy never replaces what is
 * running. On 2026-11-09, two production deploys failed (commits `560dfece`
 * 04:43->04:55 and `5ee782d0` 05:28->05:42) and this exact gap — reading
 * this script's serve-state output alone and concluding "nothing in
 * flight" — meant nobody was told for two hours.
 *
 * There is no Railway credential or Railway CLI on this floor, so GitHub's
 * own Deployments API is the only source of DEPLOY-ATTEMPT ground truth
 * (as opposed to serve-state, which API health already gives):
 *   GET /repos/:owner/:repo/deployments?environment=<env>   (latest attempt)
 *   GET /repos/:owner/:repo/deployments/:id/statuses        (its outcome)
 * Both are fetched directly (no `gh` CLI dependency, so this still runs
 * anywhere Node + network does); an `Authorization` header is added only
 * when `GH_TOKEN`/`GITHUB_TOKEN` is already set in the environment — this
 * never requires provisioning a new credential, and the public repo's
 * generous unauthenticated rate limit (60/hr, 2 calls per run) is enough
 * for how this tool is actually used (on demand, not polled).
 *
 * Verdicts (`result.githubDeployment.verdict`), judged from the LATEST
 * deployment record for the production environment and that record's OWN
 * latest status (deployments can carry several status updates over time;
 * only the newest, by `created_at`, is the current truth):
 *   SUCCESS     the latest deployment's latest status is `success`
 *   FAILURE     `failure` or `error` — IMPOSSIBLE TO MISS, non-zero exit
 *   IN_PROGRESS `in_progress`, `queued` or `pending` — a deploy is still
 *               running RIGHT NOW; merging during this window is exactly
 *               the ci.yml:13-31 #405/#406 shape (a later push can mark an
 *               in-flight deployment INACTIVE without ever replacing it).
 *               IMPOSSIBLE TO MISS, non-zero exit
 *   INACTIVE    the latest deployment's latest status is `inactive` — by
 *               construction this can only be the newest deployment
 *               record if NO newer one was ever created to replace it
 *               (a real new deployment would itself now be "latest"
 *               instead). This is the #405/#406 bug's own fingerprint
 *               read directly off the API, not inferred: non-zero exit.
 *   UNKNOWN     the Deployments API itself could not be read (network
 *               error, non-200, empty environment) — distinct from
 *               FAILURE: an unanswerable question is not a negative answer.
 * The report always also restates whether the commit production actually
 * SERVES (the existing serve-state check above) equals origin/main's head
 * — one combined answer, not two the reader has to reconcile by hand.
 *
 * NOT wired into any CI workflow or made a required/gating check by this
 * change — that is a repo-settings decision, explicitly left to the owner,
 * same boundary already drawn around `docker-build-api` (FLOOR-6). This is
 * a reporting and exit-code change only; nothing here costs money, polls on
 * a schedule, or notifies anyone — it answers only when asked.
 *
 * NOT a CI gate, on purpose, for all three: a just-merged commit legitimately
 * shows BEHIND until the platform finishes its own deploy, so wiring this to
 * fail a pipeline would page on every merge and be ignored within a day —
 * and unlike a PR check, this asks about PRODUCTION, which a green pipeline
 * on a branch says nothing about. Run it when you want the answer; nothing
 * runs it at you. (Also: it makes live network calls against production and,
 * for web/admin, shells out to `turbo query affected` — neither belongs in a
 * job that runs on every push.)
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
import { execFileSync, execSync } from 'node:child_process';

const DEFAULTS = {
  apiBase: 'https://bmplapi-production.up.railway.app',
  webBase: 'https://www.bzemarketplace.com',
  adminBase: 'https://bmpl-admin.vercel.app',
  remote: 'https://github.com/louve-rg/bmpl.git',
  ghRepo: 'louve-rg/bmpl',
  ghEnvironment: 'carefree-achievement / production',
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
const adminBase = flag('admin-base') ?? DEFAULTS.adminBase;
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
/** Dry-run lever: judge history as if production reported this commit — for
 *  "what would the verdict be" questions and for testing the classifier. */
const assumeProduction = flag('assume-production');
const ghRepo = flag('gh-repo') ?? DEFAULTS.ghRepo;
const ghEnvironment = flag('gh-environment') ?? DEFAULTS.ghEnvironment;
/** Dry-run lever, same purpose as --assume-production: judge a SPECIFIC
 *  deployment id instead of whatever is currently latest — for testing the
 *  classifier against a known historical deployment on demand. */
const assumeDeploymentId = flag('assume-deployment-id');
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

/**
 * FLOOR-7: GitHub REST API, direct `fetch` (no `gh` CLI dependency). An
 * `Authorization` header is added only when a token already exists in the
 * environment (`GH_TOKEN`/`GITHUB_TOKEN`) — never a reason to provision a
 * new credential; `louve-rg/bmpl` is public, so unauthenticated calls work
 * fine at a lower rate limit (60/hr, and this tool makes 2 calls per run).
 */
async function fetchGithubApi(path) {
  const token = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const ctl = new AbortController();
  const t = setTimeout(() => ctl.abort(), DEFAULTS.timeoutMs);
  try {
    const res = await fetch(`https://api.github.com${path}`, {
      signal: ctl.signal,
      redirect: 'follow',
      headers: {
        Accept: 'application/vnd.github+json',
        ...(token ? { Authorization: `Bearer ${token}` } : {}),
      },
    });
    if (!res.ok) return { error: `HTTP ${res.status}` };
    return { body: await res.json() };
  } catch (e) {
    return { error: e?.cause?.code ?? e?.name ?? String(e) };
  } finally {
    clearTimeout(t);
  }
}

/** Most recent entry by `created_at` — the API's own documented ordering
 *  matches this in practice, but re-sorting client-side costs nothing and
 *  never trusts an undocumented default. */
function newestByCreatedAt(items) {
  if (!Array.isArray(items) || items.length === 0) return null;
  return [...items].sort((a, b) => new Date(b.created_at) - new Date(a.created_at))[0];
}

/**
 * FLOOR-7: the latest deployment ATTEMPT for the production environment —
 * deploy-attempt ground truth, distinct from serve-state (what `/api/health`
 * reports is currently running). `repo` and `environment` are read from
 * this script's own flags/DEFAULTS, never external input, so the
 * encodeURIComponent below is a correctness step (the environment name has
 * a literal space and slash), not a sanitisation boundary.
 */
async function latestDeployment(repo, environment) {
  const { body, error } = await fetchGithubApi(`/repos/${repo}/deployments?per_page=10&environment=${encodeURIComponent(environment)}`);
  if (error) return { error };
  const latest = newestByCreatedAt(body);
  if (!latest) return { error: `no deployments recorded for environment "${environment}"` };
  return { deployment: latest };
}

/** Single deployment by id — used for --assume-deployment-id so a test run
 *  against a specific historical id still gets the real sha/created_at,
 *  not nulls, and so the cross-check line below is actually exercised. */
async function deploymentById(repo, deploymentId) {
  const { body, error } = await fetchGithubApi(`/repos/${repo}/deployments/${deploymentId}`);
  if (error) return { error };
  return { deployment: body };
}

async function latestDeploymentStatus(repo, deploymentId) {
  const { body, error } = await fetchGithubApi(`/repos/${repo}/deployments/${deploymentId}/statuses?per_page=10`);
  if (error) return { error };
  const latest = newestByCreatedAt(body);
  if (!latest) return { error: `deployment ${deploymentId} has no status updates` };
  return { status: latest };
}

const GH_DEPLOY_EXIT = { SUCCESS: 0, FAILURE: 1, IN_PROGRESS: 1, INACTIVE: 1, UNKNOWN: 2 };

/**
 * FLOOR-7: judge the latest production deployment ATTEMPT (ground truth
 * from GitHub, not inferred from what is served) and whether it is the
 * kind of outcome that must not go unnoticed. See the header doc comment
 * for the full verdict table and why INACTIVE-as-latest is itself the
 * #405/#406 bug's fingerprint rather than a benign state.
 */
async function checkGithubDeployment(repo, environment, mainSha, overrideId) {
  let deployment;
  if (overrideId) {
    const { deployment: d, error } = await deploymentById(repo, overrideId);
    if (error) return { verdict: 'UNKNOWN', reason: `could not read deployment ${overrideId} (${error})` };
    deployment = d;
  } else {
    const { deployment: d, error } = await latestDeployment(repo, environment);
    if (error) return { verdict: 'UNKNOWN', reason: `could not read the latest deployment (${error})` };
    deployment = d;
  }
  const { status, error: statusError } = await latestDeploymentStatus(repo, deployment.id);
  if (statusError) {
    return {
      verdict: 'UNKNOWN',
      reason: `could not read deployment ${deployment.id}'s status (${statusError})`,
      deploymentId: deployment.id,
      deploymentSha: deployment.sha,
    };
  }
  const state = status.state;
  const verdict = state === 'success' ? 'SUCCESS' : state === 'failure' || state === 'error' ? 'FAILURE' : state === 'in_progress' || state === 'queued' || state === 'pending' ? 'IN_PROGRESS' : state === 'inactive' ? 'INACTIVE' : 'UNKNOWN';
  return {
    verdict,
    deploymentId: deployment.id,
    deploymentSha: deployment.sha,
    deploymentCreatedAt: deployment.created_at,
    latestStatusState: state,
    latestStatusCreatedAt: status.created_at,
    matchesMainByDeploymentSha: mainSha && deployment.sha ? mainSha === deployment.sha : null,
    ...(verdict === 'UNKNOWN' && state ? { reason: `unrecognised deployment status state "${state}"` } : {}),
  };
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

/**
 * Railway rebuilds the API only when a commit touches build.watchPatterns
 * (railway.json — the deploy's own source of truth, read from origin/main so
 * a stale checkout cannot lie; never hardcoded here, because it will change
 * without telling this script). Returns the pattern list, or null when it
 * cannot be read — and null means "do not claim the refinement", never
 * "assume everything matters" or "assume nothing does".
 */
function watchPatterns(main) {
  const raw = git('show', `${main}:railway.json`) ?? git('show', 'HEAD:railway.json');
  if (!raw) return null;
  try {
    const patterns = JSON.parse(raw)?.build?.watchPatterns;
    return Array.isArray(patterns) && patterns.length > 0 ? patterns : null;
  } catch {
    return null;
  }
}

/** Root-relative glob of railway's dialect: `**` crosses slashes, `*` does not. */
function globToRegex(pattern) {
  const escaped = pattern.replace(/[.+^${}()|[\]\\]/g, '\\$&').replaceAll('**', '0000').replaceAll('*', '[^/]*').replaceAll('0000', '.*');
  return new RegExp(`^${escaped}$`);
}

function matchesAny(file, regexes) {
  return regexes.some((r) => r.test(file));
}

/**
 * BMPL-316: the same query each Vercel app's OWN `ignoreCommand` runs
 * (`apps/web/vercel.json`, `apps/admin/vercel.json`) — `turbo query affected
 * --base=<sha> --packages <name>`, not a re-derived approximation of it. `sha`
 * arguments are validated as hex-only before this is ever called and `pkg` is
 * always one of two hardcoded literals from this file (never external input),
 * which is what makes `shell: true` below safe rather than merely convenient:
 * `turbo.CMD` on Windows cannot be spawned directly by `execFileSync` without
 * shell interpretation (a Node/Windows limitation, not a turbo one), and
 * every argument reaching that shell is already closed off from injection by
 * the checks in this function and its two call sites — which is also why
 * this builds one plain command STRING for `execSync` rather than an args
 * array for `execFileSync` with `shell: true`: Node warns on the latter
 * specifically because it cannot itself guarantee an array's elements are
 * safely escaped for whatever shell runs them, a warning that exists for
 * exactly the case (external/untrusted arguments) this function is not in,
 * since both interpolated values are already validated hex or literals
 * before they ever reach the string below. Returns true/false, or null when
 * the query itself could not be answered (turbo unavailable, a ref it cannot
 * resolve) — null means "do not claim the refinement", the same discipline
 * `watchPatterns` follows for Railway.
 */
function turboAffected(base, head, pkg) {
  if (!/^[0-9a-f]{7,40}$/i.test(base) || !/^[0-9a-f]{7,40}$/i.test(head)) return null;
  if (pkg !== '@bmpl/web' && pkg !== '@bmpl/admin') return null;
  try {
    const out = execSync(`pnpm exec turbo query affected --base ${base} --head ${head} --packages ${pkg}`, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'ignore'],
    });
    const items = JSON.parse(out)?.data?.affectedPackages?.items;
    return Array.isArray(items) ? items.length > 0 : null;
  } catch {
    return null;
  }
}

/**
 * `refine` selects which deployment's own rebuild rule judges the delta:
 *   { mode: 'railway' }        (default) — API, railway.json watchPatterns
 *   { mode: 'turbo', pkg }     — web/admin, that app's own `turbo query
 *                                 affected` (== its vercel.json ignoreCommand)
 * Both answer the identical question — "would this deployment's own platform
 * have rebuilt across this range?" — from that platform's own real
 * configuration, never a guess. Ancestry (CURRENT/DIVERGED/UNKNOWN-for-count)
 * is shared and mode-independent; only the deliverable/not-deliverable
 * refinement differs, because that is the one part each platform decides its
 * own way.
 */
function classify(prodCommit, main, { refine = { mode: 'railway' } } = {}) {
  if (main.startsWith(prodCommit) || prodCommit.startsWith(main)) return { verdict: 'CURRENT' };
  if (!inRepo()) {
    // Without local history we know the commits differ but not their
    // relation — and we cannot see which FILES the delta touches, so the
    // deliverable/not-deliverable refinement below is honestly out of reach:
    // degrade to plain BEHIND and say so, never guess.
    return {
      verdict: 'BEHIND',
      note: 'commits differ; run inside a repo checkout to confirm ancestry, list the delta and judge whether any of it is deliverable',
      unconfirmed: true,
    };
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
  const base = {
    count: count ? Number(count) : null,
    missing: missing ? missing.split('\n') : [],
  };

  // BEHIND must mean "this deployment is MISSING something it should have".
  // A change outside an app's own dependency graph moves main without ever
  // triggering that app's rebuild — the platform is right not to build, and
  // a verdict that cries BEHIND on every such merge teaches everyone to
  // ignore the day it matters.
  if (refine.mode === 'turbo') {
    const affected = turboAffected(full, main, refine.pkg);
    if (affected === null) {
      return { ...base, verdict: 'BEHIND', note: `could not run turbo query affected for ${refine.pkg} (unavailable, or a ref it could not resolve), so whether this delta would trigger a rebuild is unjudged — same query as this app's own vercel.json ignoreCommand` };
    }
    if (!affected) {
      return { ...base, verdict: 'NOTHING_TO_DELIVER', note: `origin/main is ahead, but none of it touches ${refine.pkg} per turbo's own dependency graph — the identical query Vercel's ignoreCommand runs, so Vercel would not have rebuilt this deployment either` };
    }
    return { ...base, verdict: 'BEHIND', note: `${refine.pkg} is affected by this range per turbo's own dependency graph (the same check Vercel's ignoreCommand runs) — Vercel should have rebuilt` };
  }

  // Railway (API): judged against watchPatterns, per-commit labelled, as before.
  const patterns = watchPatterns(main);
  const files = git('diff', '--name-only', `${full}..${main}`);
  if (!patterns || files === null) {
    return { ...base, verdict: 'BEHIND', note: 'could not read railway.json watchPatterns (or the delta), so whether this delta would trigger a deploy is unjudged' };
  }
  const regexes = patterns.map(globToRegex);
  const deliverable = files.split('\n').filter(Boolean).filter((f) => matchesAny(f, regexes));
  if (deliverable.length === 0) {
    return { ...base, verdict: 'NOTHING_TO_DELIVER' };
  }
  // Label each undelivered commit so the reader sees which ones are the
  // reason this is BEHIND and which merely ride along in the range.
  const labelled = base.missing.map((line) => {
    const sha = line.split(' ')[0];
    const touched = git('diff-tree', '--no-commit-id', '--name-only', '-r', sha) ?? '';
    const watched = touched.split('\n').filter(Boolean).some((f) => matchesAny(f, regexes));
    return `${watched ? '[api] ' : '[unwatched] '}${line}`;
  });
  return { ...base, verdict: 'BEHIND', missing: labelled, deliverableFiles: deliverable.length };
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

const EXIT = { CURRENT: 0, NOTHING_TO_DELIVER: 0, BEHIND: 1, UNKNOWN: 2, DIVERGED: 3 };

/**
 * Shared by the web and admin build checks (BMPL-316) — same shape, same
 * /health contract (BMPL-67), only the base URL, the turbo package name and
 * the label differ. Never scored (see header): the caller stores the result,
 * exit code stays the API's.
 */
async function checkBuild(label, base, pkg, mainSha) {
  const health = await fetchJson(`${base}/health`);
  if (health.error || typeof health.body?.commit !== 'string' || !health.body.commit) {
    // Unreachable or commit-less is UNKNOWN — an unverifiable build must
    // never be reported as agreement with main.
    return {
      label,
      verdict: 'UNKNOWN',
      reason: health.error ? `${label} /health unanswerable (${health.error})` : `${label} /health carries no commit (a build without commit identity)`,
      main: mainSha ? mainSha.slice(0, 7) : null,
    };
  }
  if (!mainSha) {
    return { label, verdict: 'UNKNOWN', reason: 'could not read origin/main from the remote', deployed: health.body.commit };
  }
  const c = classify(health.body.commit, mainSha, { refine: { mode: 'turbo', pkg } });
  return {
    label,
    verdict: c.verdict,
    deployed: health.body.commit,
    main: mainSha.slice(0, 7),
    ...(c.count != null ? (c.verdict === 'NOTHING_TO_DELIVER' ? { mainAheadBy: c.count } : { commitsSince: c.count }) : {}),
    ...(c.missing?.length ? (c.verdict === 'NOTHING_TO_DELIVER' ? { aheadUnrelated: c.missing } : { since: c.missing }) : {}),
    ...(c.note ? { note: c.note } : {}),
  };
}

function printBuild(w) {
  if (w.verdict === 'CURRENT') console.log(`${w.label} BUILD (measured) CURRENT — the deployed build is ${w.deployed}, which is origin/main (${w.main})`);
  else if (w.verdict === 'NOTHING_TO_DELIVER')
    console.log(
      `${w.label} BUILD (measured) NOTHING TO DELIVER — deployed build is ${w.deployed}; origin/main is ${w.main}, ${w.mainAheadBy} commit${w.mainAheadBy === 1 ? '' : 's'} ahead, none affecting this app (turbo query affected — the same check Vercel's own ignoreCommand runs)`,
    );
  else if (w.verdict === 'BEHIND')
    console.log(`${w.label} BUILD (measured) BEHIND — deployed build is ${w.deployed}, origin/main is ${w.main}${w.commitsSince != null ? ` (${w.commitsSince} commit${w.commitsSince === 1 ? '' : 's'} since)` : ''}`);
  else if (w.verdict === 'DIVERGED') console.log(`${w.label} BUILD (measured) DIVERGED — deployed build is ${w.deployed}, origin/main is ${w.main}`);
  else console.log(`${w.label} BUILD UNKNOWN — ${w.reason} (an unverifiable build is never reported as current)`);
  if (w.note) console.log(`  note: ${w.note}`);
  for (const line of w.since ?? []) console.log(`  since this build: ${line}`);
  for (const line of w.aheadUnrelated ?? []) console.log(`  ahead, unrelated: ${line}`);
}

/**
 * FLOOR-7: prints plainly, and loudly, for FAILURE/IN_PROGRESS/INACTIVE —
 * these must be impossible to miss, per the card this was written for.
 * `apiResult` is the EXISTING serve-state answer (computed above, not
 * re-derived here) so this restates "does production serve main's head"
 * in the same report as "what did the last deploy attempt do", instead of
 * leaving the reader to reconcile two separate answers by hand.
 */
function printGithubDeployment(g, apiResult) {
  if (!g) return;
  const shaLabel = g.deploymentSha ? g.deploymentSha.slice(0, 7) : g.deploymentId != null ? `id ${g.deploymentId}` : 'unknown';
  if (g.verdict === 'SUCCESS') {
    console.log(`GITHUB DEPLOYMENT (production, latest attempt) SUCCESS — ${shaLabel}, status "${g.latestStatusState}" at ${g.latestStatusCreatedAt}`);
  } else if (g.verdict === 'FAILURE') {
    console.log(`GITHUB DEPLOYMENT (production, latest attempt) *** FAILURE *** — ${shaLabel}, status "${g.latestStatusState}" at ${g.latestStatusCreatedAt} — a deploy ran and did not complete; production is still serving whatever it served before`);
  } else if (g.verdict === 'IN_PROGRESS') {
    console.log(`GITHUB DEPLOYMENT (production, latest attempt) *** IN PROGRESS *** — ${shaLabel}, status "${g.latestStatusState}" since ${g.deploymentCreatedAt} — do not merge anything that would not itself trigger a rebuild (ci.yml:13-31, the #405/#406 shape)`);
  } else if (g.verdict === 'INACTIVE') {
    console.log(`GITHUB DEPLOYMENT (production, latest attempt) *** INACTIVE, NEVER REPLACED *** — ${shaLabel} was superseded at ${g.latestStatusCreatedAt} but no newer deployment exists for this environment — this is the #405/#406 bug's own fingerprint: a later push marked it inactive without ever building a replacement`);
  } else {
    console.log(`GITHUB DEPLOYMENT (production, latest attempt) UNKNOWN — ${g.reason}`);
  }
  if (g.deploymentSha && apiResult?.production) {
    console.log(`  cross-check: production currently SERVES ${apiResult.production.slice(0, 7)} (${apiResult.verdict}); the last deploy ATTEMPT targeted ${shaLabel}${g.matchesMainByDeploymentSha === false ? ' — the last attempt is already behind origin/main' : ''}`);
  }
}

async function main() {
  const result = { api: {}, web: null, webBuild: null, adminBuild: null, githubDeployment: null };

  const health = assumeProduction
    ? { body: { commit: assumeProduction, assumed: true } }
    : await fetchJson(`${apiBase}/api/health`);
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
      ...(health.body.assumed ? { assumed: 'production commit was ASSUMED via --assume-production, not fetched' } : {}),
      ...(c.count != null ? (c.verdict === 'NOTHING_TO_DELIVER' ? { mainAheadBy: c.count } : { commitsBehind: c.count }) : {}),
      // Under the calm verdict nothing is "undelivered" — the commits are
      // merely ahead, in files this deployment never builds from.
      ...(c.missing?.length ? (c.verdict === 'NOTHING_TO_DELIVER' ? { aheadUnwatched: c.missing } : { undelivered: c.missing }) : {}),
      ...(c.note ? { note: c.note } : {}),
    };
  }

  if (webRoute) result.web = { route: webRoute, base: webBase, ...(await probeWeb(webRoute)) };

  // BMPL-316: web and admin are checked BY DEFAULT — this is the fix, not a
  // flag someone has to remember to pass.
  result.webBuild = await checkBuild('WEB', webBase, '@bmpl/web', mainSha);
  result.adminBuild = await checkBuild('ADMIN', adminBase, '@bmpl/admin', mainSha);

  // FLOOR-7: also checked BY DEFAULT, same reasoning as BMPL-316 above —
  // the whole point is that reading serve-state alone and concluding
  // "nothing in flight" is exactly the mistake this closes.
  result.githubDeployment = await checkGithubDeployment(ghRepo, ghEnvironment, mainSha, assumeDeploymentId);

  if (asJson) {
    console.log(JSON.stringify(result, null, 2));
  } else {
    const a = result.api;
    if (a.verdict === 'CURRENT') console.log(`CURRENT — production runs ${a.production}, which is origin/main (${a.main})`);
    else if (a.verdict === 'NOTHING_TO_DELIVER')
      console.log(
        `NOTHING TO DELIVER — production runs ${a.production}; origin/main is ${a.main}, ${a.mainAheadBy} commit${a.mainAheadBy === 1 ? '' : 's'} ahead, none touching what this deployment builds from (railway.json watchPatterns)`,
      );
    else if (a.verdict === 'BEHIND') console.log(`BEHIND — production runs ${a.production}, origin/main is ${a.main}${a.commitsBehind != null ? ` (${a.commitsBehind} commit${a.commitsBehind === 1 ? '' : 's'} behind)` : ''}`);
    else if (a.verdict === 'DIVERGED') console.log(`DIVERGED — production runs ${a.production}, origin/main is ${a.main}`);
    else console.log(`UNKNOWN — ${a.reason}`);
    if (a.startedAt) console.log(`  deployed instance started ${a.startedAt} (uptime ${a.uptimeSeconds}s)`);
    if (a.assumed) console.log(`  note: ${a.assumed}`);
    if (a.note) console.log(`  note: ${a.note}`);
    for (const line of a.undelivered ?? []) console.log(`  undelivered: ${line}`);
    for (const line of a.aheadUnwatched ?? []) console.log(`  ahead, unwatched: ${line}`);
    if (result.web) console.log(`WEB ROUTE (probe) ${result.web.verdict} — ${result.web.route} on ${result.web.base}: ${result.web.detail}`);
    printBuild(result.webBuild);
    printBuild(result.adminBuild);
    printGithubDeployment(result.githubDeployment, a);
  }

  const apiExit = EXIT[result.api.verdict] ?? EXIT.UNKNOWN;
  const deployExit = GH_DEPLOY_EXIT[result.githubDeployment?.verdict] ?? EXIT.UNKNOWN;
  // Worse of the two axes — either one being non-zero must make the whole
  // run non-zero (FLOOR-7's actual requirement), and the two axes answer
  // different questions (what is SERVED vs. what the last deploy ATTEMPT
  // did), so there is no single ordering where one subsumes the other.
  process.exitCode = Math.max(apiExit, deployExit);
}

main();
