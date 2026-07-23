import Link from 'next/link';
import { BrandLockup } from '../Logo';

const COLUMNS = [
  {
    heading: 'Services',
    links: [
      'Marketplace',
      'Shipping & Delivery',
      'Passenger Service',
      'Belize Connect',
      'Real Estate',
      'Marketing',
    ],
  },
  { heading: 'Company', links: ['About', 'Careers', 'Contact', 'Blog'] },
  { heading: 'Support', links: ['Help Center', 'Safety', 'Terms', 'Privacy'] },
];

export function Footer() {
  return (
    <footer className="bg-belize-navy pt-16">
      <div className="container-bmpl grid gap-10 pb-12 md:grid-cols-4">
        <div>
          <BrandLockup />
          <p className="mt-4 max-w-xs text-sm text-blue-100">
            Your Complete Commerce Solution — comprehensive solutions for business and personal
            needs across all six districts of Belize.
          </p>
        </div>
        {COLUMNS.map((col) => (
          <div key={col.heading}>
            <h3 className="text-sm font-bold uppercase tracking-wide text-belize-light">
              {col.heading}
            </h3>
            <ul className="mt-4 space-y-2">
              {col.links.map((link) => (
                <li key={link}>
                  <Link href="#" className="text-sm text-blue-100 transition hover:text-white">
                    {link}
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
      <div className="border-t border-white/10 py-6">
        <div className="container-bmpl flex flex-col items-center justify-between gap-3 text-sm text-blue-200 sm:flex-row">
          <p>© {new Date().getFullYear()} Belize Marketplace &amp; Logistics. All rights reserved.</p>
          <p>Made in Belize 🇧🇿</p>
        </div>
      </div>
    </footer>
  );
}
