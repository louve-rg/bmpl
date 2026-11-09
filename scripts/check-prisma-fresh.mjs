#!/usr/bin/env node
// FLOOR-5: a per-package build/typecheck run directly (bypassing turbo's
// `^build` dependency graph) silently compiles against whatever Prisma
// client happens to already be on disk. If that client predates a newer
// migration, the result is dozens of opaque "property does not exist on
// PrismaClient" errors that read exactly like a broken branch, with nothing
// telling the reader their own environment — not the code — is behind.
//
// This check compares the newest mtime under packages/database/prisma
// (schema + migrations) against the generated client's own mtime and fails
// loud, with the actual command to run, before tsc ever gets a chance to
// produce that confusing error list.
import { existsSync, readdirSync, statSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const prismaDir = path.join(repoRoot, 'packages/database/prisma');

function newestMtimeUnder(dir) {
  let newest = 0;
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) newest = Math.max(newest, newestMtimeUnder(full));
    else newest = Math.max(newest, statSync(full).mtimeMs);
  }
  return newest;
}

const schemaNewest = newestMtimeUnder(prismaDir);

const require = createRequire(path.join(repoRoot, 'packages/database/package.json'));
let clientEntry;
try {
  clientEntry = require.resolve('@prisma/client');
} catch {
  console.error(
    '\n[check-prisma-fresh] @prisma/client has never been generated.\n' +
      '  Run `pnpm db:generate` (or `pnpm turbo run build --filter=@bmpl/database`) first.\n',
  );
  process.exit(1);
}

// The generated query engine / model types live beside the package entry,
// in a sibling `.prisma/client` directory — that's what `prisma generate`
// actually rewrites. The package entry itself rarely changes mtime.
const generatedDir = path.join(path.dirname(clientEntry), '..', '..', '.prisma', 'client');
if (!existsSync(generatedDir)) {
  console.error(
    '\n[check-prisma-fresh] @prisma/client is installed but never generated.\n' +
      '  Run `pnpm db:generate` (or `pnpm turbo run build --filter=@bmpl/database`) first.\n',
  );
  process.exit(1);
}
const generatedNewest = newestMtimeUnder(generatedDir);

if (schemaNewest > generatedNewest) {
  console.error(
    '\n[check-prisma-fresh] packages/database/prisma has changed (schema or a migration) since the\n' +
      'Prisma client was last generated — building now would compile against stale types and\n' +
      'fail with confusing "property does not exist on PrismaClient" errors.\n' +
      '  Run `pnpm db:generate` (or `pnpm turbo run build --filter=@bmpl/database`) first,\n' +
      '  or build through turbo (`pnpm turbo run build --filter=@bmpl/api`), which does this automatically.\n',
  );
  process.exit(1);
}
