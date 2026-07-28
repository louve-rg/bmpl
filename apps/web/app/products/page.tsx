import Link from 'next/link';
import { Header } from '../../components/landing/Header';
import { Footer } from '../../components/landing/Footer';
import { serverGetSafe } from '../../lib/server-api';

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
  searchParams: { categoryId?: string; sort?: string; page?: string; q?: string; priceMin?: string; priceMax?: string; inStock?: string };
}) {
  // API params use cents for price; the URL keeps dollars (user-facing).
  const apiParams = new URLSearchParams();
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
      <main className="container-bmpl py-10">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h1 className="text-3xl font-bold text-belize-navy">Shop</h1>
          <div className="flex gap-1.5 text-xs">
            {SORTS.map((s) => (
              <Link
                key={s.v}
                href={qp({ sort: s.v, page: '1' })}
                className={`rounded-full px-3 py-1.5 font-medium ${
                  (searchParams.sort ?? 'newest') === s.v ? 'bg-belize-blue text-white' : 'bg-white text-slate-600'
                }`}
              >
                {s.label}
              </Link>
            ))}
          </div>
        </div>

        <form method="get" action="/products" className="mt-4 flex flex-wrap items-end gap-3 rounded-2xl border border-slate-200 bg-white p-3">
          {searchParams.categoryId && <input type="hidden" name="categoryId" value={searchParams.categoryId} />}
          {searchParams.sort && <input type="hidden" name="sort" value={searchParams.sort} />}
          <input name="q" defaultValue={searchParams.q ?? ''} placeholder="Search products…" className="min-w-48 flex-1 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="priceMin" defaultValue={searchParams.priceMin ?? ''} inputMode="decimal" placeholder="Min $" className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <input name="priceMax" defaultValue={searchParams.priceMax ?? ''} inputMode="decimal" placeholder="Max $" className="w-24 rounded-lg border border-slate-300 px-3 py-2 text-sm" />
          <label className="flex items-center gap-1.5 text-sm text-slate-600">
            <input type="checkbox" name="inStock" value="true" defaultChecked={!!searchParams.inStock} /> In stock
          </label>
          <button className="rounded-lg bg-belize-blue px-4 py-2 text-sm font-semibold text-white hover:bg-belize-deep">Apply</button>
        </form>

        <div className="mt-6 grid gap-6 md:grid-cols-[200px_1fr]">
          <aside>
            <h2 className="mb-2 text-xs font-semibold uppercase text-slate-500">Categories</h2>
            <Link href={qp({ categoryId: undefined, page: '1' })} className={`block rounded px-2 py-1 text-sm ${!searchParams.categoryId ? 'font-semibold text-belize-blue' : 'text-slate-600'}`}>
              All
            </Link>
            {cats.map((c) => (
              <div key={c.id}>
                <Link href={qp({ categoryId: c.id, page: '1' })} className={`block rounded px-2 py-1 text-sm ${searchParams.categoryId === c.id ? 'font-semibold text-belize-blue' : 'text-slate-600'}`}>
                  {c.name}
                </Link>
                {(c.children ?? []).map((ch) => (
                  <Link key={ch.id} href={qp({ categoryId: ch.id, page: '1' })} className={`block rounded px-2 py-1 pl-5 text-sm ${searchParams.categoryId === ch.id ? 'font-semibold text-belize-blue' : 'text-slate-500'}`}>
                    {ch.name}
                  </Link>
                ))}
              </div>
            ))}
          </aside>

          <section>
            {unavailable ? (
              <p className="rounded-2xl border border-amber-200 bg-amber-50 p-10 text-center text-amber-700">
                The shop is temporarily unavailable. Please try again in a moment.
              </p>
            ) : data.items.length === 0 ? (
              <p className="rounded-2xl border border-slate-200 bg-white p-10 text-center text-slate-400">No products found.</p>
            ) : (
              <div className="grid gap-5 sm:grid-cols-2 lg:grid-cols-3">
                {data.items.map((p) => (
                  <Link key={p.id} href={`/products/${p.slug}`} className="group rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-belize-accent hover:shadow-md">
                    <div className="flex aspect-square items-center justify-center overflow-hidden rounded-lg bg-slate-100 text-slate-300">
                      {p.primaryImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.primaryImageUrl} alt={p.title} className="h-full w-full object-cover" />
                      ) : (
                        'No image'
                      )}
                    </div>
                    <p className="mt-3 font-semibold text-belize-navy group-hover:text-belize-blue">{p.title}</p>
                    <p className="text-xs text-slate-400">{p.vendor.businessName} · {p.category.name}</p>
                    <p className="mt-1 text-sm">
                      {p.salePriceMinor != null ? (
                        <>
                          <span className="font-bold text-belize-blue">{money(p.salePriceMinor)}</span>{' '}
                          <span className="text-slate-400 line-through">{money(p.priceMinor)}</span>
                        </>
                      ) : (
                        <span className="font-bold text-belize-navy">{money(p.priceMinor)}</span>
                      )}
                    </p>
                    {!p.inStock && <p className="mt-1 text-xs font-semibold text-red-500">Out of stock</p>}
                  </Link>
                ))}
              </div>
            )}

            {totalPages > 1 && (
              <div className="mt-8 flex justify-center gap-2 text-sm">
                {data.page > 1 && <Link href={qp({ page: String(data.page - 1) })} className="rounded-lg border border-slate-300 px-3 py-1.5">← Prev</Link>}
                <span className="px-3 py-1.5 text-slate-500">Page {data.page} of {totalPages}</span>
                {data.page < totalPages && <Link href={qp({ page: String(data.page + 1) })} className="rounded-lg border border-slate-300 px-3 py-1.5">Next →</Link>}
              </div>
            )}
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
