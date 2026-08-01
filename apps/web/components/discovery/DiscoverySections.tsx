import Link from 'next/link';
import { serverGetSafe } from '../../lib/server-api';
import { ProductRow, type ProductCardData } from './ProductCard';

interface DiscoveryCategory {
  id: string;
  name: string;
  slug: string;
  iconName: string | null;
  productCount: number;
}

interface DiscoveryResponse {
  featured: ProductCardData[];
  topRated: ProductCardData[];
  newArrivals: ProductCardData[];
  popular: ProductCardData[];
  categories: DiscoveryCategory[];
}

/**
 * Homepage discovery block (server-rendered). Fetches the public discovery feed
 * and renders titled product rows plus a "Shop by category" tile row. Renders
 * nothing when the feed is unavailable, and hides individual empty sections.
 */
export async function DiscoverySections() {
  const res = await serverGetSafe<DiscoveryResponse>('/marketplace/discovery');
  if (!res.ok) return null;
  const { featured, topRated, newArrivals, popular, categories } = res.data;

  const hasAnything =
    (featured?.length ?? 0) +
      (topRated?.length ?? 0) +
      (newArrivals?.length ?? 0) +
      (popular?.length ?? 0) +
      (categories?.length ?? 0) >
    0;
  if (!hasAnything) return null;

  const viewAll = (
    <Link href="/products" className="text-sm font-semibold text-belize-blue hover:underline">
      View all →
    </Link>
  );

  return (
    <section aria-labelledby="discovery-heading" className="bg-white py-16 sm:py-20">
      <div className="container-bmpl space-y-14">
        <div className="mx-auto max-w-2xl text-center">
          <p className="bmpl-eyebrow">Marketplace</p>
          <h2 id="discovery-heading" className="mt-2 text-3xl font-bold tracking-tight text-belize-navy sm:text-4xl">
            Discover local products
          </h2>
          <p className="mt-3 text-base text-slate-600 sm:text-lg">
            Handpicked, top-rated, and trending goods from verified Belizean businesses.
          </p>
        </div>

        {categories?.length > 0 && (
          <section aria-label="Shop by category">
            <h3 className="mb-4 text-xl font-bold tracking-tight text-belize-navy sm:text-2xl">Shop by category</h3>
            <div className="flex flex-wrap gap-2.5">
              {categories.map((c) => (
                <Link
                  key={c.id}
                  href={`/products?categoryId=${encodeURIComponent(c.id)}`}
                  className="inline-flex items-center gap-2 rounded-full border border-slate-200 bg-white px-4 py-2 text-sm font-medium text-belize-navy shadow-bmpl-sm transition hover:-translate-y-0.5 hover:border-belize-light/60 hover:text-belize-blue hover:shadow-bmpl-md"
                >
                  {c.name}
                  {c.productCount > 0 && <span className="text-xs text-slate-400">{c.productCount}</span>}
                </Link>
              ))}
            </div>
          </section>
        )}

        <ProductRow title="Featured" items={featured ?? []} action={viewAll} />
        <ProductRow title="Top rated" items={topRated ?? []} action={viewAll} />
        <ProductRow title="New arrivals" items={newArrivals ?? []} action={viewAll} />
        <ProductRow title="Popular" items={popular ?? []} action={viewAll} />
      </div>
    </section>
  );
}
