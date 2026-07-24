/**
 * Cloud bootstrap — the SAFE alternative to the development seed for cloud
 * environments. It:
 *   • seeds the role catalog + system wallet accounts (idempotent),
 *   • creates ONE administrator from environment-supplied credentials,
 *   • never seeds demo users/applications,
 *   • refuses obvious dev/weak passwords,
 *   • refuses to run in production unless explicitly authorized.
 *
 * Run:  pnpm --filter @bmpl/database bootstrap
 * Required env:
 *   BOOTSTRAP_ADMIN_EMAIL      admin login email
 *   BOOTSTRAP_ADMIN_PASSWORD   strong temporary password (rotate after first login)
 * Optional:
 *   BOOTSTRAP_ALLOW_PRODUCTION=true   required when NODE_ENV=production
 */
import {
  ROLE_DEFINITIONS,
  ROLE_CODES,
  PERMISSION_BUNDLES,
  WALLET_ACCOUNT_TYPES,
} from '@bmpl/shared';
import { hashPassword } from '@bmpl/authentication';
import { prisma } from '../src/index';

const KNOWN_DEV_PASSWORDS = new Set(['ChangeMe!Admin123', 'DemoPass123', 'password', 'admin']);

function assertStrongPassword(pw: string | undefined): asserts pw is string {
  if (!pw) throw new Error('BOOTSTRAP_ADMIN_PASSWORD is required.');
  if (KNOWN_DEV_PASSWORDS.has(pw)) {
    throw new Error('BOOTSTRAP_ADMIN_PASSWORD must not be a known development password.');
  }
  const strong = pw.length >= 12 && /[A-Za-z]/.test(pw) && /[0-9]/.test(pw) && /[^A-Za-z0-9]/.test(pw);
  if (!strong) {
    throw new Error(
      'BOOTSTRAP_ADMIN_PASSWORD must be ≥12 chars and include a letter, a number, and a symbol.',
    );
  }
}

async function seedRolesAndAccounts() {
  for (const code of ROLE_CODES) {
    const d = ROLE_DEFINITIONS[code];
    await prisma.role.upsert({
      where: { code },
      update: {
        label: d.label,
        description: d.description,
        isAdminRole: d.isAdminRole,
        requiresApproval: d.requiresApproval,
        autoGranted: d.autoGranted,
      },
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

async function main() {
  const isProd = process.env.NODE_ENV === 'production';
  if (isProd && process.env.BOOTSTRAP_ALLOW_PRODUCTION !== 'true') {
    throw new Error(
      'Refusing to bootstrap in production. Set BOOTSTRAP_ALLOW_PRODUCTION=true to authorize.',
    );
  }

  const email = process.env.BOOTSTRAP_ADMIN_EMAIL?.trim().toLowerCase();
  const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
  if (!email) throw new Error('BOOTSTRAP_ADMIN_EMAIL is required.');
  assertStrongPassword(password);

  await seedRolesAndAccounts();

  const passwordHash = await hashPassword(password);
  const admin = await prisma.user.upsert({
    where: { email },
    update: {}, // idempotent: never overwrite an existing admin's password here
    create: {
      email,
      passwordHash,
      firstName: 'Platform',
      lastName: 'Administrator',
      emailVerifiedAt: new Date(),
      acceptedTermsAt: new Date(),
      activeRoleCode: 'CUSTOMER',
      roles: {
        create: [
          { roleCode: 'CUSTOMER', status: 'APPROVED', approvedAt: new Date() },
          { roleCode: 'SUPER_ADMIN', status: 'APPROVED', approvedAt: new Date() },
        ],
      },
      walletAccounts: { create: { type: 'USER', currency: 'BZD' } },
    },
  });

  // Ensure SUPER_ADMIN role + permissions even if the user already existed.
  await prisma.userRole.upsert({
    where: { userId_roleCode: { userId: admin.id, roleCode: 'SUPER_ADMIN' } },
    update: { status: 'APPROVED', approvedAt: new Date() },
    create: { userId: admin.id, roleCode: 'SUPER_ADMIN', status: 'APPROVED', approvedAt: new Date() },
  });
  for (const permission of PERMISSION_BUNDLES.SUPER_ADMIN!) {
    await prisma.adminPermissionGrant.upsert({
      where: { userId_permission: { userId: admin.id, permission } },
      update: {},
      create: { userId: admin.id, permission },
    });
  }

  console.info(`✓ Bootstrap complete. Administrator: ${email}`);
  console.info('  Rotate this temporary password after first login.');
}

main()
  .catch((err) => {
    console.error('Bootstrap failed:', err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
