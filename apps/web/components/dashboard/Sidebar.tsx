'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { BrandLockup } from '../Logo';
import { RoleSwitcher } from './RoleSwitcher';
import { LogoutButton } from './LogoutButton';
import { api } from '../../lib/api';
import type { MeView } from '../../lib/types';
import { badgeCount, unreadLabel } from '../../lib/badge';

type NavItem = { label: string; href: string; icon: string };

const BASE_NAV: NavItem[] = [
  { label: 'Overview', href: '/dashboard', icon: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z' },
  { label: 'Notifications', href: '/dashboard/notifications', icon: 'M12 3a6 6 0 0 0-6 6v3l-2 3h16l-2-3V9a6 6 0 0 0-6-6ZM9 19a3 3 0 0 0 6 0' },
  { label: 'Messages', href: '/dashboard/messages', icon: 'M4 5h16v10H7l-3 3V5Z' },
  { label: 'My Orders', href: '/orders', icon: 'M6 3h12l1 4H5l1-4Zm-1 4v13h14V7M9 11h6' },
  { label: 'Wishlist', href: '/wishlist', icon: 'M12 21s-7.5-4.9-10-9.4C.6 8.7 2 5.3 5.2 5.3c2 0 3.3 1.2 4.8 3 1.5-1.8 2.8-3 4.8-3 3.2 0 4.6 3.4 3.2 6.3C19.5 16.1 12 21 12 21Z' },
  { label: 'My Reviews', href: '/dashboard/reviews', icon: 'M12 3l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.3l-5.8 3.06 1.1-6.46-4.69-4.58 6.49-.94L12 3Z' },
  { label: 'Payments', href: '/payments', icon: 'M3 6h18v12H3zM3 10h18' },
  { label: 'My Roles', href: '/dashboard/roles', icon: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 8a6 6 0 0 1 12 0' },
  { label: 'Profile', href: '/dashboard/profile', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0' },
];

// Driver tools — only for an approved DELIVERY_DRIVER (these routes are role-gated,
// so showing them to everyone created dead-end links for plain customers).
const DRIVER_NAV: NavItem[] = [
  { label: 'Driver Home', href: '/dashboard/driver', icon: 'M3 7h11v9H3z M14 10h4l3 3v3h-7' },
  { label: 'Deliveries', href: '/dashboard/driver/jobs', icon: 'M3 7h11v9H3z M14 10h4l3 3v3h-7' },
  { label: 'Earnings', href: '/dashboard/driver/earnings', icon: 'M12 3v18 M6 8h9a3 3 0 0 1 0 6H8' },
];

const VENDOR_NAV: NavItem[] = [
  { label: 'My Store', href: '/dashboard/store', icon: 'M4 8h16l-1 3H5L4 8Zm1 3v9h14v-9M9 20v-5h6v5' },
  { label: 'My Products', href: '/dashboard/products', icon: 'M4 7l8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7' },
  { label: 'Store Orders', href: '/dashboard/orders', icon: 'M6 3h12l1 4H5l1-4Zm-1 4v13h14V7' },
  { label: 'Delivery', href: '/dashboard/delivery', icon: 'M3 7h11v9H3z M14 10h4l3 3v3h-7' },
  { label: 'Settlements', href: '/dashboard/settlements', icon: 'M3 6h18v12H3z M3 10h18' },
  { label: 'Analytics', href: '/dashboard/analytics', icon: 'M4 20V4 M4 20h16 M8 20v-6 M13 20V9 M18 20v-9' },
];

const JOBS_NAV: NavItem[] = [
  { label: 'Job Profile', href: '/dashboard/jobs/profile', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0' },
  { label: 'Saved Jobs', href: '/dashboard/jobs/saved', icon: 'M12 21s-7.5-4.9-10-9.4C.6 8.7 2 5.3 5.2 5.3c2 0 3.3 1.2 4.8 3 1.5-1.8 2.8-3 4.8-3 3.2 0 4.6 3.4 3.2 6.3C19.5 16.1 12 21 12 21Z' },
  { label: 'My Applications', href: '/dashboard/jobs/applications', icon: 'M7 3h7l5 5v13H7V3Zm7 0v5h5M9 13h6M9 17h6' },
];

const EMPLOYER_NAV: NavItem[] = [
  { label: 'Company', href: '/dashboard/employer', icon: 'M4 21V5l8-3 8 3v16M9 21v-5h6v5M8 9h1M8 13h1M15 9h1M15 13h1' },
  { label: 'Job Listings', href: '/dashboard/employer/jobs', icon: 'M6 7V5a2 2 0 0 1 2-2h8a2 2 0 0 1 2 2v2M3 7h18v13H3V7Zm0 5h18' },
  { label: 'Applicants', href: '/dashboard/employer/applications', icon: 'M16 11a4 4 0 1 0-4-4M3 21a6 6 0 0 1 12 0M17 21a5 5 0 0 0-2-4' },
];

const HOME_ICON = 'M3 10.5 12 4l9 6.5M5 9.5V20h14V9.5M9 20v-6h6v6';
const REALESTATE_NAV: NavItem[] = [
  { label: 'Saved Properties', href: '/dashboard/properties/saved', icon: 'M12 21s-7.5-4.9-10-9.4C.6 8.7 2 5.3 5.2 5.3c2 0 3.3 1.2 4.8 3 1.5-1.8 2.8-3 4.8-3 3.2 0 4.6 3.4 3.2 6.3C19.5 16.1 12 21 12 21Z' },
  { label: 'My Enquiries', href: '/dashboard/properties/enquiries', icon: 'M4 5h16v10H7l-3 3V5Z' },
  { label: 'My Viewings', href: '/dashboard/properties/viewings', icon: 'M8 3v4M16 3v4M4 9h16M5 5h14v16H5V5Z' },
];

const PROPERTY_OWNER_NAV: NavItem[] = [
  { label: 'Owner Profile', href: '/dashboard/property-owner/profile', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0' },
  { label: 'My Listings', href: '/dashboard/property-owner/listings', icon: HOME_ICON },
  { label: 'Enquiries', href: '/dashboard/property-owner/enquiries', icon: 'M4 5h16v10H7l-3 3V5Z' },
  { label: 'Viewings', href: '/dashboard/property-owner/viewings', icon: 'M8 3v4M16 3v4M4 9h16M5 5h14v16H5V5Z' },
  { label: 'Analytics', href: '/dashboard/property-owner/analytics', icon: 'M4 20V4 M4 20h16 M8 20v-6 M13 20V9 M18 20v-9' },
];

const AGENT_NAV: NavItem[] = [
  { label: 'Agent Profile', href: '/dashboard/real-estate-agent/profile', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0' },
  { label: 'Agency', href: '/dashboard/real-estate-agent/agency', icon: 'M4 21V5l8-3 8 3v16M9 21v-5h6v5M8 9h1M8 13h1M15 9h1M15 13h1' },
  { label: 'Assignments', href: '/dashboard/real-estate-agent/assignments', icon: 'M7 3h7l5 5v13H7V3Zm7 0v5h5M9 13h6M9 17h6' },
  { label: 'Listings', href: '/dashboard/real-estate-agent/listings', icon: HOME_ICON },
  { label: 'Enquiries', href: '/dashboard/real-estate-agent/enquiries', icon: 'M4 5h16v10H7l-3 3V5Z' },
  { label: 'Viewings', href: '/dashboard/real-estate-agent/viewings', icon: 'M8 3v4M16 3v4M4 9h16M5 5h14v16H5V5Z' },
  { label: 'Analytics', href: '/dashboard/real-estate-agent/analytics', icon: 'M4 20V4 M4 20h16 M8 20v-6 M13 20V9 M18 20v-9' },
];

const MARKETING_NAV: NavItem[] = [
  { label: 'Overview', href: '/dashboard/business/marketing', icon: 'M4 20V4 M4 20h16 M8 20v-6 M13 20V9 M18 20v-9' },
  { label: 'Promotions', href: '/dashboard/business/marketing/promotions', icon: 'M3 11l18-5v12L3 14v-3Zm0 0v4a2 2 0 0 0 2 2h1' },
  { label: 'Campaigns', href: '/dashboard/business/marketing/campaigns', icon: 'M3 5h18v4H3zM5 9v10h14V9M9 13h6' },
  { label: 'Coupons', href: '/dashboard/business/marketing/coupons', icon: 'M4 7h16v3a2 2 0 0 0 0 4v3H4v-3a2 2 0 0 0 0-4V7Zm10 0v10' },
];

const MESSAGES_POLL_MS = 60_000;

export function Sidebar({ me }: { me: MeView }) {
  const pathname = usePathname();
  // On mobile the full multi-group nav is collapsed behind a toggle so it doesn't
  // push page content far down; it's always visible from `md` upward.
  const [menuOpen, setMenuOpen] = useState(false);
  useEffect(() => {
    setMenuOpen(false);
  }, [pathname]);
  const isVendor = me.roles.some((r) => r.roleCode === 'VENDOR' && r.status === 'APPROVED');
  const isEmployer = me.roles.some((r) => r.roleCode === 'EMPLOYER' && r.status === 'APPROVED');
  const isPropertyOwner = me.roles.some((r) => r.roleCode === 'PROPERTY_OWNER' && r.status === 'APPROVED');
  const isAgent = me.roles.some((r) => r.roleCode === 'REAL_ESTATE_AGENT' && r.status === 'APPROVED');
  const isDriver = me.roles.some((r) => r.roleCode === 'DELIVERY_DRIVER' && r.status === 'APPROVED');
  const groups: Array<{ heading?: string; items: NavItem[] }> = [
    { items: BASE_NAV },
    { heading: 'Belize Connect', items: JOBS_NAV },
    { heading: 'Real Estate', items: REALESTATE_NAV },
  ];
  if (isDriver) groups.push({ heading: 'Driver', items: DRIVER_NAV });
  if (isVendor) groups.push({ heading: 'Vendor', items: VENDOR_NAV });
  if (isEmployer) groups.push({ heading: 'Employer', items: EMPLOYER_NAV });
  if (isPropertyOwner) groups.push({ heading: 'Property Owner', items: PROPERTY_OWNER_NAV });
  if (isAgent) groups.push({ heading: 'Real-Estate Agent', items: AGENT_NAV });
  // Marketing tools are available to any approved business role.
  if (isVendor || isEmployer || isPropertyOwner || isAgent) groups.push({ heading: 'Marketing', items: MARKETING_NAV });

  // Best-effort unread-messages badge on the Messages nav item.
  const [unread, setUnread] = useState(0);
  const refreshUnread = useCallback(async () => {
    try {
      const { count } = await api.get<{ count: number }>('/conversations/unread-count');
      setUnread(count);
    } catch {
      /* silent — badge is best-effort */
    }
  }, []);
  useEffect(() => {
    void refreshUnread();
    const t = setInterval(() => void refreshUnread(), MESSAGES_POLL_MS);
    return () => clearInterval(t);
  }, [refreshUnread]);

  return (
    <aside className="w-full border-r border-slate-200 bg-white md:h-screen md:w-72 md:shrink-0">
      {/* Mobile-only bar: brand + a toggle that collapses the (otherwise very tall) nav. */}
      <div className="flex items-center justify-between p-4 md:hidden">
        <Link href="/" className="rounded-bmpl-lg bg-belize-navy p-2">
          <BrandLockup />
        </Link>
        <button
          type="button"
          onClick={() => setMenuOpen((o) => !o)}
          aria-expanded={menuOpen}
          aria-controls="dashboard-nav-panel"
          aria-label={menuOpen ? 'Close navigation menu' : 'Open navigation menu'}
          className="inline-flex h-10 w-10 items-center justify-center rounded-bmpl-md text-slate-600 transition hover:bg-slate-100 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-accent"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" className="h-5 w-5" aria-hidden>
            {menuOpen ? <path d="M6 6l12 12M18 6L6 18" /> : <path d="M4 7h16M4 12h16M4 17h16" />}
          </svg>
        </button>
      </div>

      <div
        id="dashboard-nav-panel"
        className={`${menuOpen ? 'flex' : 'hidden'} h-full flex-col gap-6 p-4 md:flex md:p-5`}
      >
        <Link href="/" className="hidden rounded-bmpl-lg bg-belize-navy p-3 md:block">
          <BrandLockup />
        </Link>

        <RoleSwitcher me={me} />

      <nav className="flex flex-col gap-4" aria-label="Dashboard">
        {groups.map((group, gi) => (
          <div key={group.heading ?? gi} className="flex flex-col gap-0.5">
            {group.heading && (
              <p className="mb-1 px-3 text-[10px] font-semibold uppercase tracking-[0.18em] text-slate-400">{group.heading}</p>
            )}
            {group.items.map((item) => {
              const active = item.href === '/dashboard' ? pathname === '/dashboard' : pathname === item.href || pathname.startsWith(`${item.href}/`);
              return (
                <Link
                  key={item.href}
                  href={item.href}
                  aria-current={active ? 'page' : undefined}
                  className={`group flex items-center gap-3 rounded-bmpl-md px-3 py-2 text-sm font-medium transition ${
                    active ? 'bg-belize-blue/10 text-belize-blue' : 'text-slate-600 hover:bg-slate-50 hover:text-belize-navy'
                  }`}
                >
                  <span className={`h-4 w-0.5 rounded-full transition ${active ? 'bg-belize-blue' : 'bg-transparent'}`} aria-hidden />
                  <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
                    <path d={item.icon} />
                  </svg>
                  <span className="flex-1">{item.label}</span>
                  {item.href === '/dashboard/messages' && unread > 0 && (
                    <span
                      aria-label={unreadLabel(unread)}
                      className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-belize-accent px-1.5 text-[10px] font-bold leading-[18px] text-white"
                    >
                      {badgeCount(unread)}
                    </span>
                  )}
                </Link>
              );
            })}
          </div>
        ))}
      </nav>

      <div className="mt-auto border-t border-slate-100 pt-4">
        <p className="px-3 text-sm font-semibold text-belize-navy">
          {me.firstName} {me.lastName}
        </p>
        <p className="mb-2 px-3 text-xs text-slate-500">{me.email}</p>
        <LogoutButton />
      </div>
      </div>
    </aside>
  );
}
