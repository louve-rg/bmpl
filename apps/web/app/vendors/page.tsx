import Link from 'next/link';
import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import { serverGetSafe } from '../../lib/server-api';
import { Alert, Badge as UiBadge, Breadcrumbs, Button, EmptyState, Input } from '../../components/ui';
import { storesBreadcrumbs } from '../../lib/marketplace-nav';

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

export default async function VendorsDirectoryPage({ searchParams }: { searchParams: { q?: string } }) {
  const qs = searchParams.q ? `?q=${encodeURIComponent(searchParams.q)}` : '';
  const res = await serverGetSafe<VendorCard[]>(`/marketplace/vendors${qs}`);
  const vendors = res.ok ? res.data : [];

  return (
    <>
      <Header />
      <main className="bg-slate-50 py-10">
        <div className="container-bmpl">
          <Breadcrumbs items={storesBreadcrumbs()} className="mb-3" />
          <p className="bmpl-eyebrow">Marketplace</p>
          <h1 className="bmpl-page-title mt-1">Vendors</h1>
          <p className="mt-1.5 text-slate-500">Discover approved storefronts across Belize.</p>

          <form method="get" action="/vendors" className="mt-5 flex gap-2">
            <Input name="q" aria-label="Search vendors" defaultValue={searchParams.q ?? ''} placeholder="Search vendors…" className="min-w-48 flex-1" />
            <Button type="submit">Search</Button>
          </form>

          {!res.ok ? (
            <Alert tone="warning" className="mt-10">The marketplace is temporarily unavailable. Please try again in a moment.</Alert>
          ) : vendors.length === 0 ? (
            <div className="mt-10">
              <EmptyState title="No storefronts are live yet." description="Check back soon." />
            </div>
          ) : (
            <div className="mt-8 grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
              {vendors.map((v) => (
                <Link
                  key={v.slug}
                  href={`/store/${v.slug}`}
                  className="group rounded-bmpl-lg border border-slate-200 bg-white p-5 shadow-bmpl-sm transition hover:-translate-y-0.5 hover:border-belize-light/60 hover:shadow-bmpl-md"
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
                      <span
                        role="img"
                        aria-label={
                          v.ratingCount > 0
                            ? `Rated ${v.ratingAverage.toFixed(1)} out of 5 from ${v.ratingCount} review${v.ratingCount === 1 ? '' : 's'}`
                            : 'No reviews yet'
                        }
                        className="block text-xs text-slate-400"
                      >
                        <span aria-hidden>
                          {'★'.repeat(Math.round(v.ratingAverage))}
                          {v.ratingCount > 0 ? ` (${v.ratingCount})` : ' New'}
                        </span>
                      </span>
                    </div>
                  </div>
                  {v.description && <p className="mt-3 line-clamp-2 text-sm text-slate-600">{v.description}</p>}
                  <div className="mt-3 flex flex-wrap gap-1.5">
                    {v.pickupEnabled && <UiBadge tone="brand">Pickup</UiBadge>}
                    {v.deliveryEnabled && <UiBadge tone="brand">Delivery</UiBadge>}
                    <UiBadge tone={v.storeStatus === 'OPEN' ? 'success' : 'neutral'}>{v.storeStatus}</UiBadge>
                  </div>
                </Link>
              ))}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
