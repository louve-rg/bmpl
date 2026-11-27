#!/usr/bin/env node
'use strict';
// MDF-1176: record which schema.prisma produced the client that was just
// generated, so a later, unrelated event (an install that silently relinks
// node_modules, a stale cross-worktree copy, etc.) can be told apart from
// "this really is current" instead of just trusting that the files exist.
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

function resolveGeneratedClientDir(packageDir) {
  // @prisma/client and .prisma/client are siblings inside whatever
  // node_modules actually holds them (pnpm's virtual store, not
  // necessarily packages/database/node_modules itself).
  const clientPkgJson = require.resolve('@prisma/client/package.json', { paths: [packageDir] });
  // clientPkgJson = <nm>/@prisma/client/package.json -> <nm> is three dirnames up.
  const clientNodeModules = path.dirname(path.dirname(path.dirname(clientPkgJson)));
  return path.join(clientNodeModules, '.prisma', 'client');
}

function main() {
  const packageDir = path.resolve(__dirname, '..');
  const schemaPath = path.join(packageDir, 'prisma', 'schema.prisma');
  const outDir = resolveGeneratedClientDir(packageDir);

  if (!fs.existsSync(schemaPath)) {
    console.error('[prisma-guard] No schema.prisma at ' + schemaPath);
    process.exit(1);
  }
  if (!fs.existsSync(outDir)) {
    console.error('[prisma-guard] Generated client dir missing, expected at ' + outDir + ' -- did `prisma generate` run first?');
    process.exit(1);
  }

  const hash = crypto.createHash('sha256').update(fs.readFileSync(schemaPath)).digest('hex');
  fs.writeFileSync(path.join(outDir, '.schema-hash'), hash + '\n', 'utf8');
  console.log('[prisma-guard] stamped generated client with schema hash ' + hash.slice(0, 12) + '...');
}

main();
