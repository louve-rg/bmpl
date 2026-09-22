/**
 * Belize Connect — Jobs & Employment (Phase 5 · M24) — integration + security vs real
 * Postgres + MinIO. Covers the full vertical: employer/company profile, job seeker
 * profile + private résumé, job authoring → moderation → publish → public search,
 * application submission (required questions + snapshots + duplicate/deadline/closed
 * rules + résumé ownership), the employer pipeline (validated transitions, events,
 * private notes, résumé access, cross-employer isolation), interviews, withdraw, and
 * the security invariants (guest denial, IDOR, admin gating, no marketplace side effects).
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, putToPresigned, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const PDF = Buffer.from('%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF');

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object | string = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object | string = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);
const guest = (p: string) => request(ctx.server).get(`/api/${p}`);

async function login(email: string, password: string) {
  const r = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(r.status).toBe(201);
  return cookiesOf(r);
}
async function register(email: string) {
  const reg = await request(ctx.server).post('/api/auth/register').send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
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
  return { cookies, userId: u.userId };
}
/** Employer creates a job, adds a required question, submits; admin approves → PUBLISHED. */
async function publishJob(emp: { cookies: string[] }, opts: { deadline?: Date } = {}) {
  const create = await post(emp.cookies, 'employer/jobs', { title: `Engineer ${uniq()}`, employmentType: 'FULL_TIME', description: 'Build things. '.repeat(5), workArrangement: 'ONSITE', district: 'BELIZE', ...(opts.deadline ? { applicationDeadline: opts.deadline.toISOString() } : {}) });
  expect(create.status).toBe(201);
  const jobId = create.body.id;
  const q = await post(emp.cookies, `employer/jobs/${jobId}/questions`, { prompt: 'Why you?', type: 'SHORT_TEXT', required: true });
  expect(q.status).toBe(201);
  const questionId = q.body.questions[0].id;
  expect((await post(emp.cookies, `employer/jobs/${jobId}/submit`)).body.status).toBe('SUBMITTED');
  const mod = await post(adminCookies, `admin/jobs/${jobId}/moderate`, { action: 'APPROVE' });
  expect(mod.status).toBe(201);
  expect(mod.body.status).toBe('PUBLISHED');
  return { jobId, slug: create.body.slug, questionId };
}
async function makeSeekerWithResume() {
  const s = uniq();
  const u = await register(`seek_${s}@example.bz`);
  await request(ctx.server).put('/api/job-seeker/profile').set('Cookie', u.cookies).send({ preferredName: `Seeker ${s}` });
  const pre = await post(u.cookies, 'job-seeker/resumes/presign', { fileName: 'cv.pdf', contentType: 'application/pdf', sizeBytes: PDF.length });
  expect(pre.status).toBe(201);
  expect(await putToPresigned(pre.body.uploadUrl, PDF, 'application/pdf')).toBe(200);
  const conf = await post(u.cookies, 'job-seeker/resumes', { storageKey: pre.body.key, label: 'My CV' });
  expect(conf.status).toBe(201);
  return { ...u, resumeId: conf.body.resumes[0].id };
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

describe('employer + job lifecycle + public', () => {
  it('publishes a job through moderation and exposes it publicly; unapproved employer is denied', async () => {
    const emp = await makeEmployer();
    const { jobId, slug } = await publishJob(emp);
    // public detail + search
    const detail = await guest(`jobs/${slug}`);
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe('PUBLISHED');
    expect(detail.body.companyProfile).toBeTruthy();
    const search = await guest('jobs');
    expect(search.body.items.some((j: { id: string }) => j.id === jobId)).toBe(true);
    // a plain customer (no EMPLOYER role) cannot author jobs
    const cust = await register(`c_${uniq()}@example.bz`);
    expect((await post(cust.cookies, 'employer/jobs', { title: 'x', employmentType: 'FULL_TIME', description: 'x'.repeat(30) })).status).toBe(403);
    // draft never appears publicly
    const draft = await post(emp.cookies, 'employer/jobs', { title: `Draft ${uniq()}`, employmentType: 'PART_TIME', description: 'secret '.repeat(6) });
    expect((await guest(`jobs/${draft.body.slug}`)).status).toBe(404);
  });

  it('rejects moderation bypass + enforces cross-employer isolation', async () => {
    const empA = await makeEmployer();
    const empB = await makeEmployer();
    const { jobId } = await publishJob(empA);
    // employer B cannot see or mutate employer A's job
    expect((await get(empB.cookies, `employer/jobs/${jobId}`)).status).toBe(404);
    expect((await post(empB.cookies, `employer/jobs/${jobId}/close`)).status).toBe(404);
    // employer cannot self-approve via the admin route (no permission)
    expect((await post(empA.cookies, `admin/jobs/${jobId}/moderate`, { action: 'SUSPEND' })).status).toBe(403);
  });
});

describe('applications: submit rules + pipeline + privacy', () => {
  it('enforces guest denial, required questions, résumé ownership, and duplicate prevention', async () => {
    const emp = await makeEmployer();
    const { jobId, questionId } = await publishJob(emp);
    const seeker = await makeSeekerWithResume();

    // guest cannot apply
    expect((await request(ctx.server).post('/api/job-seeker/applications').send({ jobId })).status).toBe(401);
    // missing required answer → 400
    expect((await post(seeker.cookies, 'job-seeker/applications', { jobId, resumeId: seeker.resumeId })).status).toBe(400);
    // résumé belonging to someone else → 400
    const other = await makeSeekerWithResume();
    expect((await post(seeker.cookies, 'job-seeker/applications', { jobId, resumeId: other.resumeId, answers: [{ questionId, text: 'hi' }] })).status).toBe(400);
    // valid submission
    const ok = await post(seeker.cookies, 'job-seeker/applications', { jobId, resumeId: seeker.resumeId, answers: [{ questionId, text: 'Because I am great.' }] });
    expect(ok.status).toBe(201);
    expect(ok.body.status).toBe('SUBMITTED');
    expect(ok.body.answers[0]).toMatchObject({ prompt: 'Why you?', text: 'Because I am great.' }); // snapshot
    // duplicate active application → 400
    expect((await post(seeker.cookies, 'job-seeker/applications', { jobId, resumeId: seeker.resumeId, answers: [{ questionId, text: 'again' }] })).status).toBe(400);
  });

  it('runs the pipeline with validated transitions, private notes, résumé access + isolation, and notifies the applicant', async () => {
    const emp = await makeEmployer();
    const other = await makeEmployer();
    const { jobId, questionId } = await publishJob(emp);
    const seeker = await makeSeekerWithResume();
    const appId = (await post(seeker.cookies, 'job-seeker/applications', { jobId, resumeId: seeker.resumeId, answers: [{ questionId, text: 'pick me' }] })).body.id;

    // employer sees only their own applicants
    expect((await get(emp.cookies, 'employer/applications')).body.some((a: { id: string }) => a.id === appId)).toBe(true);
    expect((await get(other.cookies, `employer/applications/${appId}`)).status).toBe(404);
    // résumé access: owning employer yes, other employer no
    expect((await get(emp.cookies, `employer/applications/${appId}/resume-url`)).body.url).toContain('http');
    expect((await get(other.cookies, `employer/applications/${appId}/resume-url`)).status).toBe(404);
    // invalid transition rejected (SUBMITTED → HIRED)
    expect((await post(emp.cookies, `employer/applications/${appId}/status`, { status: 'HIRED' })).status).toBe(400);
    // valid pipeline: SHORTLISTED, then interview, then offer, then hired
    expect((await post(emp.cookies, `employer/applications/${appId}/status`, { status: 'SHORTLISTED' })).body.status).toBe('SHORTLISTED');
    await post(emp.cookies, `employer/applications/${appId}/notes`, { note: 'Strong candidate — internal only' });
    const sched = await post(emp.cookies, `employer/applications/${appId}/interviews`, { scheduledAt: new Date(Date.now() + 86400000).toISOString(), mode: 'VIDEO', location: 'https://meet.example/x' });
    expect(sched.body.status).toBe('INTERVIEW_SCHEDULED');
    expect((await post(emp.cookies, `employer/applications/${appId}/status`, { status: 'OFFER_EXTENDED' })).body.status).toBe('OFFER_EXTENDED');
    expect((await post(emp.cookies, `employer/applications/${appId}/status`, { status: 'HIRED' })).body.status).toBe('HIRED');

    // applicant view: sees status + timeline + interview, NEVER the private employer note
    const mine = await get(seeker.cookies, `job-seeker/applications/${appId}`);
    expect(mine.body.status).toBe('HIRED');
    expect(mine.body.employerNotes).toBeUndefined();
    expect(JSON.stringify(mine.body)).not.toContain('internal only');
    expect(mine.body.timeline.length).toBeGreaterThanOrEqual(4);
    expect(mine.body.interviews.length).toBe(1);
    // applicant was notified (JOB category notifications exist)
    const notes = await get(seeker.cookies, 'notifications?category=JOB');
    expect(notes.body.items.length).toBeGreaterThan(0);
    // employer↔applicant conversation is context-scoped and openable by both
    expect((await post(seeker.cookies, `job-seeker/applications/${appId}/conversation`)).status).toBe(201);
    expect((await post(emp.cookies, `employer/applications/${appId}/conversation`)).status).toBe(201);
  });

  it('blocks applications to closed/expired jobs and supports withdraw', async () => {
    const emp = await makeEmployer();
    // expired job
    const expired = await publishJob(emp, { deadline: new Date(Date.now() - 86400000) });
    const seeker = await makeSeekerWithResume();
    expect((await post(seeker.cookies, 'job-seeker/applications', { jobId: expired.jobId, resumeId: seeker.resumeId, answers: [{ questionId: expired.questionId, text: 'x' }] })).status).toBe(400);
    // closed job
    const open = await publishJob(emp);
    const appId = (await post(seeker.cookies, 'job-seeker/applications', { jobId: open.jobId, resumeId: seeker.resumeId, answers: [{ questionId: open.questionId, text: 'x' }] })).body.id;
    // withdraw, then re-apply is allowed (documented policy)
    expect((await post(seeker.cookies, `job-seeker/applications/${appId}/withdraw`)).body.status).toBe('WITHDRAWN');
    expect((await post(seeker.cookies, 'job-seeker/applications', { jobId: open.jobId, resumeId: seeker.resumeId, answers: [{ questionId: open.questionId, text: 'retry' }] })).status).toBe(201);
    // once closed, no new applications
    await post(emp.cookies, `employer/jobs/${open.jobId}/close`);
    const seeker2 = await makeSeekerWithResume();
    expect((await post(seeker2.cookies, 'job-seeker/applications', { jobId: open.jobId, resumeId: seeker2.resumeId, answers: [{ questionId: open.questionId, text: 'x' }] })).status).toBe(404);
  });
});

describe('résumé privacy + saved jobs + admin gating', () => {
  it('keeps résumés private (owner signed URL; no public field) and supports saved jobs', async () => {
    const emp = await makeEmployer();
    const { jobId, slug } = await publishJob(emp);
    const seeker = await makeSeekerWithResume();
    // owner gets a signed URL; the public job detail never exposes résumé/storage keys
    expect((await get(seeker.cookies, `job-seeker/resumes/${seeker.resumeId}/url`)).body.url).toContain('http');
    expect(JSON.stringify((await guest(`jobs/${slug}`)).body)).not.toContain('jobs/resumes/');
    // save / list / unsave
    expect((await post(seeker.cookies, `job-seeker/saved/${jobId}`)).body).toEqual({ saved: true });
    expect((await get(seeker.cookies, 'job-seeker/saved')).body.items.length).toBe(1);
    expect((await get(seeker.cookies, 'job-seeker/saved/ids')).body.jobIds).toContain(jobId);
    expect((await request(ctx.server).post(`/api/job-seeker/saved/${jobId}`)).status).toBe(401); // guest
  });

  it('gates admin moderation + reports behind permissions', async () => {
    const emp = await makeEmployer();
    const { jobId } = await publishJob(emp);
    const cust = await register(`c_${uniq()}@example.bz`);
    // report a job (any authed user)
    expect((await post(cust.cookies, `job-seeker/report/${jobId}`, { reason: 'SCAM' })).status).toBe(201);
    // customer cannot reach admin moderation
    expect((await get(cust.cookies, 'admin/jobs')).status).toBe(403);
    expect((await get(cust.cookies, 'admin/jobs/reports')).status).toBe(403);
    // admin sees the report + moderation list
    expect((await get(adminCookies, 'admin/jobs/reports')).body.some((r: { jobId: string }) => r.jobId === jobId)).toBe(true);
    expect((await get(adminCookies, 'admin/jobs?reported=true')).body.some((j: { id: string }) => j.id === jobId)).toBe(true);
    expect((await get(adminCookies, 'admin/jobs/analytics')).status).toBe(200);
  });
});

/**
 * Interviews: the least-tested corner of the vertical (BMPL-141 follow-up).
 *
 * Two decided facts are PINNED here so nobody later "fixes" them server-side:
 * the orchestrator ruled (2026-09-22) that interview notes and status-change
 * notes ARE candidate-visible — the private channel is employerNotes, and only
 * employerNotes. And the interview PATCH carries the one ownership check in
 * the module that does not go through ownedApplication; until now nothing
 * proved it refuses a foreign employer.
 */
describe('interviews: ownership, and which notes the candidate sees', () => {
  /** Employer + published job + a submitted application from a fresh seeker. */
  async function applied() {
    const emp = await makeEmployer();
    const { jobId, questionId } = await publishJob(emp);
    const seeker = await makeSeekerWithResume();
    const ok = await post(seeker.cookies, 'job-seeker/applications', {
      jobId, resumeId: seeker.resumeId, answers: [{ questionId, text: 'Because I am great.' }],
    });
    expect(ok.status).toBe(201);
    return { emp, seeker, appId: ok.body.id as string };
  }

  it('a foreign employer updating an interview reads exactly like a missing one', async () => {
    const { emp, appId } = await applied();
    const sched = await post(emp.cookies, `employer/applications/${appId}/interviews`, {
      scheduledAt: new Date(Date.now() + 86400000).toISOString(), mode: 'VIDEO', location: 'https://meet.example/x',
    });
    expect(sched.status).toBe(201);
    const interviewId = sched.body.interviews[0].id;

    const rival = await makeEmployer();
    const foreign = await patch(rival.cookies, `employer/interviews/${interviewId}`, { status: 'CANCELLED' });
    const missing = await patch(rival.cookies, 'employer/interviews/nonexistent00000000000000', { status: 'CANCELLED' });
    expect(foreign.status).toBe(404);
    expect(missing.status).toBe(404);
    expect(foreign.body).toEqual(missing.body);
    // And the probe changed nothing.
    const row = await ctx.prisma.jobInterview.findUniqueOrThrow({ where: { id: interviewId } });
    expect(row.status).not.toBe('CANCELLED');
  });

  it('the candidate sees interview notes and status notes — and never employerNotes', async () => {
    const { emp, seeker, appId } = await applied();
    // The three note channels, with distinguishable sentinels.
    expect((await post(emp.cookies, `employer/applications/${appId}/status`, {
      status: 'UNDER_REVIEW', note: 'STATUSNOTE-VISIBLE-SENTINEL',
    })).status).toBe(201);
    expect((await post(emp.cookies, `employer/applications/${appId}/interviews`, {
      scheduledAt: new Date(Date.now() + 86400000).toISOString(), mode: 'IN_PERSON', location: 'Front desk',
      notes: 'IVNOTE-VISIBLE-SENTINEL bring two forms of ID',
    })).status).toBe(201);
    expect((await post(emp.cookies, `employer/applications/${appId}/notes`, {
      note: 'EMPLOYERNOTE-PRIVATE-SENTINEL weak references',
    })).status).toBe(201);

    const mine = await get(seeker.cookies, `job-seeker/applications/${appId}`);
    expect(mine.status).toBe(200);
    const raw = JSON.stringify(mine.body);
    // Ruled candidate-visible: the interview note and the status-change note.
    expect(raw).toContain('IVNOTE-VISIBLE-SENTINEL');
    expect(raw).toContain('STATUSNOTE-VISIBLE-SENTINEL');
    // The one private channel stays private — not under any key, anywhere.
    expect(raw).not.toContain('EMPLOYERNOTE-PRIVATE-SENTINEL');

    // The employer's own view still carries it.
    const theirs = await get(emp.cookies, `employer/applications/${appId}`);
    expect(JSON.stringify(theirs.body)).toContain('EMPLOYERNOTE-PRIVATE-SENTINEL');
  });

  it('the owner reschedules and cancels, and the candidate sees the outcome', async () => {
    const { emp, seeker, appId } = await applied();
    const sched = await post(emp.cookies, `employer/applications/${appId}/interviews`, {
      scheduledAt: new Date(Date.now() + 86400000).toISOString(), mode: 'VIDEO', location: 'https://meet.example/x',
    });
    expect(sched.status).toBe(201);
    const interviewId = sched.body.interviews[0].id;

    // Reschedule: a new time flips the status without it being spelled out.
    const newTime = new Date(Date.now() + 2 * 86400000).toISOString();
    const moved = await patch(emp.cookies, `employer/interviews/${interviewId}`, { scheduledAt: newTime });
    expect(moved.status).toBe(200);
    expect(moved.body.interviews.find((iv: { id: string }) => iv.id === interviewId).status).toBe('RESCHEDULED');

    // Cancel: an explicit status the candidate's view reflects.
    expect((await patch(emp.cookies, `employer/interviews/${interviewId}`, { status: 'CANCELLED' })).status).toBe(200);
    const mine = await get(seeker.cookies, `job-seeker/applications/${appId}`);
    expect(mine.body.interviews.find((iv: { id: string }) => iv.id === interviewId).status).toBe('CANCELLED');
  });
});
