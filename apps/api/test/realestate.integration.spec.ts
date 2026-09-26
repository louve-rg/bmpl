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
let adminUserId: string;
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
  adminUserId = a.id;
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

/**
 * Lifecycle depth (QA-A11). The six tests above cover the spine; these cover
 * the states a listing spends its life in. Every fixture takes the product
 * path — the one standing exception, as everywhere in this suite, is the
 * auth-role upsert in makeOwner/makeAgent; the only raw reads are lookups of
 * ids/slugs the API deliberately does not echo (profile ids, history counts).
 * Each "from" state is REACHED through the API, never written to the row —
 * a transition proven from a hand-planted state proves the transition and
 * nothing about whether the state is reachable.
 */
describe('listing lifecycle depth', () => {
  it('walks a sale to SOLD and a rental to RENTED, refusing the crossed purposes', async () => {
    const owner = await makeOwner();
    const sale = await publishListing(owner); // FOR_SALE by default
    // A sale cannot be "rented out".
    expect((await post(owner.cookies, `property-owner/listings/${sale.id}/status`, { action: 'RENTED' })).status).toBe(400);
    expect((await post(owner.cookies, `property-owner/listings/${sale.id}/status`, { action: 'UNDER_OFFER' })).body.status).toBe('UNDER_OFFER');
    const sold = await post(owner.cookies, `property-owner/listings/${sale.id}/status`, { action: 'SOLD' });
    expect(sold.body.status).toBe('SOLD');
    // SOLD is the end of the road for owner actions.
    expect((await post(owner.cookies, `property-owner/listings/${sale.id}/status`, { action: 'UNDER_OFFER' })).status).toBe(400);

    const rental = await publishListing(owner, { purpose: 'FOR_RENT', rentalPeriod: 'MONTH', priceMinor: 150000, title: `Rental ${uniq()}` });
    // A rental cannot be "sold".
    expect((await post(owner.cookies, `property-owner/listings/${rental.id}/status`, { action: 'SOLD' })).status).toBe(400);
    expect((await post(owner.cookies, `property-owner/listings/${rental.id}/status`, { action: 'RENTED' })).body.status).toBe('RENTED');
  });

  it('withdraws a live listing off the public site, archives it, and refuses archiving live stock', async () => {
    const owner = await makeOwner();
    const { id, slug } = await publishListing(owner);
    // Live stock cannot be archived directly.
    expect((await post(owner.cookies, `property-owner/listings/${id}/status`, { action: 'ARCHIVE' })).status).toBe(400);
    expect((await post(owner.cookies, `property-owner/listings/${id}/status`, { action: 'WITHDRAW' })).body.status).toBe('WITHDRAWN');
    // Gone from the public site, detail and search both.
    expect((await guest(`properties/${slug}`)).status).toBe(404);
    expect((await guest('properties')).body.items.some((p: { id: string }) => p.id === id)).toBe(false);
    // A withdrawn listing can be archived; owner relisting does not exist —
    // the way back to PUBLISHED is the admin RESTORE action, by design.
    expect((await post(owner.cookies, `property-owner/listings/${id}/status`, { action: 'ARCHIVE' })).body.status).toBe('ARCHIVED');
  });

  it('moderation SUSPEND/ARCHIVE respect the lifecycle: no back door from draft to published', async () => {
    const owner = await makeOwner();
    // A draft that has never seen a moderator. Before the from-state guard,
    // SUSPEND here succeeded — and RESTORE takes SUSPENDED to PUBLISHED, so
    // two admin clicks put a never-reviewed listing on the public site.
    const draft = await post(owner.cookies, 'property-owner/listings', {
      purpose: 'FOR_SALE', propertyType: 'HOUSE', title: `Backdoor ${uniq()}`,
      description: 'A wonderful family home with a garden and sea views, close to town.',
      priceMinor: 25000000, district: 'BELIZE', locality: 'Belize City', exactAddress: '9 Hidden Lane',
    });
    expect(draft.status).toBe(201);
    const suspendDraft = await post(admin, `admin/properties/${draft.body.id}/moderate`, { action: 'SUSPEND' });
    expect(suspendDraft.status).toBe(400);
    expect(suspendDraft.body.message).toMatch(/live listing/i);
    // Archiving a draft remains legitimate tidying (same rule as the owner path).
    expect((await post(admin, `admin/properties/${draft.body.id}/moderate`, { action: 'ARCHIVE' })).body.status).toBe('ARCHIVED');

    // A live listing: cannot be archived in place, suspends once, restores.
    const live = await publishListing(owner);
    const archiveLive = await post(admin, `admin/properties/${live.id}/moderate`, { action: 'ARCHIVE' });
    expect(archiveLive.status).toBe(400);
    expect(archiveLive.body.message).toMatch(/withdraw or wait/i);
    expect((await post(admin, `admin/properties/${live.id}/moderate`, { action: 'SUSPEND' })).body.status).toBe('SUSPENDED');
    expect((await post(admin, `admin/properties/${live.id}/moderate`, { action: 'SUSPEND' })).status).toBe(400);
    expect((await post(admin, `admin/properties/${live.id}/moderate`, { action: 'RESTORE' })).body.status).toBe('PUBLISHED');
  });

  it('proves MORE_INFO_REQUIRED is a loop, not a dead end: edit, resubmit, approve', async () => {
    const owner = await makeOwner();
    const c = await post(owner.cookies, 'property-owner/listings', {
      purpose: 'FOR_SALE', propertyType: 'HOUSE', title: `Info Loop ${uniq()}`,
      description: 'A home whose first submission is missing some information.',
      priceMinor: 18000000, district: 'CAYO',
    });
    const id = c.body.id;
    await post(owner.cookies, `property-owner/listings/${id}/submit`);
    const back = await post(admin, `admin/properties/${id}/moderate`, { action: 'REQUEST_INFO', reason: 'Add the land size.' });
    expect(back.body.status).toBe('MORE_INFO_REQUIRED');
    // Editable in that state...
    expect((await patch(owner.cookies, `property-owner/listings/${id}`, { description: 'A home, now with the requested land size of two acres stated.' })).status).toBe(200);
    // ...and resubmittable, and approvable on the second pass.
    expect((await post(owner.cookies, `property-owner/listings/${id}/submit`)).body.status).toBe('SUBMITTED');
    expect((await post(admin, `admin/properties/${id}/moderate`, { action: 'APPROVE' })).body.status).toBe('PUBLISHED');
    // Published means no longer editable — the loop is closed at both ends.
    expect((await patch(owner.cookies, `property-owner/listings/${id}`, { description: 'Rewriting a live listing without review must not be possible now.' })).status).toBe(400);
  });

  it('suspending an owner takes their live listings offline; restoring the owner does NOT republish them', async () => {
    const owner = await makeOwner();
    const { id, slug } = await publishListing(owner);
    const ownerProfileId = (await ctx.prisma.propertyOwnerProfile.findFirstOrThrow({ where: { userId: owner.userId } })).id;

    expect((await post(admin, `admin/properties/owners/${ownerProfileId}/suspend`, { reason: 'Verification failed.' })).status).toBe(201);
    // The cascade: live listings go SUSPENDED and vanish from the public site.
    const suspended = await ctx.prisma.propertyListing.findUniqueOrThrow({ where: { id } });
    expect(suspended.status).toBe('SUSPENDED');
    expect((await guest(`properties/${slug}`)).status).toBe(404);
    expect((await guest('properties')).body.items.some((p: { id: string }) => p.id === id)).toBe(false);

    // Restoring the OWNER restores the account only. The listing stays
    // SUSPENDED until an admin restores it individually — deliberate (each
    // listing gets its own look), and recorded here so a change to it is a
    // decision rather than an accident.
    expect((await post(admin, `admin/properties/owners/${ownerProfileId}/restore`, {})).status).toBe(201);
    expect((await ctx.prisma.propertyListing.findUniqueOrThrow({ where: { id } })).status).toBe('SUSPENDED');
    // The individual restore brings it back to the public site.
    expect((await post(admin, `admin/properties/${id}/moderate`, { action: 'RESTORE' })).body.status).toBe('PUBLISHED');
    expect((await guest(`properties/${slug}`)).status).toBe(200);
  });

  it('resolves a report and files it under its outcome', async () => {
    const owner = await makeOwner();
    const { id } = await publishListing(owner);
    const reporter = await register(`rep_${uniq()}@ex.bz`);
    expect((await post(reporter.cookies, `property-seeker/report/${id}`, { reason: 'INCORRECT_INFO', note: 'The photos show a different house.' })).status).toBe(201);

    const open = (await get(admin, 'admin/properties/reports?status=OPEN')).body;
    const report = open.find((r: { listingId: string }) => r.listingId === id);
    expect(report).toBeTruthy();

    expect((await post(admin, `admin/properties/reports/${report.id}/resolve`, { status: 'ACTIONED', note: 'Owner asked to correct the photos.' })).status).toBe(201);
    // Filed under its outcome, and no longer open.
    expect((await get(admin, 'admin/properties/reports?status=ACTIONED')).body.some((r: { id: string }) => r.id === report.id)).toBe(true);
    expect((await get(admin, 'admin/properties/reports?status=OPEN')).body.some((r: { id: string }) => r.id === report.id)).toBe(false);
  });

  it('appends price history on a real price change and only then', async () => {
    const owner = await makeOwner();
    const c = await post(owner.cookies, 'property-owner/listings', {
      purpose: 'FOR_SALE', propertyType: 'LAND', title: `Priced ${uniq()}`,
      description: 'A parcel of land whose asking price will move before it is listed.',
      priceMinor: 5000000, district: 'TOLEDO',
    });
    const id = c.body.id;
    const history = () => ctx.prisma.propertyPriceHistory.count({ where: { listingId: id } });
    expect(await history()).toBe(1); // the creation price is history's first entry
    expect((await patch(owner.cookies, `property-owner/listings/${id}`, { priceMinor: 4500000 })).status).toBe(200);
    expect(await history()).toBe(2);
    // A non-price edit must not fabricate a price event.
    expect((await patch(owner.cookies, `property-owner/listings/${id}`, { title: `Priced Again ${uniq()}` })).status).toBe(200);
    expect(await history()).toBe(2);
    // Re-stating the SAME price is not a change either.
    expect((await patch(owner.cookies, `property-owner/listings/${id}`, { priceMinor: 4500000 })).status).toBe(200);
    expect(await history()).toBe(2);
  });

  it('walks the viewing machine through its legal spine and slams every terminal door', async () => {
    const owner = await makeOwner();
    const { id } = await publishListing(owner);
    const seeker = await register(`vw_${uniq()}@ex.bz`);
    const future = () => new Date(Date.now() + 3 * 86400000).toISOString();

    // REQUESTED → PROPOSED → RESCHEDULED → CONFIRMED → COMPLETED.
    const a = (await post(seeker.cookies, 'property-seeker/viewing-requests', { listingId: id, requestedDate: future(), requestedTime: '09:00' })).body;
    for (const step of [
      { status: 'PROPOSED', note: 'Could we do the afternoon instead?' },
      { status: 'RESCHEDULED' },
      { status: 'CONFIRMED', confirmedDate: future(), confirmedTime: '15:00' },
      { status: 'COMPLETED' },
    ]) {
      const r = await post(owner.cookies, `property-owner/viewings/${a.id}/transition`, step);
      expect(r.body.status).toBe(step.status);
    }
    // COMPLETED is terminal.
    expect((await post(owner.cookies, `property-owner/viewings/${a.id}/transition`, { status: 'CANCELLED' })).status).toBe(400);

    // DECLINED is terminal too — and skipping straight to COMPLETED from
    // REQUESTED is not a legal move.
    const b = (await post(seeker.cookies, 'property-seeker/viewing-requests', { listingId: id, requestedDate: future(), requestedTime: '11:00' })).body;
    expect((await post(owner.cookies, `property-owner/viewings/${b.id}/transition`, { status: 'COMPLETED' })).status).toBe(400);
    expect((await post(owner.cookies, `property-owner/viewings/${b.id}/transition`, { status: 'DECLINED' })).body.status).toBe('DECLINED');
    expect((await post(owner.cookies, `property-owner/viewings/${b.id}/transition`, { status: 'CONFIRMED', confirmedDate: future(), confirmedTime: '10:00' })).status).toBe(400);
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

/**
 * The two dead statuses stay dead (BMPL-163).
 *
 * PropertyStatus permits APPROVED and UNDER_REVIEW, but no code path writes
 * either: moderation reviews from SUBMITTED and its APPROVE lands directly on
 * PUBLISHED. The danger is that guard lists already half-expect both values,
 * which is exactly how a state sneaks in unreviewed. This suite walks EVERY
 * status-writing action the API offers and then asserts, over the status
 * column AND the append-only status history that every transition records,
 * that neither value was ever produced. If a future writer makes one
 * reachable, this fails — and that failure is the review trigger, on purpose.
 */
describe('dead listing statuses stay dead (BMPL-163)', () => {
  it('walks every lifecycle action; APPROVED and UNDER_REVIEW never occur', async () => {
    const owner = await makeOwner();

    // The full review loop: submit, more-info, resubmit, approve — landing on
    // PUBLISHED, never APPROVED — then under offer, then sold.
    const sale = await post(owner.cookies, 'property-owner/listings', {
      purpose: 'FOR_SALE', propertyType: 'HOUSE', title: `Deadstate Sale ${uniq()}`,
      description: 'A wonderful family home with a garden and sea views, close to town.',
      priceMinor: 25000000, district: 'BELIZE', locality: 'Belize City', exactAddress: '1 Pin Lane',
    });
    expect(sale.status).toBe(201);
    const saleId = sale.body.id;
    expect((await post(owner.cookies, `property-owner/listings/${saleId}/submit`)).body.status).toBe('SUBMITTED');
    expect((await post(admin, `admin/properties/${saleId}/moderate`, { action: 'REQUEST_INFO', reason: 'Add photos of the garden.' })).body.status).toBe('MORE_INFO_REQUIRED');
    expect((await post(owner.cookies, `property-owner/listings/${saleId}/submit`)).body.status).toBe('SUBMITTED');
    const approved = await post(admin, `admin/properties/${saleId}/moderate`, { action: 'APPROVE' });
    expect(approved.body.status).toBe('PUBLISHED'); // the key line: approval IS publication
    expect((await post(owner.cookies, `property-owner/listings/${saleId}/status`, { action: 'UNDER_OFFER' })).body.status).toBe('UNDER_OFFER');
    expect((await post(owner.cookies, `property-owner/listings/${saleId}/status`, { action: 'SOLD' })).body.status).toBe('SOLD');

    // The rental outcome.
    const rental = await publishListing(owner, { purpose: 'FOR_RENT', rentalPeriod: 'MONTH', title: `Deadstate Rental ${uniq()}` });
    expect((await post(owner.cookies, `property-owner/listings/${rental.id}/status`, { action: 'RENTED' })).body.status).toBe('RENTED');

    // Admin suspend / restore / unpublish, then owner archive.
    const churn = await publishListing(owner, { title: `Deadstate Churn ${uniq()}` });
    expect((await post(admin, `admin/properties/${churn.id}/moderate`, { action: 'SUSPEND', reason: 'Complaint received.' })).body.status).toBe('SUSPENDED');
    expect((await post(admin, `admin/properties/${churn.id}/moderate`, { action: 'RESTORE' })).body.status).toBe('PUBLISHED');
    expect((await post(admin, `admin/properties/${churn.id}/moderate`, { action: 'UNPUBLISH', reason: 'Owner request.' })).body.status).toBe('WITHDRAWN');
    expect((await post(owner.cookies, `property-owner/listings/${churn.id}/status`, { action: 'ARCHIVE' })).body.status).toBe('ARCHIVED');

    // Rejection, and the owner walking away from a live listing.
    const rejected = await post(owner.cookies, 'property-owner/listings', {
      purpose: 'FOR_SALE', propertyType: 'LAND', title: `Deadstate Reject ${uniq()}`,
      description: 'A parcel of land with road access and utilities nearby, ready to build.',
      priceMinor: 5000000, district: 'CAYO', locality: 'Belmopan', exactAddress: '2 Pin Lane',
    });
    expect((await post(owner.cookies, `property-owner/listings/${rejected.body.id}/submit`)).body.status).toBe('SUBMITTED');
    expect((await post(admin, `admin/properties/${rejected.body.id}/moderate`, { action: 'REJECT', reason: 'Not a real property.' })).body.status).toBe('REJECTED');
    const withdrawn = await publishListing(owner, { title: `Deadstate Withdraw ${uniq()}` });
    expect((await post(owner.cookies, `property-owner/listings/${withdrawn.id}/status`, { action: 'WITHDRAW' })).body.status).toBe('WITHDRAWN');

    // The pin, over everything this database has ever seen in this run: the
    // status column, and the history rows every transition writes — no row,
    // from any test in this file, ever held either dead value.
    expect(await ctx.prisma.propertyListing.count({ where: { status: { in: ['APPROVED', 'UNDER_REVIEW'] } } })).toBe(0);
    expect(await ctx.prisma.propertyStatusHistory.count({ where: { OR: [
      { toStatus: { in: ['APPROVED', 'UNDER_REVIEW'] } },
      { fromStatus: { in: ['APPROVED', 'UNDER_REVIEW'] } },
    ] } })).toBe(0);
  });
});

/**
 * Notification event codes (BMPL-149): every one of these used to reuse the
 * marketplace's PRODUCT_MODERATED, so notification analytics could not tell a
 * real-estate event from a product one. The protected state is the stored
 * `event` column on the notification row, asserted directly rather than the
 * 200/201 the action already returns.
 */
describe('notification event codes are property-specific, not PRODUCT_MODERATED (BMPL-149)', () => {
  async function latestEvent(userId: string) {
    const row = await ctx.prisma.notificationRecipient.findFirstOrThrow({
      where: { userId },
      include: { notification: true },
      orderBy: { id: 'desc' },
    });
    return row.notification.event;
  }

  it('submission tells admins, and moderation tells the owner, with their own events', async () => {
    const owner = await makeOwner();
    const create = await post(owner.cookies, 'property-owner/listings', {
      purpose: 'FOR_SALE', propertyType: 'HOUSE', title: `Event Villa ${uniq()}`,
      description: 'A wonderful family home with a garden and sea views, close to town.',
      priceMinor: 25000000, district: 'BELIZE', locality: 'Belize City', exactAddress: '1 Event Lane',
    });
    expect(create.status).toBe(201);
    expect((await post(owner.cookies, `property-owner/listings/${create.body.id}/submit`)).status).toBe(201);
    expect(await latestEvent(adminUserId)).toBe('ADMIN_PROPERTY_LISTING_SUBMITTED');

    const mod = await post(admin, `admin/properties/${create.body.id}/moderate`, { action: 'APPROVE' });
    expect(mod.status).toBe(201);
    // APPROVE routes through notifyListers -> PROPERTY_LISTING_STATUS_CHANGED
    // for the admin-driven path (SUSPEND below is the same helper, no
    // exceptUserId, so it also lands on the owner directly).
    expect((await post(admin, `admin/properties/${create.body.id}/moderate`, { action: 'SUSPEND' })).status).toBe(201);
    expect(await latestEvent(owner.userId)).toBe('PROPERTY_LISTING_STATUS_CHANGED');
  });

  it('an agent invitation and its acceptance each carry their own event', async () => {
    const owner = await makeOwner();
    const { id } = await publishListing(owner);
    const agent = await makeAgent();

    expect((await post(owner.cookies, `property-owner/listings/${id}/assign-agent`, { agentProfileId: agent.agentProfileId })).status).toBe(201);
    expect(await latestEvent(agent.userId)).toBe('PROPERTY_ASSIGNMENT_INVITED');

    const asg = await get(agent.cookies, 'real-estate-agent/assignments');
    const asgId = asg.body[0].id;
    expect((await post(agent.cookies, `real-estate-agent/assignments/${asgId}/accept`)).status).toBe(201);
    expect(await latestEvent(owner.userId)).toBe('PROPERTY_ASSIGNMENT_ACCEPTED');
  });

  it('an enquiry, its closure, a viewing request and its update each carry their own event', async () => {
    const owner = await makeOwner();
    const { id } = await publishListing(owner);
    const seeker = await register(`ev_seeker_${uniq()}@ex.bz`);

    const enq = await post(seeker.cookies, 'property-seeker/enquiries', { listingId: id, type: 'PRICE', message: 'Is the price negotiable?' });
    expect(enq.status).toBe(201);
    expect(await latestEvent(owner.userId)).toBe('PROPERTY_ENQUIRY_CREATED');

    expect((await post(owner.cookies, `property-owner/enquiries/${enq.body.id}/close`)).status).toBe(201);
    expect(await latestEvent(seeker.userId)).toBe('PROPERTY_ENQUIRY_CLOSED');

    const vr = await post(seeker.cookies, 'property-seeker/viewing-requests', { listingId: id, requestedDate: new Date(Date.now() + 86400000).toISOString(), requestedTime: '10:00' });
    expect(vr.status).toBe(201);
    expect(await latestEvent(owner.userId)).toBe('PROPERTY_VIEWING_REQUESTED');

    expect((await post(owner.cookies, `property-owner/viewings/${vr.body.id}/transition`, { status: 'CONFIRMED', confirmedDate: new Date(Date.now() + 86400000).toISOString(), confirmedTime: '10:00' })).status).toBe(201);
    expect(await latestEvent(seeker.userId)).toBe('PROPERTY_VIEWING_UPDATED');
  });
});
