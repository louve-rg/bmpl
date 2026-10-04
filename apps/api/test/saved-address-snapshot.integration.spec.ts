/**
 * Editing or deleting a saved address must never rewrite the address a shipment
 * or an order already recorded. A saved address is a convenience the customer
 * picks from, not a reference the history depends on: the booking copies the
 * values in, and this suite proves the copy survives both an edit and a delete.
 *
 * The assertion is on the stored snapshot values, byte-for-byte (JSON), before
 * and after each step, not on the absence of a foreign key. A control edit that
 * reads back changed proves the mutation really happened.
 */
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import request from 'supertest';
import { bootApp, cookiesOf, resetDb, seedRoles, seedSuperAdmin, type TestContext } from './helpers';

let ctx: TestContext;
let adminCookies: string[];
let categoryId: string;
let seq = 0;
const uniq = () => `${(seq += 1).toString(36)}${Date.now().toString(36)}`;

const get = (c: string[], p: string) => request(ctx.server).get(`/api/${p}`).set('Cookie', c);
const post = (c: string[], p: string, b: object = {}) => request(ctx.server).post(`/api/${p}`).set('Cookie', c).send(b);
const patch = (c: string[], p: string, b: object = {}) => request(ctx.server).patch(`/api/${p}`).set('Cookie', c).send(b);
const del = (c: string[], p: string) => request(ctx.server).delete(`/api/${p}`).set('Cookie', c);

async function registerCustomer(email: string) {
  const reg = await request(ctx.server)
    .post('/api/auth/register')
    .send({ email, password: 'CustomerPass123', firstName: 'C', lastName: 'U', acceptedTerms: true });
  expect(reg.status).toBe(201);
  const user = await ctx.prisma.user.findUniqueOrThrow({ where: { email } });
  return { cookies: cookiesOf(reg), userId: user.id };
}

/** Approved vendor with one published, stocked product. */
async function makeVendorProduct() {
  const s = uniq();
  const v = await registerCustomer(`sas_v${s}@example.bz`);
  await ctx.prisma.userRole.create({ data: { userId: v.userId, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() } });
  const vp = await ctx.prisma.vendorProfile.create({
    data: {
      userId: v.userId,
      businessName: `Snapshot Store ${s}`,
      slug: `snapshot-store-${s}`,
      contactEmail: `sasv${s}@x.bz`,
      approvalStatus: 'APPROVED',
      storeStatus: 'OPEN',
      settings: { create: { deliveryEnabled: true, pickupEnabled: true, baseDeliveryFeeMinor: 500n } },
      locations: { create: { label: 'Main', addressLine1: '1 St', city: 'Belize City', district: 'BELIZE', isPrimary: true } },
    },
  });
  const product = await ctx.prisma.product.create({
    data: { vendorProfileId: vp.id, categoryId, title: `Snapshot Prod ${s}`, slug: `snapshot-prod-${s}`, sku: `SP-${s}`, status: 'PUBLISHED', priceMinor: 1000n, currency: 'BZD', inventory: { create: { quantity: 10, reserved: 0 } } },
  });
  return { vendorProfileId: vp.id, productId: product.id };
}

/** Three hubs and two air routes, the minimum the planner needs for Placencia to San Pedro. */
async function seedNetwork() {
  const hub: Record<string, string> = {};
  for (const h of [
    { code: 'MUN', name: 'Belize City Municipal Airstrip', district: 'BELIZE', city: 'Belize City', fee: 1000 },
    { code: 'SPA', name: 'San Pedro Airstrip', district: 'BELIZE', city: 'San Pedro', fee: 1500 },
    { code: 'PLA', name: 'Placencia Airstrip', district: 'STANN_CREEK', city: 'Placencia', fee: 1200 },
  ]) {
    const r = await post(adminCookies, 'admin/logistics/hubs', { code: h.code, name: h.name, type: 'AIRSTRIP', district: h.district, city: h.city, modes: ['LAND', 'AIR'] });
    hub[h.code] = r.body.id;
    await ctx.prisma.logisticsHub.update({ where: { id: r.body.id }, data: { courierFeeMinor: BigInt(h.fee) } });
  }
  for (const r of [
    { from: 'PLA', to: 'MUN', price: 8000 },
    { from: 'MUN', to: 'SPA', price: 6000 },
  ]) {
    await post(adminCookies, 'admin/logistics/routes', { originHubId: hub[r.from], destinationHubId: hub[r.to], mode: 'AIR', durationMinutes: 45, priceMinor: r.price, carrierName: 'Tropic Air' });
  }
}

const SHIPMENT_ADDRESS_FIELDS = {
  originName: true, originPhone: true, originEmail: true, originCompany: true, originAddress: true, originAddress2: true,
  originCity: true, originDistrict: true, originLatitude: true, originLongitude: true, originInstructions: true,
  destinationName: true, destinationPhone: true, destinationEmail: true, destinationCompany: true, destinationAddress: true,
  destinationAddress2: true, destinationCity: true, destinationDistrict: true, destinationLatitude: true, destinationLongitude: true,
  destinationInstructions: true,
} as const;

const ORDER_ADDRESS_FIELDS = {
  fullName: true, phone: true, addressLine1: true, addressLine2: true, city: true, district: true, country: true,
  latitude: true, longitude: true, instructions: true,
} as const;

beforeAll(async () => {
  ctx = await bootApp();
  await resetDb(ctx.prisma);
  await seedRoles(ctx.prisma);
  const admin = await seedSuperAdmin(ctx.prisma);
  const login = await request(ctx.server).post('/api/auth/login').send({ email: admin.email, password: admin.password });
  expect(login.status).toBe(201);
  adminCookies = cookiesOf(login);
  const cat = await ctx.prisma.category.create({ data: { name: 'Snapshot General', slug: `snapshot-gen-${uniq()}` } });
  categoryId = cat.id;
  await seedNetwork();
});

afterAll(async () => {
  await ctx.app.close();
});

describe('editing or deleting a saved address leaves recorded shipment and order snapshots untouched', () => {
  it('a shipment and an order booked from a saved address keep byte-identical address snapshots through an edit and then a delete', async () => {
    const customer = await registerCustomer(`sas_c${uniq()}@example.bz`);

    // The customer saves an address, then books using its values, as the forms do.
    const saved = await post(customer.cookies, 'addresses', { label: 'Home', fullName: 'Original Name', phone: '501-600-1234', addressLine1: '12 Queen Street', city: 'Belize City', district: 'BELIZE' });
    expect(saved.status).toBe(201);
    const addressId = saved.body.id as string;
    const destination = { name: 'Original Name', phone: '501-600-1234', address: '12 Queen Street', city: 'Belize City', district: 'BELIZE' };

    const ship = await post(customer.cookies, 'shipping', {
      service: 'DOOR_TO_DOOR',
      origin: { district: 'STANN_CREEK', city: 'Placencia', address: '1 Sidewalk', name: 'Sender', phone: '501-2223333' },
      destination,
      preferredMode: 'AIR',
      description: 'Snapshot box',
      payWithWallet: false,
    });
    expect(ship.status).toBe(201);
    const shipmentId = ship.body.id as string;

    const vendor = await makeVendorProduct();
    await post(customer.cookies, 'cart/items', { productId: vendor.productId, quantity: 1 }).expect(201);
    const order = await post(customer.cookies, 'checkout', {
      vendors: [{ vendorProfileId: vendor.vendorProfileId, deliveryMethod: 'DELIVERY' }],
      deliveryAddress: { fullName: destination.name, phone: destination.phone, addressLine1: destination.address, city: destination.city, district: destination.district },
      payWithWallet: false,
    });
    expect(order.status).toBe(201);
    const orderId = order.body.id as string;

    const shipmentSnapshot = async () =>
      JSON.stringify(await ctx.prisma.shipment.findUniqueOrThrow({ where: { id: shipmentId }, select: SHIPMENT_ADDRESS_FIELDS }));
    const orderSnapshot = async () =>
      JSON.stringify(await ctx.prisma.orderAddress.findFirstOrThrow({ where: { orderId }, select: ORDER_ADDRESS_FIELDS }));

    const shipBefore = await shipmentSnapshot();
    const orderBefore = await orderSnapshot();
    expect(shipBefore).toContain('12 Queen Street');
    expect(orderBefore).toContain('12 Queen Street');

    // EDIT the saved address.
    const edited = await patch(customer.cookies, `addresses/${addressId}`, { addressLine1: '99 Changed Road', city: 'Changed Town', fullName: 'Changed Name' });
    expect(edited.status).toBe(200);
    const readBack = await get(customer.cookies, 'addresses');
    expect(readBack.body.find((a: { id: string }) => a.id === addressId).addressLine1).toBe('99 Changed Road'); // control: the edit really happened
    expect(await shipmentSnapshot()).toBe(shipBefore);
    expect(await orderSnapshot()).toBe(orderBefore);

    // DELETE the saved address.
    const removed = await del(customer.cookies, `addresses/${addressId}`);
    expect(removed.status).toBe(200);
    const listAfter = await get(customer.cookies, 'addresses');
    expect(listAfter.body.find((a: { id: string }) => a.id === addressId)).toBeUndefined(); // control: the delete really happened
    expect(await shipmentSnapshot()).toBe(shipBefore);
    expect(await orderSnapshot()).toBe(orderBefore);
  });
});
