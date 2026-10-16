/**
 * A job seeker records the TYPES OF WORK they are willing to do, as links to the
 * existing JobCategory taxonomy (not a parallel list). Replace-the-whole-set
 * semantics, visible categories only, owner-scoped, and the stored state (read back
 * from the database through the profile) is what each assertion checks.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, type TestContext } from './helpers';

let ctx: TestContext;
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const put = (c: string[], p: string, b: object) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);

async function registerSeeker(withProfile = true) {
  const s = uniq();
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email: `wc_${s}@example.bz`, password: 'CustomerPass123', firstName: 'W', lastName: 'C', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const cookies = cookiesOf(reg);
  if (withProfile) {
    expect((await put(cookies, 'job-seeker/profile', { preferredName: `Seeker ${s}` })).status).toBe(200);
  }
  return { cookies };
}

async function makeCategory(name: string, isVisible = true) {
  const s = uniq();
  return ctx.prisma.jobCategory.create({ data: { name, slug: `wc-${s}`, isVisible } });
}

/** The categories the profile reads back as stored. */
async function storedWorkCategoryIds(cookies: string[]): Promise<string[]> {
  const res = await get(cookies, 'job-seeker/profile');
  expect(res.status).toBe(200);
  return (res.body.workCategories as Array<{ jobCategory: { id: string } }>).map((w) => w.jobCategory.id).sort();
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
});
afterAll(async () => {
  await ctx.app.close();
});

describe('job seeker work categories: the kinds of work a person is willing to do', () => {
  it('a seeker records work categories and reads them back from the stored profile', async () => {
    const plumbing = await makeCategory('Plumbing');
    const driving = await makeCategory('Driving');
    const seeker = await registerSeeker();

    const res = await put(seeker.cookies, 'job-seeker/profile/work-categories', { categoryIds: [plumbing.id, driving.id] });
    expect(res.status).toBe(200);
    expect(await storedWorkCategoryIds(seeker.cookies)).toEqual([plumbing.id, driving.id].sort());
  });

  it('the write REPLACES the whole set: a later write without a category removes it', async () => {
    const plumbing = await makeCategory('Plumbing');
    const driving = await makeCategory('Driving');
    const seeker = await registerSeeker();

    expect((await put(seeker.cookies, 'job-seeker/profile/work-categories', { categoryIds: [plumbing.id, driving.id] })).status).toBe(200);
    expect((await put(seeker.cookies, 'job-seeker/profile/work-categories', { categoryIds: [driving.id] })).status).toBe(200);
    expect(await storedWorkCategoryIds(seeker.cookies)).toEqual([driving.id]);

    expect((await put(seeker.cookies, 'job-seeker/profile/work-categories', { categoryIds: [] })).status).toBe(200);
    expect(await storedWorkCategoryIds(seeker.cookies)).toEqual([]);
  });

  it('a hidden category is refused and nothing is stored', async () => {
    const hidden = await makeCategory('Retired Trade', false);
    const seeker = await registerSeeker();

    const res = await put(seeker.cookies, 'job-seeker/profile/work-categories', { categoryIds: [hidden.id] });
    expect(res.status).toBe(400);
    expect(await storedWorkCategoryIds(seeker.cookies)).toEqual([]);
  });

  it('an unknown category id is refused and the previous set is kept', async () => {
    const plumbing = await makeCategory('Plumbing');
    const seeker = await registerSeeker();
    expect((await put(seeker.cookies, 'job-seeker/profile/work-categories', { categoryIds: [plumbing.id] })).status).toBe(200);

    const res = await put(seeker.cookies, 'job-seeker/profile/work-categories', { categoryIds: [plumbing.id, 'does-not-exist'] });
    expect(res.status).toBe(400);
    expect(await storedWorkCategoryIds(seeker.cookies)).toEqual([plumbing.id]);
  });

  it('a person with no job-seeker profile yet is refused', async () => {
    const plumbing = await makeCategory('Plumbing');
    const noProfile = await registerSeeker(false);

    const res = await put(noProfile.cookies, 'job-seeker/profile/work-categories', { categoryIds: [plumbing.id] });
    expect(res.status).toBe(404);
  });

  it("one seeker's categories are never changed by another seeker's write", async () => {
    const plumbing = await makeCategory('Plumbing');
    const driving = await makeCategory('Driving');
    const a = await registerSeeker();
    const b = await registerSeeker();

    expect((await put(a.cookies, 'job-seeker/profile/work-categories', { categoryIds: [plumbing.id] })).status).toBe(200);
    expect((await put(b.cookies, 'job-seeker/profile/work-categories', { categoryIds: [driving.id] })).status).toBe(200);
    expect(await storedWorkCategoryIds(a.cookies)).toEqual([plumbing.id]);
    expect(await storedWorkCategoryIds(b.cookies)).toEqual([driving.id]);
  });

  it('a duplicate id in one request is stored once, not refused', async () => {
    const plumbing = await makeCategory('Plumbing');
    const seeker = await registerSeeker();

    expect((await put(seeker.cookies, 'job-seeker/profile/work-categories', { categoryIds: [plumbing.id, plumbing.id] })).status).toBe(200);
    expect(await storedWorkCategoryIds(seeker.cookies)).toEqual([plumbing.id]);
  });
});
