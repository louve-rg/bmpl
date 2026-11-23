import type { Metadata, Viewport } from 'next';
import './globals.css';
import { SessionExpiredBanner } from '../components/SessionExpiredBanner';
import { AnnouncementBanner } from '../components/AnnouncementBanner';

export const metadata: Metadata = {
  title: 'Belize Marketplace & Logistics — Your Complete Commerce Solution',
  description:
    'Comprehensive solutions for business and personal needs in Belize: marketplace, shipping & delivery, passenger service, Belize Connect employment, real estate, marketing, and a platform wallet.',
  metadataBase: new URL(process.env.NEXT_PUBLIC_SITE_URL ?? 'http://localhost:3000'),
  openGraph: {
    title: 'Belize Marketplace & Logistics',
    description: 'Your Complete Commerce Solution — for all of Belize.',
    type: 'website',
  },
};

export const viewport: Viewport = {
  themeColor: '#1e40af',
  width: 'device-width',
  initialScale: 1,
  viewportFit: 'cover',
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>
        {/* S2-ANNOUNCE: AnnouncementBanner (now also the static "Coming
            February 2027" strip, see its own comment) first in the body, in
            normal flow (not sticky/fixed) -- keeps both existing `sticky
            top-0` headers (public Header, dashboard shell) unaffected, and
            makes THIS the element that owns the top safe-area inset rather
            than either of them. This is also the one place the dynamic
            maintenance/ops notice now mounts -- moved here from Header.tsx
            so it reaches every apps/web route, not only public pages. */}
        <AnnouncementBanner />
        {children}
        <SessionExpiredBanner />
      </body>
    </html>
  );
}
