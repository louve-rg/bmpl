#!/usr/bin/env node
'use strict';
// MDF-1176: a worktree's top-level node_modules/<pkg> entries are
// sometimes symlinked directly into ANOTHER worktree's absolute path
// (a hand-rolled dependency-sharing optimization, not pnpm's own
// per-worktree virtual store). When the worktree on the far end of that
// link is torn down (a reaped temp), every entry pointing at it goes
// dangling -- and the resulting error (MODULE_NOT_FOUND, or a build tool
// refusing to start) never names the real cause: a node_modules entry
// pointing at a directory that no longer exists.
//
// Run this against any worktree to get that diagnosis directly instead
// of reverse-engineering it from a cryptic failure:
//   node scripts/check-node-modules-links.cjs [worktreeRoot]
// Exits non-zero if anything is dangling.
const fs = require('fs');
const path = require('path');

function main() {
  const worktreeRoot = path.resolve(process.argv[2] || process.cwd());
  const nodeModulesPath = path.join(worktreeRoot, 'node_modules');

  if (!fs.existsSync(nodeModulesPath)) {
    console.error('[node-modules-links] No node_modules at ' + nodeModulesPath);
    process.exit(1);
  }

  const entries = fs.readdirSync(nodeModulesPath, { withFileTypes: true });
  const crossWorktree = [];
  const dangling = [];

  for (const ent of entries) {
    const full = path.join(nodeModulesPath, ent.name);
    let lst;
    try {
      lst = fs.lstatSync(full);
    } catch (e) {
      continue;
    }
    if (!lst.isSymbolicLink()) continue;

    const target = fs.readlinkSync(full);
    const isOutsideThisWorktree = !path.resolve(target).toLowerCase().startsWith(worktreeRoot.toLowerCase());
    if (!isOutsideThisWorktree) continue; // pnpm's own internal isolated-linker symlinks, expected.

    crossWorktree.push({ name: ent.name, target });
    try {
      fs.realpathSync(full);
    } catch (e) {
      dangling.push({ name: ent.name, target });
    }
  }

  if (crossWorktree.length === 0) {
    console.log('[node-modules-links] OK: ' + worktreeRoot + ' has no node_modules entries pointing outside itself.');
    return;
  }

  console.log('[node-modules-links] ' + worktreeRoot + ': ' + crossWorktree.length + ' entries point outside this worktree.');
  for (const c of crossWorktree) {
    console.log('  ' + c.name + ' -> ' + c.target + (dangling.some((d) => d.name === c.name) ? '  [DANGLING]' : ''));
  }

  if (dangling.length > 0) {
    console.error('');
    console.error('============================================================');
    console.error('[node-modules-links] ' + dangling.length + ' entries are DANGLING (the worktree they');
    console.error('  point at no longer exists). This is MDF-1176: a worktree was');
    console.error('  reaped while this one still depended on its node_modules.');
    console.error('  Fix by removing the shared link and giving this worktree its');
    console.error('  own install, e.g.: CI=true pnpm install --frozen-lockfile');
    console.error('============================================================');
    process.exit(1);
  } else {
    console.log('');
    console.log('[node-modules-links] All cross-worktree links currently resolve, but this');
    console.log('  worktree will break the moment the worktree it depends on is torn down.');
    console.log('  Not failing on this run, but consider moving to a private install.');
  }
}

main();
