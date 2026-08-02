import Link from 'next/link';
import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import { serverGetSafe } from '../../lib/server-api';
import { Alert, Breadcrumbs } from '../../components/ui';
import { PropertyGrid } from '../../components/realestate/PropertyCard';
import { SearchFilters, type PropertyFilterValues } from '../../components/realestate/SearchFilters';
import type { PropertyList as PropertyListType } from '../../lib/realestate';

export const dynamic = 'force-dynamic';
export const metadata = { title: 'Real Estate · Belize Marketplace & Logistics' };

const FILTER_KEYS = [
  'q',
  'purpose',
  'propertyType',
  'district',
  'priceMin',
  'priceMax',
  'bedrooms',
  'bathrooms',
  'furnishing',
  'sort',
] as const;

export default async function PropertiesPage({
  searchParams,
}: {
  searchParams: Record<string, string | undefined>;
}) {
  const apiParams = new URLSearchParams();
  for (const key of FILTER_KEYS) {
    const val = searchParams[key];
    if (val) apiParams.set(key, val);
  }
  apiParams.set('page', searchParams.page ?? '1');

  const listRes = await serverGetSafe<PropertyListType>(`/properties?${apiParams.toString()}`);

  const unavailable = !listRes.ok;
  const data = listRes.ok ? listRes.data : { total: 0, page: 1, pageSize: 20, items: [] };
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  const initial: PropertyFilterValues = {};
  for (const key of FILTER_KEYS) {
    if (searchParams[key]) initial[key] = searchParams[key];
  }

  const pageHref = (page: number) => {
    const p = new URLSearchParams();
    for (const key of FILTER_KEYS) if (searchParams[key]) p.set(key, searchParams[key]!);
    p.set('page', String(page));
    return `/properties?${p.toString()}`;
  };

  return (
    <>
      <Header />
      <main className="bg-slate-50">
        <div className="container-bmpl pt-6">
          <Breadcrumbs
            items={[
              { label: 'Home', href: '/' },
              { label: 'Real Estate' },
            ]}
            className="mb-3"
          />
        </div>
        <section className="bg-gradient-to-r from-belize-navy to-belize-blue">
          <div className="container-bmpl py-12 sm:py-16">
            <p className="text-sm font-semibold uppercase tracking-wide text-belize-accent">Belize Real Estate</p>
            <h1 className="mt-2 text-3xl font-bold text-white sm:text-4xl">Find property across Belize</h1>
            <p className="mt-3 max-w-2xl text-blue-100">
              Browse homes, land, and commercial property for sale or rent across all six districts. Save
              listings, enquire, and book viewings in minutes.
            </p>
          </div>
        </section>

        <div className="container-bmpl -mt-8 pb-14">
          <SearchFilters initial={initial} />

          <div className="mt-6 flex items-center justify-between">
            <p className="text-sm text-slate-500">
              {unavailable
                ? 'Listings are temporarily unavailable.'
                : `${data.total} propert${data.total === 1 ? 'y' : 'ies'} found`}
            </p>
          </div>

          <div className="mt-4">
            {unavailable ? (
              <Alert tone="warning">Real Estate is temporarily unavailable. Please try again in a moment.</Alert>
            ) : (
              <PropertyGrid
                properties={data.items}
                emptyTitle="No properties match your search"
                emptyDescription="Try widening your filters or clearing them to see all listings."
              />
            )}
          </div>

          {totalPages > 1 && (
            <div className="mt-8 flex items-center justify-center gap-2 text-sm">
              {data.page > 1 && (
                <Link
                  href={pageHref(data.page - 1)}
                  className="rounded-bmpl-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-600 transition hover:border-belize-light/60 hover:text-belize-navy"
                >
                  ← Prev
                </Link>
              )}
              <span className="px-3 py-1.5 text-slate-500">
                Page {data.page} of {totalPages}
              </span>
              {data.page < totalPages && (
                <Link
                  href={pageHref(data.page + 1)}
                  className="rounded-bmpl-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-600 transition hover:border-belize-light/60 hover:text-belize-navy"
                >
                  Next →
                </Link>
              )}
            </div>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}
