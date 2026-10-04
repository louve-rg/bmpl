import Link from 'next/link';
import { BrandLockup } from '../Logo';

type LinkItem = { label: string; href: string };

const COLUMNS: Array<{ heading: string; links: LinkItem[] }> = [
  {
    heading: 'Platform',
    links: [
      { label: 'Marketplace', href: '/products' },
      { label: 'Shipping', href: '/shipping' },
      { label: 'Passenger', href: '/dashboard/passenger' },
      { label: 'Jobs', href: '/jobs' },
      { label: 'Real Estate', href: '/properties' },
      { label: 'Wallet', href: '/#wallet' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'Contact', href: 'mailto:support@bzemarketplace.com' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'Privacy', href: '#' },
      { label: 'Terms', href: '#' },
    ],
  },
];

const LEGAL: LinkItem[] = [
  { label: 'Privacy', href: '#' },
  { label: 'Terms', href: '#' },
];

export function Footer() {
  return (
    <footer className="bg-belize-navy text-blue-100">
      <div className="mx-auto w-full max-w-[1200px] px-4 py-16 sm:px-6 lg:px-8">
        <div className="grid gap-10 md:grid-cols-2 lg:grid-cols-[1.5fr_1fr_1fr_1fr]">
          {/* Brand */}
          <div>
            <BrandLockup />
            <p className="mt-4 max-w-xs text-sm leading-relaxed text-blue-100/70">
              One secure platform connecting commerce, logistics, and services across all six
              districts of Belize.
            </p>
          </div>

          {/* Link columns */}
          {COLUMNS.map((col) => (
            <div key={col.heading}>
              <h3 className="text-xs font-semibold uppercase tracking-[0.18em] text-belize-light">{col.heading}</h3>
              <ul className="mt-4 space-y-2.5">
                {col.links.map((link) => (
                  <li key={link.label}>
                    <Link href={link.href} className="text-sm text-blue-100/70 transition hover:text-white">
                      {link.label}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          ))}
        </div>
      </div>

      {/* Bottom bar */}
      <div className="border-t border-white/10">
        <div className="mx-auto flex w-full max-w-[1200px] flex-col items-center justify-between gap-4 px-4 py-6 text-sm text-blue-100/60 sm:flex-row sm:px-6 lg:px-8">
          <p>© 2026 Belize Marketplace &amp; Logistics</p>
          <nav aria-label="Legal" className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2">
            {LEGAL.map((l) => (
              <Link key={l.label} href={l.href} className="transition hover:text-white">
                {l.label}
              </Link>
            ))}
          </nav>
        </div>
      </div>
    </footer>
  );
}
