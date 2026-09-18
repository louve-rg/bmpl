#!/usr/bin/env node
/**
 * Integration-run honesty wrapper (BMPL-79). Two lies this run could
 * previously tell, both measured before they were fixed:
 *
 * 1. STALE WORKSPACE BUILDS. `pnpm --filter @bmpl/api test:integration`
 *    selects this package and runs its script — pnpm builds no dependency
 *    graph on the way, so the suite executed against whatever `packages/X/dist`
 *    happened to be lying around. The scary direction is not the 500 a
 *    missing symbol produces; it is a stale dist that still holds the OLD,
 *    PASSING implementation — a green run that verified code no longer in
 *    the repository. So the workspace packages are built first, through
 *    turbo (cached: an up-to-date tree costs ~a second). CI is exempt —
 *    its workflow builds every package explicitly before this script runs
 *    (ci.yml, "Build packages (needed by the API)") and has no stale dist
 *    to inherit; this trap is local-developer only.
 *
 *    THE GATE IS "EVERY WORKSPACE PACKAGE BUILT SUCCESSFULLY BY A PATH WE
 *    TRUST", NOT "TURBO EXITED 0" (BMPL-133). turbo is the primary path,
 *    unchanged. When turbo itself cannot run — e.g. a machine's Application
 *    Control policy blocks its native binary, which surfaces as a crash
 *    inside the child node process, not as a spawn error here — the SAME
 *    build is attempted once more via pnpm (`pnpm -r --filter "./packages/*"
 *    run build`), loudly announced. This is a fallback, not a loosened
 *    gate: a genuine compile error fails BOTH paths and the run still
 *    refuses, with the same message and a non-zero exit.
 *
 * 2. THE npm-HABIT `--`. `pnpm test:integration -- shipping` forwards the
 *    literal `--` and vitest 2 discards everything after it — a "targeted"
 *    run that silently executed the full suite, exit 0. A leading `--` is
 *    stripped here, with a note, so the npm spelling means what its author
 *    meant.
 *
 * Not guarded, deliberately: `-t <name>` matching nothing still exits 0
 * with everything skipped. Automating that means scraping or sidecar
 * reporters guarding against a typo whose evidence ("N skipped", 0 passed)
 * is already on the screen of the human who typed it. Documented, not
 * automated.
 *
 * 3. THE SHARED TEST DATABASE (BMPL-115). TEST_DATABASE_URL in the root
 *    .env points every local checkout at ONE `bmpl_test`, and the suite
 *    truncates it between tests — so two agents running at once truncate
 *    each other. The flake is the visible symptom; the danger is a FALSE
 *    GREEN: assertions passing against rows another run's setup happened to
 *    leave behind. A green run proves nothing unless the checkout is the
 *    code you meant to test AND the database is the one you meant to test.
 *    So a local run whose target is the shared default `bmpl_test` is
 *    redirected to a per-worktree database (`bmpl_test_<worktree>`), created
 *    on first use; globalSetup then migrates it exactly as it always has.
 *    Nothing to remember, nothing to configure — forgetting is safe, which
 *    is the point. CI is untouched (its databases are already isolated per
 *    run); an explicitly custom TEST_DATABASE_URL is honoured as deliberate.
 *
 * Env switches:
 *   BMPL_SKIP_WORKSPACE_BUILD=1  skip the dependency build (you manage
 *                                builds yourself and accept the risk)
 *   BMPL_DRY_RUN=1               print what would run, run nothing
 *   BMPL_SHARED_TEST_DB=1        keep the shared bmpl_test (you are
 *                                coordinating serial runs yourself)
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, basename, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(apiDir));
const require = createRequire(join(apiDir, 'package.json'));
const requireRoot = createRequire(join(repoRoot, 'package.json'));

/** The one refusal (guard 1). Both build paths failing prints exactly this. */
const BUILD_REFUSAL =
  '[run-integration] refusing to run: workspace package build failed, and running the suite against stale dist proves nothing.';

/** The verified pnpm equivalent of the turbo build (BMPL-133). Every element
 *  is a literal — nothing user-supplied ever reaches the fallback spawn. */
const PNPM_FALLBACK_ARGS = ['-r', '--filter=./packages/*', 'run', 'build'];

/**
 * Guard 1, both paths (exported for the unit spec — no real build is spawned
 * there). turbo first, unchanged; ANY unsuccessful turbo build — non-zero
 * status, spawn-level error, or turbo not even resolvable — falls back to
 * pnpm, because a blocked binary crashes INSIDE the child node process and
 * shows up as a plain non-zero status, not as `spawnSync().error`. The
 * fallback must then succeed on its own merits or `exit` is called with the
 * refusal, before any test could run.
 *
 * deps: { spawn, cwd, execPath, npmExecPath, resolveTurboBin, log, error, exit }
 */
export function enforceWorkspaceBuild(deps) {
  const { spawn, cwd, execPath, npmExecPath, resolveTurboBin, log, error, exit } = deps;

  let turboWhy = null;
  let turboStatus = null;
  try {
    const turboBin = resolveTurboBin();
    const turbo = spawn(execPath, [turboBin, 'run', 'build', '--filter=./packages/*', '--output-logs=errors-only'], {
      stdio: 'inherit',
      cwd,
    });
    if (turbo.status === 0 && !turbo.error) return { ok: true, via: 'turbo' };
    turboStatus = turbo.status;
    turboWhy = turbo.error ? `spawn failed: ${turbo.error.message}` : `exit status ${turbo.status}`;
  } catch (e) {
    turboWhy = `turbo could not be resolved: ${e.message}`;
  }

  log(
    `[run-integration] TURBO BUILD FAILED OR COULD NOT RUN (${turboWhy}) — falling back to the pnpm path: pnpm ${PNPM_FALLBACK_ARGS.join(' ')}. ` +
      'The gate is unchanged: every workspace package must still build (BMPL-133). If turbo is blocked on this machine (Application Control policy), that is an owner/machine matter — do not weaken it from here.',
  );

  // pnpm is not a workspace dependency, so it cannot be resolved the way turbo
  // is. Under `pnpm run` (the documented invocation) npm_execpath names pnpm's
  // own JS entry — spawn that through node: no shell, same as turbo. Invoked
  // any other way, fall back to `pnpm` via the shell; every argument is a
  // literal (see PNPM_FALLBACK_ARGS), so the shell adds no injection surface.
  const viaNode = typeof npmExecPath === 'string' && /^pnpm(\.(c|m)?js)?$/.test(basename(npmExecPath));
  const fallback = viaNode
    ? spawn(execPath, [npmExecPath, ...PNPM_FALLBACK_ARGS], { stdio: 'inherit', cwd })
    : spawn('pnpm', [...PNPM_FALLBACK_ARGS], { stdio: 'inherit', cwd, shell: true });
  if (fallback.status === 0 && !fallback.error) return { ok: true, via: 'pnpm' };

  error(BUILD_REFUSAL);
  exit(fallback.status || turboStatus || 1);
  return { ok: false };
}

/**
 * Decide which test database this run targets (guard 3 in the header).
 * Returns null to leave everything exactly as it is today; otherwise the
 * TEST_DATABASE_URL the child must run with.
 */
function resolveIsolatedTestUrl() {
  if (process.env.CI) return null; // CI is already isolated per run — untouched.
  if (process.env.BMPL_SHARED_TEST_DB === '1') {
    console.log('[run-integration] BMPL_SHARED_TEST_DB=1 — using the SHARED bmpl_test; you are coordinating serial runs yourself.');
    return null;
  }
  // The same source globalSetup reads, in the same precedence: real env wins,
  // the root .env fills in. Parsed here without mutating process.env.
  let url = process.env.TEST_DATABASE_URL;
  if (!url) {
    try {
      const { parse } = require('dotenv');
      url = parse(readFileSync(join(repoRoot, '.env'), 'utf8')).TEST_DATABASE_URL;
    } catch {
      return null; // no .env — globalSetup will refuse loudly, as designed.
    }
  }
  if (!url) return null;
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    return null; // unparseable — let the suite fail with its own message.
  }
  const dbName = parsed.pathname.replace(/^\//, '');
  // Only the SHARED DEFAULT is redirected. A different name is somebody's
  // deliberate choice and stays theirs.
  if (dbName !== 'bmpl_test') return null;
  const slug = basename(repoRoot).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');
  const isolated = `bmpl_test_${slug || 'local'}`.slice(0, 63);
  parsed.pathname = `/${isolated}`;
  return { url: parsed.toString(), dbName: isolated, adminUrl: (() => { const u = new URL(url); u.pathname = '/postgres'; return u.toString(); })() };
}

/** CREATE DATABASE if missing, via the Prisma client the repo already ships. */
async function ensureDatabaseExists(target) {
  const requireDb = createRequire(join(repoRoot, 'packages', 'database', 'package.json'));
  const { PrismaClient } = requireDb('@prisma/client');
  const maintenance = new PrismaClient({ datasources: { db: { url: target.adminUrl } } });
  try {
    const found = await maintenance.$queryRaw`SELECT 1 FROM pg_database WHERE datname = ${target.dbName}`;
    if (!Array.isArray(found) || found.length === 0) {
      // CREATE DATABASE cannot run in a transaction; $executeRawUnsafe sends
      // the single statement as-is. The name is wrapper-derived (never user
      // input) and quoted.
      await maintenance.$executeRawUnsafe(`CREATE DATABASE "${target.dbName}"`);
      console.log(`[run-integration] created database "${target.dbName}" (first isolated run from this worktree).`);
    }
  } finally {
    await maintenance.$disconnect();
  }
}

async function main() {
  let args = process.argv.slice(2);
  if (args[0] === '--') {
    console.log('[run-integration] note: stripped a leading "--" (npm habit) — vitest 2 would have discarded every argument after it and silently run the FULL suite.');
    args = args.slice(1);
  }

  const dryRun = process.env.BMPL_DRY_RUN === '1';
  const skipBuild = process.env.CI || process.env.BMPL_SKIP_WORKSPACE_BUILD === '1';

  const isolation = resolveIsolatedTestUrl();
  if (isolation) {
    console.log(`[run-integration] local run isolated to database "${isolation.dbName}" — the shared bmpl_test truncates under whoever runs last (BMPL-115). BMPL_SHARED_TEST_DB=1 restores the old behaviour.`);
  }

  // Resolve vitest's real entry so the spawn needs no shell and user-supplied
  // filter arguments are passed as argv, never interpolated into a string.
  const vitestPkg = require('vitest/package.json');
  const vitestBin = join(dirname(require.resolve('vitest/package.json')), typeof vitestPkg.bin === 'string' ? vitestPkg.bin : vitestPkg.bin.vitest);
  const vitestArgv = [vitestBin, 'run', '--config', 'vitest.integration.config.ts', ...args];

  if (dryRun) {
    console.log(`[run-integration] dry run. build step: ${skipBuild ? 'SKIPPED (' + (process.env.CI ? 'CI builds packages explicitly' : 'BMPL_SKIP_WORKSPACE_BUILD') + ')' : 'turbo run build --filter=./packages/* — primary; if turbo itself cannot run, falls back to `pnpm -r --filter=./packages/* run build` (BMPL-133); refuses if both fail'}`);
    console.log(`[run-integration] test database: ${isolation ? `"${isolation.dbName}" (isolated, created on first use)` : 'TEST_DATABASE_URL as configured (CI, custom, or BMPL_SHARED_TEST_DB)'}`);
    console.log(`[run-integration] would exec: node ${vitestArgv.join(' ')}`);
    process.exit(0);
  }

  if (isolation) {
    await ensureDatabaseExists(isolation);
  }

  if (!skipBuild) {
    // The floor's standing rebuild-after-base-move rule, made mechanical.
    // turbo is resolved to its JS entry and run through node directly — no
    // shell, no .bin shims — so the guard works even when node_modules/.bin
    // is damaged and cannot be defeated by PATH surprises. On failure of BOTH
    // paths, enforceWorkspaceBuild prints the refusal and exits before any
    // test can run.
    enforceWorkspaceBuild({
      spawn: spawnSync,
      cwd: repoRoot,
      execPath: process.execPath,
      npmExecPath: process.env.npm_execpath,
      resolveTurboBin: () => requireRoot.resolve('turbo/bin/turbo'),
      log: console.log,
      error: console.error,
      exit: (code) => process.exit(code),
    });
  }

  const res = spawnSync(process.execPath, vitestArgv, {
    stdio: 'inherit',
    cwd: apiDir,
    // globalSetup loads the root .env with dotenv's no-override default, so a
    // TEST_DATABASE_URL set here wins — the redirect needs no change there.
    env: isolation ? { ...process.env, TEST_DATABASE_URL: isolation.url } : process.env,
  });
  process.exit(res.status ?? 1);
}

// The unit spec imports this module for enforceWorkspaceBuild; only then must
// main() stay quiet. The guard deliberately fails TOWARD running: a
// path-comparison "is main module" check that misfired would turn the wrapper
// into a silent exit-0 no-op — the precise false green it exists to prevent.
// vitest sets VITEST in its own process; the wrapper is never otherwise run
// under it (the suite it spawns is a child, whose env this does not affect).
if (!process.env.VITEST) {
  await main();
}
