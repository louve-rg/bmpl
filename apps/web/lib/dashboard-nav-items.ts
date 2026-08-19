import type { RoleGatedGroup } from './dashboard-nav';

/**
 * The dashboard navigation, defined ONCE.
 *
 * This used to live inside `Sidebar.tsx`, which was fine while the sidebar was
 * the only place navigation appeared. Adding a mobile drawer would have meant a
 * second copy, and two copies of a nav is two navs — one of them quietly missing
 * whatever was added last. The desktop sidebar and the mobile drawer now render
 * from this module and differ only in layout.
 *
 * `icon` is an SVG path `d` string rather than a component so this file stays
 * plain data and can be imported by tests without a React renderer.
 */
export interface NavItem {
  label: string;
  href: string;
  icon: string;
}

const HOME_ICON = 'M3 10.5 12 4l9 6.5M5 9.5V20h14V9.5M9 20v-6h6v6';
const PERSON_ICON = 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0';
const TRUCK_ICON = 'M3 7h11v9H3z M14 10h4l3 3v3h-7';
const CHAT_ICON = 'M4 5h16v10H7l-3 3V5Z';
const HEART_ICON =
  'M12 21s-7.5-4.9-10-9.4C.6 8.7 2 5.3 5.2 5.3c2 0 3.3 1.2 4.8 3 1.5-1.8 2.8-3 4.8-3 3.2 0 4.6 3.4 3.2 6.3C19.5 16.1 12 21 12 21Z';
const DOC_ICON = 'M7 3h7l5 5v13H7V3Zm7 0v5h5M9 13h6M9 17h6';
const CALENDAR_ICON = 'M8 3v4M16 3v4M4 9h16M5 5h14v16H5V5Z';
const CHART_ICON = 'M4 20V4 M4 20h16 M8 20v-6 M13 20V9 M18 20v-9';
const BUILDING_ICON = 'M4 21V5l8-3 8 3v16M9 21v-5h6v5M8 9h1M8 13h1M15 9h1M15 13h1';
const CARD_ICON = 'M3 6h18v12H3zM3 10h18';

/** The customer baseline every signed-in user gets. */
export const BASE_NAV: NavItem[] = [
  { label: 'Overview', href: '/dashboard', icon: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z' },
  { label: 'Notifications', href: '/dashboard/notifications', icon: 'M12 3a6 6 0 0 0-6 6v3l-2 3h16l-2-3V9a6 6 0 0 0-6-6ZM9 19a3 3 0 0 0 6 0' },
  { label: 'Messages', href: '/dashboard/messages', icon: CHAT_ICON },
  { label: 'My Orders', href: '/orders', icon: 'M6 3h12l1 4H5l1-4Zm-1 4v13h14V7M9 11h6' },
  // Separate from Orders on purpose: a shipment can exist without a purchase,
  // and a locally-delivered order has no shipment at all.
  { label: 'Shipments', href: '/dashboard/shipments', icon: 'M3 8h11v8H3zM14 11h4l3 3v2h-7zM6.5 19a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Zm11 0a1.5 1.5 0 1 0 0-3 1.5 1.5 0 0 0 0 3Z' },
  { label: 'Wishlist', href: '/wishlist', icon: HEART_ICON },
  { label: 'My Reviews', href: '/dashboard/reviews', icon: 'M12 3l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.3l-5.8 3.06 1.1-6.46-4.69-4.58 6.49-.94L12 3Z' },
  { label: 'Payments', href: '/payments', icon: CARD_ICON },
  { label: 'My Roles', href: '/dashboard/roles', icon: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 8a6 6 0 0 1 12 0' },
  { label: 'Profile', href: '/dashboard/profile', icon: PERSON_ICON },
];

/**
 * Driver tools — only for an approved DELIVERY_DRIVER (these routes are
 * role-gated, so showing them to everyone created dead-end links for plain
 * customers).
 *
 * The client asked for each of Driver Profile, Vehicle Profile, Application &
 * Documents and Service Areas to be reachable from the navigation. They were all
 * sections of one very long dashboard page before, which meant the only way to
 * reach "Service Areas" was to scroll past four forms.
 *
 * Operational items come first, management below: a driver opens this to work,
 * not to edit their licence expiry.
 */
export const DRIVER_NAV: NavItem[] = [
  { label: 'Driver Dashboard', href: '/dashboard/driver', icon: HOME_ICON },
  { label: 'My Deliveries', href: '/dashboard/driver/jobs', icon: TRUCK_ICON },
  { label: 'My Earnings', href: '/dashboard/driver/earnings', icon: 'M12 3v18 M6 8h9a3 3 0 0 1 0 6H8' },
  { label: 'Driver Profile', href: '/dashboard/driver/profile', icon: PERSON_ICON },
  { label: 'Vehicle Profile', href: '/dashboard/driver/vehicles', icon: 'M5 16h14M5 16a2 2 0 1 0 4 0M15 16a2 2 0 1 0 4 0M4 16v-4l2-5h9l3 5h2v4' },
  { label: 'Application & Documents', href: '/dashboard/driver/documents', icon: DOC_ICON },
  { label: 'Service Areas', href: '/dashboard/driver/service-areas', icon: 'M12 21s-6-5.3-6-10a6 6 0 1 1 12 0c0 4.7-6 10-6 10Zm0-8a2 2 0 1 0 0-4 2 2 0 0 0 0 4Z' },
];

const VENDOR_NAV: NavItem[] = [
  { label: 'My Store', href: '/dashboard/store', icon: 'M4 8h16l-1 3H5L4 8Zm1 3v9h14v-9M9 20v-5h6v5' },
  { label: 'My Products', href: '/dashboard/products', icon: 'M4 7l8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7' },
  { label: 'Store Orders', href: '/dashboard/orders', icon: 'M6 3h12l1 4H5l1-4Zm-1 4v13h14V7' },
  { label: 'Delivery', href: '/dashboard/delivery', icon: TRUCK_ICON },
  { label: 'Settlements', href: '/dashboard/settlements', icon: CARD_ICON },
  { label: 'Analytics', href: '/dashboard/analytics', icon: CHART_ICON },
];

const JOBS_NAV: NavItem[] = [
  { label: 'Job Profile', href: '/dashboard/jobs/profile', icon: PERSON_ICON },
  { label: 'Saved Jobs', href: '/dashboard/jobs/saved', icon: HEART_ICON },
  { label: 'My Applications', href: '/dashboard/jobs/applications', icon: DOC_ICON },
];

const EMPLOYER_NAV: NavItem[] = [
  { label: 'Company', href: '/dashboard/employer', icon: BUILDING_ICON },
  { label: 'Job Listings', href: '/dashboard/employer/jobs', icon: 'M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2M3 7h18v13H3V7Zm0 5h18' },
  { label: 'Applicants', href: '/dashboard/employer/applications', icon: 'M16 11a4 4 0 1 0-4-4M3 21a6 6 0 0 1 12 0M17 21a5 5 0 0 0-2-4' },
];

const REALESTATE_NAV: NavItem[] = [
  { label: 'Saved Properties', href: '/dashboard/properties/saved', icon: HEART_ICON },
  { label: 'My Enquiries', href: '/dashboard/properties/enquiries', icon: CHAT_ICON },
  { label: 'My Viewings', href: '/dashboard/properties/viewings', icon: CALENDAR_ICON },
];

const PROPERTY_OWNER_NAV: NavItem[] = [
  { label: 'Owner Profile', href: '/dashboard/property-owner/profile', icon: PERSON_ICON },
  { label: 'My Listings', href: '/dashboard/property-owner/listings', icon: HOME_ICON },
  { label: 'Enquiries', href: '/dashboard/property-owner/enquiries', icon: CHAT_ICON },
  { label: 'Viewings', href: '/dashboard/property-owner/viewings', icon: CALENDAR_ICON },
  { label: 'Analytics', href: '/dashboard/property-owner/analytics', icon: CHART_ICON },
];

const AGENT_NAV: NavItem[] = [
  { label: 'Agent Profile', href: '/dashboard/real-estate-agent/profile', icon: PERSON_ICON },
  { label: 'Agency', href: '/dashboard/real-estate-agent/agency', icon: BUILDING_ICON },
  { label: 'Assignments', href: '/dashboard/real-estate-agent/assignments', icon: DOC_ICON },
  { label: 'Listings', href: '/dashboard/real-estate-agent/listings', icon: HOME_ICON },
  { label: 'Enquiries', href: '/dashboard/real-estate-agent/enquiries', icon: CHAT_ICON },
  { label: 'Viewings', href: '/dashboard/real-estate-agent/viewings', icon: CALENDAR_ICON },
  { label: 'Analytics', href: '/dashboard/real-estate-agent/analytics', icon: CHART_ICON },
];

const MARKETING_NAV: NavItem[] = [
  { label: 'Overview', href: '/dashboard/business/marketing', icon: CHART_ICON },
  { label: 'Promotions', href: '/dashboard/business/marketing/promotions', icon: 'M3 11l18-5v12L3 14v-3Zm0 0v4a2 2 0 0 0 2 2h1' },
  { label: 'Campaigns', href: '/dashboard/business/marketing/campaigns', icon: 'M3 5h18v4H3zM5 9v10h14V9M9 13h6' },
  { label: 'Coupons', href: '/dashboard/business/marketing/coupons', icon: 'M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V7Zm10 0v10' },
];

/**
 * Every role-gated section of the navigation, in display order. `requires` is
 * deliberately NOT optional: a section is only ever shown to users holding one of
 * its roles (status APPROVED), and a future section cannot be added without saying
 * which roles it belongs to.
 *
 * The seeker groups are gated too, even though their APIs accept any CUSTOMER:
 * - Belize Connect → JOB_SEEKER, an opt-in role that needs no approval, so a user
 *   self-grants it from My Roles the moment they want the job tools.
 * - Real Estate → the seller-side real-estate roles. There is no seeker role, and
 *   the tools stay reachable by URL; this only keeps the nav to roles the user
 *   actually holds.
 */
export const ROLE_GROUPS: ReadonlyArray<RoleGatedGroup<NavItem>> = [
  { heading: 'Belize Connect', items: JOBS_NAV, requires: ['JOB_SEEKER'] },
  { heading: 'Real Estate', items: REALESTATE_NAV, requires: ['PROPERTY_OWNER', 'REAL_ESTATE_AGENT'] },
  { heading: 'Driver', items: DRIVER_NAV, requires: ['DELIVERY_DRIVER'] },
  { heading: 'Vendor', items: VENDOR_NAV, requires: ['VENDOR'] },
  { heading: 'Employer', items: EMPLOYER_NAV, requires: ['EMPLOYER'] },
  { heading: 'Property Owner', items: PROPERTY_OWNER_NAV, requires: ['PROPERTY_OWNER'] },
  { heading: 'Real-Estate Agent', items: AGENT_NAV, requires: ['REAL_ESTATE_AGENT'] },
  // Marketing tools are available to any approved business role.
  { heading: 'Marketing', items: MARKETING_NAV, requires: ['VENDOR', 'EMPLOYER', 'PROPERTY_OWNER', 'REAL_ESTATE_AGENT'] },
];

/**
 * Is `href` the section the user is currently in?
 *
 * `/dashboard` matches exactly — everything else lives under it, so a prefix
 * match would light up Overview on every page. Everything else matches its own
 * subtree, EXCEPT where one nav href is a prefix of another: `/dashboard/driver`
 * is the parent of `/dashboard/driver/jobs`, and prefix-matching would show two
 * items active at once. `siblings` is the full set of hrefs in the nav, and a
 * longer sibling that also matches wins.
 */
export function isNavItemActive(href: string, pathname: string, siblings: readonly string[] = []): boolean {
  if (href === '/dashboard') return pathname === '/dashboard';
  const matches = (h: string) => pathname === h || pathname.startsWith(`${h}/`);
  if (!matches(href)) return false;
  return !siblings.some((s) => s !== href && s.length > href.length && matches(s));
}

/** Every href in the navigation — the sibling set for {@link isNavItemActive}. */
export function allNavHrefs(groups: ReadonlyArray<{ items: NavItem[] }>): string[] {
  return groups.flatMap((g) => g.items.map((i) => i.href));
}
