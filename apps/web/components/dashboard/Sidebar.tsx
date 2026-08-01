'use client';

import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useCallback, useEffect, useState } from 'react';
import { BrandLockup } from '../Logo';
import { RoleSwitcher } from './RoleSwitcher';
import { LogoutButton } from './LogoutButton';
import { api } from '../../lib/api';
import type { MeView } from '../../lib/types';

type NavItem = { label: string; href: string; icon: string };

const BASE_NAV: NavItem[] = [
  { label: 'Overview', href: '/dashboard', icon: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z' },
  { label: 'Notifications', href: '/dashboard/notifications', icon: 'M12 3a6 6 0 0 0-6 6v3l-2 3h16l-2-3V9a6 6 0 0 0-6-6ZM9 19a3 3 0 0 0 6 0' },
  { label: 'Messages', href: '/dashboard/messages', icon: 'M4 5h16v10H7l-3 3V5Z' },
  { label: 'My Orders', href: '/orders', icon: 'M6 3h12l1 4H5l1-4Zm-1 4v13h14V7M9 11h6' },
  { label: 'My Reviews', href: '/dashboard/reviews', icon: 'M12 3l2.9 5.88 6.49.94-4.7 4.58 1.11 6.46L12 17.3l-5.8 3.06 1.1-6.46-4.69-4.58 6.49-.94L12 3Z' },
  { label: 'Payments', href: '/payments', icon: 'M3 6h18v12H3zM3 10h18' },
  { label: 'My Roles', href: '/dashboard/roles', icon: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 8a6 6 0 0 1 12 0' },
  { label: 'Profile', href: '/dashboard/profile', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0' },
  { label: 'Driver', href: '/dashboard/driver', icon: 'M3 7h11v9H3z M14 10h4l3 3v3h-7' },
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

const MESSAGES_POLL_MS = 60_000;

export function Sidebar({ me }: { me: MeView }) {
  const pathname = usePathname();
  const isVendor = me.roles.some((r) => r.roleCode === 'VENDOR' && r.status === 'APPROVED');
  const groups: Array<{ heading?: string; items: NavItem[] }> = isVendor
    ? [{ items: BASE_NAV }, { heading: 'Vendor', items: VENDOR_NAV }]
    : [{ items: BASE_NAV }];

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
    <aside className="flex w-full flex-col gap-6 border-r border-slate-200 bg-white p-5 md:h-screen md:w-72 md:shrink-0">
      <Link href="/" className="rounded-bmpl-lg bg-belize-navy p-3">
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
                      aria-label={`${unread} unread`}
                      className="inline-flex min-w-[18px] items-center justify-center rounded-full bg-belize-accent px-1.5 text-[10px] font-bold leading-[18px] text-white"
                    >
                      {unread > 99 ? '99+' : unread}
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
    </aside>
  );
}
