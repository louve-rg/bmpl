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
const uniq = () => `${Date.now()}_${(seq += 1)}`;

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
