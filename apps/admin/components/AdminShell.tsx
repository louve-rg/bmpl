'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '../lib/api';
import { BrandLockup } from './Logo';
import { NotificationBell } from './notifications/NotificationBell';
import { AnnouncementBanner } from './AnnouncementBanner';

const NAV: Array<{ label: string; href: string; icon: string }> = [
  { label: 'Overview', href: '/dashboard', icon: 'M4 13h6V4H4v9Zm0 7h6v-5H4v5Zm10 0h6V11h-6v9Zm0-16v5h6V4h-6Z' },
  { label: 'Operations', href: '/dashboard/ops', icon: 'M10.3 3.2 9.9 5a7 7 0 0 0-1.7 1l-1.8-.6-1.7 3 1.4 1.2a7 7 0 0 0 0 2l-1.4 1.2 1.7 3 1.8-.6a7 7 0 0 0 1.7 1l.4 1.8h3.4l.4-1.8a7 7 0 0 0 1.7-1l1.8.6 1.7-3-1.4-1.2a7 7 0 0 0 0-2l1.4-1.2-1.7-3-1.8.6a7 7 0 0 0-1.7-1l-.4-1.8h-3.4ZM12 9a3 3 0 1 1 0 6 3 3 0 0 1 0-6Z' },
  { label: 'Notifications', href: '/dashboard/notifications', icon: 'M12 3a6 6 0 0 0-6 6v3l-2 3h16l-2-3V9a6 6 0 0 0-6-6ZM9 19a3 3 0 0 0 6 0' },
  { label: 'Support', href: '/dashboard/support', icon: 'M4 5h16v10H7l-3 3V5Z' },
  { label: 'Reviews', href: '/dashboard/reviews', icon: 'M12 3l2.6 5.3 5.9.9-4.2 4.1 1 5.8-5.3-2.8-5.3 2.8 1-5.8L3.5 9.2l5.9-.9L12 3Z' },
  { label: 'Belize Connect', href: '/dashboard/jobs', icon: 'M4 7h16v12H4zM9 7V5a2 2 0 0 1 2-2h2a2 2 0 0 1 2 2v2M4 12h16' },
  { label: 'Real Estate', href: '/dashboard/properties', icon: 'M4 11l8-6 8 6M6 10v9h12v-9M10 19v-5h4v5' },
  { label: 'Marketing', href: '/dashboard/marketing', icon: 'M3 11v2a1 1 0 0 0 1 1h3l4 4V6L7 10H4a1 1 0 0 0-1 1Zm13-3a5 5 0 0 1 0 8M18 5a9 9 0 0 1 0 14' },
  { label: 'Applications', href: '/dashboard/applications', icon: 'M6 3h9l4 4v14H6V3Zm9 0v4h4M9 12h6M9 16h6' },
  { label: 'Profile Photos', href: '/dashboard/avatars', icon: 'M12 12a4 4 0 1 0 0-8 4 4 0 0 0 0 8Zm-7 8a7 7 0 0 1 14 0M3 3h4M3 3v4M21 3h-4M21 3v4M3 21h4M3 21v-4M21 21h-4M21 21v-4' },
  { label: 'Users', href: '/dashboard/users', icon: 'M9 11a3 3 0 1 0 0-6 3 3 0 0 0 0 6Zm-6 8a6 6 0 0 1 12 0M17 11a3 3 0 0 0 0-6M22 19a6 6 0 0 0-4-5.7' },
  { label: 'Vendors', href: '/dashboard/vendors', icon: 'M4 8h16l-1 3H5L4 8Zm1 3v9h14v-9M9 20v-5h6v5' },
  { label: 'Drivers', href: '/dashboard/drivers', icon: 'M3 7h11v9H3z M14 10h4l3 3v3h-7' },
  { label: 'Dispatch', href: '/dashboard/dispatch', icon: 'M3 7h11v9H3z M14 10h4l3 3v3h-7' },
  { label: 'Products', href: '/dashboard/products', icon: 'M4 7l8-4 8 4-8 4-8-4Zm0 0v10l8 4 8-4V7' },
  { label: 'Orders', href: '/dashboard/orders', icon: 'M6 3h12l1 4H5l1-4Zm-1 4v13h14V7M9 11h6' },
  { label: 'Payments', href: '/dashboard/payments', icon: 'M3 6h18v12H3zM3 10h18' },
  { label: 'Wallet', href: '/dashboard/wallet', icon: 'M3 7h18v12H3zM17 12h2M3 10h14a2 2 0 0 1 2 2' },
  { label: 'Settlements', href: '/dashboard/settlements', icon: 'M3 6h18v12H3z M3 10h18' },
  { label: 'Analytics', href: '/dashboard/analytics', icon: 'M4 20V4M4 20h16M8 20v-6M13 20V9M18 20v-9' },
  { label: 'Categories', href: '/dashboard/categories', icon: 'M4 5h7v7H4zM13 5h7v7h-7zM4 14h7v5H4zM13 14h7v5h-7z' },
  { label: 'Audit Log', href: '/dashboard/audit', icon: 'M5 4h11l3 3v13H5zM9 12l2 2 4-4' },
];

export function AdminShell({ children }: { children: React.ReactNode }) {
  const pathname = usePathname();
  const router = useRouter();

  async function logout() {
    try {
      await api.post('/auth/logout');
    } finally {
      router.push('/login');
    }
  }

  return (
    <div className="min-h-screen md:flex">
      <aside className="flex w-full flex-col gap-5 bg-belize-navy p-4 md:h-screen md:w-64 md:shrink-0 md:p-5">
        <Link href="/dashboard" className="px-1 pt-1">
          <BrandLockup />
        </Link>

        <nav className="flex flex-col gap-0.5" aria-label="Admin">
          {NAV.map((item) => {
            const active = item.href === '/dashboard' ? pathname === '/dashboard' : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                aria-current={active ? 'page' : undefined}
                className={`group flex items-center gap-3 rounded-bmpl-md px-3 py-2 text-sm font-medium transition ${
                  active ? 'bg-white/10 text-white' : 'text-blue-100/80 hover:bg-white/5 hover:text-white'
                }`}
              >
                <span className={`h-4 w-0.5 rounded-full transition ${active ? 'bg-belize-accent' : 'bg-transparent'}`} aria-hidden />
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={`h-4 w-4 ${active ? 'text-belize-light' : 'text-blue-100/60 group-hover:text-blue-100'}`} aria-hidden>
                  <path d={item.icon} />
                </svg>
                {item.label}
              </Link>
            );
          })}
        </nav>

        <button
          onClick={logout}
          className="mt-auto flex items-center gap-2 rounded-bmpl-md px-3 py-2 text-left text-sm font-medium text-blue-100/80 transition hover:bg-white/5 hover:text-white"
        >
          <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className="h-4 w-4" aria-hidden>
            <path d="M15 12H4m0 0 4-4m-4 4 4 4M14 4h5a1 1 0 0 1 1 1v14a1 1 0 0 1-1 1h-5" />
          </svg>
          Sign out
        </button>
      </aside>
      <main className="flex flex-1 flex-col bg-slate-100">
        <AnnouncementBanner />
        <header className="flex items-center justify-end border-b border-slate-200 bg-white px-4 py-2.5 md:px-8">
          <NotificationBell />
        </header>
        <div className="flex-1 p-5 md:p-8">{children}</div>
      </main>
    </div>
  );
}
