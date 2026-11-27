#!/usr/bin/env node
'use strict';
// MDF-1176: refuse to run a Prisma client generate/build step when this
// package's node_modules does not physically live inside the current git
// worktree. A temp/clone whose node_modules is a Windows junction into its
// source agent's real worktree (isolate:true isolates the git tree only,
// not node_modules) would otherwise overwrite that agent's generated
// client through the junction, silently, mid-session. Turn that into a
// loud, immediate abort instead.
const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

function resolveWorktreeRoot(cwd) {
  try {
    return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
  } catch (err) {
    console.error('[prisma-guard] Could not resolve the git worktree root from ' + cwd + ': ' + err.message);
    process.exit(1);
  }
}

function main() {
  const packageDir = path.resolve(__dirname, '..');
  const worktreeRoot = path.resolve(resolveWorktreeRoot(packageDir));
  const nodeModulesPath = path.join(worktreeRoot, 'node_modules');

  if (!fs.existsSync(nodeModulesPath)) {
    console.error('[prisma-guard] No node_modules at worktree root: ' + nodeModulesPath);
    console.error('[prisma-guard] Run an install for this worktree before generating.');
    process.exit(1);
  }

  const real = path.resolve(fs.realpathSync(nodeModulesPath));
  const expected = path.resolve(nodeModulesPath);

  if (real.toLowerCase() !== expected.toLowerCase()) {
    console.error('');
    console.error('============================================================');
    console.error('[prisma-guard] ABORT (MDF-1176)');
    console.error('  node_modules under this worktree is not a real directory');
    console.error('  here -- it resolves somewhere else on disk:');
    console.error('    worktree root : ' + worktreeRoot);
    console.error('    node_modules  : ' + nodeModulesPath);
    console.error('    real target   : ' + real);
    console.error('');
    console.error('  Generating here would write the Prisma client through that');
    console.error('  link into WHATEVER worktree really owns it -- not this one.');
    console.error('  That is the floor-wide hazard tracked as MDF-1176. Refusing');
    console.error('  to run `prisma generate`.');
    console.error('============================================================');
    process.exit(1);
  }
}

main();
