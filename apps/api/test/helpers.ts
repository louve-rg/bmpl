import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import { expect } from 'vitest';
import cookieParser from 'cookie-parser';
import {
  MAX_DOCUMENT_BYTES,
  MAX_PRODUCT_IMAGE_BYTES,
  ROLE_CODES,
  ROLE_DEFINITIONS,
  PERMISSION_BUNDLES,
  WALLET_ACCOUNT_TYPES,
} from '@bmpl/shared';
import { hashPassword } from '@bmpl/authentication';
import type { PrismaClient } from '@bmpl/database';

export interface TestContext {
  app: INestApplication;
  prisma: PrismaClient;
  /**
   * The HTTP server supertest drives. Typed as the real `Server` rather than
   * `unknown`: every spec passes this straight to `request()`, so `unknown` made
   * each of those call sites a type error the moment the specs were brought under
   * typechecking at all — which is why they never were.
   */
  server: Server;
}

export async function bootApp(): Promise<TestContext> {
  const { AppModule } = await import('../src/app.module');
  const { prisma } = await import('@bmpl/database');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.use(cookieParser(process.env.COOKIE_SECRET));
  // Mirror main.ts: scoped raw-body parser for binary uploads (browser → API → storage).
  const { rawUploadBody } = await import('../src/common/raw-upload-body.middleware');
  app.use(rawUploadBody(Math.max(MAX_PRODUCT_IMAGE_BYTES, MAX_DOCUMENT_BYTES) + 1024 * 1024));
  app.setGlobalPrefix('api');
  // Mirror main.ts so the CORS allow-list is genuinely exercised by tests.
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:3001')
    .split(',')
    .map((o) => o.trim());
  app.enableCors({ origin: origins, credentials: true });
  await app.init();
  return { app, prisma, server: app.getHttpServer() as Server };
}

/**
 * BMPL-386: assert that `read()` returns the same value immediately before
 * and after `action()` runs, by diffing a freshly-taken baseline rather than
 * asserting against an assumed literal. This suite hit the same bug four
 * times in one night, always the same shape: a test asserted a field or a
 * row count against a value it ASSUMED (a payment sitting at `'CREATED'`, a
 * ledger with zero entries) when the fixture's own setup had ALREADY
 * legitimately touched the same thing first -- `createForShipment`
 * internally transitions `CREATED` -> `PENDING` before returning; a test's
 * own funding call posts a real ledger entry on the wallet it then asserts
 * against. An assertion built on an assumed value measures the fixture, not
 * the action under test -- worse than a missing test, since a CORRECTLY
 * fixed system can then read as still broken (the assumed literal no longer
 * matches reality), or a guard that silently stops working can keep passing
 * forever (the assumed zero happens to still be literally true by luck).
 *
 * `action` may itself reject -- proving a write is refused is usually the
 * whole point of calling this -- so it runs inside a try/catch and, with no
 * `expectRejection` given, any rejection is swallowed; `read()` is what gets
 * compared, before and after.
 *
 * That swallow is itself a version of the exact bug this helper exists to
 * prevent, one level deeper: if `action` rejects for an UNRELATED reason --
 * a typo, a missing fixture, a closed connection -- the call never reaches
 * whatever it was meant to exercise, `read()` naturally shows no change
 * either way, and the test passes while proving nothing. The author would
 * believe they had demonstrated a guard works when their own setup never
 * reached it. Pass `expectRejection` (a substring or a pattern) when the
 * point IS that `action` must be refused, so a DIFFERENT failure still
 * fails the test for its real reason instead of passing by accident.
 */
export async function expectUnchangedBy<T>(
  read: () => Promise<T>,
  action: () => Promise<unknown>,
  expectRejection?: string | RegExp,
): Promise<void> {
  const before = await read();
  try {
    await action();
  } catch (e) {
    if (expectRejection !== undefined) {
      const message = e instanceof Error ? e.message : String(e);
      const matches = typeof expectRejection === 'string' ? message.includes(expectRejection) : expectRejection.test(message);
      if (!matches) throw e; // a DIFFERENT failure -- let it fail the test for its real reason.
    }
  }
  expect(await read()).toEqual(before);
}

/**
 * MDF-499 FOLLOW-UP: a reusable harness for the owner's §10 "duplicate,
 * concurrent and retried actions" requirement, built because `Promise.all`
 * of N HTTP requests was already shown, twice independently in this suite, to
 * be WEAK evidence of a real race — each call does open its own TCP
 * connection (supertest does not reuse one across separate `request(...)`
 * calls), but whether the underlying database work for two of them was ever
 * genuinely in flight AT THE SAME INSTANT was never measured, only assumed
 * from the HTTP calls being unawaited relative to each other.
 *
 * This measures it directly: while the N request-thunks run, a side
 * connection polls `pg_stat_activity` in a tight loop (bounded only by its
 * own round-trip time — no sleep between samples, to maximise the sampling
 * rate) for how many OTHER backends on this same database are `state =
 * 'active'` (mid-query) at that instant. `pid <> pg_backend_pid()` excludes
 * the poll's own backend; no column that requires same-role/superuser
 * visibility is read, only `state`, so this works regardless of which DB
 * role the pool connects as.
 *
 * `observed: true` is real, DB-level proof that two requests' queries
 * overlapped — not inferred from timing or from the response shape.
 * `observed: false` means only that THIS run's sampling never caught an
 * overlap; it is not proof no race is possible, since a short critical
 * section on a fast local Postgres can start and finish between two samples.
 * Report whichever one actually came back — do not round a `false` up to "a
 * race was impossible", and do not round a `true` down to "probably nothing".
 */
export interface ConcurrencyProbe<T> {
  responses: T[];
  observed: boolean;
  peakConcurrentActive: number;
  samples: number;
  elapsedMs: number;
}

export async function raceOverSeparateConnections<T>(
  prisma: PrismaClient,
  fns: Array<() => Promise<T>>,
): Promise<ConcurrencyProbe<T>> {
  const start = Date.now();
  let peak = 0;
  let samples = 0;
  let polling = true;
  const poll = (async () => {
    while (polling) {
      samples += 1;
      try {
        const rows = await prisma.$queryRawUnsafe<Array<{ n: number | bigint }>>(
          `SELECT count(*)::int AS n FROM pg_stat_activity WHERE datname = current_database() AND state = 'active' AND pid <> pg_backend_pid()`,
        );
        const n = Number(rows[0]?.n ?? 0);
        if (n > peak) peak = n;
      } catch {
        // A transient probe failure (e.g. a pool connection momentarily
        // unavailable) must not fail the thing it only exists to observe.
      }
    }
  })();
  const responses = await Promise.all(fns.map((fn) => fn()));
  polling = false;
  await poll;
  return { responses, observed: peak >= 2, peakConcurrentActive: peak, samples, elapsedMs: Date.now() - start };
}

/** Wipe all application data between test groups (keeps schema + migrations). */
export async function resetDb(prisma: PrismaClient): Promise<void> {
  const rows = await prisma.$queryRaw<Array<{ tablename: string }>>`
    SELECT tablename FROM pg_tables
    WHERE schemaname = 'public' AND tablename <> '_prisma_migrations'`;
  const list = rows.map((r) => `"public"."${r.tablename}"`).join(', ');
  if (list) {
    await prisma.$executeRawUnsafe(`TRUNCATE TABLE ${list} RESTART IDENTITY CASCADE`);
  }
}

/** The baseline Belize Connect job categories (mirrors seed.ts + the
 *  20260915120000_seed_job_categories migration). Idempotent by unique slug. */
export const BASELINE_JOB_CATEGORIES: Array<{ name: string; slug: string; sortOrder: number }> = [
  { name: 'Accounting & Finance', slug: 'accounting-finance', sortOrder: 10 },
  { name: 'Administration & Office Support', slug: 'administration-office-support', sortOrder: 20 },
  { name: 'Agriculture & Fisheries', slug: 'agriculture-fisheries', sortOrder: 30 },
  { name: 'Construction & Skilled Trades', slug: 'construction-skilled-trades', sortOrder: 40 },
  { name: 'Customer Service', slug: 'customer-service', sortOrder: 50 },
  { name: 'Education & Training', slug: 'education-training', sortOrder: 60 },
  { name: 'Engineering', slug: 'engineering', sortOrder: 70 },
  { name: 'Government & Public Service', slug: 'government-public-service', sortOrder: 80 },
  { name: 'Healthcare', slug: 'healthcare', sortOrder: 90 },
  { name: 'Hospitality & Tourism', slug: 'hospitality-tourism', sortOrder: 100 },
  { name: 'Human Resources', slug: 'human-resources', sortOrder: 110 },
  { name: 'Information Technology', slug: 'information-technology', sortOrder: 120 },
  { name: 'Legal', slug: 'legal', sortOrder: 130 },
  { name: 'Logistics & Transportation', slug: 'logistics-transportation', sortOrder: 140 },
  { name: 'Manufacturing', slug: 'manufacturing', sortOrder: 150 },
  { name: 'Marketing & Communications', slug: 'marketing-communications', sortOrder: 160 },
  { name: 'Retail & Sales', slug: 'retail-sales', sortOrder: 170 },
  { name: 'Security', slug: 'security', sortOrder: 180 },
  { name: 'Social Services', slug: 'social-services', sortOrder: 190 },
  { name: 'Other', slug: 'other', sortOrder: 200 },
];

/** Idempotently seed the baseline job categories (upsert by slug). */
export async function seedJobCategories(prisma: PrismaClient): Promise<void> {
  for (const c of BASELINE_JOB_CATEGORIES) {
    await prisma.jobCategory.upsert({ where: { slug: c.slug }, update: { name: c.name, sortOrder: c.sortOrder }, create: c });
  }
}

/** Seed the role catalog + system wallet accounts. */
export async function seedRoles(prisma: PrismaClient): Promise<void> {
  for (const code of ROLE_CODES) {
    const d = ROLE_DEFINITIONS[code];
    await prisma.role.upsert({
      where: { code },
      update: {},
      create: {
        code,
        label: d.label,
        description: d.description,
        isAdminRole: d.isAdminRole,
        requiresApproval: d.requiresApproval,
        autoGranted: d.autoGranted,
      },
    });
  }
  for (const type of WALLET_ACCOUNT_TYPES) {
    if (type === 'USER') continue;
    const existing = await prisma.walletAccount.findFirst({ where: { type, userId: null } });
    if (!existing) await prisma.walletAccount.create({ data: { type, currency: 'BZD' } });
  }
  // A driver-worked leg now refuses booking outright when nobody has ever
  // configured coverage for its district (districtHasConfiguredCoverage).
  // Almost every existing spec books a shipment to assert something else
  // entirely, with no driver fixture of its own, so the baseline goes here
  // — the one setup call every integration spec already makes — rather than
  // threading it individually through every file that books a shipment.
  // Offline and invisible to assignment (see seedBaselineCourierCoverage's
  // own comment); a spec whose own beforeEach wipes driver tables between
  // tests calls seedBaselineCourierCoverage itself, after its own fixture,
  // to restore it.
  await seedBaselineCourierCoverage(prisma);
}

/**
 * A driver-worked leg (FIRST_MILE/LAST_MILE/DIRECT) now refuses booking
 * outright when nobody has ever configured coverage for its district
 * (ShipmentService#runCreate, districtHasConfiguredCoverage). Almost no
 * existing shipping spec cares about driver assignment at all — they book a
 * parcel to assert something else entirely — so most need this called once
 * in their own `beforeAll`, for every district their fixtures use, to keep
 * booking exactly as unblocked as it always was.
 *
 * Deliberately OFFLINE: this exists ONLY to satisfy "configured", never to
 * be dispatched. `eligibleDriversForDistrict`'s pool requires `ONLINE`, so
 * this driver can never be offered, assigned, ranked above, or otherwise
 * interfere with a test's own specific driver/assignment fixtures — it is
 * invisible to every assertion except the new UNSUPPORTED gate.
 */
export async function seedBaselineCourierCoverage(
  prisma: PrismaClient,
  districts: string[] = ['BELIZE', 'CAYO', 'COROZAL', 'ORANGE_WALK', 'STANN_CREEK', 'TOLEDO'],
): Promise<void> {
  // Both sides of the simulation boundary — a test driver can never satisfy
  // a real booking's coverage check (districtHasConfiguredCoverage filters
  // on isTest, same as every other driver-matching query), and the reverse,
  // so one baseline account per side.
  for (const isTest of [false, true]) {
    const email = isTest ? 'it-baseline-courier-test@example.bz' : 'it-baseline-courier@example.bz';
    const user = await prisma.user.upsert({
      where: { email },
      update: {},
      create: {
        email,
        isTest,
        passwordHash: await hashPassword('BaselinePass123'),
        firstName: 'Baseline',
        lastName: 'Courier',
        emailVerifiedAt: new Date(),
        roles: { create: [{ roleCode: 'CUSTOMER', status: 'APPROVED', approvedAt: new Date() }] },
        walletAccounts: { create: { type: 'USER', currency: 'BZD' } },
      },
    });
    await prisma.userRole.upsert({
      where: { userId_roleCode: { userId: user.id, roleCode: 'DELIVERY_DRIVER' } },
      update: { status: 'APPROVED', approvedAt: new Date() },
      create: { userId: user.id, roleCode: 'DELIVERY_DRIVER', status: 'APPROVED', approvedAt: new Date() },
    });
    const profile = await prisma.driverProfile.upsert({
      where: { userId: user.id },
      update: { isActive: true, isTest },
      create: {
        userId: user.id,
        isTest,
        legalName: 'Baseline Courier',
        displayName: 'Baseline Courier',
        phone: '+5016000001',
        homeDistrict: 'BELIZE',
        licenceNumber: `DL-BASELINE${isTest ? '-T' : ''}`,
        licenceExpiry: new Date(Date.now() + 365 * 24 * 3600 * 1000),
        vehicleOwnership: 'OWNED',
        availability: 'OFFLINE',
        isActive: true,
      },
    });
    for (const district of districts) {
      await prisma.driverServiceArea.upsert({
        where: { driverProfileId_district: { driverProfileId: profile.id, district: district as never } },
        update: { isActive: true },
        create: { driverProfileId: profile.id, district: district as never, isActive: true },
      });
    }
  }
}

/** Create a super-admin with all permissions (for admin-workflow tests). */
export async function seedSuperAdmin(
  prisma: PrismaClient,
  email = 'it-admin@example.bz',
  password = 'AdminPass123',
): Promise<{ id: string; email: string; password: string }> {
  const passwordHash = await hashPassword(password);
  const admin = await prisma.user.upsert({
    where: { email },
    update: {},
    create: {
      email,
      passwordHash,
      firstName: 'IT',
      lastName: 'Admin',
      emailVerifiedAt: new Date(),
      activeRoleCode: 'SUPER_ADMIN',
      roles: {
        create: [
          { roleCode: 'CUSTOMER', status: 'APPROVED', approvedAt: new Date() },
          { roleCode: 'SUPER_ADMIN', status: 'APPROVED', approvedAt: new Date() },
        ],
      },
      walletAccounts: { create: { type: 'USER', currency: 'BZD' } },
    },
  });
  for (const permission of PERMISSION_BUNDLES.SUPER_ADMIN!) {
    await prisma.adminPermissionGrant.upsert({
      where: { userId_permission: { userId: admin.id, permission } },
      update: {},
      create: { userId: admin.id, permission },
    });
  }
  return { id: admin.id, email, password };
}

/** Create a limited admin holding only the given permissions. */
export async function seedLimitedAdmin(
  prisma: PrismaClient,
  email: string,
  permissions: string[],
  password = 'AdminPass123',
): Promise<{ id: string; email: string; password: string }> {
  const passwordHash = await hashPassword(password);
  const admin = await prisma.user.create({
    data: {
      email,
      passwordHash,
      firstName: 'Limited',
      lastName: 'Admin',
      emailVerifiedAt: new Date(),
      activeRoleCode: 'ADMIN',
      roles: {
        create: [
          { roleCode: 'CUSTOMER', status: 'APPROVED', approvedAt: new Date() },
          { roleCode: 'ADMIN', status: 'APPROVED', approvedAt: new Date() },
        ],
      },
    },
  });
  for (const permission of permissions) {
    await prisma.adminPermissionGrant.create({ data: { userId: admin.id, permission } });
  }
  return { id: admin.id, email, password };
}

export function cookiesOf(res: { headers: Record<string, unknown> }): string[] {
  const raw = res.headers['set-cookie'];
  return Array.isArray(raw) ? (raw as string[]) : raw ? [raw as string] : [];
}

/** Read a single cookie's value from a Set-Cookie array. */
export function cookieValue(cookies: string[], name: string): string | undefined {
  for (const c of cookies) {
    const m = new RegExp(`(?:^|; )${name}=([^;]+)`).exec(c);
    if (m) return decodeURIComponent(m[1]!);
  }
  return undefined;
}

/** Upload a buffer to a presigned PUT URL (real MinIO round-trip). */
export async function putToPresigned(
  url: string,
  body: Buffer,
  contentType: string,
): Promise<number> {
  const res = await fetch(url, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body,
  });
  return res.status;
}

/**
 * BMPL-348 / SEC-1: `JSON.stringify(body)` then `.not.toContain(pin)` flattens
 * the whole document into one string first — and a flattened document has
 * substrings that exist in no actual value, manufactured across field
 * boundaries and punctuation. That is how this assertion has failed on real,
 * correct code twice: a fixture phone number ending `...2223333` colliding
 * with a random PIN `2223`, and `"501-4445555"` colliding with pin `4445` —
 * four digits sitting inside one unrelated field's value, not leaked from
 * anywhere. Walking the PARSED body and checking real leaf values avoids both
 * directions of the mistake:
 *
 * 1. Every leaf, compared to the PIN as a string, must not be an exact
 *    match — this is what actually does the work: it finds the PIN under a
 *    key nobody thought to name, and it catches one serialized as a NUMBER
 *    (`String(2223) === '2223'`), which a substring search on stringified
 *    JSON would miss (`2223` with no surrounding quotes never appears as a
 *    substring of `"2223"`).
 * 2. A string leaf must not contain the PIN as a STANDALONE TOKEN — bounded
 *    by a non-alphanumeric character (or the start/end of the string) on
 *    both sides — which is what preserves "your code is 2223" inside a
 *    notification body or an echoed error. A bare `\b` is not enough: it
 *    still fires inside a cuid like `cmuoid2223x`. `501-2223333` does not
 *    match because the run is followed by another digit; `cmuoid2223x` does
 *    not match because it is preceded by a letter.
 *
 * RESIDUAL, not pretended away: a prose field that legitimately contains a
 * standalone run equal to this run's real PIN would still fire. Far rarer
 * than an arbitrary digit run landing inside an unrelated field, and when it
 * fires it is at least pointing at something shaped like a code — rule that
 * out first if this ever goes red, rather than assuming the assertion itself
 * regressed.
 */
export function findPinLeak(value: unknown, pin: string, path = '$'): string | null {
  if (value == null) return null;
  if (typeof value === 'object') {
    const entries = Array.isArray(value) ? value.map((v, i) => [i, v] as const) : Object.entries(value as Record<string, unknown>);
    for (const [key, child] of entries) {
      const hit = findPinLeak(child, pin, `${path}.${key}`);
      if (hit) return hit;
    }
    return null;
  }
  if (String(value) === pin) return path;
  if (typeof value === 'string' && new RegExp(`(?<![0-9A-Za-z])${pin}(?![0-9A-Za-z])`).test(value)) return path;
  return null;
}
