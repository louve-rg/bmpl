/**
 * Belize Connect — the lifecycle corners the BMPL-141 audit named as untested
 * (BMPL-147): duplicate-job, the archive rules, the employer-suspend cascade,
 * withdraw-then-reapply, and the one RELIANCE the audit flagged rather than
 * re-audited — application conversations delegate authorization to
 * MessagingService.openJobApplication. That delegation is PINNED here by
 * behaviour: only the two parties of an application reach its thread, and an
 * outsider reads exactly like a missing record.
 *
 * A separate file from jobs.integration.spec.ts on purpose: #102 is appending
 * to that file in flight, and two open branches editing one spec file is a
 * merge conflict nobody needs.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const guest = (p: string) => request(ctx.server).get(`/api/${p}`);

async function login(email: string, password: string) {
  const r = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(r.status).toBe(201);
  return cookiesOf(r);
}

async function register(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  return { cookies: cookiesOf(reg), userId: (await ctx.prisma.user.findUniqueOrThrow({ where: { email } })).id };
}

async function makeEmployer() {
  const s = uniq();
  const u = await register(`emp_${s}@example.bz`);
  await ctx.prisma.userRole.create({ data: { userId: u.userId, roleCode: 'EMPLOYER', status: 'APPROVED', approvedAt: new Date() } });
  const cookies = await login(`emp_${s}@example.bz`, 'CustomerPass123');
  const prof = await request(ctx.server).put('/api/employer/profile').set('Cookie', cookies).send({ companyName: `Acme ${s}`, contactEmail: `hr${s}@acme.bz` });
  expect(prof.status).toBe(200);
  const profile = await ctx.prisma.employerProfile.findUniqueOrThrow({ where: { userId: u.userId } });
  return { cookies, userId: u.userId, profileId: profile.id };
}

/** Employer creates a job with one required question, submits; admin publishes. */
async function publishJob(emp: { cookies: string[] }) {
  const create = await post(emp.cookies, 'employer/jobs', {
    title: `Engineer ${uniq()}`, employmentType: 'FULL_TIME', description: 'Build things. '.repeat(5), workArrangement: 'ONSITE', district: 'BELIZE',
  });
  expect(create.status).toBe(201);
  const jobId = create.body.id as string;
  const q = await post(emp.cookies, `employer/jobs/${jobId}/questions`, { prompt: 'Why you?', type: 'SHORT_TEXT', required: true });
  expect(q.status).toBe(201);
  const questionId = q.body.questions[0].id as string;
  expect((await post(emp.cookies, `employer/jobs/${jobId}/submit`)).body.status).toBe('SUBMITTED');
  const mod = await post(adminCookies, `admin/jobs/${jobId}/moderate`, { action: 'APPROVE' });
  expect(mod.status).toBe(201);
  expect(mod.body.status).toBe('PUBLISHED');
  return { jobId, slug: create.body.slug as string, questionId };
}

/** A seeker who can apply (résumé is optional at submit and not the subject here). */
async function makeSeeker() {
  const s = uniq();
  const u = await register(`seek_${s}@example.bz`);
  await request(ctx.server).put('/api/job-seeker/profile').set('Cookie', u.cookies).send({ preferredName: `Seeker ${s}` });
  return u;
}

async function apply(seeker: { cookies: string[] }, jobId: string, questionId: string) {
  return post(seeker.cookies, 'job-seeker/applications', {
    jobId, answers: [{ questionId, text: 'Because I am great.' }],
  });
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);
});

afterAll(async () => {
  await ctx.app.close();
});

/* ------------------------------------------------------------------------- */

describe('listing lifecycle: duplicate and archive', () => {
  it('duplicate clones an owned listing into a fresh DRAFT — and a rival cannot clone it', async () => {
    const emp = await makeEmployer();
    const { jobId, slug } = await publishJob(emp);

    // The documented replacement for editing a published job: close and duplicate.
    const dup = await post(emp.cookies, `employer/jobs/${jobId}/duplicate`);
    expect(dup.status).toBe(201);
    expect(dup.body.status).toBe('DRAFT');
    expect(dup.body.title).toMatch(/\(copy\)$/);
    expect(dup.body.slug).not.toBe(slug);
    // The application questions travel with the copy.
    expect(dup.body.questions.map((q: { prompt: string }) => q.prompt)).toContain('Why you?');
    // A fresh draft is not public, whatever its parent was.
    expect((await guest(`jobs/${dup.body.slug}`)).status).toBe(404);
    // The original is untouched by the cloning.
    expect((await guest(`jobs/${slug}`)).status).toBe(200);

    // Cross-employer: someone else's listing reads exactly like a missing one.
    const rival = await makeEmployer();
    const foreign = await post(rival.cookies, `employer/jobs/${jobId}/duplicate`);
    const missing = await post(rival.cookies, 'employer/jobs/nonexistent00000000000000/duplicate');
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
  });

  it('archive refuses a live or in-review job, accepts a closed one, and takes it off the public site', async () => {
    const emp = await makeEmployer();
    const { jobId, slug } = await publishJob(emp);

    // Live: refused.
    const live = await post(emp.cookies, `employer/jobs/${jobId}/archive`);
    expect(live.status).toBe(400);
    expect(live.body.message).toContain('Close or wait');

    // In review: refused.
    const draft = await post(emp.cookies, 'employer/jobs', { title: `Pending ${uniq()}`, employmentType: 'PART_TIME', description: 'Pending review. '.repeat(4) });
    expect((await post(emp.cookies, `employer/jobs/${draft.body.id}/submit`)).body.status).toBe('SUBMITTED');
    expect((await post(emp.cookies, `employer/jobs/${draft.body.id}/archive`)).status).toBe(400);

    // Closed: archive lands, is stamped, and the job leaves the public site.
    expect((await post(emp.cookies, `employer/jobs/${jobId}/close`)).body.status).toBe('CLOSED');
    const archived = await post(emp.cookies, `employer/jobs/${jobId}/archive`);
    expect(archived.status).toBe(201);
    expect(archived.body.status).toBe('ARCHIVED');
    const row = await ctx.prisma.jobListing.findUniqueOrThrow({ where: { id: jobId } });
    expect(row.archivedAt).toBeTruthy();
    expect((await guest(`jobs/${slug}`)).status).toBe(404);
    const search = await guest('jobs');
    expect(search.body.items.some((j: { id: string }) => j.id === jobId)).toBe(false);

    // The grave is final for self-service: an archived job cannot be resubmitted.
    expect((await post(emp.cookies, `employer/jobs/${jobId}/submit`)).status).toBe(400);
  });
});

describe('employer suspension cascade', () => {
  it('suspending an employer takes their live jobs down — and restoring does NOT silently resurrect them', async () => {
    const emp = await makeEmployer();
    const { jobId, slug } = await publishJob(emp);
    const draft = await post(emp.cookies, 'employer/jobs', { title: `Backlog ${uniq()}`, employmentType: 'CONTRACT', description: 'Not yet submitted. '.repeat(4) });
    expect(draft.status).toBe(201);

    const suspended = await post(adminCookies, `admin/jobs/employers/${emp.profileId}/suspend`, { reason: 'UAT: cascade check' });
    expect(suspended.status).toBe(201);
    expect(suspended.body.approvalStatus).toBe('SUSPENDED');

    // The live listing is off the air; the draft is left alone.
    expect((await ctx.prisma.jobListing.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('SUSPENDED');
    expect((await ctx.prisma.jobListing.findUniqueOrThrow({ where: { id: draft.body.id } })).status).toBe('DRAFT');
    expect((await guest(`jobs/${slug}`)).status).toBe(404);
    const search = await guest('jobs');
    expect(search.body.items.some((j: { id: string }) => j.id === jobId)).toBe(false);

    // A suspended employer cannot push new work into review.
    const blocked = await post(emp.cookies, `employer/jobs/${draft.body.id}/submit`);
    expect(blocked.status).toBe(403);
    expect(blocked.body.message).toContain('suspended');

    // Restore reopens the account, not the listings: what was taken down STAYS
    // down until someone deliberately republishes it. This is the coded design
    // (setApproval cascades only on SUSPENDED) — pinned so a future "restore"
    // cannot start silently resurrecting public jobs nobody re-reviewed.
    expect((await post(adminCookies, `admin/jobs/employers/${emp.profileId}/restore`)).status).toBe(201);
    expect((await ctx.prisma.jobListing.findUniqueOrThrow({ where: { id: jobId } })).status).toBe('SUSPENDED');
    expect((await guest(`jobs/${slug}`)).status).toBe(404);
  });
});

describe('withdraw, then reapply', () => {
  it('a withdrawn application frees the slot: the reapplication is a NEW record and the old one stays withdrawn', async () => {
    const emp = await makeEmployer();
    const { jobId, questionId } = await publishJob(emp);
    const seeker = await makeSeeker();

    const first = await apply(seeker, jobId, questionId);
    expect(first.status).toBe(201);
    // The duplicate guard holds while the first application is active.
    expect((await apply(seeker, jobId, questionId)).status).toBe(400);

    expect((await post(seeker.cookies, `job-seeker/applications/${first.body.id}/withdraw`)).status).toBe(201);

    // Withdrawn frees the slot — and the reapplication is a fresh record.
    const second = await apply(seeker, jobId, questionId);
    expect(second.status).toBe(201);
    expect(second.body.id).not.toBe(first.body.id);
    expect(second.body.status).toBe('SUBMITTED');

    // The history is both rows, not a resurrected one.
    const mine = await get(seeker.cookies, 'job-seeker/applications');
    const statuses = new Map(mine.body.map((a: { id: string; status: string }) => [a.id, a.status]));
    expect(statuses.get(first.body.id)).toBe('WITHDRAWN');
    expect(statuses.get(second.body.id)).toBe('SUBMITTED');

    // The employer works the new application; the pipeline is live again.
    expect((await get(emp.cookies, `employer/applications/${second.body.id}`)).status).toBe(200);
  });
});

describe('application conversations: the MessagingService reliance, pinned', () => {
  it('only the two parties reach the thread; an outsider reads exactly like a missing record', async () => {
    const emp = await makeEmployer();
    const { jobId, questionId } = await publishJob(emp);
    const seeker = await makeSeeker();
    const applied = await apply(seeker, jobId, questionId);
    expect(applied.status).toBe(201);
    const appId = applied.body.id as string;

    // Both parties open the SAME thread.
    const seekerOpen = await post(seeker.cookies, `job-seeker/applications/${appId}/conversation`);
    expect(seekerOpen.status).toBe(201);
    const convId = seekerOpen.body.id as string;
    const employerOpen = await post(emp.cookies, `employer/applications/${appId}/conversation`);
    expect(employerOpen.status).toBe(201);
    expect(employerOpen.body.id).toBe(convId);

    // A message with a sentinel travels between them.
    expect((await post(seeker.cookies, `conversations/${convId}/messages`, { body: 'CONVSENTINEL my references are attached' })).status).toBe(201);
    expect(JSON.stringify((await get(emp.cookies, `conversations/${convId}`)).body)).toContain('CONVSENTINEL');

    // A rival employer cannot OPEN it via the application…
    const rivalEmployer = await makeEmployer();
    const foreignOpen = await post(rivalEmployer.cookies, `employer/applications/${appId}/conversation`);
    const missingOpen = await post(rivalEmployer.cookies, 'employer/applications/nonexistent00000000000000/conversation');
    expect(foreignOpen.status).toBe(404);
    expect(missingOpen.status).toBe(404);
    expect(foreignOpen.body).toEqual(missingOpen.body);

    // …nor READ or WRITE the conversation itself, and the refusal is
    // indistinguishable from the conversation not existing.
    const foreignRead = await get(rivalEmployer.cookies, `conversations/${convId}`);
    const missingRead = await get(rivalEmployer.cookies, 'conversations/nonexistent00000000000000');
    expect(foreignRead.status).toBe(404);
    expect(missingRead.status).toBe(404);
    expect(foreignRead.body).toEqual(missingRead.body);
    expect(JSON.stringify(foreignRead.body)).not.toContain('CONVSENTINEL');
    expect((await post(rivalEmployer.cookies, `conversations/${convId}/messages`, { body: 'let me in' })).status).toBe(404);

    // Another SEEKER cannot reach it either — not via the application, not directly.
    const otherSeeker = await makeSeeker();
    const seekerForeign = await post(otherSeeker.cookies, `job-seeker/applications/${appId}/conversation`);
    const seekerMissing = await post(otherSeeker.cookies, 'job-seeker/applications/nonexistent00000000000000/conversation');
    expect(seekerForeign.status).toBe(404);
    expect(seekerMissing.status).toBe(404);
    expect(seekerForeign.body).toEqual(seekerMissing.body);
    expect((await get(otherSeeker.cookies, `conversations/${convId}`)).status).toBe(404);
  });
});
