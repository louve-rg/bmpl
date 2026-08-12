import type { Server } from 'node:http';
import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
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
