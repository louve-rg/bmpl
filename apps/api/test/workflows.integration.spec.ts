/**
 * Core platform workflows — integration against real PostgreSQL + MinIO.
 * Executes the full lifecycle end-to-end and the authorization/abuse matrix.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  bootApp,
  cookiesOf,
  putToPresigned,
  resetDb,
  seedLimitedAdmin,
  seedRoles,
  seedSuperAdmin,
  type TestContext,
} from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let vendorCookies: string[];
let vendorUserId: string;
let applicationId: string;
let documentId: string;
let documentKey: string;

const DOC_BYTES = Buffer.from('%PDF-1.4\nBMPL integration test document\n%%EOF');
const STORAGE_ENDPOINT = process.env.STORAGE_ENDPOINT ?? 'http://localhost:9000';
const STORAGE_BUCKET = process.env.STORAGE_BUCKET ?? 'bmpl-documents';

async function login(email: string, password: string): Promise<string[]> {
  const res = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}

async function registerCustomer(email: string, password = 'CustomerPass123'): Promise<string[]> {
  const res = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password, firstName: 'Test', lastName: 'User', acceptedTerms: true });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  adminCookies = await login(admin.email, admin.password);

  vendorCookies = await registerCustomer('wf_vendor@example.bz');
  const vendor = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'wf_vendor@example.bz' } });
  vendorUserId = vendor.id;
});
afterAll(async () => {
  await ctx.app.close();
});

describe('health & readiness', () => {
  it('liveness returns ok', async () => {
    const res = await request(ctx.server).get('/api/health');
    expect(res.status).toBe(200);
    expect(res.body.status).toBe('ok');
  });

  it('readiness confirms database, redis, and storage are reachable', async () => {
    const res = await request(ctx.server).get('/api/health/ready');
    expect(res.status).toBe(200);
    // storage is a tri-state: 'ok' when configured+reachable (MinIO in tests),
    // 'not_configured' when storage is intentionally disabled (optional).
    expect(res.body.checks).toEqual({ database: true, redis: true, storage: 'ok' });
  });
});

describe('role application + private storage', () => {
  it('rejects an unsupported document type at presign', async () => {
    const res = await request(ctx.server)
      .post('/api/roles/applications/VENDOR/documents/presign')
      .set('Cookie', vendorCookies)
      .send({ fileName: 'malware.exe', contentType: 'application/x-msdownload', sizeBytes: 1024 });
    expect(res.status).toBe(400);
  });

  it('rejects an oversized document at presign', async () => {
    const res = await request(ctx.server)
      .post('/api/roles/applications/VENDOR/documents/presign')
      .set('Cookie', vendorCookies)
      .send({ fileName: 'big.pdf', contentType: 'application/pdf', sizeBytes: 11 * 1024 * 1024 });
    expect(res.status).toBe(400);
  });

  it('presigns, uploads to MinIO, and submits with REAL stored metadata', async () => {
    const presign = await request(ctx.server)
      .post('/api/roles/applications/VENDOR/documents/presign')
      .set('Cookie', vendorCookies)
      .send({ fileName: 'trade-licence.pdf', contentType: 'application/pdf', sizeBytes: DOC_BYTES.length });
    expect(presign.status).toBe(201);
    documentKey = presign.body.key;

    const uploadStatus = await putToPresigned(presign.body.uploadUrl, DOC_BYTES, 'application/pdf');
    expect(uploadStatus).toBe(200);

    const submit = await request(ctx.server)
      .post('/api/roles/applications')
      .set('Cookie', vendorCookies)
      .send({ roleCode: 'VENDOR', documentKeys: [documentKey], message: 'Please review my shop.' });
    expect(submit.status).toBe(201);
    expect(submit.body.autoApproved).toBe(false);
    applicationId = submit.body.applicationId;

    // The DB stores the REAL content type + size read from the object, not 0/octet-stream.
    const doc = await ctx.prisma.roleApplicationDocument.findFirstOrThrow({
      where: { application: { id: applicationId } },
    });
    documentId = doc.id;
    expect(doc.contentType).toBe('application/pdf');
    expect(doc.sizeBytes).toBe(DOC_BYTES.length);
  });

  it('shows VENDOR as PENDING and not selectable in the role switcher', async () => {
    const me = await request(ctx.server).get('/api/me').set('Cookie', vendorCookies);
    const vendorRole = me.body.roles.find((r: { roleCode: string }) => r.roleCode === 'VENDOR');
    expect(vendorRole.status).toBe('PENDING');
    expect(vendorRole.isSelectable).toBe(false);
  });

  it('rejects a duplicate active VENDOR application', async () => {
    const res = await request(ctx.server)
      .post('/api/roles/applications')
      .set('Cookie', vendorCookies)
      .send({ roleCode: 'VENDOR', documentKeys: [] });
    expect(res.status).toBe(400);
  });

  it("rejects a document key from another user's namespace", async () => {
    const res = await request(ctx.server)
      .post('/api/roles/applications')
      .set('Cookie', vendorCookies)
      .send({
        roleCode: 'SHIPPING_PROVIDER',
        documentKeys: ['applications/someone-else/SHIPPING_PROVIDER/x/forged.pdf'],
      });
    expect(res.status).toBe(400);
  });
});

describe('administrator approval workflow', () => {
  it('lists the pending application in the queue', async () => {
    const res = await request(ctx.server)
      .get('/api/admin/applications?status=PENDING')
      .set('Cookie', adminCookies);
    expect(res.status).toBe(200);
    expect(res.body.some((a: { id: string }) => a.id === applicationId)).toBe(true);
  });

  it('serves a working signed document URL; the object is private otherwise', async () => {
    const signed = await request(ctx.server)
      .get(`/api/admin/documents/${documentId}/url`)
      .set('Cookie', adminCookies);
    expect(signed.status).toBe(200);
    expect(signed.body.url).toContain('X-Amz-Expires=300'); // short-lived

    // The signed URL works and returns the exact bytes.
    const viaSigned = await fetch(signed.body.url);
    expect(viaSigned.status).toBe(200);
    const bytes = Buffer.from(await viaSigned.arrayBuffer());
    expect(bytes.equals(DOC_BYTES)).toBe(true);

    // The same object without a signature is forbidden (private bucket).
    const unsigned = await fetch(`${STORAGE_ENDPOINT}/${STORAGE_BUCKET}/${documentKey}`);
    expect(unsigned.status).toBe(403);
  });

  it('forbids an ordinary customer from requesting a document URL', async () => {
    const res = await request(ctx.server)
      .get(`/api/admin/documents/${documentId}/url`)
      .set('Cookie', vendorCookies);
    expect(res.status).toBe(403);
  });

  it('requests more info → review record + customer notification', async () => {
    const res = await request(ctx.server)
      .post('/api/admin/applications/request-more-info')
      .set('Cookie', adminCookies)
      .send({ applicationId, message: 'Please upload a clearer licence.' });
    expect(res.status).toBe(201);

    const app = await ctx.prisma.roleApplication.findUniqueOrThrow({ where: { id: applicationId } });
    expect(app.status).toBe('MORE_INFO_REQUIRED');

    const notes = await request(ctx.server).get('/api/notifications').set('Cookie', vendorCookies);
    expect(notes.body.items.some((n: { type: string }) => n.type === 'ROLE_APPLICATION')).toBe(true);
  });

  it('lets the customer provide more info, then admin approves', async () => {
    const provide = await request(ctx.server)
      .post(`/api/roles/applications/${applicationId}/more-info`)
      .set('Cookie', vendorCookies)
      .send({ message: 'Re-uploaded a clearer copy.', documentKeys: [] });
    expect(provide.status).toBe(201);

    const approve = await request(ctx.server)
      .post('/api/admin/applications/approve')
      .set('Cookie', adminCookies)
      .send({ applicationId });
    expect(approve.status).toBe(201);

    const role = await ctx.prisma.userRole.findUniqueOrThrow({
      where: { userId_roleCode: { userId: vendorUserId, roleCode: 'VENDOR' } },
    });
    expect(role.status).toBe('APPROVED');
  });

  it('retains full approval history and writes an immutable audit record', async () => {
    const detail = await request(ctx.server)
      .get(`/api/admin/applications/${applicationId}`)
      .set('Cookie', adminCookies);
    const actions = detail.body.reviews.map((r: { action: string }) => r.action);
    expect(actions).toEqual(
      expect.arrayContaining(['SUBMITTED', 'MORE_INFO_REQUESTED', 'INFO_PROVIDED', 'APPROVED']),
    );

    const audit = await ctx.prisma.auditLog.findFirst({
      where: { action: 'ROLE_APPROVED', targetRole: 'VENDOR', targetUserId: vendorUserId },
    });
    expect(audit).toBeTruthy();

    // There is no API surface to delete/modify an audit entry.
    const del = await request(ctx.server)
      .delete(`/api/admin/audit/${audit!.id}`)
      .set('Cookie', adminCookies);
    expect(del.status).toBe(404);
  });
});

describe('role switching', () => {
  it('offers both CUSTOMER and VENDOR once approved', async () => {
    const me = await request(ctx.server).get('/api/me').set('Cookie', vendorCookies);
    const selectable = me.body.roles.filter((r: { isSelectable: boolean }) => r.isSelectable);
    expect(selectable.map((r: { roleCode: string }) => r.roleCode).sort()).toEqual(['CUSTOMER', 'VENDOR']);
  });

  it('switches to VENDOR and persists the active role', async () => {
    const sw = await request(ctx.server)
      .post('/api/roles/switch')
      .set('Cookie', vendorCookies)
      .send({ roleCode: 'VENDOR' });
    expect(sw.status).toBe(201);
    expect(sw.body.activeRole).toBe('VENDOR');
    const me = await request(ctx.server).get('/api/me').set('Cookie', vendorCookies);
    expect(me.body.activeRole).toBe('VENDOR');
  });

  it('suspends VENDOR → not selectable, active role falls back to CUSTOMER', async () => {
    const res = await request(ctx.server)
      .post('/api/admin/roles/suspend')
      .set('Cookie', adminCookies)
      .send({ userId: vendorUserId, roleCode: 'VENDOR', reason: 'Compliance review.' });
    expect(res.status).toBe(201);

    const me = await request(ctx.server).get('/api/me').set('Cookie', vendorCookies);
    const vendorRole = me.body.roles.find((r: { roleCode: string }) => r.roleCode === 'VENDOR');
    expect(vendorRole.isSelectable).toBe(false);
    expect(me.body.activeRole).toBe('CUSTOMER');

    const sw = await request(ctx.server)
      .post('/api/roles/switch')
      .set('Cookie', vendorCookies)
      .send({ roleCode: 'VENDOR' });
    expect(sw.status).toBe(403);
  });

  it('restores VENDOR → selectable again', async () => {
    await request(ctx.server)
      .post('/api/admin/roles/restore')
      .set('Cookie', adminCookies)
      .send({ userId: vendorUserId, roleCode: 'VENDOR' })
      .expect(201);
    const sw = await request(ctx.server)
      .post('/api/roles/switch')
      .set('Cookie', vendorCookies)
      .send({ roleCode: 'VENDOR' });
    expect(sw.status).toBe(201);
  });

  it('revokes VENDOR → cannot be activated via the API', async () => {
    await request(ctx.server)
      .post('/api/admin/roles/revoke')
      .set('Cookie', adminCookies)
      .send({ userId: vendorUserId, roleCode: 'VENDOR', reason: 'Terminated.' })
      .expect(201);
    const sw = await request(ctx.server)
      .post('/api/roles/switch')
      .set('Cookie', vendorCookies)
      .send({ roleCode: 'VENDOR' });
    expect(sw.status).toBe(403);
  });

  it('rejects an invalid enum and a not-held role', async () => {
    const invalid = await request(ctx.server)
      .post('/api/roles/switch')
      .set('Cookie', vendorCookies)
      .send({ roleCode: 'NOT_A_ROLE' });
    expect(invalid.status).toBe(400);

    const notHeld = await request(ctx.server)
      .post('/api/roles/switch')
      .set('Cookie', vendorCookies)
      .send({ roleCode: 'EMPLOYER' });
    expect(notHeld.status).toBe(404);
  });
});

describe('account suspension', () => {
  it('suspends an account → sessions revoked, login blocked, then restores', async () => {
    const cookies = await registerCustomer('wf_suspendee@example.bz');
    const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email: 'wf_suspendee@example.bz' } });

    // Works before suspension.
    await request(ctx.server).get('/api/me').set('Cookie', cookies).expect(200);

    await request(ctx.server)
      .post('/api/admin/users/suspend')
      .set('Cookie', adminCookies)
      .send({ userId: user.id, reason: 'Abuse report.' })
      .expect(201);

    // Existing session is revoked; new login is blocked.
    const after = await request(ctx.server).get('/api/me').set('Cookie', cookies);
    expect(after.status).toBe(401);
    const blocked = await request(ctx.server)
      .post('/api/auth/login')
      .send({ email: 'wf_suspendee@example.bz', password: 'CustomerPass123' });
    expect(blocked.status).toBe(401);

    await request(ctx.server)
      .post('/api/admin/users/restore')
      .set('Cookie', adminCookies)
      .send({ userId: user.id })
      .expect(201);
    const relogin = await request(ctx.server)
      .post('/api/auth/login')
      .send({ email: 'wf_suspendee@example.bz', password: 'CustomerPass123' });
    expect(relogin.status).toBe(201);

    const suspended = await ctx.prisma.auditLog.findFirst({
      where: { action: 'USER_SUSPENDED', targetUserId: user.id },
    });
    const restored = await ctx.prisma.auditLog.findFirst({
      where: { action: 'USER_RESTORED', targetUserId: user.id },
    });
    expect(suspended).toBeTruthy();
    expect(restored).toBeTruthy();
  });
});

describe('authorization & abuse', () => {
  it('forbids a customer from admin endpoints', async () => {
    await request(ctx.server).get('/api/admin/summary').set('Cookie', vendorCookies).expect(403);
  });

  it('forbids an unauthenticated request to a protected route', async () => {
    await request(ctx.server).get('/api/me').expect(401);
  });

  it('prevents an admin from approving their OWN application (no self-approval)', async () => {
    const admin = await ctx.prisma.user.findFirstOrThrow({ where: { email: 'it-admin@example.bz' } });
    // MARKETING_CLIENT requires a document, so upload one first (M12.1 enforcement).
    const presign = await request(ctx.server)
      .post('/api/roles/applications/MARKETING_CLIENT/documents/presign')
      .set('Cookie', adminCookies)
      .send({ fileName: 'biz-reg.pdf', contentType: 'application/pdf', sizeBytes: DOC_BYTES.length });
    expect(presign.status).toBe(201);
    expect(await putToPresigned(presign.body.uploadUrl, DOC_BYTES, 'application/pdf')).toBe(200);
    const submit = await request(ctx.server)
      .post('/api/roles/applications')
      .set('Cookie', adminCookies)
      .send({ roleCode: 'MARKETING_CLIENT', documentKeys: [presign.body.key] });
    expect(submit.status).toBe(201);
    const ownAppId = submit.body.applicationId;

    const approveSelf = await request(ctx.server)
      .post('/api/admin/applications/approve')
      .set('Cookie', adminCookies)
      .send({ applicationId: ownAppId });
    expect(approveSelf.status).toBe(403);
    expect(admin.id).toBeTruthy();
  });

  it('forbids an admin WITHOUT the review permission from approving', async () => {
    const limited = await seedLimitedAdmin(ctx.prisma, 'wf_limited@example.bz', ['users.read']);
    const limitedCookies = await login(limited.email, limited.password);
    // Reads allowed by users.read but application review is not.
    const approve = await request(ctx.server)
      .post('/api/admin/applications/approve')
      .set('Cookie', limitedCookies)
      .send({ applicationId });
    expect(approve.status).toBe(403);
  });

  it('enforces the CORS allow-list (rejects a disallowed origin)', async () => {
    const allowed = await request(ctx.server).get('/api/health').set('Origin', 'http://localhost:3000');
    expect(allowed.headers['access-control-allow-origin']).toBe('http://localhost:3000');

    const disallowed = await request(ctx.server).get('/api/health').set('Origin', 'http://evil.example.com');
    expect(disallowed.headers['access-control-allow-origin']).toBeUndefined();
  });
});
