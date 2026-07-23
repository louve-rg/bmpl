/**
 * Development seed. Idempotent — safe to run repeatedly.
 *
 *  * Populates the Role catalog from the shared ROLE_DEFINITIONS.
 *  * Creates system wallet accounts (double-entry counter-parties).
 *  * Creates a SUPER_ADMIN staff account (credentials from env).
 *  * Creates a few demo customers, including one pending VENDOR application,
 *    so the admin approval queue has something to review out of the box.
 *
 * Run: pnpm db:seed   (after migrate)
 */
import 'dotenv/config';
import {
  ROLE_DEFINITIONS,
  ROLE_CODES,
  PERMISSION_BUNDLES,
  WALLET_ACCOUNT_TYPES,
} from '@bmpl/shared';
import { hashPassword } from '@bmpl/authentication';
import { prisma } from '../src/index';

async function seedRoles() {
  for (const code of ROLE_CODES) {
    const def = ROLE_DEFINITIONS[code];
    await prisma.role.upsert({
      where: { code },
      update: {
        label: def.label,
        description: def.description,
        isAdminRole: def.isAdminRole,
        requiresApproval: def.requiresApproval,
        autoGranted: def.autoGranted,
      },
      create: {
        code,
        label: def.label,
        description: def.description,
        isAdminRole: def.isAdminRole,
        requiresApproval: def.requiresApproval,
        autoGranted: def.autoGranted,
      },
    });
  }
  console.info(`✓ Seeded ${ROLE_CODES.length} roles`);
}

async function seedSystemWalletAccounts() {
  for (const type of WALLET_ACCOUNT_TYPES) {
    if (type === 'USER') continue; // user accounts are created per-user
    const existing = await prisma.walletAccount.findFirst({
      where: { type, userId: null, currency: 'BZD' },
    });
    if (!existing) {
      await prisma.walletAccount.create({ data: { type, currency: 'BZD' } });
    }
  }
  console.info('✓ Seeded system wallet accounts');
}

async function createUser(params: {
  email: string;
  password: string;
  firstName: string;
  lastName: string;
  verified?: boolean;
}) {
  const passwordHash = await hashPassword(params.password);
  return prisma.user.upsert({
    where: { email: params.email },
    update: {},
    create: {
      email: params.email,
      passwordHash,
      firstName: params.firstName,
      lastName: params.lastName,
      emailVerifiedAt: params.verified ? new Date() : null,
      acceptedTermsAt: new Date(),
      activeRoleCode: 'CUSTOMER',
      roles: {
        create: { roleCode: 'CUSTOMER', status: 'APPROVED', approvedAt: new Date() },
      },
      walletAccounts: {
        create: { type: 'USER', currency: 'BZD' },
      },
    },
  });
}

async function seedSuperAdmin() {
  const email = process.env.SEED_SUPER_ADMIN_EMAIL ?? 'admin@bzemarketplace.com';
  const password = process.env.SEED_SUPER_ADMIN_PASSWORD ?? 'ChangeMe!Admin123';

  const admin = await createUser({
    email,
    password,
    firstName: 'Platform',
    lastName: 'Administrator',
    verified: true,
  });

  // Grant the SUPER_ADMIN + SUPPORT_AGENT staff roles (approved).
  for (const roleCode of ['SUPER_ADMIN', 'SUPPORT_AGENT'] as const) {
    await prisma.userRole.upsert({
      where: { userId_roleCode: { userId: admin.id, roleCode } },
      update: { status: 'APPROVED', approvedAt: new Date() },
      create: { userId: admin.id, roleCode, status: 'APPROVED', approvedAt: new Date() },
    });
  }

  // Grant all SUPER_ADMIN permissions (admin capability axis, separate from roles).
  for (const permission of PERMISSION_BUNDLES.SUPER_ADMIN!) {
    await prisma.adminPermissionGrant.upsert({
      where: { userId_permission: { userId: admin.id, permission } },
      update: {},
      create: { userId: admin.id, permission },
    });
  }

  console.info(`✓ Seeded SUPER_ADMIN: ${email}`);
  return admin;
}

async function seedDemoData() {
  // A verified customer with nothing pending.
  const demoPassword = process.env.SEED_DEMO_PASSWORD ?? 'DemoPass123';

  await createUser({
    email: 'maya.customer@example.bz',
    password: demoPassword,
    firstName: 'Maya',
    lastName: 'Cardenas',
    verified: true,
  });

  // A customer who has applied to become a VENDOR — populates the review queue.
  const vendorApplicant = await createUser({
    email: 'deshawn.vendor@example.bz',
    password: demoPassword,
    firstName: 'Deshawn',
    lastName: 'Bennett',
    verified: true,
  });

  const existingApp = await prisma.roleApplication.findFirst({
    where: { userId: vendorApplicant.id, roleCode: 'VENDOR' },
  });
  if (!existingApp) {
    const userRole = await prisma.userRole.upsert({
      where: { userId_roleCode: { userId: vendorApplicant.id, roleCode: 'VENDOR' } },
      update: { status: 'PENDING' },
      create: { userId: vendorApplicant.id, roleCode: 'VENDOR', status: 'PENDING' },
    });

    await prisma.roleApplication.create({
      data: {
        userId: vendorApplicant.id,
        roleCode: 'VENDOR',
        userRoleId: userRole.id,
        status: 'PENDING',
        message: 'I run a small crafts shop in San Ignacio and would like to sell online.',
        reviews: {
          create: { action: 'SUBMITTED', toStatus: 'PENDING' },
        },
      },
    });
    console.info('✓ Seeded demo pending VENDOR application');
  }
}

async function main() {
  const isProduction = process.env.NODE_ENV === 'production';
  console.info('Seeding BMPL database…');

  // Roles, system wallet accounts, and the super-admin are always seeded.
  await seedRoles();
  await seedSystemWalletAccounts();
  await seedSuperAdmin();

  // Demo customers / applications are development scaffolding only.
  if (isProduction) {
    console.info('• Skipping demo data (NODE_ENV=production).');
  } else {
    await seedDemoData();
  }

  const usingDefaultAdminPw = !process.env.SEED_SUPER_ADMIN_PASSWORD;
  if (usingDefaultAdminPw || !isProduction) {
    console.warn(
      '\n⚠  DEVELOPMENT super-admin password is UNSAFE for production. Set a strong\n' +
        '   SEED_SUPER_ADMIN_PASSWORD (and rotate the seeded account) before any\n' +
        '   shared or production deployment.\n',
    );
  }
  console.info('Seed complete.');
}

main()
  .catch((err) => {
    console.error('Seed failed:', err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
