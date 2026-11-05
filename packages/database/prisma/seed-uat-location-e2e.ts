/**
 * UAT fixtures for the location/address/map E2E harness (MDF-535, feeding
 * MDF-485's 14 owner-named checks).
 *
 * Fills two gaps `apps/web/e2e/support/auth.ts` had going into this phase:
 *
 *   1. A SECOND customer. Check #13 ("a user cannot access or modify another
 *      customer's saved addresses") is structurally impossible to test with
 *      one account — there is no "another customer" to attempt against.
 *   2. A SHIPPING_PROVIDER fixture at all. ROLE_FIXTURES has never had one
 *      (confirmed by grep before writing this: zero references in seed.ts,
 *      seed-uat-roles.ts or seed-uat-logistics.ts) — the exact gap the
 *      carrier-loop E2E phase flagged and could never close, because no
 *      reproducible carrier account existed to log in as.
 *
 * Self-contained in its own file rather than extending seed-uat-logistics.ts
 * or seed-uat-roles.ts, same reasoning as seed-uat-logistics.ts's own
 * dispatchVendor fixture: avoids a cross-script run-order dependency, and
 * this phase's fixtures are conceptually unrelated to the manual-dispatch
 * walkthrough or the five-role audit those files already serve.
 *
 * HOW: drives the REAL API over HTTP wherever an endpoint exists, same
 * discipline as every other UAT seed in this directory. The carrier's
 * SHIPPING_PROVIDER role goes through the real role-application +
 * document-upload + admin-approve flow (packages/shared/src/roles.ts marks
 * it requiresApproval:true, requiredDocuments: ['Business registration',
 * 'Operating/transport permit'] — not a role an account gets for free), then
 * the carrier's ORGANIZATION goes through its own, separate self-service
 * PUT .../profile (PENDING) + admin POST .../approve lifecycle — two
 * independent approvals, matching apps/api/test/carrier-provider-lifecycle
 * .integration.spec.ts's own registerCarrier()/makeCarrier() shape, just
 * driven here as a real two-step UAT fixture instead of a test-local helper.
 *
 * Idempotent — safe to run repeatedly; every step checks current state first.
 *
 * Requires: `pnpm db:seed` run once before (roles + super admin), and the API
 * running locally (`pnpm --filter @bmpl/api dev`).
 *
 * Run: pnpm --filter @bmpl/database seed:uat-location-e2e
 */
import 'dotenv/config';
import { prisma } from '../src/index';

/* ------------------------------------------------------------------ guard */

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

/** Same minimal cookie-session client as seed-uat-logistics.ts — see that
 *  file's own copy for why it sends no Origin header. */
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

const PASSWORD = process.env.UAT_SEED_PASSWORD ?? 'UatWalkthrough!123';

const CUSTOMER_2 = { email: 'uat-customer-2@bzemarketplace.com', firstName: 'Uat', lastName: 'SecondCustomer' };
const CARRIER_OWNER = { email: 'uat-carrier@bzemarketplace.com', firstName: 'Uat', lastName: 'CarrierOwner' };
const CARRIER_BUSINESS_NAME = 'UAT Location-E2E Carrier (simulation)';
// A dedicated, OPEN vendor+product for checks #7/#8 (checkout -> order record)
// — NOT seed.ts's public 'uat-walk-store-simulation', which ships CLOSED on
// purpose (MDF-410's own dispatch fixture needed the same workaround, for
// the same reason: checkout refuses "currently closed" regardless of
// isTest). Own email, same reasoning as seed-uat-logistics.ts's
// dispatchVendor: this script can run independently of run order.
const LOCATION_VENDOR = { email: 'uat-location-vendor@bzemarketplace.com', firstName: 'Uat', lastName: 'LocationVendor' };
const LOCATION_VENDOR_BUSINESS_NAME = 'UAT Location-E2E Delivery Store (simulation)';
const LOCATION_PRODUCT_SKU = 'UATLOCATIONE2E-1';

const PDF = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
    '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF\n',
);

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
  const found = await admin.get<{ items: Array<{ id: string; email: string }> }>(
    `/admin/users?query=${encodeURIComponent(who.email)}`,
  );
  const row = found.items.find((r) => r.email === who.email);
  if (!row) throw new Error(`Could not find ${who.email} in /admin/users after registering.`);
  return row.id;
}

/** Same real-mailbox verification sequence as seed-uat-logistics.ts. */
async function ensureEmailVerified(client: Client, email: string): Promise<void> {
  const me = await client.get<{ emailVerified: boolean }>('/me');
  if (me.emailVerified) {
    console.info(`  • ${email} already verified`);
    return;
  }
  type CapturedEmail = { to: string; subject: string; body: string; createdAt: string };
  let captured: CapturedEmail;
  try {
    captured = await client.get<CapturedEmail>(`/dev/emails/latest?email=${encodeURIComponent(email)}`);
  } catch (e) {
    throw new Error(
      `${email} is not verified and no verification email was captured at /dev/emails/latest — cannot proceed. ` +
        `(${isFailure(e) ? e.message : String(e)})`,
    );
  }
  const token = /token=([A-Za-z0-9_-]+)/.exec(captured.body)?.[1];
  if (!token) throw new Error(`Captured email for ${email} had no verification token in its body.`);
  await client.post('/auth/verify-email', { token });
  console.info(`  ✓ ${email} verified via the dev mailbox, through the real /auth/verify-email flow`);
}

async function main(): Promise<void> {
  assertDevelopmentEnvironment();

  try {
    await new Client('preflight').get('/health');
  } catch {
    console.error(`✗ The API is not reachable at ${API_BASE}. Start it first: pnpm --filter @bmpl/api dev`);
    process.exit(1);
  }

  console.info('Seeding location/address E2E fixtures (MDF-535)…');

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

  // ---- second customer (check #13: cross-customer isolation needs two accounts) ----
  console.info('• Second customer');
  const customer2Id = await ensureUser(superAdmin, CUSTOMER_2);
  await superAdmin.post('/admin/users/test-flag', { userId: customer2Id, isTest: true, reason: 'MDF-535 location E2E harness' });
  console.info(`  ✓ ${CUSTOMER_2.email} ready and flagged isTest`);

  // ---- carrier (SHIPPING_PROVIDER role + organization, two independent approvals) ----
  console.info('• Carrier (SHIPPING_PROVIDER)');
  const carrierOwnerId = await ensureUser(superAdmin, CARRIER_OWNER);
  await superAdmin.post('/admin/users/test-flag', { userId: carrierOwnerId, isTest: true, reason: 'MDF-535 location E2E harness' });

  const carrierOwner = new Client('carrier owner');
  await carrierOwner.login(CARRIER_OWNER.email, PASSWORD);

  type MyApplication = { id: string; roleCode: string; status: string };
  const myApps = await carrierOwner.get<MyApplication[]>('/roles/applications');
  let application = myApps.find((a) => a.roleCode === 'SHIPPING_PROVIDER');
  if (!application) {
    await ensureEmailVerified(carrierOwner, CARRIER_OWNER.email);
    // Two required documents (packages/shared/src/roles.ts: 'Business
    // registration', 'Operating/transport permit') — both the same
    // throwaway PDF bytes, same as every other document-gated UAT fixture
    // in this directory.
    const businessReg = await carrierOwner.upload<{ key?: string; storageKey?: string }>(
      '/roles/applications/SHIPPING_PROVIDER/documents/upload?filename=uat-carrier-business-registration.pdf',
      PDF,
      'application/pdf',
    );
    const permit = await carrierOwner.upload<{ key?: string; storageKey?: string }>(
      '/roles/applications/SHIPPING_PROVIDER/documents/upload?filename=uat-carrier-operating-permit.pdf',
      PDF,
      'application/pdf',
    );
    const businessRegKey = businessReg.key ?? businessReg.storageKey;
    const permitKey = permit.key ?? permit.storageKey;
    if (!businessRegKey || !permitKey) {
      throw new Error(`Document upload returned no key: ${JSON.stringify({ businessReg, permit })}`);
    }
    await carrierOwner.post('/roles/applications', {
      roleCode: 'SHIPPING_PROVIDER',
      message: 'MDF-535 location E2E harness seed',
      documentKeys: [businessRegKey, permitKey],
    });
    console.info('  ✓ SHIPPING_PROVIDER application submitted');
    const refreshed = await carrierOwner.get<MyApplication[]>('/roles/applications');
    application = refreshed.find((a) => a.roleCode === 'SHIPPING_PROVIDER');
    if (!application) throw new Error('The SHIPPING_PROVIDER application did not appear in /roles/applications.');
  }
  if (application.status !== 'APPROVED') {
    await superAdmin.post('/admin/applications/approve', { applicationId: application.id, note: 'MDF-535 location E2E harness seed' });
    console.info('  ✓ SHIPPING_PROVIDER role approved via POST admin/applications/approve');
  } else {
    console.info('  • SHIPPING_PROVIDER role already approved');
  }

  // The ORGANIZATION is a second, independent lifecycle (D1/D1b, MDF-500) —
  // an approved role alone grants zero operational privilege. Self-service
  // PUT upserts (PENDING on first create), admin approve makes it real.
  type ProviderProfile = { id: string; status: string; businessName: string };
  let profile = await carrierOwner.get<ProviderProfile | null>('/shipping/provider/profile').catch(() => null);
  if (!profile) {
    profile = await carrierOwner.put<ProviderProfile>('/shipping/provider/profile', {
      businessName: CARRIER_BUSINESS_NAME,
      contactEmail: CARRIER_OWNER.email,
    });
    console.info('  ✓ carrier organization profile created via PUT shipping/provider/profile (PENDING)');
  } else {
    console.info(`  • carrier organization profile already exists (${profile.status})`);
  }
  if (profile.status === 'PENDING') {
    await superAdmin.post(`/admin/logistics/providers/${profile.id}/approve`);
    console.info('  ✓ carrier organization approved via POST admin/logistics/providers/:id/approve');
  } else if (profile.status !== 'APPROVED') {
    throw new Error(`Unexpected carrier organization status "${profile.status}" — MDF-535 seed does not handle recovery from this state.`);
  }

  // ---- delivery-enabled storefront + product (checks #7/#8) ----------------
  console.info('• Delivery-enabled storefront + product');
  await ensureUser(superAdmin, LOCATION_VENDOR);
  const locationVendor = new Client('location vendor');
  await locationVendor.login(LOCATION_VENDOR.email, PASSWORD);

  const vendorApps = await locationVendor.get<MyApplication[]>('/roles/applications');
  let vendorApplication = vendorApps.find((a) => a.roleCode === 'VENDOR');
  if (!vendorApplication) {
    await ensureEmailVerified(locationVendor, LOCATION_VENDOR.email);
    const idUpload = await locationVendor.upload<{ key?: string; storageKey?: string }>(
      '/roles/applications/VENDOR/documents/upload?filename=uat-location-vendor-id.pdf',
      PDF,
      'application/pdf',
    );
    const regUpload = await locationVendor.upload<{ key?: string; storageKey?: string }>(
      '/roles/applications/VENDOR/documents/upload?filename=uat-location-vendor-business-registration.pdf',
      PDF,
      'application/pdf',
    );
    const idKey = idUpload.key ?? idUpload.storageKey;
    const regKey = regUpload.key ?? regUpload.storageKey;
    if (!idKey || !regKey) throw new Error(`Document upload returned no key: ${JSON.stringify({ idUpload, regUpload })}`);
    await locationVendor.post('/roles/applications', {
      roleCode: 'VENDOR',
      message: 'MDF-535 location E2E harness seed',
      documentKeys: [idKey, regKey],
    });
    const refreshed = await locationVendor.get<MyApplication[]>('/roles/applications');
    vendorApplication = refreshed.find((a) => a.roleCode === 'VENDOR');
    if (!vendorApplication) throw new Error('The location vendor VENDOR application did not appear in /roles/applications.');
    console.info('  ✓ VENDOR application submitted for the location-harness vendor');
  } else {
    console.info('  • location-harness vendor VENDOR application already exists');
  }
  if (vendorApplication.status !== 'APPROVED') {
    await superAdmin.post('/admin/applications/approve', { applicationId: vendorApplication.id, note: 'MDF-535 location E2E harness seed' });
    console.info('  ✓ location-harness vendor VENDOR role approved');
  }

  type VendorProfileRow = { id: string; businessName: string; approvalStatus: string; storeStatus: string };
  type OwnProfileResponse = { profile: VendorProfileRow | null };
  let vendorProfile = (await locationVendor.get<OwnProfileResponse>('/vendor/profile')).profile;
  if (!vendorProfile) {
    vendorProfile = (
      await locationVendor.post<OwnProfileResponse>('/vendor/profile', {
        businessName: LOCATION_VENDOR_BUSINESS_NAME,
        contactEmail: LOCATION_VENDOR.email,
        description: 'SYNTHETIC QA TEST DATA — exists solely for the MDF-535 location/address E2E harness (checks #7/#8: a saved address reaching a real checkout order). Never a real storefront.',
      })
    ).profile;
    console.info('  ✓ location-harness storefront profile created');
  }
  if (!vendorProfile) throw new Error('Location-harness storefront profile is still null after create.');
  if (vendorProfile.approvalStatus === 'DRAFT' || vendorProfile.approvalStatus === 'REJECTED') {
    await locationVendor.post('/vendor/profile/submit');
    vendorProfile = (await locationVendor.get<OwnProfileResponse>('/vendor/profile')).profile;
    if (!vendorProfile) throw new Error('Location-harness storefront profile disappeared after submit.');
  }
  if (vendorProfile.approvalStatus === 'PENDING') {
    await superAdmin.post(`/admin/vendors/${vendorProfile.id}/approve`, { note: 'MDF-535 location E2E harness seed' });
    console.info('  ✓ location-harness storefront approved');
  } else if (vendorProfile.approvalStatus !== 'APPROVED') {
    throw new Error(`Unexpected location-harness storefront approvalStatus "${vendorProfile.approvalStatus}".`);
  }
  await superAdmin.patch(`/admin/vendors/${vendorProfile.id}/test-mode`, { isTest: true, reason: 'MDF-535 location E2E harness seed' });
  await locationVendor.patch('/vendor/settings', { deliveryEnabled: true, baseDeliveryFeeMinor: 500 });
  if (vendorProfile.storeStatus !== 'OPEN') {
    await locationVendor.patch('/vendor/profile', { storeStatus: 'OPEN' });
    console.info('  ✓ location-harness storefront set to OPEN');
  }

  type CategoryNode = { id: string; slug: string; children: CategoryNode[] };
  function findCategoryBySlug(nodes: CategoryNode[], slug: string): CategoryNode | null {
    for (const n of nodes) {
      if (n.slug === slug) return n;
      const found = findCategoryBySlug(n.children, slug);
      if (found) return found;
    }
    return null;
  }
  const categoryTree = await new Client('preflight').get<CategoryNode[]>('/marketplace/categories');
  const electronicsCategory = findCategoryBySlug(categoryTree, 'electronics');
  if (!electronicsCategory) {
    console.info('  ⚠ no "electronics" category found — skipping the location-harness product (checks #7/#8 will have nothing to add to cart).');
  } else {
    type ProductRow = { id: string; sku: string };
    const existingProducts = await locationVendor.get<ProductRow[]>('/vendor/products');
    const existingProduct = existingProducts.find((p) => p.sku === LOCATION_PRODUCT_SKU);
    if (!existingProduct) {
      await locationVendor.post<ProductRow>('/vendor/products', {
        title: 'UAT Location-E2E Widget (simulation)',
        sku: LOCATION_PRODUCT_SKU,
        categoryId: electronicsCategory.id,
        priceMinor: 1000,
        description: 'SYNTHETIC QA TEST DATA — exists solely for the MDF-535 location/address E2E harness. Not for sale.',
      });
      console.info('  ✓ location-harness product created via POST vendor/products');
    } else {
      console.info('  • location-harness product already exists');
    }
  }

  console.info('\nLocation E2E fixtures ready.');
  console.info(`  customer (second account): ${CUSTOMER_2.email}`);
  console.info(`  carrier (SHIPPING_PROVIDER, approved role + approved org): ${CARRIER_OWNER.email}`);
  console.info(`  delivery vendor (OPEN, deliveryEnabled): ${LOCATION_VENDOR.email}`);
  console.info('  (passwords: the UAT_SEED_PASSWORD env var, or the script default)');
}

main()
  .catch((err) => {
    console.error('MDF-535 location E2E seed failed:', isFailure(err) ? `${err.status} ${err.message} ${JSON.stringify(err.body)}` : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
