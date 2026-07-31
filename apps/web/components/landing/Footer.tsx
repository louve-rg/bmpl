import Link from 'next/link';
import type { ReactNode } from 'react';
import { BrandLockup } from '../Logo';

type LinkItem = { label: string; href: string };

const COLUMNS: Array<{ heading: string; links: LinkItem[] }> = [
  {
    heading: 'Platform',
    links: [
      { label: 'Marketplace', href: '/products' },
      { label: 'Shipping', href: '/#services' },
      { label: 'Passenger', href: '/#services' },
      { label: 'Jobs', href: '/#services' },
      { label: 'Real Estate', href: '/#services' },
      { label: 'Marketing', href: '/#services' },
      { label: 'Wallet', href: '/#wallet' },
    ],
  },
  {
    heading: 'Company',
    links: [
      { label: 'About', href: '#' },
      { label: 'Careers', href: '#' },
      { label: 'Press', href: '#' },
      { label: 'Blog', href: '#' },
      { label: 'Contact', href: '#' },
    ],
  },
  {
    heading: 'Resources',
    links: [
      { label: 'Help Center', href: '#' },
      { label: 'Privacy', href: '#' },
      { label: 'Terms', href: '#' },
      { label: 'Developers', href: '#' },
      { label: 'API', href: '#' },
      { label: 'Status', href: '#' },
    ],
  },
];

const LEGAL: LinkItem[] = [
  { label: 'Privacy', href: '#' },
  { label: 'Terms', href: '#' },
  { label: 'Accessibility', href: '#' },
  { label: 'Security', href: '#' },
  { label: 'Status', href: '#' },
  { label: 'Sitemap', href: '#' },
];

const SOCIALS: Array<{ label: string; href: string; icon: ReactNode }> = [
  { label: 'LinkedIn', href: '#', icon: <path d="M4.98 3.5A2.5 2.5 0 1 1 0 3.51 2.5 2.5 0 0 1 4.98 3.5ZM.5 8.3h4V24h-4V8.3Zm6.5 0h3.83v2.15h.05c.53-1 1.84-2.15 3.79-2.15 4.05 0 4.8 2.67 4.8 6.14V24h-4v-6.76c0-1.61-.03-3.68-2.24-3.68-2.25 0-2.6 1.76-2.6 3.57V24h-4V8.3Z" /> },
  { label: 'Facebook', href: '#', icon: <path d="M13.5 21v-8h2.7l.4-3.1h-3.1V7.9c0-.9.26-1.5 1.55-1.5h1.65V3.6c-.29-.04-1.27-.12-2.41-.12-2.38 0-4.01 1.45-4.01 4.12v2.3H7.6V13h2.68v8h3.22Z" /> },
  { label: 'Instagram', href: '#', icon: <><rect x="3" y="3" width="18" height="18" rx="5" fill="none" stroke="currentColor" strokeWidth="1.7" /><circle cx="12" cy="12" r="4" fill="none" stroke="currentColor" strokeWidth="1.7" /><circle cx="17.2" cy="6.8" r="1.1" /></> },
  { label: 'YouTube', href: '#', icon: <path d="M23 12s0-3.5-.45-5.2a2.9 2.9 0 0 0-2-2C18.7 4.3 12 4.3 12 4.3s-6.7 0-8.55.5a2.9 2.9 0 0 0-2 2C1 8.5 1 12 1 12s0 3.5.45 5.2a2.9 2.9 0 0 0 2 2c1.85.5 8.55.5 8.55.5s6.7 0 8.55-.5a2.9 2.9 0 0 0 2-2C23 15.5 23 12 23 12ZM9.75 15.3V8.7l5.7 3.3-5.7 3.3Z" /> },
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
            <div className="mt-6 flex gap-2.5">
              {SOCIALS.map((s) => (
                <Link
                  key={s.label}
                  href={s.href}
                  aria-label={s.label}
                  className="flex h-9 w-9 items-center justify-center rounded-lg border border-white/10 bg-white/5 text-blue-100/80 transition duration-300 hover:border-belize-light/50 hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-belize-accent"
                >
                  <svg viewBox="0 0 24 24" fill="currentColor" className="h-4 w-4" aria-hidden>
                    {s.icon}
                  </svg>
                </Link>
              ))}
            </div>
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
