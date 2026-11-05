/**
 * Saved addresses (the customer's own address book): create/list/update/delete,
 * default promotion, and — the one behaviour that had no test at all — that one
 * account can never read or modify another account's saved addresses.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, type TestContext } from './helpers';

let ctx: TestContext;
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);
const del = (c: string[], p: string) => request(ctx.server).delete(`/api/${p}`).set('Cookie', c);
const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);

async function makeCustomer() {
  const email = `c_${uniq()}@ex.bz`;
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  return cookiesOf(reg);
}

const addressBody = (over: object = {}) => ({
  label: 'Home',
  fullName: 'Edward Flowers',
  phone: '501-600-1234',
  addressLine1: '12 Queen Street',
  city: 'Belize City',
  district: 'BELIZE',
  ...over,
});

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
});
afterAll(async () => {
  await ctx.app.close();
});

describe('saved addresses — create, list, update, delete', () => {
  it('the first saved address becomes the default automatically; a second explicit default demotes it', async () => {
    const cust = await makeCustomer();

    const first = await post(cust, 'addresses', addressBody({ label: 'Home' }));
    expect(first.status).toBe(201);
    expect(first.body.isDefault).toBe(true);

    const second = await post(cust, 'addresses', addressBody({ label: 'Office', isDefault: true }));
    expect(second.status).toBe(201);
    expect(second.body.isDefault).toBe(true);

    const list = await get(cust, 'addresses');
    expect(list.status).toBe(200);
    const byLabel = (l: string) => list.body.find((a: { label: string }) => a.label === l);
    expect(byLabel('Home').isDefault).toBe(false);
    expect(byLabel('Office').isDefault).toBe(true);
    // default first, then most recently updated
    expect(list.body[0].label).toBe('Office');
  });

  it('update edits fields and can move the default; delete promotes the next address', async () => {
    const cust = await makeCustomer();
    const a = (await post(cust, 'addresses', addressBody({ label: 'Home' }))).body;
    const b = (await post(cust, 'addresses', addressBody({ label: 'Work', addressLine1: '9 Albert Street' }))).body;
    expect(a.isDefault).toBe(true);
    expect(b.isDefault).toBe(false);

    const updated = await patch(cust, `addresses/${b.id}`, { instructions: 'Ask for the front desk', isDefault: true });
    expect(updated.status).toBe(200);
    expect(updated.body.instructions).toBe('Ask for the front desk');
    expect(updated.body.isDefault).toBe(true);

    const listAfterUpdate = await get(cust, 'addresses');
    expect(listAfterUpdate.body.find((x: { id: string }) => x.id === a.id).isDefault).toBe(false);

    // deleting the (now) default promotes the remaining address
    const removed = await del(cust, `addresses/${b.id}`);
    expect(removed.status).toBe(200);
    expect(removed.body.deleted).toBe(true);

    const listAfterDelete = await get(cust, 'addresses');
    expect(listAfterDelete.body.length).toBe(1);
    expect(listAfterDelete.body[0].id).toBe(a.id);
    expect(listAfterDelete.body[0].isDefault).toBe(true);
  });

  it('rejects an address with no usable location: no street, no pin', async () => {
    const cust = await makeCustomer();
    const bad = await post(cust, 'addresses', { label: 'Nowhere', fullName: 'E F', phone: '501-600-1234', addressLine1: '', city: 'Belize City', district: 'BELIZE' });
    expect(bad.status).toBe(400);
  });
});

describe('saved addresses — un-defaulting by PATCH never leaves the account with no default', () => {
  const isDefaultOf = async (id: string) =>
    (await ctx.prisma.savedAddress.findUniqueOrThrow({ where: { id }, select: { isDefault: true } })).isDefault;

  it('PATCH isDefault:false on the current default promotes another address, so exactly one stays the default', async () => {
    const cust = await makeCustomer();
    const a = (await post(cust, 'addresses', addressBody({ label: 'Home' }))).body;
    const b = (await post(cust, 'addresses', addressBody({ label: 'Work', addressLine1: '9 Albert Street' }))).body;
    expect(await isDefaultOf(a.id)).toBe(true);

    const res = await patch(cust, `addresses/${a.id}`, { isDefault: false });
    expect(res.status).toBe(200);
    expect(res.body.isDefault).toBe(false);
    // stored state, not just the response: the successor really holds the default
    expect(await isDefaultOf(a.id)).toBe(false);
    expect(await isDefaultOf(b.id)).toBe(true);
  });

  it('PATCH isDefault:false on a NON-default address changes nothing about the current default (control)', async () => {
    const cust = await makeCustomer();
    const a = (await post(cust, 'addresses', addressBody({ label: 'Home' }))).body;
    const b = (await post(cust, 'addresses', addressBody({ label: 'Work', addressLine1: '9 Albert Street' }))).body;

    expect((await patch(cust, `addresses/${b.id}`, { isDefault: false })).status).toBe(200);
    expect(await isDefaultOf(a.id)).toBe(true);
    expect(await isDefaultOf(b.id)).toBe(false);
  });

  it('PATCH isDefault:false on the ONLY address is refused, and the stored default is untouched', async () => {
    const cust = await makeCustomer();
    const only = (await post(cust, 'addresses', addressBody({ label: 'Home' }))).body;
    expect(await isDefaultOf(only.id)).toBe(true);

    const res = await patch(cust, `addresses/${only.id}`, { isDefault: false });
    expect(res.status).toBe(400);
    expect(await isDefaultOf(only.id)).toBe(true);
  });
});

describe('saved addresses — cross-user isolation', () => {
  it('one account cannot list, update or delete a saved address that belongs to another account', async () => {
    const owner = await makeCustomer();
    const intruder = await makeCustomer();

    const mine = (await post(owner, 'addresses', addressBody({ label: 'Home' }))).body;

    // the intruder's own list never contains the owner's address
    const intruderList = await get(intruder, 'addresses');
    expect(intruderList.status).toBe(200);
    expect(intruderList.body).toEqual([]);

    // a direct update attempt against the owner's address id fails closed — 404,
    // never 403, so the intruder cannot even confirm the id exists
    const forgedUpdate = await patch(intruder, `addresses/${mine.id}`, { label: 'Hijacked' });
    expect(forgedUpdate.status).toBe(404);

    // a direct delete attempt fails the same way
    const forgedDelete = await del(intruder, `addresses/${mine.id}`);
    expect(forgedDelete.status).toBe(404);

    // the owner's address is untouched by either attempt
    const stillMine = await get(owner, 'addresses');
    expect(stillMine.body.length).toBe(1);
    expect(stillMine.body[0].id).toBe(mine.id);
    expect(stillMine.body[0].label).toBe('Home');
  });

  it('an unauthenticated caller cannot reach the address book at all', async () => {
    const anon = await request(ctx.server).get('/api/addresses');
    expect(anon.status).toBe(401);
  });
});

/**
 * MDF-485: `addressLine1` became optional so a pin-only Belize address can be
 * saved at all, `landmark` is a new field distinct from `instructions`, and
 * `pinConfirmedAt` is the owner's checkable invariant — set only when the
 * API actually receives coordinates, and never accepted from the request.
 */
describe('saved addresses — pin-first (MDF-485)', () => {
  const BELIZE_CITY = { latitude: 17.4995, longitude: -88.1976 };

  it('saves a pin-only address with no street at all, and records the pin as confirmed', async () => {
    const cust = await makeCustomer();
    const res = await post(cust, 'addresses', {
      label: 'Home',
      fullName: 'Edward Flowers',
      phone: '501-600-1234',
      city: 'Belize City',
      district: 'BELIZE',
      landmark: 'Behind the blue gate',
      ...BELIZE_CITY,
    });
    expect(res.status).toBe(201);
    expect(res.body.addressLine1).toBeFalsy();
    expect(res.body.landmark).toBe('Behind the blue gate');
    expect(res.body.latitude).toBe(BELIZE_CITY.latitude);
    expect(res.body.pinConfirmedAt).toBeTruthy();

    const stored = await ctx.prisma.savedAddress.findUniqueOrThrow({ where: { id: res.body.id } });
    expect(stored.pinConfirmedAt).not.toBeNull();
  });

  it('a street-only address (no pin) has no confirmed pin', async () => {
    const cust = await makeCustomer();
    const res = await post(cust, 'addresses', addressBody({ label: 'Office' }));
    expect(res.status).toBe(201);
    expect(res.body.pinConfirmedAt).toBeNull();
  });

  it('a client cannot set pinConfirmedAt directly — it is derived from whether coordinates are present', async () => {
    const cust = await makeCustomer();
    const res = await post(cust, 'addresses', { ...addressBody({ label: 'Office' }), pinConfirmedAt: '2020-01-01T00:00:00Z' });
    expect(res.status).toBe(201);
    // No coordinates were sent, so the pin is not confirmed regardless of the
    // (ignored) client-supplied value.
    expect(res.body.pinConfirmedAt).toBeNull();
  });

  it('adding a pin by PATCH confirms it; removing the pin by PATCH clears the confirmation', async () => {
    const cust = await makeCustomer();
    const created = (await post(cust, 'addresses', addressBody({ label: 'Office' }))).body;
    expect(created.pinConfirmedAt).toBeNull();

    const pinned = await patch(cust, `addresses/${created.id}`, BELIZE_CITY);
    expect(pinned.status).toBe(200);
    expect(pinned.body.pinConfirmedAt).toBeTruthy();

    const unpinned = await patch(cust, `addresses/${created.id}`, { latitude: null, longitude: null });
    expect(unpinned.status).toBe(200);
    expect(unpinned.body.pinConfirmedAt).toBeNull();
    // The street line is still there, so the address stays locatable.
    expect(unpinned.body.addressLine1).toBeTruthy();
  });

  it('a PATCH that leaves no street and no pin is refused, not silently saved unlocatable', async () => {
    const cust = await makeCustomer();
    const created = (await post(cust, 'addresses', addressBody({ label: 'Office' }))).body;

    const res = await patch(cust, `addresses/${created.id}`, { addressLine1: null });
    expect(res.status).toBe(400);

    // The stored row is untouched by the refused write.
    const stillThere = await ctx.prisma.savedAddress.findUniqueOrThrow({ where: { id: created.id } });
    expect(stillThere.addressLine1).toBe('12 Queen Street');
  });

  it('a PATCH that drops the street is fine when a pin already covers the address', async () => {
    const cust = await makeCustomer();
    const created = (await post(cust, 'addresses', { ...addressBody({ label: 'Office' }), ...BELIZE_CITY })).body;

    const res = await patch(cust, `addresses/${created.id}`, { addressLine1: null });
    expect(res.status).toBe(200);
    expect(res.body.addressLine1).toBeFalsy();
    expect(res.body.latitude).toBe(BELIZE_CITY.latitude);
  });

  it('editing an unrelated field leaves a previously confirmed pin confirmed', async () => {
    const cust = await makeCustomer();
    const created = (await post(cust, 'addresses', { ...addressBody({ label: 'Office' }), ...BELIZE_CITY })).body;
    expect(created.pinConfirmedAt).toBeTruthy();

    const res = await patch(cust, `addresses/${created.id}`, { instructions: 'Ring twice' });
    expect(res.status).toBe(200);
    expect(res.body.pinConfirmedAt).toBe(created.pinConfirmedAt);
  });

  /**
   * MDF-533 (Jim's finding): this is the actual wire shape the "Save to my
   * addresses" star sends, not the omitted-field case above.
   * `toSavedAddressPayload` (apps/web/lib/address.ts) posts `addressLine1`
   * raw-trimmed on BOTH create and edit — a pin-only address sends `""`,
   * never a missing key. Before the schema normalised it, the star button
   * was enabled (the client's own `addressGap` check passed) and then the
   * API 400'd anyway.
   */
  it('create: a blank addressLine1 (not an omitted one) alongside coordinates still saves and confirms the pin', async () => {
    const cust = await makeCustomer();
    const res = await post(cust, 'addresses', { ...addressBody({ label: 'Home' }), addressLine1: '', ...BELIZE_CITY });
    expect(res.status).toBe(201);
    expect(res.body.addressLine1).toBeFalsy();
    expect(res.body.pinConfirmedAt).toBeTruthy();
  });

  it('update: a blank addressLine1 (not an omitted one) alongside coordinates still saves, same as create', async () => {
    const cust = await makeCustomer();
    const created = (await post(cust, 'addresses', addressBody({ label: 'Home' }))).body;

    // Mirrors toSavedAddressPayload exactly: every field resent, blank street.
    const res = await patch(cust, `addresses/${created.id}`, { ...addressBody({ label: 'Home' }), addressLine1: '', ...BELIZE_CITY });
    expect(res.status).toBe(200);
    expect(res.body.addressLine1).toBeFalsy();
    expect(res.body.pinConfirmedAt).toBeTruthy();
  });
});
