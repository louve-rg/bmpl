#!/usr/bin/env node
'use strict';
// MDF-1176: fail loudly if the generated Prisma client in THIS worktree's
// node_modules was not produced from THIS worktree's current schema.prisma.
// A written column fails loudly on its own if the client is stale; a
// read-only one just returns undefined and a loose assertion passes. This
// check is meant to run before anything that depends on the client (tests,
// dev server) so staleness is caught at the same spot every time, not only
// when it happens to touch a written field.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function resolveGeneratedClientDir(packageDir) {
  const clientPkgJson = require.resolve('@prisma/client/package.json', { paths: [packageDir] });
  // clientPkgJson = <nm>/@prisma/client/package.json -> <nm> is three dirnames up.
  const clientNodeModules = path.dirname(path.dirname(path.dirname(clientPkgJson)));
  return path.join(clientNodeModules, '.prisma', 'client');
}

function main() {
  const packageDir = path.resolve(__dirname, '..');
  const schemaPath = path.join(packageDir, 'prisma', 'schema.prisma');
  const stampPath = path.join(resolveGeneratedClientDir(packageDir), '.schema-hash');

  const currentHash = crypto.createHash('sha256').update(fs.readFileSync(schemaPath)).digest('hex');

  if (!fs.existsSync(stampPath)) {
    console.error('[prisma-guard] No generated-client stamp found at ' + stampPath);
    console.error('[prisma-guard] Run `pnpm --filter @bmpl/database run generate` before relying on @prisma/client here.');
    process.exit(1);
  }

  const stamped = fs.readFileSync(stampPath, 'utf8').trim();
  if (stamped !== currentHash) {
    console.error('');
    console.error('============================================================');
    console.error('[prisma-guard] STALE CLIENT (MDF-1176)');
    console.error('  The generated Prisma client here was stamped for a');
    console.error('  different schema.prisma than the one in this worktree now.');
    console.error('  stamped hash : ' + stamped);
    console.error('  current hash : ' + currentHash);
    console.error('  Run `pnpm --filter @bmpl/database run generate` and retry.');
    console.error('============================================================');
    process.exit(1);
  }

  console.log('[prisma-guard] OK: generated client matches this worktree\'s schema.prisma.');
}

main();
