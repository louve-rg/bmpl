/**
 * Real Estate (Phase 6 · M25) — integration + security vs real Postgres + MinIO.
 * Covers owner/agent profiles, listing lifecycle → moderation → publish → public,
 * LOCATION PRIVACY (exact address never public), private documents (signed URL +
 * isolation), image round-trip, agent assignment/accept, seeker save/enquiry/viewing,
 * viewing-status machine, cross-owner/agent isolation, admin gating, and guest denial.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { bootApp, cookiesOf, putToPresigned, resetDb, seedLimitedAdmin, seedRoles, seedSuperAdmin, type TestContext } from './helpers';
import request from 'supertest';

let ctx: TestContext;
let admin: string[];
let seq = 0;
const uniq = () => `${Date.now()}_${(seq += 1)}`;
const PNG = Buffer.from('89504e470d0a1a0a0000000d49484452', 'hex');
const PDF = Buffer.from('%PDF-1.4 test');

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object | string = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object | string = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);
const put = (c: string[], p: string, b: object | string = {}) => request(ctx.server).put(`/api/${p}`).set('Cookie', c).send(b);
const guest = (p: string) => request(ctx.server).get(`/api/${p}`);

async function login(email: string, pw: string) { const r = await request(ctx.server).post('/api/auth/login').send({ email, password: pw }); expect(r.status).toBe(201); return cookiesOf(r); }
async function register(email: string) {
  const r = await request(ctx.server).post('/api/auth/register').send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(r.status).toBe(201);
  return { cookies: cookiesOf(r), userId: (await ctx.prisma.user.findUniqueOrThrow({ where: { email } })).id };
}
async function makeOwner() {
  const s = uniq(); const u = await register(`own_${s}@ex.bz`);
  await ctx.prisma.userRole.create({ data: { userId: u.userId, roleCode: 'PROPERTY_OWNER', status: 'APPROVED', approvedAt: new Date() } });
  const cookies = await login(`own_${s}@ex.bz`, 'CustomerPass123');
  expect((await put(cookies, 'property-owner/profile', { legalName: `Owner ${s}` })).status).toBe(200);
  return { cookies, userId: u.userId };
}
async function makeAgent() {
  const s = uniq(); const u = await register(`agt_${s}@ex.bz`);
  await ctx.prisma.userRole.create({ data: { userId: u.userId, roleCode: 'REAL_ESTATE_AGENT', status: 'APPROVED', approvedAt: new Date() } });
  const cookies = await login(`agt_${s}@ex.bz`, 'CustomerPass123');
  const prof = await put(cookies, 'real-estate-agent/profile', { displayName: `Agent ${s}` });
  expect(prof.status).toBe(200);
  const agentProfileId = (await ctx.prisma.realEstateAgentProfile.findFirstOrThrow({ where: { userId: u.userId } })).id;
  return { cookies, userId: u.userId, agentProfileId };
}
/** Owner creates a listing, admin approves → PUBLISHED. Returns {id, slug}. */
async function publishListing(owner: { cookies: string[] }, extra: Record<string, unknown> = {}) {
  const c = await post(owner.cookies, 'property-owner/listings', {
    purpose: 'FOR_SALE', propertyType: 'HOUSE', title: `Villa ${uniq()}`,
    description: 'A wonderful family home with a garden and sea views, close to town.',
    priceMinor: 25000000, district: 'BELIZE', locality: 'Belize City', exactAddress: '123 Hidden Lane', ...extra,
  });
  expect(c.status).toBe(201);
  const id = c.body.id;
  expect((await post(owner.cookies, `property-owner/listings/${id}/submit`)).body.status).toBe('SUBMITTED');
  const m = await post(admin, `admin/properties/${id}/moderate`, { action: 'APPROVE' });
  expect(m.status).toBe(201);
  expect(m.body.status).toBe('PUBLISHED');
  const slug = (await ctx.prisma.propertyListing.findUniqueOrThrow({ where: { id } })).slug;
  return { id, slug };
}

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const a = await seedSuperAdmin(ctx.prisma);
  admin = await login(a.email, a.password);
});
afterAll(async () => { await ctx.app.close(); });

describe('listing lifecycle + public + location privacy', () => {
  it('publishes via moderation, appears publicly, and NEVER exposes the exact address', async () => {
    const owner = await makeOwner();
    const { id, slug } = await publishListing(owner);
    const detail = await guest(`properties/${slug}`);
    expect(detail.status).toBe(200);
    expect(detail.body.status).toBe('PUBLISHED');
    // location privacy: default DISTRICT_ONLY → exact address must not appear anywhere public
    expect(JSON.stringify(detail.body)).not.toContain('123 Hidden Lane');
    expect(detail.body.location?.district).toBe('BELIZE');
    // public search includes it
    const search = await guest('properties');
    expect(search.body.items.some((p: { id: string }) => p.id === id)).toBe(true);
    // a plain customer cannot author listings
    const cust = await register(`c_${uniq()}@ex.bz`);
    expect((await post(cust.cookies, 'property-owner/listings', { purpose: 'FOR_SALE', propertyType: 'LAND', title: 'x', description: 'y'.repeat(25), priceMinor: 100 })).status).toBe(403);
    // draft never public
    const draft = await post(owner.cookies, 'property-owner/listings', { purpose: 'FOR_RENT', propertyType: 'APARTMENT', title: `Draft ${uniq()}`, description: 'A hidden draft listing that must never be public.', priceMinor: 100000, rentalPeriod: 'MONTH' });
    expect((await guest(`properties/${draft.body.slug}`)).status).toBe(404);
  });

  it('enforces cross-owner isolation and blocks moderation bypass', async () => {
    const a = await makeOwner(); const b = await makeOwner();
    const { id } = await publishListing(a);
    expect((await get(b.cookies, `property-owner/listings/${id}`)).status).toBe(404);
    expect((await post(b.cookies, `property-owner/listings/${id}/status`, { action: 'WITHDRAW' })).status).toBe(404);
    expect((await post(a.cookies, `admin/properties/${id}/moderate`, { action: 'SUSPEND' })).status).toBe(403); // owner lacks permission
  });
});

describe('images + private documents', () => {
  it('uploads a public image and a PRIVATE document that only the owner can fetch', async () => {
    const owner = await makeOwner();
    const c = await post(owner.cookies, 'property-owner/listings', { purpose: 'FOR_SALE', propertyType: 'HOUSE', title: `Doc Villa ${uniq()}`, description: 'Home with private ownership documents attached for verification.', priceMinor: 30000000, district: 'CAYO' });
    const id = c.body.id;
    // image round-trip (public)
    const ipre = await post(owner.cookies, `property-owner/listings/${id}/images/presign`, { fileName: 'front.png', contentType: 'image/png', sizeBytes: PNG.length });
    expect(ipre.status).toBe(201);
    expect(await putToPresigned(ipre.body.uploadUrl, PNG, 'image/png')).toBe(200);
    expect((await post(owner.cookies, `property-owner/listings/${id}/images`, { storageKey: ipre.body.key, altText: 'front' })).status).toBe(201);
    // private document round-trip
    const dpre = await post(owner.cookies, `property-owner/listings/${id}/documents/presign`, { fileName: 'deed.pdf', contentType: 'application/pdf', sizeBytes: PDF.length });
    expect(await putToPresigned(dpre.body.uploadUrl, PDF, 'application/pdf')).toBe(200);
    const conf = await post(owner.cookies, `property-owner/listings/${id}/documents`, { storageKey: dpre.body.key, kind: 'TITLE_DEED', label: 'Deed' });
    expect(conf.status).toBe(201);
    const docId = (await ctx.prisma.propertyDocument.findFirstOrThrow({ where: { listing: { id } } })).id;
    // owner gets a signed URL
    expect((await get(owner.cookies, `property-owner/listings/${id}/documents/${docId}/url`)).body.url).toContain('http');
    // another owner cannot reach this listing's documents
    const other = await makeOwner();
    expect((await get(other.cookies, `property-owner/listings/${id}/documents/${docId}/url`)).status).toBe(404);
    // publish + confirm the public detail exposes neither the document nor the storage key
    await post(owner.cookies, `property-owner/listings/${id}/submit`);
    await post(admin, `admin/properties/${id}/moderate`, { action: 'APPROVE' });
    const slug = (await ctx.prisma.propertyListing.findUniqueOrThrow({ where: { id } })).slug;
    const pub = JSON.stringify((await guest(`properties/${slug}`)).body);
    expect(pub).not.toContain('deed.pdf');
    expect(pub).not.toContain('properties/' + id + '/docs');
  });
});

describe('seeker: save / enquiry / viewing + guest denial', () => {
  it('blocks guests and runs save + enquiry + viewing with owner responses', async () => {
    const owner = await makeOwner();
    const { id } = await publishListing(owner);
    // guest denials
    expect((await request(ctx.server).post(`/api/property-seeker/saved/${id}`)).status).toBe(401);
    expect((await request(ctx.server).post('/api/property-seeker/enquiries').send({ listingId: id, message: 'hi there please' })).status).toBe(401);
    expect((await request(ctx.server).post('/api/property-seeker/viewing-requests').send({ listingId: id, requestedDate: new Date().toISOString() })).status).toBe(401);

    const seeker = await register(`s_${uniq()}@ex.bz`);
    // save + list
    expect((await post(seeker.cookies, `property-seeker/saved/${id}`)).body).toMatchObject({ saved: true });
    expect((await get(seeker.cookies, 'property-seeker/saved')).body.items.length).toBe(1);
    // enquiry
    const enq = await post(seeker.cookies, 'property-seeker/enquiries', { listingId: id, type: 'PRICE', message: 'Is the price negotiable?' });
    expect(enq.status).toBe(201);
    const enqId = enq.body.id;
    // owner sees + replies + closes
    expect((await get(owner.cookies, 'property-owner/enquiries')).body.some((e: { id: string }) => e.id === enqId)).toBe(true);
    expect((await post(owner.cookies, `property-owner/enquiries/${enqId}/reply`, { message: 'Yes, slightly.' })).status).toBe(201);
    // another customer cannot read this enquiry
    const other = await register(`s2_${uniq()}@ex.bz`);
    expect((await get(other.cookies, `property-seeker/enquiries/${enqId}`)).status).toBe(404);
    // viewing request + owner transitions (validated machine)
    const vr = await post(seeker.cookies, 'property-seeker/viewing-requests', { listingId: id, requestedDate: new Date(Date.now() + 86400000).toISOString(), requestedTime: '10:00', message: 'Morning please' });
    expect(vr.status).toBe(201);
    const vid = vr.body.id;
    expect((await post(owner.cookies, `property-owner/viewings/${vid}/transition`, { status: 'CONFIRMED', confirmedDate: new Date(Date.now() + 86400000).toISOString(), confirmedTime: '10:00' })).body.status).toBe('CONFIRMED');
    // illegal transition rejected (CONFIRMED → REQUESTED not allowed)
    expect((await post(owner.cookies, `property-owner/viewings/${vid}/transition`, { status: 'REQUESTED' })).status).toBe(400);
    // seeker notified (PROPERTY category)
    expect((await get(seeker.cookies, 'notifications?category=PROPERTY')).body.items.length).toBeGreaterThan(0);
    // context-scoped messaging opens for both parties
    expect((await post(seeker.cookies, `property-seeker/enquiries/${enqId}/conversation`)).status).toBe(201);
  });
});

describe('agent assignment + admin gating', () => {
  it('owner assigns an agent who accepts and can then manage the listing', async () => {
    const owner = await makeOwner();
    const agent = await makeAgent();
    const c = await post(owner.cookies, 'property-owner/listings', { purpose: 'FOR_RENT', propertyType: 'CONDO', title: `Assign ${uniq()}`, description: 'A condo the owner wants an agent to manage on their behalf.', priceMinor: 200000, rentalPeriod: 'MONTH', district: 'BELIZE' });
    const id = c.body.id;
    // before assignment the agent cannot see it
    expect((await get(agent.cookies, `real-estate-agent/listings/${id}`)).status).toBe(404);
    expect((await post(owner.cookies, `property-owner/listings/${id}/assign-agent`, { agentProfileId: agent.agentProfileId })).status).toBe(201);
    const asg = await get(agent.cookies, 'real-estate-agent/assignments');
    expect(asg.body.length).toBeGreaterThanOrEqual(1);
    const asgId = asg.body[0].id;
    expect((await post(agent.cookies, `real-estate-agent/assignments/${asgId}/accept`)).status).toBe(201);
    // now the agent can manage it
    expect((await get(agent.cookies, `real-estate-agent/listings/${id}`)).status).toBe(200);
  });

  it('gates admin moderation + property documents behind permissions', async () => {
    const owner = await makeOwner();
    const { id } = await publishListing(owner);
    const cust = await register(`c3_${uniq()}@ex.bz`);
    expect((await post(cust.cookies, `property-seeker/report/${id}`, { reason: 'SCAM' })).status).toBe(201);
    expect((await get(cust.cookies, 'admin/properties')).status).toBe(403);
    expect((await get(admin, 'admin/properties')).status).toBe(200);
    expect((await get(admin, 'admin/properties/reports')).body.some((r: { listingId: string }) => r.listingId === id)).toBe(true);
    // an admin WITHOUT property_documents.read cannot read private docs
    const limited = await seedLimitedAdmin(ctx.prisma, `la_${uniq()}@ex.bz`, ['properties.read', 'properties.moderate']);
    const lc = await login(limited.email, limited.password);
    expect((await get(lc, `admin/properties/${id}/documents`)).status).toBe(403);
    expect((await get(admin, 'admin/properties/analytics')).status).toBe(200);
  });
});
