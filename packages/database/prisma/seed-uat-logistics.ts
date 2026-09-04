/**
 * UAT logistics seed — a walkable simulation shipping network.
 *
 * Builds everything the manual-dispatch walkthrough needs, END TO END, with
 * every piece marked isTest so the simulation boundary holds:
 *
 *   * two simulation terminals (Belize City ⇄ Belmopan), a LAND route between
 *     them, and a priced courier lane;
 *   * a simulation customer with a funded test wallet and one PAID
 *     DOOR_TO_HUB shipment (unpaid shipments correctly refuse assignment,
 *     so payment is load-bearing);
 *   * a simulation driver on a DIFFERENT user (the self-delivery exclusion
 *     empties the pool otherwise): approved role, ONLINE, in-district, with
 *     an approved vehicle whose documents have future expiry dates;
 *   * two operations admins: one holding logistics.read+operate+verify and
 *     one holding read+operate but NOT verify, so the #12 permission split
 *     can be demonstrated rather than asserted.
 *
 * HOW: wherever an endpoint exists, this script drives the REAL API over
 * HTTP — a hub created by POST admin/logistics/hubs is a hub the product can
 * actually produce. One direct Prisma write remains, marked FALLBACK below:
 * granting the ADMIN staff role (no endpoint grants admin roles; the base
 * seed does the same for SUPER_ADMIN). The two fallbacks earlier revisions
 * needed — pricing hubs and flagging hubs/routes isTest — were API gaps
 * fixed by #19, and this seed now exercises those endpoints for real: if
 * either call fails, #19 does not work as claimed.
 *
 * Idempotent — safe to run repeatedly. Reuses anything it already created;
 * only the walkthrough shipment is created fresh when no active one exists,
 * so every run leaves exactly one parcel to walk.
 *
 * Requires: `pnpm db:seed` run once before (roles + super admin), and the API
 * running locally (`pnpm --filter @bmpl/api dev`).
 *
 * Run: pnpm --filter @bmpl/database seed:uat
 */
import 'dotenv/config';
import { prisma } from '../src/index';

/* ------------------------------------------------------------------ guard */

/**
 * This seed writes business data and flips isTest flags. It must never run
 * against anything but a local development database — refuse loudly rather
 * than trust that nobody ever exports the wrong DATABASE_URL.
 */
function assertDevelopmentEnvironment(): void {
  const fail = (why: string): never => {
    console.error(`✗ REFUSING TO SEED: ${why}`);
    process.exit(1);
  };
  if (process.env.NODE_ENV === 'production') fail('NODE_ENV is production.');
  const raw = process.env.DATABASE_URL;
  if (!raw) fail('DATABASE_URL is not set.');
  let url: URL;
  try {
    url = new URL(raw as string);
  } catch {
    return fail('DATABASE_URL is not a parseable URL.');
  }
  if (!['localhost', '127.0.0.1'].includes(url.hostname)) {
    fail(`database host "${url.hostname}" is not localhost.`);
  }
  const dbName = url.pathname.replace(/^\//, '');
  if (dbName === 'bmpl_test') {
    fail('DATABASE_URL points at bmpl_test — that database belongs to the integration suite.');
  }
  if (dbName !== 'bmpl') {
    fail(`database "${dbName}" is not the local development database "bmpl".`);
  }
  const api = new URL(API_BASE);
  if (!['localhost', '127.0.0.1'].includes(api.hostname)) {
    fail(`API base "${API_BASE}" is not local.`);
  }
}

/* ------------------------------------------------------------- http client */

const API_BASE = process.env.UAT_SEED_API_URL ?? 'http://localhost:4000';

interface ApiFailure {
  status: number;
  message: string;
  body: unknown;
}

/**
 * A minimal cookie-session API client. Sends NO Origin header on purpose:
 * the CSRF guard treats origin-less callers as non-browser clients, which is
 * exactly what this is — so the session cookie alone authenticates, the same
 * way any server-side integration would.
 */
class Client {
  private cookies = new Map<string, string>();
  constructor(public readonly label: string) {}

  private cookieHeader(): string {
    return [...this.cookies.entries()].map(([k, v]) => `${k}=${v}`).join('; ');
  }

  private absorb(res: Response): void {
    for (const line of res.headers.getSetCookie()) {
      const [pair] = line.split(';');
      if (!pair) continue;
      const eq = pair.indexOf('=');
      if (eq < 1) continue;
      this.cookies.set(pair.slice(0, eq).trim(), pair.slice(eq + 1).trim());
    }
  }

  async call<T>(method: string, path: string, body?: unknown): Promise<T> {
    const res = await fetch(`${API_BASE}/api${path}`, {
      method,
      headers: {
        'content-type': 'application/json',
        ...(this.cookies.size > 0 ? { cookie: this.cookieHeader() } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    this.absorb(res);
    const text = await res.text();
    let data: unknown = null;
    try {
      data = text ? JSON.parse(text) : null;
    } catch {
      data = text;
    }
    if (!res.ok) {
      const message =
        typeof data === 'object' && data !== null && 'message' in data
          ? String((data as { message: unknown }).message)
          : `HTTP ${res.status}`;
      throw { status: res.status, message, body: data } satisfies ApiFailure;
    }
    return data as T;
  }

  /** Raw-byte upload, the way the product uploads documents: bytes in, key out. */
  async upload<T>(path: string, bytes: Uint8Array, contentType: string): Promise<T> {
    const res = await fetch(`${API_BASE}/api${path}`, {
      method: 'POST',
      headers: {
        'content-type': contentType,
        ...(this.cookies.size > 0 ? { cookie: this.cookieHeader() } : {}),
      },
      body: bytes,
    });
    this.absorb(res);
    const data: unknown = await res.json().catch(() => null);
    if (!res.ok) {
      const message =
        typeof data === 'object' && data !== null && 'message' in data
          ? String((data as { message: unknown }).message)
          : `HTTP ${res.status}`;
      throw { status: res.status, message, body: data } satisfies ApiFailure;
    }
    return data as T;
  }

  get = <T>(path: string) => this.call<T>('GET', path);
  post = <T>(path: string, body?: unknown) => this.call<T>('POST', path, body);
  put = <T>(path: string, body?: unknown) => this.call<T>('PUT', path, body);
  patch = <T>(path: string, body?: unknown) => this.call<T>('PATCH', path, body);

  async login(email: string, password: string): Promise<void> {
    await this.post('/auth/login', { email, password });
    console.info(`  → signed in as ${this.label} (${email})`);
  }
}

const isFailure = (e: unknown): e is ApiFailure =>
  typeof e === 'object' && e !== null && 'status' in e && 'message' in e;

/* ---------------------------------------------------------------- fixtures */

// Simulation fixtures, named so nobody mistakes them for a real network. The
// towns are real (a UAT depot has to sit somewhere the district enum can
// name); the depots, the carrier and every rate are explicitly simulation.
const HUB_A = {
  code: 'UATBC',
  name: 'Belize City UAT Depot (simulation)',
  type: 'WAREHOUSE',
  district: 'BELIZE',
  city: 'Belize City',
  modes: ['LAND'],
  isTest: true,
};
const HUB_B = {
  code: 'UATBP',
  name: 'Belmopan UAT Depot (simulation)',
  type: 'WAREHOUSE',
  district: 'CAYO',
  city: 'Belmopan',
  modes: ['LAND'],
  isTest: true,
};
const HUB_COURIER_FEE_MINOR = 700; // BZ$7.00 simulation first/last-mile rate
const ROUTE = { mode: 'LAND', carrierName: 'UAT Simulation Carrier', durationMinutes: 90, priceMinor: 1500, isTest: true };
const LANE = {
  originDistrict: 'BELIZE',
  originCity: 'Belize City',
  destinationDistrict: 'CAYO',
  destinationCity: 'Belmopan',
  priceMinor: 2500,
  durationMinutes: 120,
  note: 'UAT simulation lane',
  isTest: true,
};

const PASSWORD = process.env.UAT_SEED_PASSWORD ?? 'UatWalkthrough!123';
const USERS = {
  opsFull: { email: 'uat-ops-full@bzemarketplace.com', firstName: 'Uat', lastName: 'OpsFull' },
  opsLimited: { email: 'uat-ops-limited@bzemarketplace.com', firstName: 'Uat', lastName: 'OpsLimited' },
  customer: { email: 'uat-customer@bzemarketplace.com', firstName: 'Uat', lastName: 'Sender' },
  driver: { email: 'uat-driver@bzemarketplace.com', firstName: 'Uat', lastName: 'Driver' },
};

const OPS_FULL_PERMISSIONS = ['logistics.read', 'logistics.manage', 'logistics.operate', 'logistics.verify'];
const OPS_LIMITED_PERMISSIONS = ['logistics.read', 'logistics.operate'];

/* ------------------------------------------------------------------- steps */

async function ensureUser(admin: Client, who: { email: string; firstName: string; lastName: string }): Promise<string> {
  const anon = new Client(who.email);
  try {
    await anon.post('/auth/register', {
      email: who.email,
      password: PASSWORD,
      firstName: who.firstName,
      lastName: who.lastName,
      acceptedTerms: true,
    });
    console.info(`  ✓ registered ${who.email}`);
  } catch (e) {
    if (!isFailure(e) || e.status >= 500) throw e;
    console.info(`  • ${who.email} already registered (${e.message})`);
  }
  // The id comes from the admin user directory rather than a direct query —
  // same source the admin console uses.
  const found = await admin.get<{ items: Array<{ id: string; email: string }> }>(
    `/admin/users?query=${encodeURIComponent(who.email)}`,
  );
  const row = found.items.find((r) => r.email === who.email);
  if (!row) throw new Error(`Could not find ${who.email} in /admin/users after registering.`);
  return row.id;
}

async function main(): Promise<void> {
  assertDevelopmentEnvironment();

  // Preflight: the API must be running, because this seed IS an API client.
  try {
    await new Client('preflight').get('/health');
  } catch {
    console.error(`✗ The API is not reachable at ${API_BASE}. Start it first: pnpm --filter @bmpl/api dev`);
    process.exit(1);
  }

  console.info('Seeding the UAT logistics walkthrough…');

  // ---- super admin session (created by the base seed) ----------------------
  const superAdmin = new Client('super admin');
  try {
    await superAdmin.login(
      process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@bzemarketplace.com',
      process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe!Admin123',
    );
  } catch (e) {
    console.error('✗ Could not sign in as the seeded super admin. Run `pnpm db:seed` first.');
    throw e;
  }

  // ---- people --------------------------------------------------------------
  console.info('• People');
  const opsFullId = await ensureUser(superAdmin, USERS.opsFull);
  const opsLimitedId = await ensureUser(superAdmin, USERS.opsLimited);
  const customerId = await ensureUser(superAdmin, USERS.customer);
  const driverId = await ensureUser(superAdmin, USERS.driver);

  // Permission SETS (replace semantics → idempotent). The limited admin
  // deliberately lacks logistics.verify: demonstrating that refusal is part
  // of the walkthrough, not an accident.
  await superAdmin.post('/admin/permissions', { userId: opsFullId, permissions: OPS_FULL_PERMISSIONS });
  await superAdmin.post('/admin/permissions', { userId: opsLimitedId, permissions: OPS_LIMITED_PERMISSIONS });
  console.info('  ✓ ops permissions set (full: +verify; limited: operate only)');

  // FALLBACK — the one direct write left: no endpoint grants admin staff
  // roles; the base seed writes SUPER_ADMIN's the same way. The ADMIN role
  // is what lets the admin app treat these two as staff at all.
  for (const userId of [opsFullId, opsLimitedId]) {
    await prisma.userRole.upsert({
      where: { userId_roleCode: { userId, roleCode: 'ADMIN' } },
      update: { status: 'APPROVED' },
      create: { userId, roleCode: 'ADMIN', status: 'APPROVED', approvedAt: new Date() },
    });
  }
  console.info('  ✓ ADMIN staff role granted to both ops accounts (direct write — no endpoint exists)');

  // Simulation people are marked through the real admin endpoint.
  await superAdmin.post('/admin/users/test-flag', { userId: customerId, isTest: true, reason: 'UAT logistics walkthrough seed' });
  await superAdmin.post('/admin/users/test-flag', { userId: driverId, isTest: true, reason: 'UAT logistics walkthrough seed' });
  console.info('  ✓ customer + driver flagged isTest');

  // ---- the network ---------------------------------------------------------
  console.info('• Network');
  const opsFull = new Client('ops (full)');
  await opsFull.login(USERS.opsFull.email, PASSWORD);

  type HubRow = { id: string; code: string; courierFeeMinor: number; isActive: boolean; isTest: boolean };
  const hubs = await opsFull.get<HubRow[]>('/admin/logistics/hubs');
  async function ensureHub(spec: typeof HUB_A): Promise<string> {
    const existing = hubs.find((h) => h.code === spec.code);
    if (existing) {
      console.info(`  • hub ${spec.code} already exists`);
      if (!existing.isTest) {
        await opsFull.patch(`/admin/logistics/hubs/${existing.id}`, { isTest: true });
        console.info(`  ✓ hub ${spec.code} flagged isTest via PATCH (#19)`);
      }
      return existing.id;
    }
    const made = await opsFull.post<HubRow>('/admin/logistics/hubs', spec);
    console.info(`  ✓ hub ${spec.code} created via POST admin/logistics/hubs (isTest inline, #19)`);
    return made.id;
  }
  const hubAId = await ensureHub(HUB_A);
  const hubBId = await ensureHub(HUB_B);

  // The rate goes through the SAME PATCH the Terminals screen sends — the
  // path that was defective until #19 added courierFeeMinor to the schema.
  // This is a live check of that fix: if this call fails, #19 is broken.
  for (const id of [hubAId, hubBId]) {
    await opsFull.patch(`/admin/logistics/hubs/${id}`, { courierFeeMinor: HUB_COURIER_FEE_MINOR });
  }
  console.info(`  ✓ courier rate BZ$${(HUB_COURIER_FEE_MINOR / 100).toFixed(2)} set via PATCH admin/logistics/hubs/:id (#19 fix, exercised)`);

  type RouteRow = { id: string; originHubId: string; destinationHubId: string; mode: string; isTest: boolean };
  const routes = await opsFull.get<RouteRow[]>('/admin/logistics/routes');
  const wantRoute = (o: string, d: string) =>
    routes.find((r) => r.originHubId === o && r.destinationHubId === d && r.mode === ROUTE.mode);
  for (const [o, d] of [
    [hubAId, hubBId],
    [hubBId, hubAId],
  ] as const) {
    const existing = wantRoute(o, d);
    if (existing) {
      console.info('  • route already exists');
      if (!existing.isTest) {
        await opsFull.patch(`/admin/logistics/routes/${existing.id}`, { isTest: true });
        console.info('  ✓ route flagged isTest via PATCH (#19)');
      }
      continue;
    }
    await opsFull.post<RouteRow>('/admin/logistics/routes', {
      originHubId: o,
      destinationHubId: d,
      ...ROUTE,
    });
    console.info('  ✓ route created via POST admin/logistics/routes (isTest inline, #19)');
  }

  type LaneRow = { id: string; originCity: string; destinationCity: string };
  const lanes = await opsFull.get<LaneRow[]>('/admin/logistics/courier-lanes');
  if (!lanes.some((l) => l.originCity === LANE.originCity && l.destinationCity === LANE.destinationCity)) {
    await opsFull.post('/admin/logistics/courier-lanes', LANE);
    console.info('  ✓ courier lane created via POST admin/logistics/courier-lanes (isTest via the API — the one network piece that supports it)');
  } else {
    console.info('  • courier lane already exists');
  }

  // ---- the driver ----------------------------------------------------------
  console.info('• Driver');
  const driver = new Client('driver');
  await driver.login(USERS.driver.email, PASSWORD);

  const inAYear = new Date();
  inAYear.setFullYear(inAYear.getFullYear() + 1);

  await driver.put('/driver/profile', {
    legalName: 'UAT Walkthrough Driver',
    displayName: 'UAT Driver',
    phone: '+501-600-0000',
    homeDistrict: 'BELIZE',
    licenceNumber: 'UAT-000001',
    licenceExpiry: inAYear.toISOString(),
    vehicleOwnership: 'OWNED',
    termsAccepted: true,
  });
  console.info('  ✓ driver profile upserted via PUT driver/profile');

  type VehicleRow = { id: string; licencePlate: string; approvalStatus: string };
  let vehicles = await driver.get<VehicleRow[]>('/driver/vehicles');
  if (!vehicles.some((v) => v.licencePlate === 'UAT-0001')) {
    await driver.post('/driver/vehicles', {
      type: 'VAN',
      make: 'UAT',
      model: 'Walkthrough Van',
      licencePlate: 'UAT-0001',
      registrationExpiry: inAYear.toISOString(),
      insuranceExpiry: inAYear.toISOString(),
      isPrimary: true,
    });
    vehicles = await driver.get<VehicleRow[]>('/driver/vehicles');
    console.info('  ✓ vehicle added (registration + insurance valid a year out — the pool drops expired-or-missing)');
  }
  const vehicle = vehicles.find((v) => v.licencePlate === 'UAT-0001');
  if (!vehicle) throw new Error('The UAT vehicle disappeared between POST and GET.');

  await driver.put('/driver/service-areas', { districts: ['BELIZE'] });
  console.info('  ✓ service area: BELIZE');

  // The DELIVERY_DRIVER role, through the real application + review flow.
  type MyApplication = { id: string; roleCode: string; status: string };
  const myApps = await driver.get<MyApplication[]>('/roles/applications');
  let application = myApps.find((a) => a.roleCode === 'DELIVERY_DRIVER');
  if (!application) {
    // The role requires supporting documents, so one goes through the real
    // upload path: raw bytes to the API, storage key back, key on the form.
    const pdf = new TextEncoder().encode(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
        '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF\n',
    );
    const uploaded = await driver.upload<{ key?: string; storageKey?: string }>(
      '/roles/applications/DELIVERY_DRIVER/documents/upload?filename=uat-licence.pdf',
      pdf,
      'application/pdf',
    );
    const documentKey = uploaded.key ?? uploaded.storageKey;
    if (!documentKey) throw new Error(`Document upload returned no key: ${JSON.stringify(uploaded)}`);
    console.info('  ✓ supporting document uploaded via POST roles/applications/:roleCode/documents/upload');
    await driver.post('/roles/applications', {
      roleCode: 'DELIVERY_DRIVER',
      message: 'UAT logistics walkthrough seed',
      documentKeys: [documentKey],
    });
    console.info('  ✓ DELIVERY_DRIVER application submitted');
    // Re-read rather than trusting the submit response shape: the listing is
    // the contract the applicant's own screen uses.
    const refreshed = await driver.get<MyApplication[]>('/roles/applications');
    application = refreshed.find((a) => a.roleCode === 'DELIVERY_DRIVER');
    if (!application) throw new Error('The DELIVERY_DRIVER application did not appear in /roles/applications.');
  }
  if (application.status !== 'APPROVED') {
    await superAdmin.post('/admin/applications/approve', { applicationId: application.id, note: 'UAT walkthrough seed' });
    console.info('  ✓ application approved via POST admin/applications/approve');
  } else {
    console.info('  • DELIVERY_DRIVER already approved');
  }

  if (vehicle.approvalStatus !== 'APPROVED') {
    await superAdmin.post(`/admin/drivers/vehicles/${vehicle.id}/approve`, {});
    console.info('  ✓ vehicle approved via POST admin/drivers/vehicles/:id/approve');
  }

  // Simulation driver — through the real admin endpoint built for exactly this.
  type DriverDirectoryRow = { id: string; email: string };
  const directory = await superAdmin.get<DriverDirectoryRow[]>('/admin/drivers');
  const driverProfileRow = directory.find((d) => d.email === USERS.driver.email);
  if (!driverProfileRow) throw new Error('Driver profile not found in /admin/drivers.');
  await superAdmin.patch(`/admin/drivers/${driverProfileRow.id}/test-mode`, { isTest: true, reason: 'UAT walkthrough seed' });
  console.info('  ✓ driver profile flagged isTest via PATCH admin/drivers/:id/test-mode');

  await driver.patch('/driver/availability', { availability: 'ONLINE' });
  console.info('  ✓ driver ONLINE');

  // ---- the customer, funded and shipping ----------------------------------
  console.info('• Customer');
  const customer = new Client('customer');
  await customer.login(USERS.customer.email, PASSWORD);

  // Funding through the admin test-credit endpoint (the self-service flag is
  // not set in this environment, and turning env flags on is not this
  // script's business). Two grants cover the shipment comfortably.
  const CREDIT = { amountMinor: 100_000, reason: 'UAT logistics walkthrough funding' };
  await superAdmin.post('/admin/wallet/test-credit', { userId: customerId, ...CREDIT });
  console.info(`  ✓ BZ$${(CREDIT.amountMinor / 100).toFixed(2)} test credit granted via POST admin/wallet/test-credit`);

  // One WALKABLE parcel per run: reuse only a shipment still waiting for its
  // first-mile assignment — anything further along has been walked already,
  // so a fresh one is booked through the real quote → create(payWithWallet)
  // flow and each run leaves exactly one parcel ready to assign.
  type MineRow = { reference: string; status: string };
  const mine = await customer.get<MineRow[]>('/shipping');
  const active = mine.find((s) => s.status === 'AWAITING_PICKUP');
  if (active) {
    console.info(`  • walkable shipment already waiting: ${active.reference} (${active.status})`);
  } else {
    const booking = {
      service: 'DOOR_TO_HUB',
      origin: {
        name: 'Uat Sender',
        phone: '+501-600-0001',
        address: '12 UAT Walkthrough Street',
        city: 'Belize City',
        district: 'BELIZE',
      },
      destination: {
        hubId: hubBId,
        name: 'Uat Recipient',
        phone: '+501-600-0002',
      },
      pieces: 1,
      description: 'UAT walkthrough parcel',
      payWithWallet: true,
    };
    await customer.post('/shipping/quote', booking);
    const created = await customer.post<{ reference?: string }>('/shipping', booking);
    console.info(`  ✓ shipment booked and PAID via POST shipping (payWithWallet): ${created.reference ?? '(no reference returned)'}`);
  }

  console.info('\nUAT walkthrough environment ready.');
  console.info(`  admin (full):    ${USERS.opsFull.email}`);
  console.info(`  admin (limited): ${USERS.opsLimited.email}  ← no logistics.verify, on purpose`);
  console.info(`  customer:        ${USERS.customer.email}`);
  console.info(`  driver:          ${USERS.driver.email}`);
  console.info('  (all passwords: the UAT_SEED_PASSWORD env var, or the script default)');
}

main()
  .catch((err) => {
    console.error('UAT seed failed:', isFailure(err) ? `${err.status} ${err.message} ${JSON.stringify(err.body)}` : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
