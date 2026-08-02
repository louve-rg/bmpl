/**
 * Admin permission catalog.
 *
 * IMPORTANT: admin permissions are a SEPARATE axis from customer-facing roles.
 * A user's customer roles (VENDOR, DRIVER, ...) never grant any of these. These
 * are held via AdminPermission records and enforced by backend guards.
 */
export const PERMISSIONS = [
  'users.read',
  'users.suspend',
  'users.restore',
  'role_applications.read',
  'role_applications.review', // approve / reject / request-more-info
  'roles.suspend',
  'roles.restore',
  'roles.revoke',
  'documents.read', // view private uploaded documents via signed URLs
  'audit.read',
  'admin.manage', // manage other admins' permissions (SUPER_ADMIN)
  'notifications.broadcast',
  // ---- Marketplace (Phase 2) ----
  'vendors.read', // view vendor profiles in the admin moderation console
  'vendors.moderate', // approve / reject / suspend / restore vendor storefronts
  'products.read', // view products in the admin moderation console
  'products.moderate', // approve / reject / suspend products
  'categories.manage', // create / edit / delete marketplace categories
  // ---- Marketplace (Phase 3 · M10) ----
  'orders.read', // read-only order visibility in the admin console (no editing)
  'orders.manage', // operational order actions (e.g. release inventory reservations) — M10.1
  // ---- Marketplace (Phase 3 · M11) ----
  'payments.read', // read-only payment / wallet-hold / payment-event visibility (no actions)
  // ---- Wallet (Phase 3 · M12) ----
  'wallet.read', // read-only wallet transactions / escrow balances / ledger visibility (no adjustments)
  // ---- Logistics: Driver Management (Phase 4 · M14) ----
  'drivers.read', // view driver profiles / vehicles / service areas / availability (read-only)
  'drivers.moderate', // approve/reject driver vehicles (driver role approval reuses role_applications.review)
  // ---- Logistics: Dispatch & Delivery Execution (Phase 4 · M15) ----
  'deliveries.read', // view deliveries, timelines, assignment history in the dispatch console (read-only)
  'deliveries.assign', // assign / reassign a driver to a delivery
  'deliveries.manage', // cancel an assignment; other operational dispatch actions
  'deliveries.verify', // reveal pickup/delivery PINs; admin override of verification
  'proof_of_delivery.read', // view private proof-of-delivery files via signed URLs
  // ---- Messaging & Order Communication (Phase 4 · M17) ----
  'support.read', // list / view support conversations (and any conversation for moderation)
  'support.respond', // join + reply to support threads, add internal notes, close/reopen
  // ---- Settlement & Earnings (Phase 3 · M18) ----
  'settlements.read', // view settlements, driver earnings, financial timeline + exceptions (read-only)
  'settlements.manage', // update the platform fee configuration + retry failed settlements
  // ---- Reviews & Ratings (Phase 4 · M19) ----
  'reviews.read', // view all reviews + reports in the moderation console (read-only)
  'reviews.moderate', // hide/reject reviews + resolve reports
  // ---- Analytics & Reporting (Phase 4 · M22) ----
  'analytics.read', // view platform analytics dashboards + export reports (read-only)
  // ---- Platform Operations (Phase 4 · M23) ----
  'ops.read', // view the operations console (cross-domain action queues + audit export)
  'ops.manage', // manage the platform announcement / maintenance banner
  // ---- Belize Connect Jobs (Phase 5 · M24) ----
  'employers.read', // view employer/company profiles + applications in the admin console
  'employers.moderate', // approve/reject/suspend employers (role-application review reused)
  'jobs.read', // view job listings + moderation queue (read-only)
  'jobs.moderate', // approve/reject/more-info/unpublish/suspend/archive job listings + resolve job reports
  'job_categories.manage', // manage the job-category lookup
  // ---- Real Estate (Phase 6 · M25) ----
  'properties.read', // view property listings + moderation queue (read-only)
  'properties.moderate', // approve/reject/more-info/suspend/unpublish/archive listings; resolve property reports
  'property_owners.read', // view property-owner profiles/applications
  'property_owners.moderate', // suspend/restore property owners
  'real_estate_agents.read', // view agent profiles/applications
  'real_estate_agents.moderate', // suspend/restore agents
  'agencies.read', // view agencies
  'agencies.moderate', // approve/suspend agencies
  'property_reports.read', // view the property report queue
  'property_documents.read', // HIGHLY RESTRICTED — view private ownership/authority documents (SUPER_ADMIN only)
  // Marketing & Business Promotion (M26)
  'promotions.read', // view promotions + moderation queue (read-only)
  'promotions.moderate', // approve/reject/more-info/pause/expire/archive promotions; resolve abuse reports
  'promotions.manage', // admin-manage featured content, placements, priority directly
  'campaigns.manage', // admin-manage campaigns + schedules + lifecycle
  'coupons.manage', // admin-manage platform coupons + review vendor coupons
  'marketing.analytics', // view cross-promotion marketing analytics
  'homepage.manage', // curate homepage hero/featured placements
] as const;

export type Permission = (typeof PERMISSIONS)[number];

/** Default permission bundles applied when seeding/assigning staff roles. */
export const PERMISSION_BUNDLES: Record<string, Permission[]> = {
  SUPPORT_AGENT: [
    'users.read',
    'role_applications.read',
    'documents.read',
    'audit.read',
    'vendors.read',
    'products.read',
    'orders.read',
    'payments.read',
    'wallet.read',
    'drivers.read',
    'deliveries.read',
    'proof_of_delivery.read',
    'support.read',
    'support.respond',
    'settlements.read',
    'reviews.read',
    'employers.read',
    'jobs.read',
    'properties.read',
    'real_estate_agents.read',
    'agencies.read',
    'property_owners.read',
    'promotions.read',
    'marketing.analytics',
  ],
  ADMIN: [
    'users.read',
    'users.suspend',
    'users.restore',
    'role_applications.read',
    'role_applications.review',
    'roles.suspend',
    'roles.restore',
    'roles.revoke',
    'documents.read',
    'audit.read',
    'notifications.broadcast',
    'vendors.read',
    'vendors.moderate',
    'products.read',
    'products.moderate',
    'categories.manage',
    'orders.read',
    'orders.manage',
    'payments.read',
    'wallet.read',
    'drivers.read',
    'drivers.moderate',
    'deliveries.read',
    'deliveries.assign',
    'deliveries.manage',
    'deliveries.verify',
    'proof_of_delivery.read',
    'support.read',
    'support.respond',
    'settlements.read',
    'settlements.manage',
    'reviews.read',
    'reviews.moderate',
    'analytics.read',
    'ops.read',
    'ops.manage',
    'employers.read',
    'employers.moderate',
    'jobs.read',
    'jobs.moderate',
    'job_categories.manage',
    // Real Estate (M25) — NOTE: property_documents.read is deliberately EXCLUDED from
    // the ADMIN bundle (private ownership docs → SUPER_ADMIN only).
    'properties.read',
    'properties.moderate',
    'property_owners.read',
    'property_owners.moderate',
    'real_estate_agents.read',
    'real_estate_agents.moderate',
    'agencies.read',
    'agencies.moderate',
    'property_reports.read',
    // Marketing & Business Promotion (M26)
    'promotions.read',
    'promotions.moderate',
    'promotions.manage',
    'campaigns.manage',
    'coupons.manage',
    'marketing.analytics',
    'homepage.manage',
  ],
  SUPER_ADMIN: [...PERMISSIONS],
};
