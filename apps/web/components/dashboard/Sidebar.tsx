import Link from 'next/link';
import { BrandLockup } from '../Logo';
import { RoleSwitcher } from './RoleSwitcher';
import { LogoutButton } from './LogoutButton';
import type { MeView } from '../../lib/types';

const NAV = [
  { label: 'Overview', href: '/dashboard' },
  { label: 'My Roles', href: '/dashboard/roles' },
  { label: 'Profile', href: '/dashboard/profile' },
];

export function Sidebar({ me }: { me: MeView }) {
  return (
    <aside className="flex w-full flex-col gap-6 border-r border-slate-200 bg-white p-5 md:h-screen md:w-72 md:shrink-0">
      <Link href="/" className="rounded-lg bg-belize-navy p-3">
        <BrandLockup />
      </Link>

      <RoleSwitcher me={me} />

      <nav className="flex flex-col gap-1" aria-label="Dashboard">
        {NAV.map((item) => (
          <Link
            key={item.href}
            href={item.href}
            className="rounded-lg px-3 py-2 text-sm font-medium text-slate-600 transition hover:bg-belize-blue/5 hover:text-belize-blue"
          >
            {item.label}
          </Link>
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
