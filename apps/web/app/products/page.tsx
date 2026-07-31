import Link from 'next/link';
import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import { serverGetSafe } from '../../lib/server-api';
import { Alert, Badge, Button, EmptyState, Input } from '../../components/ui';

export const dynamic = 'force-dynamic';

interface ProductCard {
  id: string;
  title: string;
  slug: string;
  brand: string | null;
  priceMinor: number;
  salePriceMinor: number | null;
  currency: string;
  vendor: { businessName: string; slug: string };
  category: { name: string };
  primaryImageUrl: string | null;
  inStock: boolean;
}
interface ProductList {
  total: number;
  page: number;
  pageSize: number;
  items: ProductCard[];
}
interface CatNode {
  id: string;
  name: string;
  slug: string;
  children: CatNode[];
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;
const SORTS = [
  { v: 'newest', label: 'Newest' },
  { v: 'price_asc', label: 'Price ↑' },
  { v: 'price_desc', label: 'Price ↓' },
  { v: 'featured', label: 'Featured' },
];

export const metadata = { title: 'Shop · Belize Marketplace & Logistics' };

export default async function ProductsPage({
  searchParams,
}: {
  searchParams: { categoryId?: string; sort?: string; page?: string; q?: string; priceMin?: string; priceMax?: string; inStock?: string; vendorSlug?: string };
}) {
  // API params use cents for price; the URL keeps dollars (user-facing).
  const apiParams = new URLSearchParams();
  if (searchParams.vendorSlug) apiParams.set('vendorSlug', searchParams.vendorSlug);
  if (searchParams.categoryId) apiParams.set('categoryId', searchParams.categoryId);
  if (searchParams.sort) apiParams.set('sort', searchParams.sort);
  if (searchParams.q) apiParams.set('q', searchParams.q);
  if (searchParams.priceMin) apiParams.set('priceMin', String(Math.round(Number(searchParams.priceMin) * 100)));
  if (searchParams.priceMax) apiParams.set('priceMax', String(Math.round(Number(searchParams.priceMax) * 100)));
  if (searchParams.inStock) apiParams.set('inStock', 'true');
  apiParams.set('page', searchParams.page ?? '1');

  const [listRes, catsRes] = await Promise.all([
    serverGetSafe<ProductList>(`/marketplace/products?${apiParams.toString()}`),
    serverGetSafe<CatNode[]>('/marketplace/categories'),
  ]);
  const unavailable = !listRes.ok;
  const data = listRes.ok ? listRes.data : { total: 0, page: 1, pageSize: 24, items: [] };
  const cats = catsRes.ok ? catsRes.data : [];
  const totalPages = Math.max(1, Math.ceil(data.total / data.pageSize));

  // Link builder preserves the raw (dollar) URL params.
  const qp = (overrides: Record<string, string | undefined>) => {
    const p = new URLSearchParams();
    for (const [k, v] of Object.entries(searchParams)) if (v) p.set(k, v);
    for (const [k, val] of Object.entries(overrides)) {
      if (val === undefined) p.delete(k);
      else p.set(k, val);
    }
    return `/products?${p.toString()}`;
  };

  return (
    <>
      <Header />
      <main className="bg-slate-50 py-10">
        <div className="container-bmpl">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <p className="bmpl-eyebrow">Marketplace</p>
              <h1 className="bmpl-page-title mt-1">Shop</h1>
              {searchParams.vendorSlug && (
                <p className="mt-1.5 text-sm text-slate-500">
                  {data.items[0]?.vendor.businessName
                    ? `Browsing ${data.items[0].vendor.businessName}`
                    : 'Browsing one store'}{' '}
                  · <Link href={qp({ vendorSlug: undefined, page: '1' })} className="font-medium text-belize-blue hover:underline">Show all stores</Link>
                </p>
              )}
            </div>
            <div className="flex gap-1 rounded-full bg-slate-100 p-1 text-xs">
              {SORTS.map((s) => (
                <Link
                  key={s.v}
                  href={qp({ sort: s.v, page: '1' })}
                  className={`rounded-full px-3 py-1.5 font-medium transition ${
                    (searchParams.sort ?? 'newest') === s.v
                      ? 'bg-belize-blue text-white shadow-bmpl-sm'
                      : 'text-slate-600 hover:text-belize-navy'
                  }`}
                >
                  {s.label}
                </Link>
              ))}
            </div>
          </div>

          <form method="get" action="/products" className="bmpl-card mt-5 flex flex-wrap items-end gap-3 p-4">
            {searchParams.vendorSlug && <input type="hidden" name="vendorSlug" value={searchParams.vendorSlug} />}
            {searchParams.categoryId && <input type="hidden" name="categoryId" value={searchParams.categoryId} />}
            {searchParams.sort && <input type="hidden" name="sort" value={searchParams.sort} />}
            <Input name="q" aria-label="Search products" defaultValue={searchParams.q ?? ''} placeholder="Search products…" className="min-w-48 flex-1" />
            <Input name="priceMin" aria-label="Minimum price" defaultValue={searchParams.priceMin ?? ''} inputMode="decimal" placeholder="Min $" className="w-24" />
            <Input name="priceMax" aria-label="Maximum price" defaultValue={searchParams.priceMax ?? ''} inputMode="decimal" placeholder="Max $" className="w-24" />
            <label className="flex items-center gap-1.5 pb-2.5 text-sm text-slate-600">
              <input type="checkbox" name="inStock" value="true" defaultChecked={!!searchParams.inStock} className="h-4 w-4 rounded border-slate-300 text-belize-blue focus:ring-belize-accent" /> In stock
            </label>
            <Button type="submit">Apply</Button>
          </form>

          <div className="mt-6 grid gap-6 md:grid-cols-[200px_1fr]">
            <aside className="md:sticky md:top-24 md:self-start">
              <h2 className="bmpl-eyebrow mb-3">Categories</h2>
              <nav className="flex flex-col gap-0.5">
                <Link href={qp({ categoryId: undefined, page: '1' })} className={`rounded-bmpl-sm px-3 py-1.5 text-sm transition ${!searchParams.categoryId ? 'bg-belize-blue/10 font-semibold text-belize-blue' : 'text-slate-600 hover:bg-slate-100'}`}>
                  All
                </Link>
                {cats.map((c) => (
                  <div key={c.id}>
                    <Link href={qp({ categoryId: c.id, page: '1' })} className={`block rounded-bmpl-sm px-3 py-1.5 text-sm transition ${searchParams.categoryId === c.id ? 'bg-belize-blue/10 font-semibold text-belize-blue' : 'text-slate-600 hover:bg-slate-100'}`}>
                      {c.name}
                    </Link>
                    {(c.children ?? []).map((ch) => (
                      <Link key={ch.id} href={qp({ categoryId: ch.id, page: '1' })} className={`block rounded-bmpl-sm px-3 py-1.5 pl-6 text-sm transition ${searchParams.categoryId === ch.id ? 'bg-belize-blue/10 font-semibold text-belize-blue' : 'text-slate-500 hover:bg-slate-100'}`}>
                        {ch.name}
                      </Link>
                    ))}
                  </div>
                ))}
              </nav>
            </aside>

            <section>
              {unavailable ? (
                <Alert tone="warning">The shop is temporarily unavailable. Please try again in a moment.</Alert>
              ) : data.items.length === 0 ? (
                <EmptyState title="No products found." description="Try adjusting your search or filters." />
              ) : (
                <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                  {data.items.map((p) => (
                    <Link key={p.id} href={`/products/${p.slug}`} className="group rounded-bmpl-lg border border-slate-200 bg-white p-4 shadow-bmpl-sm transition hover:-translate-y-0.5 hover:border-belize-light/60 hover:shadow-bmpl-md">
                      <div className="flex aspect-square items-center justify-center overflow-hidden rounded-bmpl-lg bg-slate-100 text-sm text-slate-400">
                        {p.primaryImageUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={p.primaryImageUrl} alt={p.title} className="h-full w-full object-cover" />
                        ) : (
                          'No image'
                        )}
                      </div>
                      <p className="mt-3 font-semibold text-belize-navy group-hover:text-belize-blue">{p.title}</p>
                      <p className="text-xs text-slate-400">{p.vendor.businessName} · {p.category.name}</p>
                      <p className="mt-1.5 text-sm">
                        {p.salePriceMinor != null ? (
                          <>
                            <span className="font-bold text-belize-blue">{money(p.salePriceMinor)}</span>{' '}
                            <span className="text-slate-400 line-through">{money(p.priceMinor)}</span>
                          </>
                        ) : (
                          <span className="font-bold text-belize-navy">{money(p.priceMinor)}</span>
                        )}
                      </p>
                      {!p.inStock && (
                        <Badge tone="error" className="mt-1.5">Out of stock</Badge>
                      )}
                    </Link>
                  ))}
                </div>
              )}

              {totalPages > 1 && (
                <div className="mt-8 flex items-center justify-center gap-2 text-sm">
                  {data.page > 1 && <Link href={qp({ page: String(data.page - 1) })} className="rounded-bmpl-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-600 transition hover:border-belize-light/60 hover:text-belize-navy">← Prev</Link>}
                  <span className="px-3 py-1.5 text-slate-500">Page {data.page} of {totalPages}</span>
                  {data.page < totalPages && <Link href={qp({ page: String(data.page + 1) })} className="rounded-bmpl-md border border-slate-300 bg-white px-3 py-1.5 font-medium text-slate-600 transition hover:border-belize-light/60 hover:text-belize-navy">Next →</Link>}
                </div>
              )}
            </section>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}
