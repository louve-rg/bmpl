/**
 * UAT role-coverage seed — Priority 6 Phase 2 fixtures.
 *
 * Built after an audit (2026-10-16) found most of this repo's 14 role codes
 * have no CI-reproducible login fixture: some accounts that LOOK like
 * deliberate UAT fixtures (uat-pax-driver@, uat-real-estate-agent@, etc.)
 * exist only because someone built them once through the real API on one
 * machine's local database, with no committed script behind them — a fresh
 * CI database would never produce them. This script is how that stops being
 * true, one role at a time, starting with the worst-confirmed gap: VENDOR.
 * seed.ts creates a VENDOR application but leaves it PENDING; the APPROVED
 * vendor account some local databases show was approved by a human, by
 * hand, and is not reproducible either.
 *
 * HOW: wherever an endpoint exists, this script drives the REAL API over
 * HTTP, same discipline as seed-uat-logistics.ts — a role approved by
 * POST /admin/applications/approve is a role the product can actually
 * grant. No direct Prisma writes anywhere in this file.
 *
 * Idempotent — safe to run repeatedly against an EXISTING database, not
 * just a fresh one. Every step checks current state before acting: an
 * already-registered account is reused, an already-submitted application is
 * not resubmitted, an already-approved role or profile is left alone. This
 * matters more than it sounds like it should — a call-site placement bug in
 * the sibling script (seed-uat-logistics.ts, same night) once broke the
 * idempotent case for a database where nothing was actually wrong.
 *
 * Duplicates Client/ensureUser/ensureEmailVerified/assertDevelopmentEnvironment
 * from seed-uat-logistics.ts rather than importing them — that file is a
 * script, not a module (it calls main() unconditionally at the bottom), so
 * importing from it would run its entire seed as a side effect. Same
 * accepted-duplication convention this repo already uses between
 * apps/web/e2e/support and apps/admin/e2e/support.
 *
 * Requires: `pnpm db:seed` run once before (roles + super admin), and the
 * API running locally (`pnpm --filter @bmpl/api dev`).
 *
 * Run: pnpm --filter @bmpl/database seed:uat-roles
 */
import 'dotenv/config';

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
const USERS = {
  vendor: { email: 'uat-vendor@bzemarketplace.com', firstName: 'Uat', lastName: 'Vendor' },
  jobSeeker: { email: 'uat-job-seeker@bzemarketplace.com', firstName: 'Uat', lastName: 'Seeker' },
  passengerDriver: { email: 'uat-passenger-driver@bzemarketplace.com', firstName: 'Uat', lastName: 'PassengerDriver' },
  passengerProvider: { email: 'uat-passenger-provider@bzemarketplace.com', firstName: 'Uat', lastName: 'PassengerProvider' },
};

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
  const found = await admin.get<{ items: Array<{ id: string; email: string }> }>(
    `/admin/users?query=${encodeURIComponent(who.email)}`,
  );
  const row = found.items.find((r) => r.email === who.email);
  if (!row) throw new Error(`Could not find ${who.email} in /admin/users after registering.`);
  return row.id;
}

/** Same sequence as seed-uat-logistics.ts's helper of the same name — see
 * that file's comment for the full rationale. Duplicated, not imported, for
 * the reason given at the top of this file. */
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

  console.info('Seeding UAT role-coverage fixtures…');

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

  // ---- VENDOR ----------------------------------------------------------
  console.info('• Vendor');
  await ensureUser(superAdmin, USERS.vendor);
  const vendor = new Client('vendor');
  await vendor.login(USERS.vendor.email, PASSWORD);

  // Step 1 of 2: the VENDOR ROLE itself, through the real application +
  // review flow — this is what @Roles('VENDOR') checks, and nothing past
  // this point (creating a storefront profile) is reachable without it.
  type MyApplication = { id: string; roleCode: string; status: string };
  const myApps = await vendor.get<MyApplication[]>('/roles/applications');
  let application = myApps.find((a) => a.roleCode === 'VENDOR');
  if (!application) {
    // Inside this guard on purpose — see seed-uat-logistics.ts's own comment
    // at its equivalent call site for why: on a database where an
    // application already exists, this block never runs, so there is no
    // re-verification path to accidentally break on a long-lived account.
    await ensureEmailVerified(vendor, USERS.vendor.email);
    const pdf = new TextEncoder().encode(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
        '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF\n',
    );
    const idUpload = await vendor.upload<{ key?: string; storageKey?: string }>(
      '/roles/applications/VENDOR/documents/upload?filename=uat-vendor-id.pdf',
      pdf,
      'application/pdf',
    );
    const businessRegUpload = await vendor.upload<{ key?: string; storageKey?: string }>(
      '/roles/applications/VENDOR/documents/upload?filename=uat-vendor-business-registration.pdf',
      pdf,
      'application/pdf',
    );
    const idKey = idUpload.key ?? idUpload.storageKey;
    const regKey = businessRegUpload.key ?? businessRegUpload.storageKey;
    if (!idKey || !regKey) throw new Error(`Document upload returned no key: ${JSON.stringify({ idUpload, businessRegUpload })}`);
    console.info('  ✓ two supporting documents uploaded via POST roles/applications/VENDOR/documents/upload');
    await vendor.post('/roles/applications', {
      roleCode: 'VENDOR',
      message: 'UAT role-coverage seed',
      documentKeys: [idKey, regKey],
    });
    console.info('  ✓ VENDOR application submitted');
    const refreshed = await vendor.get<MyApplication[]>('/roles/applications');
    application = refreshed.find((a) => a.roleCode === 'VENDOR');
    if (!application) throw new Error('The VENDOR application did not appear in /roles/applications.');
  }
  if (application.status !== 'APPROVED') {
    await superAdmin.post('/admin/applications/approve', { applicationId: application.id, note: 'UAT role-coverage seed' });
    console.info('  ✓ VENDOR role approved via POST admin/applications/approve');
  } else {
    console.info('  • VENDOR role already approved');
  }

  // Step 2 of 2: the STOREFRONT itself — a distinct business-moderation
  // flow (VendorProfile.approvalStatus), separate from the role above. A
  // dashboard baseline needs this too: an approved VENDOR with no
  // storefront profile is still mid-onboarding, not the real surface.
  //
  // GET/POST /vendor/profile both wrap the profile — { profile, settings,
  // locations, openingHours, hoursExceptions } — confirmed by reading
  // vendor.service.ts's getOwn()/create() rather than assumed; a profile of
  // null is a real wrapped value (`{ profile: null }`), not a bare null.
  type VendorProfile = { id: string; businessName: string; approvalStatus: string };
  type OwnProfileResponse = { profile: VendorProfile | null };
  let own = await vendor.get<OwnProfileResponse>('/vendor/profile');
  if (!own.profile) {
    own = await vendor.post<OwnProfileResponse>('/vendor/profile', {
      businessName: 'UAT Walkthrough Store',
      contactEmail: USERS.vendor.email,
      description: 'A simulation storefront for the Priority 6 visual-baseline suite.',
    });
    console.info('  ✓ storefront profile created via POST vendor/profile');
  } else {
    console.info('  • storefront profile already exists');
  }
  let profile = own.profile;
  if (!profile) throw new Error('Storefront profile is still null after create.');
  if (profile.approvalStatus === 'DRAFT' || profile.approvalStatus === 'REJECTED') {
    await vendor.post('/vendor/profile/submit');
    const refreshed = await vendor.get<OwnProfileResponse>('/vendor/profile');
    if (!refreshed.profile) throw new Error('Storefront profile disappeared after submit.');
    profile = refreshed.profile;
    console.info('  ✓ storefront submitted for review via POST vendor/profile/submit');
  }
  if (profile.approvalStatus === 'PENDING') {
    await superAdmin.post(`/admin/vendors/${profile.id}/approve`, { note: 'UAT role-coverage seed' });
    console.info('  ✓ storefront approved via POST admin/vendors/:id/approve');
  } else if (profile.approvalStatus === 'APPROVED') {
    console.info('  • storefront already approved');
  } else {
    throw new Error(`Unexpected storefront approvalStatus "${profile.approvalStatus}" — not DRAFT/PENDING/REJECTED/APPROVED.`);
  }

  // setTestMode is idempotent on the server (vendor.service.ts: `if (vp.isTest
  // === isTest) return` before writing) — safe to call unconditionally rather
  // than read-then-write, and publicShape() (what GET returns) doesn't
  // expose isTest to the owner anyway, so there is nothing to check here.
  await superAdmin.patch(`/admin/vendors/${profile.id}/test-mode`, { isTest: true, reason: 'UAT role-coverage seed' });
  console.info('  ✓ storefront flagged isTest via PATCH admin/vendors/:id/test-mode (idempotent)');

  // ---- JOB_SEEKER --------------------------------------------------------
  // requiresApproval: false — exempt from email verification (roleRequiresVerifiedEmail
  // is requiresApproval && !isAdminRole; confirmed by reading packages/shared/src/roles.ts
  // rather than assumed from the VENDOR/DELIVERY_DRIVER pattern). Applying auto-approves:
  // roles.service.ts's submitApplication upserts UserRole straight to APPROVED and never
  // creates a RoleApplication row at all for a !needsApproval role, so there is nothing to
  // find via GET /roles/applications — idempotency is checked against GET /me's own roles
  // instead. Worth seeding anyway even though the profile API itself only requires
  // CUSTOMER (@Roles('CUSTOMER') on JobSeekerController): the dashboard nav's "Belize
  // Connect" section is gated on actually holding JOB_SEEKER
  // (apps/web/lib/dashboard-nav-items.ts, ROLE_GROUPS) — a baseline without it would be
  // missing nav, one of the owner's own named defect classes.
  console.info('• Job seeker');
  await ensureUser(superAdmin, USERS.jobSeeker);
  const seeker = new Client('job seeker');
  await seeker.login(USERS.jobSeeker.email, PASSWORD);

  type MeRoles = { roles: Array<{ roleCode: string; status: string }> };
  const seekerMe = await seeker.get<MeRoles>('/me');
  const hasJobSeeker = seekerMe.roles.some((r) => r.roleCode === 'JOB_SEEKER' && r.status === 'APPROVED');
  if (!hasJobSeeker) {
    await seeker.post('/roles/applications', { roleCode: 'JOB_SEEKER', message: 'UAT role-coverage seed' });
    console.info('  ✓ JOB_SEEKER role self-granted (no approval needed) via POST roles/applications');
  } else {
    console.info('  • JOB_SEEKER role already held');
  }

  // The profile page renders nothing below its header when the profile is
  // null (apps/web/app/dashboard/jobs/profile/page.tsx — `profile ? (...) :
  // null`, no explicit empty state) — a real, populated profile is needed
  // for a baseline worth anything. PUT is upsert-backed server-side
  // (job-seeker.service.ts's upsertProfile), safe to call every run.
  await seeker.call('PUT', '/job-seeker/profile', { preferredName: 'Uat Seeker' });
  console.info('  ✓ job-seeker profile upserted via PUT job-seeker/profile');

  // ---- PASSENGER_DRIVER --------------------------------------------------
  console.info('• Passenger driver');
  await ensureUser(superAdmin, USERS.passengerDriver);
  const paxDriver = new Client('passenger driver');
  await paxDriver.login(USERS.passengerDriver.email, PASSWORD);

  const inAYear = new Date();
  inAYear.setFullYear(inAYear.getFullYear() + 1);

  await paxDriver.call('PUT', '/passenger/driver/profile', {
    legalName: 'UAT Passenger Driver',
    displayName: 'UAT Passenger Driver',
    phone: '+501-600-0001',
    homeDistrict: 'BELIZE',
    licenceNumber: 'UAT-PAX-000001',
    licenceExpiry: inAYear.toISOString(),
    termsAccepted: true,
  });
  console.info('  ✓ passenger-driver profile upserted via PUT passenger/driver/profile');

  type PaxVehicle = { id: string; licencePlate: string; approvalStatus: string };
  let paxVehicles = await paxDriver.get<PaxVehicle[]>('/passenger/driver/vehicles');
  if (!paxVehicles.some((v) => v.licencePlate === 'UAT-PAX-0001')) {
    await paxDriver.post('/passenger/driver/vehicles', {
      type: 'CAR',
      make: 'UAT',
      model: 'Passenger Sedan',
      licencePlate: 'UAT-PAX-0001',
      registrationExpiry: inAYear.toISOString(),
      insuranceExpiry: inAYear.toISOString(),
      seatCapacity: 4,
      isPrimary: true,
    });
    paxVehicles = await paxDriver.get<PaxVehicle[]>('/passenger/driver/vehicles');
    console.info('  ✓ passenger vehicle added (registration + insurance valid a year out)');
  }
  const paxVehicle = paxVehicles.find((v) => v.licencePlate === 'UAT-PAX-0001');
  if (!paxVehicle) throw new Error('The UAT passenger vehicle disappeared between POST and GET.');

  type PaxApplication = { id: string; roleCode: string; status: string };
  const paxApps = await paxDriver.get<PaxApplication[]>('/roles/applications');
  let paxApplication = paxApps.find((a) => a.roleCode === 'PASSENGER_DRIVER');
  if (!paxApplication) {
    // Inside the guard, same reasoning as VENDOR and seed-uat-logistics.ts's
    // DELIVERY_DRIVER — see those call sites for why.
    await ensureEmailVerified(paxDriver, USERS.passengerDriver.email);
    const pdf = new TextEncoder().encode(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
        '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF\n',
    );
    const keys: string[] = [];
    for (const label of ['licence', 'vehicle-registration', 'insurance', 'police-record']) {
      const uploaded = await paxDriver.upload<{ key?: string; storageKey?: string }>(
        `/roles/applications/PASSENGER_DRIVER/documents/upload?filename=uat-pax-driver-${label}.pdf`,
        pdf,
        'application/pdf',
      );
      const key = uploaded.key ?? uploaded.storageKey;
      if (!key) throw new Error(`Document upload (${label}) returned no key: ${JSON.stringify(uploaded)}`);
      keys.push(key);
    }
    console.info('  ✓ four supporting documents uploaded via POST roles/applications/PASSENGER_DRIVER/documents/upload');
    await paxDriver.post('/roles/applications', {
      roleCode: 'PASSENGER_DRIVER',
      message: 'UAT role-coverage seed',
      documentKeys: keys,
    });
    console.info('  ✓ PASSENGER_DRIVER application submitted');
    const refreshed = await paxDriver.get<PaxApplication[]>('/roles/applications');
    paxApplication = refreshed.find((a) => a.roleCode === 'PASSENGER_DRIVER');
    if (!paxApplication) throw new Error('The PASSENGER_DRIVER application did not appear in /roles/applications.');
  }
  if (paxApplication.status !== 'APPROVED') {
    await superAdmin.post('/admin/applications/approve', { applicationId: paxApplication.id, note: 'UAT role-coverage seed' });
    console.info('  ✓ PASSENGER_DRIVER role approved via POST admin/applications/approve');
  } else {
    console.info('  • PASSENGER_DRIVER role already approved');
  }

  if (paxVehicle.approvalStatus !== 'APPROVED') {
    await superAdmin.post(`/admin/passengers/vehicles/${paxVehicle.id}/approve`, {});
    console.info('  ✓ passenger vehicle approved via POST admin/passengers/vehicles/:id/approve');
  }

  type PaxDriverDirectoryRow = { id: string; email: string };
  const paxDirectory = await superAdmin.get<PaxDriverDirectoryRow[]>('/admin/passengers/drivers');
  const paxDriverRow = paxDirectory.find((d) => d.email === USERS.passengerDriver.email);
  if (!paxDriverRow) throw new Error('Passenger-driver profile not found in /admin/passengers/drivers.');
  await superAdmin.patch(`/admin/passengers/drivers/${paxDriverRow.id}/test-mode`, { isTest: true, reason: 'UAT role-coverage seed' });
  console.info('  ✓ passenger-driver flagged isTest via PATCH admin/passengers/drivers/:id/test-mode (idempotent)');

  await paxDriver.patch('/passenger/driver/availability', { availability: 'ONLINE' });
  console.info('  ✓ passenger driver ONLINE');

  // ---- PASSENGER_PROVIDER ------------------------------------------------
  // A fresh operator with zero fleet affiliations is a real, valid state —
  // apps/web/components/passenger-operator/FleetRosterCard.tsx's own comment
  // says as much. No affiliation/vehicle data created here on purpose.
  console.info('• Passenger provider');
  await ensureUser(superAdmin, USERS.passengerProvider);
  const paxProvider = new Client('passenger provider');
  await paxProvider.login(USERS.passengerProvider.email, PASSWORD);

  type PaxProviderApplication = { id: string; roleCode: string; status: string };
  const paxProviderApps = await paxProvider.get<PaxProviderApplication[]>('/roles/applications');
  let paxProviderApplication = paxProviderApps.find((a) => a.roleCode === 'PASSENGER_PROVIDER');
  if (!paxProviderApplication) {
    await ensureEmailVerified(paxProvider, USERS.passengerProvider.email);
    const pdf = new TextEncoder().encode(
      '%PDF-1.4\n1 0 obj<</Type/Catalog/Pages 2 0 R>>endobj\n2 0 obj<</Type/Pages/Kids[3 0 R]/Count 1>>endobj\n' +
        '3 0 obj<</Type/Page/Parent 2 0 R/MediaBox[0 0 200 200]>>endobj\nxref\n0 4\ntrailer<</Size 4/Root 1 0 R>>\n%%EOF\n',
    );
    const keys: string[] = [];
    for (const label of ['business-registration', 'public-transport-licence']) {
      const uploaded = await paxProvider.upload<{ key?: string; storageKey?: string }>(
        `/roles/applications/PASSENGER_PROVIDER/documents/upload?filename=uat-pax-provider-${label}.pdf`,
        pdf,
        'application/pdf',
      );
      const key = uploaded.key ?? uploaded.storageKey;
      if (!key) throw new Error(`Document upload (${label}) returned no key: ${JSON.stringify(uploaded)}`);
      keys.push(key);
    }
    console.info('  ✓ two supporting documents uploaded via POST roles/applications/PASSENGER_PROVIDER/documents/upload');
    await paxProvider.post('/roles/applications', {
      roleCode: 'PASSENGER_PROVIDER',
      message: 'UAT role-coverage seed',
      documentKeys: keys,
    });
    console.info('  ✓ PASSENGER_PROVIDER application submitted');
    const refreshed = await paxProvider.get<PaxProviderApplication[]>('/roles/applications');
    paxProviderApplication = refreshed.find((a) => a.roleCode === 'PASSENGER_PROVIDER');
    if (!paxProviderApplication) throw new Error('The PASSENGER_PROVIDER application did not appear in /roles/applications.');
  }
  if (paxProviderApplication.status !== 'APPROVED') {
    await superAdmin.post('/admin/applications/approve', { applicationId: paxProviderApplication.id, note: 'UAT role-coverage seed' });
    console.info('  ✓ PASSENGER_PROVIDER role approved via POST admin/applications/approve');
  } else {
    console.info('  • PASSENGER_PROVIDER role already approved');
  }

  await paxProvider.call('PUT', '/passenger/provider/profile', {
    businessName: 'UAT Walkthrough Transport Co.',
    contactEmail: USERS.passengerProvider.email,
  });
  console.info('  ✓ passenger-provider profile upserted via PUT passenger/provider/profile');

  // NOTE: listProviders() names this field accountEmail, not email — unlike
  // listDrivers()'s flat `email` field. Confirmed by reading
  // admin-passenger.service.ts rather than assuming the two endpoints match.
  type PaxProviderDirectoryRow = { id: string; accountEmail: string };
  const paxProviderDirectory = await superAdmin.get<PaxProviderDirectoryRow[]>('/admin/passengers/providers');
  const paxProviderRow = paxProviderDirectory.find((p) => p.accountEmail === USERS.passengerProvider.email);
  if (!paxProviderRow) throw new Error('Passenger-provider profile not found in /admin/passengers/providers.');
  await superAdmin.patch(`/admin/passengers/providers/${paxProviderRow.id}/test-mode`, { isTest: true, reason: 'UAT role-coverage seed' });
  console.info('  ✓ passenger-provider flagged isTest via PATCH admin/passengers/providers/:id/test-mode (idempotent)');

  console.info('\nUAT role-coverage seed complete (VENDOR, JOB_SEEKER, PASSENGER_DRIVER, PASSENGER_PROVIDER).');
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
