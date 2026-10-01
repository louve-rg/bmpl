/**
 * BMPL-389: locks the one behaviour BMPL-388 (packages/database/src/index.ts)
 * shipped on a manual probe rather than an automated one — that the Prisma
 * client's `error` log event is filtered by matching the engine's own fixed
 * diagnostic text for a P2002 (unique-constraint violation), and ONLY that
 * text, so an unrelated error class still reaches console.error exactly as
 * before.
 *
 * Deliberately placed here rather than inside packages/database: that package
 * has no test harness today (no vitest config, no DB wiring, no CI job), and
 * standing one up would mean faking the one thing that actually matters —
 * whether a REAL P2002's message, from a REAL Postgres error, matches the
 * filter. apps/api already boots the exact `prisma` singleton this file
 * exports (bootApp() imports it from '@bmpl/database') against a real
 * database in CI, so this is the cheapest place that can test the real
 * claim rather than a mock of it. See BMPL-389 for the full reasoning on why
 * packages/database was not given its own harness.
 *
 * The failure mode this guards is a silent one: if a future Prisma upgrade
 * rewords "Unique constraint failed on the fields:", the filter simply stops
 * matching and the old noisy logging returns — nothing is hidden or lost
 * either way. This test exists to turn that silent drift into a red CI run
 * instead of a surprise the next time someone goes log-diving.
 */
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { bootApp, resetDb, type TestContext } from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
});
afterAll(async () => {
  await ctx.app.close();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe('BMPL-388: the P2002 log filter on the shared Prisma client', () => {
  it('suppresses console.error for a real, unique-constraint-violating P2002 against a real database', async () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await ctx.prisma.logisticsHub.create({
      data: { code: 'BMPL389', name: 'BMPL-389 probe hub', type: 'AIRSTRIP', district: 'BELIZE', city: 'Belize City', modes: [] },
    });
    await expect(
      ctx.prisma.logisticsHub.create({
        data: { code: 'BMPL389', name: 'BMPL-389 probe hub (duplicate)', type: 'AIRSTRIP', district: 'BELIZE', city: 'Belize City', modes: [] },
      }),
    ).rejects.toThrow(/Unique constraint failed/);

    expect(spy).not.toHaveBeenCalled();
  });

  it('does NOT suppress an unrelated PrismaClientKnownRequestError — the filter discriminates by message, not by "any error"', async () => {
    // P2025 ("record not found"), from the same typed model API as the P2002
    // above (update() vs. create()). A raw $queryRawUnsafe failure was tried
    // first and does NOT reach this client's 'error' log event at all (its
    // errors come through a different path) -- it would have passed this
    // assertion for the wrong reason (zero calls, same as a filtered one). A
    // same-path, different-code model error is the real test of "the filter
    // discriminates by message, not by swallowing every error it sees".
    const spy = vi.spyOn(console, 'error').mockImplementation(() => {});

    await expect(
      ctx.prisma.logisticsHub.update({ where: { id: 'bmpl-389-does-not-exist' }, data: { name: 'x' } }),
    ).rejects.toThrow(/No 'LogisticsHub' record|record.*not found/i);

    expect(spy).toHaveBeenCalledTimes(1);
    expect(spy.mock.calls[0]?.[0]).toEqual(expect.not.stringContaining('Unique constraint failed on the fields:'));
  });
});
