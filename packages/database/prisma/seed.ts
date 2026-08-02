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
  PERMISSIONS,
  WALLET_ACCOUNT_TYPES,
} from '@bmpl/shared';
import { hashPassword } from '@bmpl/authentication';
import { prisma, syncSuperAdminPermissions } from '../src/index';

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

  // Grant the COMPLETE permission catalog to every super admin (idempotent;
  // back-fills permissions added after an admin was first created).
  await syncSuperAdminPermissions(prisma, PERMISSIONS);

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

/** Baseline Belize Connect job categories (managed reference data). Idempotent
 *  by unique slug — matches the 20260915120000_seed_job_categories migration so
 *  fresh dev/test seeds and migrated prod converge on the same taxonomy. */
async function seedJobCategories() {
  const categories: Array<{ name: string; slug: string; sortOrder: number }> = [
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
  for (const c of categories) {
    await prisma.jobCategory.upsert({
      where: { slug: c.slug },
      update: { name: c.name, sortOrder: c.sortOrder },
      create: c,
    });
  }
}

async function main() {
  const isProduction = process.env.NODE_ENV === 'production';
  console.info('Seeding BMPL database…');

  // Roles, system wallet accounts, super-admin, and baseline reference data are always seeded.
  await seedRoles();
  await seedSystemWalletAccounts();
  await seedSuperAdmin();
  await seedJobCategories();

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
