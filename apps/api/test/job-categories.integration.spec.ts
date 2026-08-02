/**
 * Belize Connect job categories (M26.1 UX audit) — the public category pipeline
 * + idempotent baseline seed. The frontend/API/admin were already wired; the gap
 * was missing reference rows in production. These lock the fix.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, resetDb, seedRoles, seedJobCategories, BASELINE_JOB_CATEGORIES, type TestContext } from './helpers';

let ctx: TestContext;
const guest = (p: string) => request(ctx.server).get(`/api/${p}`);

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
});
afterAll(async () => { await ctx.app.close(); });

describe('job categories baseline + public exposure', () => {
  it('seeds the 20 baseline categories idempotently (no duplicates on re-run)', async () => {
    await seedJobCategories(ctx.prisma);
    const first = await ctx.prisma.jobCategory.count();
    expect(first).toBe(BASELINE_JOB_CATEGORIES.length);
    // second run must not duplicate
    await seedJobCategories(ctx.prisma);
    expect(await ctx.prisma.jobCategory.count()).toBe(first);
  });

  it('exposes visible categories publicly with human-readable labels, sorted', async () => {
    const res = await guest('jobs/categories');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
    expect(res.body.length).toBe(BASELINE_JOB_CATEGORIES.length);
    const slugs = res.body.map((c: { slug: string }) => c.slug);
    expect(slugs).toContain('healthcare');
    expect(slugs).toContain('information-technology');
    expect(slugs).toContain('other');
    const it0 = res.body.find((c: { slug: string }) => c.slug === 'information-technology');
    expect(it0.name).toBe('Information Technology'); // human-readable label, consistent
    // sorted by sortOrder (accounting-finance=10 first, other=200 last)
    expect(res.body[0].slug).toBe('accounting-finance');
    expect(res.body[res.body.length - 1].slug).toBe('other');
  });

  it('filters the public jobs list by category slug; clearing restores all', async () => {
    // seed one published job in "healthcare" via a minimal approved employer.
    const email = `emp_${Date.now()}@ex.bz`;
    const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'EmployerPass123', firstName: 'E', lastName: 'M', acceptedTerms: true });
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
    await ctx.prisma.userRole.create({ data: { userId: user.id, roleCode: 'EMPLOYER', status: 'APPROVED', approvedAt: new Date() } });
    const employer = await ctx.prisma.employerProfile.create({ data: { userId: user.id, companyName: 'Health Co', slug: `health-co-${Date.now()}`, contactEmail: email, approvalStatus: 'APPROVED' } });
    const healthcare = await ctx.prisma.jobCategory.findUniqueOrThrow({ where: { slug: 'healthcare' } });
    await ctx.prisma.jobListing.create({
      data: {
        employerProfileId: employer.id, jobCategoryId: healthcare.id, title: 'Nurse', slug: `nurse-${Date.now()}`,
        description: 'A caring nurse role in Belize City with a supportive team.',
        employmentType: 'FULL_TIME', district: 'BELIZE',
        status: 'PUBLISHED', publishedAt: new Date(),
      },
    });
    // filter by the matching category → 1 result
    const inCat = await guest('jobs?category=healthcare');
    expect(inCat.status).toBe(200);
    expect(inCat.body.items.some((j: { title: string }) => j.title === 'Nurse')).toBe(true);
    // a different category → none
    const otherCat = await guest('jobs?category=engineering');
    expect(otherCat.body.items.some((j: { title: string }) => j.title === 'Nurse')).toBe(false);
    // clearing the category restores it
    const all = await guest('jobs');
    expect(all.body.items.some((j: { title: string }) => j.title === 'Nurse')).toBe(true);
  });
});
