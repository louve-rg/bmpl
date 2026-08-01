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
  ],
  SUPER_ADMIN: [...PERMISSIONS],
};
