/**
 * The public site's navigation: Edward's hierarchy, as data (P6 of the nav plan).
 *
 * The desktop dropdowns and the mobile list both read from here, so a label or
 * destination cannot drift between them. Every href is a real destination; the
 * server still decides what a signed-out or unauthorised visitor can do there.
 *
 * Deliberately ABSENT, named rather than stubbed:
 * - Marketing (a page exists only for business roles; the owner's ruling is
 *   pending on whether it belongs in public navigation at all),
 * - Get Help (two readings; Edward's own hierarchy points at the one we cannot serve),
 * - Real Estate > Lease (needs a listing type we do not have; owner-gated),
 * - Favorites > Names (no unambiguous mapping).
 *
 * The landing-page anchors (/#services, /#providers, /#wallet, /#mobile) are
 * not destinations and are not listed. Home is the place those sections live.
 */
export type PublicNavItem = { label: string; href: string };
export type PublicNavGroup = { heading: string; items: readonly PublicNavItem[] };

export const PUBLIC_NAV_HOME: PublicNavItem = { label: 'Home', href: '/' };

export const PUBLIC_NAV_GROUPS: readonly PublicNavGroup[] = [
  {
    heading: 'Commerce',
    items: [
      { label: 'Marketplace', href: '/products' },
      { label: 'Vendors', href: '/vendors' },
      { label: 'View Cart', href: '/cart' },
      { label: 'Orders', href: '/orders' },
    ],
  },
  {
    heading: 'Transport & Logistics',
    items: [
      { label: 'Shipping & Delivery', href: '/shipping' },
      { label: 'Passenger Service', href: '/dashboard/passenger' },
    ],
  },
  {
    heading: 'Belize Connect',
    items: [
      { label: 'Find Work', href: '/jobs' },
      { label: 'Post Jobs', href: '/dashboard/employer/jobs/new' },
    ],
  },
  {
    heading: 'Real Estate',
    items: [
      { label: 'Sale', href: '/properties?purpose=FOR_SALE' },
      { label: 'Rent', href: '/properties?purpose=FOR_RENT' },
    ],
  },
  {
    heading: 'Opportunities & Earnings',
    items: [
      { label: 'Become a Marketplace Vendor', href: '/dashboard/store' },
      { label: 'Drive, Ride or Deliver', href: '/dashboard/driver' },
      { label: 'Upload Resume & Skills', href: '/dashboard/jobs/profile' },
    ],
  },
  {
    heading: 'Favorites',
    items: [{ label: 'Addresses', href: '/dashboard/addresses' }],
  },
];
