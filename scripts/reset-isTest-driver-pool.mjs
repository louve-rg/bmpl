#!/usr/bin/env node
/**
 * reset-isTest-driver-pool — census and reset for isTest driver contamination
 * on the shared dev Postgres (FLOOR-3, ordered after the third report of this
 * problem: TERM-2's baseline had to bypass automatic dispatch ranking and
 * manual-assign every leg instead, because every district already had other
 * agents' leftover ONLINE isTest drivers the sweep could offer to instead of
 * the fixture's own driver — see handoff.md "TERM-0 / TERM-2").
 *
 * THE PROBLEM: `isTest` driver_profiles accumulate across agents and sessions.
 * Nobody sets them back OFFLINE when a fixture's work is done (this agent
 * included — TERM-2's own Term2Driver fixtures were left online too). An
 * ONLINE isTest driver is eligible for the automatic dispatch sweep on ANY
 * isTest booking in its district/vehicle class, not just the fixture that
 * created it, so a contaminated pool silently turns "test the real dispatch
 * path" into "test a manual-assign workaround" with no error or signal.
 *
 * WHAT THIS DOES:
 *   node scripts/reset-isTest-driver-pool.mjs            census only, read-only
 *   node scripts/reset-isTest-driver-pool.mjs --apply     census, then reset
 *
 * Census groups driver_profiles by (isTest, availability, homeDistrict) so
 * the contamination shape is visible before anything is touched.
 *
 * Reset: driver_profiles SET availability='OFFLINE' WHERE isTest=true AND
 * availability='ONLINE'. Every row is printed (userId, displayName,
 * homeDistrict) before the write. Records are never deleted. A non-isTest
 * driver can never be touched — the WHERE clause hard-codes isTest=true. The
 * recount and the write run inside one prisma.$transaction; if updateMany
 * ever reports more rows changed than the recount taken moments earlier IN
 * THE SAME TRANSACTION, main() throws FROM INSIDE the transaction, which
 * rolls the write back — this actually PREVENTS a bad WHERE clause from
 * taking effect, not just reports it after the fact once it has already
 * committed.
 *
 * PRODUCTION GUARD: --apply refuses to run unless DATABASE_URL's host is
 * localhost/127.0.0.1 — a positive statement of what the shared dev DB looks
 * like, not a blacklist of production hostnames (this file names no
 * production host or credential anywhere). Census-only mode has no guard;
 * it never writes.
 *
 * This writes directly via Prisma, bypassing the app-level
 * DRIVER_AVAILABILITY_CHANGED audit trail on purpose: there is no admin
 * endpoint that can set another account's availability (driver.service.ts
 * setAvailability() is self-service only, ownProfileOrThrow), and asking
 * every other agent for their fixtures' driver passwords does not scale.
 * This is a maintenance operation on fixture data, not a user-facing action.
 *
 * Connects to DATABASE_URL from the repo root .env (same shared dev DB every
 * worktree on this host points at by default) unless DATABASE_URL is already
 * set in the environment. Loads @prisma/client from packages/database's own
 * node_modules, same pattern as apps/api/test/run-integration.mjs.
 */
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = dirname(dirname(fileURLToPath(import.meta.url)));
const apply = process.argv.includes('--apply');

function loadDatabaseUrl() {
  if (process.env.DATABASE_URL) return process.env.DATABASE_URL;
  const envPath = join(repoRoot, '.env');
  const text = readFileSync(envPath, 'utf8');
  const m = text.match(/^DATABASE_URL\s*=\s*"?([^"\r\n]+)"?/m);
  if (!m) throw new Error(`DATABASE_URL not found in ${envPath} and not set in environment.`);
  return m[1];
}

// Positive check, not a blacklist: a local dev DB's host is localhost/127.0.0.1.
// Nothing here names a production host or credential — this only asserts what
// dev looks like, so a target that doesn't match it (whatever it actually is)
// is refused.
function assertIsDevDatabase(url) {
  const { hostname } = new URL(url);
  if (hostname === 'localhost' || hostname === '127.0.0.1') return;
  throw new Error(
    `REFUSING --apply: DATABASE_URL's host is "${hostname}", not localhost/127.0.0.1. ` +
      `This is a bulk write and this script only has a positive guard for the shared LOCAL dev DB. ` +
      `If this really is the intended target, this guard needs a deliberate, reviewed change — not a one-off bypass.`,
  );
}

async function main() {
  const url = loadDatabaseUrl();
  if (apply) assertIsDevDatabase(url);
  const requireDb = createRequire(join(repoRoot, 'packages', 'database', 'package.json'));
  const { PrismaClient } = requireDb('@prisma/client');
  const prisma = new PrismaClient({ datasources: { db: { url } } });

  try {
    console.log(`Mode: ${apply ? 'APPLY (will set isTest ONLINE drivers to OFFLINE)' : 'CENSUS ONLY (read-only; pass --apply to reset)'}\n`);

    const before = await prisma.driverProfile.groupBy({
      by: ['isTest', 'availability', 'homeDistrict'],
      _count: { _all: true },
    });
    console.log('--- Census (isTest, availability, district -> count) ---');
    const sorted = [...before].sort((a, b) =>
      a.isTest === b.isTest ? (a.homeDistrict < b.homeDistrict ? -1 : 1) : a.isTest ? 1 : -1,
    );
    for (const row of sorted) {
      console.log(`  isTest=${row.isTest}  ${row.availability.padEnd(8)}  ${row.homeDistrict.padEnd(12)}  ${row._count._all}`);
    }

    const contaminated = await prisma.driverProfile.findMany({
      where: { isTest: true, availability: 'ONLINE' },
      select: { id: true, userId: true, displayName: true, homeDistrict: true },
      orderBy: { homeDistrict: 'asc' },
    });
    const preCount = contaminated.length;
    console.log(`\n--- isTest ONLINE drivers (${preCount}) ---`);
    if (preCount === 0) console.log('  (none — pool is clean)');
    for (const d of contaminated) {
      console.log(`  ${d.homeDistrict.padEnd(12)}  ${d.displayName}  (driverProfileId=${d.id}, userId=${d.userId})`);
    }

    if (!apply) {
      console.log('\nCensus only — no writes made. Re-run with --apply to set these OFFLINE.');
      console.log('ANNOUNCE TO THE FLOOR BEFORE RUNNING --apply: other agents may be relying on one of these as an online fixture right now.');
      return;
    }

    if (preCount === 0) {
      console.log('\nNothing to reset.');
      return;
    }

    // Recount and write in ONE transaction: if updateMany ever reports more
    // rows changed than this recount — taken inside the same transaction,
    // moments before the write — main() throws FROM INSIDE, which rolls the
    // write back. The pre-announcement preCount/contaminated list above is
    // informational only; this recount is the one the safety check trusts.
    const result = await prisma.$transaction(async (tx) => {
      const recount = await tx.driverProfile.count({ where: { isTest: true, availability: 'ONLINE' } });
      const res = await tx.driverProfile.updateMany({
        where: { isTest: true, availability: 'ONLINE' },
        data: { availability: 'OFFLINE' },
      });
      if (res.count > recount) {
        throw new Error(
          `SAFETY ABORT: updateMany reported ${res.count} rows changed but only ${recount} isTest+ONLINE rows were counted moments earlier, ` +
            `inside the same transaction. Rolling back — nothing was written. Do not trust this filter without investigating.`,
        );
      }
      return res;
    });

    console.log(`\nSet ${result.count} isTest driver_profiles OFFLINE (records kept, not deleted).`);

    const after = await prisma.driverProfile.count({ where: { isTest: true, availability: 'ONLINE' } });
    const nonTestOnline = await prisma.driverProfile.count({ where: { isTest: false, availability: 'ONLINE' } });
    console.log(`Post-reset isTest ONLINE count: ${after} (expected 0).`);
    console.log(`Non-isTest ONLINE drivers untouched: ${nonTestOnline} (this script never filters on this field for writes).`);
    if (after !== 0) {
      process.exitCode = 1;
      console.error('WARNING: isTest ONLINE count is not zero after reset — investigate before trusting the floor clean.');
    }
  } finally {
    await prisma.$disconnect();
  }
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
