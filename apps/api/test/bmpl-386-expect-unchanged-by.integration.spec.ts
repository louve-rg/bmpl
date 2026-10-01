/**
 * BMPL-386: proves the `expectUnchangedBy` helper (test/helpers.ts) actually
 * discriminates -- it must pass when the watched value genuinely does not
 * move, and it must FAIL (not pass vacuously) when it does. A helper meant
 * to stop "measures the fixture, not the action" bugs is worthless if it
 * cannot itself go red; this is the same mutation-check discipline this
 * floor already applies to production guards, applied to a test helper.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, expectUnchangedBy, resetDb, type TestContext } from './helpers';

let ctx: TestContext;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
});
afterAll(async () => {
  await ctx.app.close();
});

const countHubs = () => ctx.prisma.logisticsHub.count();
const makeHub = (code: string) =>
  ctx.prisma.logisticsHub.create({
    data: { code, name: 'BMPL-386 probe hub', type: 'AIRSTRIP', district: 'BELIZE', city: 'Belize City', modes: [] },
  });

describe('expectUnchangedBy', () => {
  it('passes when a refused write changes nothing -- the normal case it exists for', async () => {
    await makeHub('BMPL386A');
    await expect(
      expectUnchangedBy(countHubs, () => makeHub('BMPL386A')), // duplicate code -> rejects, count unmoved
    ).resolves.toBeUndefined();
  });

  it('FAILS when the watched value actually moved -- proving it is not a vacuous pass', async () => {
    // A perfectly successful, unrefused create -- the count DOES change, and
    // the helper must say so rather than silently agreeing with the fixture.
    await expect(expectUnchangedBy(countHubs, () => makeHub('BMPL386B'))).rejects.toThrow();
  });
});
