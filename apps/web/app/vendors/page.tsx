import Link from 'next/link';
import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import { serverGet } from '../../lib/server-api';

export const dynamic = 'force-dynamic';

interface VendorCard {
  businessName: string;
  slug: string;
  description: string | null;
  storeStatus: string;
  ratingAverage: number;
  ratingCount: number;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  logoUrl: string | null;
}

export const metadata = {
  title: 'Marketplace Vendors · Belize Marketplace & Logistics',
  description: 'Browse approved vendors and storefronts across Belize.',
};

export default async function VendorsDirectoryPage() {
  const vendors = (await serverGet<VendorCard[]>('/marketplace/vendors')) ?? [];

  return (
    <>
      <Header />
      <main className="container-bmpl py-10">
        <h1 className="text-3xl font-bold text-belize-navy">Vendors</h1>
        <p className="mt-1 text-slate-500">Discover approved storefronts across Belize.</p>

        {vendors.length === 0 ? (
          <p className="mt-10 rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400">
            No storefronts are live yet. Check back soon.
          </p>
        ) : (
          <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
            {vendors.map((v) => (
              <Link
                key={v.slug}
                href={`/store/${v.slug}`}
                className="group rounded-2xl border border-slate-200 bg-white p-5 transition hover:border-belize-accent hover:shadow-md"
              >
                <div className="flex items-center gap-3">
                  {v.logoUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={v.logoUrl} alt="" className="h-12 w-12 rounded-full object-cover" />
                  ) : (
                    <span className="flex h-12 w-12 items-center justify-center rounded-full bg-belize-blue/10 text-sm font-bold text-belize-blue">
                      {v.businessName.slice(0, 2).toUpperCase()}
                    </span>
                  )}
                  <div>
                    <p className="font-semibold text-belize-navy group-hover:text-belize-blue">{v.businessName}</p>
                    <p className="text-xs text-slate-400">
                      {'★'.repeat(Math.round(v.ratingAverage))}
                      {v.ratingCount > 0 ? ` (${v.ratingCount})` : ' New'}
                    </p>
                  </div>
                </div>
                {v.description && <p className="mt-3 line-clamp-2 text-sm text-slate-600">{v.description}</p>}
                <div className="mt-3 flex flex-wrap gap-1.5 text-xs">
                  {v.pickupEnabled && <Badge>Pickup</Badge>}
                  {v.deliveryEnabled && <Badge>Delivery</Badge>}
                  <Badge tone={v.storeStatus === 'OPEN' ? 'green' : 'slate'}>{v.storeStatus}</Badge>
                </div>
              </Link>
            ))}
          </div>
        )}
      </main>
      <Footer />
    </>
  );
}

function Badge({ children, tone = 'blue' }: { children: React.ReactNode; tone?: 'blue' | 'green' | 'slate' }) {
  const tones = {
    blue: 'bg-belize-blue/10 text-belize-blue',
    green: 'bg-emerald-100 text-emerald-700',
    slate: 'bg-slate-100 text-slate-500',
  };
  return <span className={`rounded-full px-2 py-0.5 font-medium ${tones[tone]}`}>{children}</span>;
}
