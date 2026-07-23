import type { Metadata, Viewport } from 'next';
import './globals.css';

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
};

export default function RootLayout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <body>{children}</body>
    </html>
  );
}
