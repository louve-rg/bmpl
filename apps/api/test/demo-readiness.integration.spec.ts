/**
 * Marketplace Client Demo Readiness (M12.1) — backend enforcement matrix.
 *
 * These tests lock the hard demo rule: NO ONE MAY PLACE AN ORDER WITHOUT LOGGING
 * INTO A CUSTOMER ACCOUNT — enforced at the API layer, independent of the
 * frontend. They assert, against real Postgres + MinIO:
 *   1. Guests may browse the PUBLIC marketplace (products, categories, detail).
 *   2. Guests are rejected (401) from every cart / checkout / order / payment /
 *      wallet endpoint — they cannot buy without authenticating.
 *   3. An authenticated customer WITHOUT the VENDOR role is refused (403) from
 *      vendor-only endpoints (right auth, wrong role).
 *   4. The VENDOR role application enforces its document requirement (400 when
 *      submitted with no documents) and accepts a real uploaded document.
 *   5. A customer can respond to MORE_INFO_REQUIRED and resubmit for review.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import {
  bootApp,
  cookiesOf,
  putToPresigned,
  resetDb,
  seedRoles,
  seedSuperAdmin,
  type TestContext,
} from './helpers';

let ctx: TestContext;
let adminCookies: string[];

const DOC_BYTES = Buffer.from('%PDF-1.4\nBMPL demo-readiness ID document\n%%EOF');

async function login(email: string, password: string): Promise<string[]> {
  const res = await request(ctx.server).post('/api/auth/login').send({ email, password });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}

async function registerCustomer(email: string, password = 'CustomerPass123'): Promise<string[]> {
  const res = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password, firstName: 'Demo', lastName: 'Customer', acceptedTerms: true });
  expect(res.status).toBe(201);
  return cookiesOf(res);
}

/** Presign → PUT to MinIO → return the stored key (what the web UI does). */
async function uploadVendorDoc(cookies: string[], fileName = 'gov-id.pdf'): Promise<string> {
  const presign = await request(ctx.server)
    .post('/api/roles/applications/VENDOR/documents/presign')
    .set('Cookie', cookies)
    .send({ fileName, contentType: 'application/pdf', sizeBytes: DOC_BYTES.length });
  expect(presign.status).toBe(201);
  const put = await putToPresigned(presign.body.uploadUrl, DOC_BYTES, 'application/pdf');
  expect(put).toBe(200);
  return presign.body.key as string;
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

describe('guests may browse the public marketplace', () => {
  it('lists products without authentication', async () => {
    const res = await request(ctx.server).get('/api/marketplace/products');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body.items)).toBe(true);
  });

  it('lists categories without authentication', async () => {
    const res = await request(ctx.server).get('/api/marketplace/categories');
    expect(res.status).toBe(200);
    expect(Array.isArray(res.body)).toBe(true);
  });
});

describe('guests cannot buy — every purchase endpoint requires authentication', () => {
  // The core demo rule, enforced at the API and independent of the UI. A guest
  // (no cookies) must get 401 from anything that would let them place an order.
  const guestBlocked: Array<[string, string, Record<string, unknown>?]> = [
    ['GET', '/api/cart'],
    ['POST', '/api/cart/items', { productId: 'x', quantity: 1 }],
    ['DELETE', '/api/cart'],
    ['POST', '/api/checkout', { vendors: [] }],
    ['GET', '/api/orders'],
    ['GET', '/api/payments'],
    ['GET', '/api/wallet/transactions/anything'],
    ['GET', '/api/me'],
    ['GET', '/api/roles/applications'],
  ];

  it.each(guestBlocked)('%s %s → 401 for a guest', async (method, path, body) => {
    const req = request(ctx.server)[method.toLowerCase() as 'get'](path);
    const res = await (body ? req.send(body) : req);
    expect(res.status).toBe(401);
  });
});

describe('authenticated customer without VENDOR role is refused vendor endpoints (403)', () => {
  let customer: string[];

  beforeAll(async () => {
    customer = await registerCustomer('demo_customer_only@example.bz');
  });

  const vendorOnly: Array<[string, string, Record<string, unknown>?]> = [
    ['GET', '/api/vendor/profile'],
    ['POST', '/api/vendor/products', { title: 'x', categoryId: 'x', priceMinor: 100 }],
    ['GET', '/api/vendor/products'],
  ];

  it.each(vendorOnly)('%s %s → 403 for a plain customer', async (method, path, body) => {
    const req = request(ctx.server)[method.toLowerCase() as 'get'](path).set('Cookie', customer);
    const res = await (body ? req.send(body) : req);
    expect(res.status).toBe(403);
  });

  it('a plain customer CAN reach customer endpoints (cart) — 200', async () => {
    const res = await request(ctx.server).get('/api/cart').set('Cookie', customer);
    expect(res.status).toBe(200);
  });
});

describe('VENDOR application enforces its document requirement', () => {
  let customer: string[];

  beforeAll(async () => {
    customer = await registerCustomer('demo_vendor_applicant@example.bz');
  });

  it('rejects a VENDOR application submitted with NO documents (400)', async () => {
    const res = await request(ctx.server)
      .post('/api/roles/applications')
      .set('Cookie', customer)
      .send({ roleCode: 'VENDOR', documentKeys: [] });
    expect(res.status).toBe(400);
  });

  it('accepts a VENDOR application with a real uploaded document (201, pending review)', async () => {
    const key = await uploadVendorDoc(customer);
    const res = await request(ctx.server)
      .post('/api/roles/applications')
      .set('Cookie', customer)
      .send({ roleCode: 'VENDOR', documentKeys: [key], message: 'Please review my shop.' });
    expect(res.status).toBe(201);
    expect(res.body.autoApproved).toBe(false);

    const me = await request(ctx.server).get('/api/me').set('Cookie', customer);
    const vendorRole = me.body.roles.find((r: { roleCode: string }) => r.roleCode === 'VENDOR');
    expect(vendorRole.status).toBe('PENDING');
    expect(vendorRole.isSelectable).toBe(false); // pending role is NOT switchable
  });
});

describe('customer can respond to a request for more information and resubmit', () => {
  it('applicant resubmits after MORE_INFO_REQUIRED and returns to PENDING', async () => {
    const customer = await registerCustomer('demo_moreinfo@example.bz');
    const key = await uploadVendorDoc(customer);
    const submit = await request(ctx.server)
      .post('/api/roles/applications')
      .set('Cookie', customer)
      .send({ roleCode: 'VENDOR', documentKeys: [key] });
    expect(submit.status).toBe(201);
    const applicationId = submit.body.applicationId as string;

    // Admin requests more information.
    const moreInfo = await request(ctx.server)
      .post('/api/admin/applications/request-more-info')
      .set('Cookie', adminCookies)
      .send({ applicationId, message: 'Please upload a clearer copy of your ID.' });
    expect(moreInfo.status).toBe(201);

    // Applicant sees the request and the reviewer note on their application.
    const apps = await request(ctx.server).get('/api/roles/applications').set('Cookie', customer);
    const app = apps.body.find((a: { id: string }) => a.id === applicationId);
    expect(app.status).toBe('MORE_INFO_REQUIRED');

    // Applicant resubmits with a fresh document → back to PENDING.
    const newKey = await uploadVendorDoc(customer, 'gov-id-clear.pdf');
    const resubmit = await request(ctx.server)
      .post(`/api/roles/applications/${applicationId}/more-info`)
      .set('Cookie', customer)
      .send({ message: 'Uploaded a clearer copy.', documentKeys: [newKey] });
    expect(resubmit.status).toBe(201);

    const after = await request(ctx.server).get('/api/roles/applications').set('Cookie', customer);
    const updated = after.body.find((a: { id: string }) => a.id === applicationId);
    expect(updated.status).toBe('PENDING');
  });
});
