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
 * Env switches:
 *   BMPL_SKIP_WORKSPACE_BUILD=1  skip the dependency build (you manage
 *                                builds yourself and accept the risk)
 *   BMPL_DRY_RUN=1               print what would run, run nothing
 */
import { spawnSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const apiDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(apiDir));
const require = createRequire(join(apiDir, 'package.json'));
const requireRoot = createRequire(join(repoRoot, 'package.json'));

let args = process.argv.slice(2);
if (args[0] === '--') {
  console.log('[run-integration] note: stripped a leading "--" (npm habit) — vitest 2 would have discarded every argument after it and silently run the FULL suite.');
  args = args.slice(1);
}

const dryRun = process.env.BMPL_DRY_RUN === '1';
const skipBuild = process.env.CI || process.env.BMPL_SKIP_WORKSPACE_BUILD === '1';

// Resolve vitest's real entry so the spawn needs no shell and user-supplied
// filter arguments are passed as argv, never interpolated into a string.
const vitestPkg = require('vitest/package.json');
const vitestBin = join(dirname(require.resolve('vitest/package.json')), typeof vitestPkg.bin === 'string' ? vitestPkg.bin : vitestPkg.bin.vitest);
const vitestArgv = [vitestBin, 'run', '--config', 'vitest.integration.config.ts', ...args];

if (dryRun) {
  console.log(`[run-integration] dry run. build step: ${skipBuild ? 'SKIPPED (' + (process.env.CI ? 'CI builds packages explicitly' : 'BMPL_SKIP_WORKSPACE_BUILD') + ')' : 'turbo run build --filter=./packages/*'}`);
  console.log(`[run-integration] would exec: node ${vitestArgv.join(' ')}`);
  process.exit(0);
}

if (!skipBuild) {
  // The floor's standing rebuild-after-base-move rule, made mechanical.
  // turbo is resolved to its JS entry and run through node directly — no
  // shell, no .bin shims — so the guard works even when node_modules/.bin
  // is damaged and cannot be defeated by PATH surprises.
  const turboBin = requireRoot.resolve('turbo/bin/turbo');
  const build = spawnSync(process.execPath, [turboBin, 'run', 'build', '--filter=./packages/*', '--output-logs=errors-only'], {
    stdio: 'inherit',
    cwd: repoRoot,
  });
  if (build.status !== 0) {
    console.error('[run-integration] refusing to run: workspace package build failed, and running the suite against stale dist proves nothing.');
    process.exit(build.status ?? 1);
  }
}

const res = spawnSync(process.execPath, vitestArgv, { stdio: 'inherit', cwd: apiDir });
process.exit(res.status ?? 1);
