import { Test } from '@nestjs/testing';
import type { INestApplication } from '@nestjs/common';
import cookieParser from 'cookie-parser';
import {
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
  server: unknown;
}

export async function bootApp(): Promise<TestContext> {
  const { AppModule } = await import('../src/app.module');
  const { prisma } = await import('@bmpl/database');
  const moduleRef = await Test.createTestingModule({ imports: [AppModule] }).compile();
  const app = moduleRef.createNestApplication();
  app.use(cookieParser(process.env.COOKIE_SECRET));
  app.setGlobalPrefix('api');
  // Mirror main.ts so the CORS allow-list is genuinely exercised by tests.
  const origins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://localhost:3001')
    .split(',')
    .map((o) => o.trim());
  app.enableCors({ origin: origins, credentials: true });
  await app.init();
  return { app, prisma, server: app.getHttpServer() };
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
