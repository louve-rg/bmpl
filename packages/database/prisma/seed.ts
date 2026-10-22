/**
 * Development seed. Idempotent — safe to run repeatedly.
 *
 *  * Populates the Role catalog from the shared ROLE_DEFINITIONS.
 *  * Creates system wallet accounts (double-entry counter-parties).
 *  * Creates a SUPER_ADMIN staff account (credentials from env).
 *  * Creates a few demo customers, including one pending VENDOR application,
 *    so the admin approval queue has something to review out of the box.
 *  * Creates two permanent Belize Connect employer fixtures for apps/web/e2e
 *    (BMPL-228) — see seedEmployerE2eFixtures() below before touching either.
 *  * Creates permanent fixtures for three PUBLIC detail routes that had no
 *    seed record anywhere in the repo (MDF-410): a storefront + product
 *    (/store/[slug], /products/[slug]) and a real-estate agency
 *    (/properties/agencies/[slug]). See seedMarketplaceFixtures() and
 *    seedAgencyFixture() below.
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

  await seedEmployerE2eFixtures();
  await seedMarketplaceFixtures();
  await seedAgencyFixture();
}

/**
 * Two permanent Belize Connect employer fixtures for apps/web/e2e (BMPL-228).
 *
 * Belize Connect has no isTest boundary (BMPL-148 is still open), and no API
 * endpoint can delete an employer profile, a role application, or a job — so
 * a committed browser test that created a fresh account every run would grow
 * real, permanent, indistinguishable data forever. These two accounts exist
 * so the journey can be re-run indefinitely against fixed, reusable state
 * instead: seeded once, kept forever, same as maya/deshawn above.
 *
 * FIXTURE 1 mirrors an employer who already has a profile — safe to reuse
 * for anything that needs one. Creating a job draft against it adds one
 * permanent Job row per test run; that is accepted, bounded residue (visible
 * in the admin jobs list, not queue-blocking — DRAFT has no moderation
 * action available).
 *
 * FIXTURE 2 is the opposite, and it is a landmine BY DESIGN: its entire
 * value to the empty-state regression test is that it has NEVER had a
 * profile created. There is no way to undo a profile once created (no
 * DELETE endpoint exists), so if any test — this one or a future,
 * unrelated one — ever calls PUT /employer/profile for this account, the
 * empty-state test breaks PERMANENTLY and silently: it will look like the
 * page regressed, when actually the fixture was consumed. The account is
 * named as a warning rather than an identifier for exactly this reason.
 * DO NOT create a profile for it. DO NOT "fix" a failing empty-state test
 * by giving this account a profile — that is the one action that cannot be
 * undone here.
 */
async function seedEmployerE2eFixtures() {
  const password = process.env.SEED_DEMO_PASSWORD ?? 'DemoPass123';

  async function approveEmployerRole(userId: string) {
    const userRole = await prisma.userRole.upsert({
      where: { userId_roleCode: { userId, roleCode: 'EMPLOYER' } },
      update: { status: 'APPROVED', approvedAt: new Date() },
      create: { userId, roleCode: 'EMPLOYER', status: 'APPROVED', approvedAt: new Date() },
    });
    const existingApp = await prisma.roleApplication.findFirst({ where: { userId, roleCode: 'EMPLOYER' } });
    if (!existingApp) {
      await prisma.roleApplication.create({
        data: {
          userId,
          roleCode: 'EMPLOYER',
          userRoleId: userRole.id,
          status: 'APPROVED',
          decidedAt: new Date(),
          message: 'BMPL-228 e2e fixture — pre-approved, not a real business.',
          reviews: {
            create: [
              { action: 'SUBMITTED', toStatus: 'PENDING' },
              { action: 'APPROVED', fromStatus: 'PENDING', toStatus: 'APPROVED' },
            ],
          },
        },
      });
    }
  }

  // FIXTURE 1: approved employer WITH a profile already saved.
  const withProfile = await createUser({
    email: 'e2e-fixture.employer-with-profile@example.bz',
    password,
    firstName: 'E2E Fixture',
    lastName: 'Employer (has a profile — BMPL-228, apps/web/e2e)',
    verified: true,
  });
  await approveEmployerRole(withProfile.id);
  await prisma.employerProfile.upsert({
    where: { userId: withProfile.id },
    update: {},
    create: {
      userId: withProfile.id,
      companyName: 'BMPL-228 E2E Fixture Co.',
      slug: 'bmpl-228-e2e-fixture-co',
      contactEmail: 'e2e-fixture.employer-with-profile@example.bz',
      approvalStatus: 'APPROVED',
    },
  });

  // FIXTURE 2: approved employer that must NEVER have a profile. See the
  // block comment above this function before touching anything here.
  const noProfile = await createUser({
    email: 'do-not-create-a-profile.e2e-fixture@example.bz',
    password,
    firstName: 'DO-NOT-GIVE-THIS-ACCOUNT-A-PROFILE',
    lastName: '(e2e fixture — BMPL-228, see seed.ts)',
    verified: true,
  });
  await approveEmployerRole(noProfile.id);

  console.info('✓ Seeded Belize Connect e2e fixtures (BMPL-228): 1 with a profile, 1 permanently without');
}

/**
 * MDF-410: /products/[slug] and /store/[slug] had NO seed record anywhere in
 * the repo, so neither could render locally at any viewport, let alone the
 * owner's required eight widths — a repo fixture gap, not a production one
 * (production carries its own, unrelated live products).
 *
 * isTest MUST be false here, which is the opposite of how a vendor/product is
 * normally marked as simulation data. products.service.ts's publicDetail()
 * and vendor.service.ts's publicStorefront() both deliberately exclude
 * isTest vendors from direct-slug reachability (the whole point of that flag
 * is that a simulation storefront is NOT publicly reachable even by its exact
 * slug) — so an isTest fixture here would 404 on exactly the route it exists
 * to exercise. "Clearly labeled" is carried entirely by name/content instead,
 * same as the BMPL-228 employer fixture above, which has no isTest boundary
 * to lean on either.
 *
 * Reuses the existing deshawn.vendor@example.bz demo account (seeded by
 * seedDemoData above) rather than creating a second vendor identity.
 */
async function seedMarketplaceFixtures() {
  const deshawn = await prisma.user.findUnique({ where: { email: 'deshawn.vendor@example.bz' } });
  if (!deshawn) {
    console.warn('⚠ MDF-410: deshawn.vendor@example.bz not found — skipping marketplace storefront/product fixture.');
    return;
  }

  await prisma.userRole.upsert({
    where: { userId_roleCode: { userId: deshawn.id, roleCode: 'VENDOR' } },
    update: { status: 'APPROVED', approvedAt: new Date() },
    create: { userId: deshawn.id, roleCode: 'VENDOR', status: 'APPROVED', approvedAt: new Date() },
  });

  const vendor = await prisma.vendorProfile.upsert({
    where: { slug: 'uat-walk-store-simulation' },
    update: {},
    create: {
      userId: deshawn.id,
      businessName: 'UAT Walk Store (simulation)',
      slug: 'uat-walk-store-simulation',
      contactEmail: 'deshawn.vendor@example.bz',
      approvalStatus: 'APPROVED',
      storeStatus: 'CLOSED',
      isTest: false,
      submittedAt: new Date(),
      approvedAt: new Date(),
    },
  });

  await prisma.vendorSettings.upsert({
    where: { vendorProfileId: vendor.id },
    update: {},
    create: {
      vendorProfileId: vendor.id,
      pickupEnabled: true,
      deliveryEnabled: true,
      baseDeliveryFeeMinor: 500n,
    },
  });

  await prisma.vendorLocation.upsert({
    where: { id: 'mdf410-uat-walk-store-hq' },
    update: {},
    create: {
      id: 'mdf410-uat-walk-store-hq',
      vendorProfileId: vendor.id,
      label: 'Req1 HQ Warehouse',
      addressLine1: '123 Main St',
      city: 'Belize City',
      district: 'BELIZE',
      country: 'BZ',
      isPrimary: false,
    },
  });

  const electronics = await prisma.category.findUnique({ where: { slug: 'electronics' } });
  if (!electronics) {
    console.warn('⚠ MDF-410: "electronics" category not found — skipping product fixture (store fixture still seeded).');
  } else {
    await prisma.product.upsert({
      where: { slug: 'uat-walk-widget-simulation' },
      update: {},
      create: {
        vendorProfileId: vendor.id,
        categoryId: electronics.id,
        title: 'UAT Walk Widget (simulation)',
        slug: 'uat-walk-widget-simulation',
        description: 'Simulation product for the BMPL-106 walkthrough.',
        sku: 'UATWALK-1',
        status: 'PUBLISHED',
        priceMinor: 2500n,
        currency: 'BZD',
        publishedAt: new Date(),
      },
    });
  }

  console.info(
    '✓ Seeded marketplace fixtures (MDF-410): /store/uat-walk-store-simulation, /products/uat-walk-widget-simulation',
  );
}

/**
 * MDF-410: /properties/agencies/[slug] had NO seed record anywhere in the
 * repo either. AgencyProfile carries no isTest column at all (Belize Connect
 * and real estate share that gap — see seedEmployerE2eFixtures' own comment),
 * so "clearly labeled" is carried by the `[QA SYNTHETIC]` name prefix and the
 * description, not by a simulation flag.
 *
 * Reuses the existing uat-real-estate-agent@bzemarketplace.com UAT account as
 * the agency's manager rather than creating a second identity.
 */
async function seedAgencyFixture() {
  const manager = await prisma.user.findUnique({ where: { email: 'uat-real-estate-agent@bzemarketplace.com' } });
  if (!manager) {
    console.warn('⚠ MDF-410: uat-real-estate-agent@bzemarketplace.com not found — skipping agency fixture.');
    return;
  }

  await prisma.agencyProfile.upsert({
    where: { slug: 'qa-synthetic-caye-breeze-realty-group' },
    update: {},
    create: {
      managerUserId: manager.id,
      name: '[QA SYNTHETIC] Caye Breeze Realty Group',
      slug: 'qa-synthetic-caye-breeze-realty-group',
      description:
        'SYNTHETIC QA TEST DATA - not a real agency. Created to exercise the /properties/agencies/[slug] route locally only, per MDF-376/MDF-410.',
      contactEmail: 'qa-synthetic-agency@example.bz',
      district: 'BELIZE',
      city: 'Belize City',
      approvalStatus: 'APPROVED',
    },
  });

  console.info('✓ Seeded real-estate agency fixture (MDF-410): /properties/agencies/qa-synthetic-caye-breeze-realty-group');
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
