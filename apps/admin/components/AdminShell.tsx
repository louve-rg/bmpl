'use client';

import Link from 'next/link';
import { usePathname, useRouter } from 'next/navigation';
import { api } from '../lib/api';

const NAV = [
  { label: 'Overview', href: '/dashboard' },
  { label: 'Applications', href: '/dashboard/applications' },
  { label: 'Users', href: '/dashboard/users' },
  { label: 'Vendors', href: '/dashboard/vendors' },
  { label: 'Products', href: '/dashboard/products' },
  { label: 'Categories', href: '/dashboard/categories' },
  { label: 'Audit Log', href: '/dashboard/audit' },
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
      <aside className="flex w-full flex-col gap-4 bg-belize-navy p-5 md:h-screen md:w-64 md:shrink-0">
        <div className="flex items-center gap-2">
          <span className="flex h-9 w-9 items-center justify-center rounded-full bg-belize-hero text-sm font-bold text-white">
            BM
          </span>
          <div className="leading-tight">
            <p className="text-sm font-bold text-white">Admin Console</p>
            <p className="text-xs text-belize-light">Belize Marketplace</p>
          </div>
        </div>
        <nav className="flex flex-col gap-1">
          {NAV.map((item) => {
            const active =
              item.href === '/dashboard'
                ? pathname === '/dashboard'
                : pathname.startsWith(item.href);
            return (
              <Link
                key={item.href}
                href={item.href}
                className={`rounded-lg px-3 py-2 text-sm font-medium transition ${
                  active ? 'bg-white/10 text-white' : 'text-blue-100 hover:bg-white/5 hover:text-white'
                }`}
              >
                {item.label}
              </Link>
            );
          })}
        </nav>
        <button
          onClick={logout}
          className="mt-auto rounded-lg px-3 py-2 text-left text-sm font-medium text-blue-100 hover:bg-white/5 hover:text-white"
        >
          Sign out
        </button>
      </aside>
      <main className="flex-1 bg-slate-100 p-5 md:p-8">{children}</main>
    </div>
  );
}
