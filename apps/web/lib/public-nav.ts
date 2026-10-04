/**
 * The one definition of the public site's primary navigation (P3 of the nav
 * plan). The desktop row and the mobile list both read from here, and the
 * grouped menu will too, so a label or destination cannot drift between them.
 *
 * Anchor links point at the landing page ("/#…") so they work from any route,
 * not just when the visitor is already on "/".
 */
export type PublicNavItem = { label: string; href: string };

export const PUBLIC_NAV: readonly PublicNavItem[] = [
  { label: 'Shop', href: '/products' },
  { label: 'Vendors', href: '/vendors' },
  { label: 'Jobs', href: '/jobs' },
  { label: 'Real Estate', href: '/properties' },
  { label: 'Services', href: '/#services' },
  { label: 'For Providers', href: '/#providers' },
  { label: 'Wallet', href: '/#wallet' },
  { label: 'Mobile App', href: '/#mobile' },
];
