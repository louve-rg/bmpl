import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '../../../components/landing/Header';
import { Footer } from '../../../components/landing/Footer';
import { serverGet } from '../../../lib/server-api';

export const dynamic = 'force-dynamic';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

interface Storefront {
  businessName: string;
  slug: string;
  description: string | null;
  contactEmail: string;
  contactPhone: string | null;
  website: string | null;
  storeStatus: string;
  ratingAverage: number;
  ratingCount: number;
  vacationMode: boolean;
  pickupEnabled: boolean;
  deliveryEnabled: boolean;
  logoUrl: string | null;
  bannerUrl: string | null;
  locations: Array<{ label: string; addressLine1: string; addressLine2: string | null; city: string; district: string; isPrimary: boolean }>;
  openingHours: Array<{ dayOfWeek: number; isClosed: boolean; openTime: string | null; closeTime: string | null }>;
  featuredProducts: Array<{ id: string; title: string; slug: string; priceMinor: number; salePriceMinor: number | null; category: { name: string } }>;
  categories: Array<{ name: string; slug: string }>;
}

const money = (c: number) => `$${(c / 100).toFixed(2)}`;

async function fetchStore(slug: string): Promise<Storefront | null> {
  try {
    return await serverGet<Storefront>(`/marketplace/vendors/${encodeURIComponent(slug)}`);
  } catch {
    return null; // 404 / not approved
  }
}

export default async function StorefrontPage({ params }: { params: { slug: string } }) {
  const store = await fetchStore(params.slug);
  if (!store) notFound();

  return (
    <>
      <Header />
      <main>
        <div className="h-40 w-full bg-gradient-to-r from-belize-navy to-belize-blue sm:h-56">
          {store.bannerUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={store.bannerUrl} alt="" className="h-full w-full object-cover" />
          )}
        </div>

        <div className="container-bmpl -mt-12 pb-12">
          <div className="flex items-end gap-4">
            {store.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img src={store.logoUrl} alt="" className="h-24 w-24 rounded-2xl border-4 border-white object-cover shadow" />
            ) : (
              <span className="flex h-24 w-24 items-center justify-center rounded-2xl border-4 border-white bg-belize-blue text-2xl font-bold text-white shadow">
                {store.businessName.slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="pb-1">
              <h1 className="text-2xl font-bold text-belize-navy">{store.businessName}</h1>
              <p className="text-sm text-slate-500">
                {'★'.repeat(Math.round(store.ratingAverage))}
                {store.ratingCount > 0 ? ` (${store.ratingCount} reviews)` : ' · No reviews yet'}
              </p>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2 text-xs">
            <Badge tone={store.storeStatus === 'OPEN' ? 'green' : 'slate'}>{store.storeStatus}</Badge>
            {store.vacationMode && <Badge tone="amber">On vacation</Badge>}
            {store.pickupEnabled && <Badge>Pickup</Badge>}
            {store.deliveryEnabled && <Badge>Delivery</Badge>}
          </div>

          {store.description && <p className="mt-5 max-w-2xl text-slate-600">{store.description}</p>}

          <div className="mt-8 grid gap-6 md:grid-cols-3">
            <section className="md:col-span-2">
              <div className="mb-3 flex items-center justify-between">
                <h2 className="text-lg font-semibold text-belize-navy">Featured products</h2>
                {store.featuredProducts.length > 0 && (
                  <Link href={`/products?vendorSlug=${store.slug}`} className="text-sm text-belize-blue hover:underline">
                    View all →
                  </Link>
                )}
              </div>
              {store.categories.length > 0 && (
                <div className="mb-4 flex flex-wrap gap-1.5">
                  {store.categories.map((c) => (
                    <span key={c.slug} className="rounded-full bg-belize-blue/10 px-2.5 py-0.5 text-xs font-medium text-belize-blue">
                      {c.name}
                    </span>
                  ))}
                </div>
              )}
              {store.featuredProducts.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-300 bg-white p-10 text-center text-slate-400">
                  This storefront hasn’t listed products yet.
                </div>
              ) : (
                <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                  {store.featuredProducts.map((p) => (
                    <Link key={p.id} href={`/products/${p.slug}`} className="group rounded-2xl border border-slate-200 bg-white p-4 transition hover:border-belize-accent hover:shadow-md">
                      <div className="flex aspect-square items-center justify-center rounded-lg bg-slate-100 text-slate-300">No image</div>
                      <p className="mt-2 font-semibold text-belize-navy group-hover:text-belize-blue">{p.title}</p>
                      <p className="text-sm font-bold text-belize-navy">
                        {p.salePriceMinor != null ? (
                          <>
                            <span className="text-belize-blue">{money(p.salePriceMinor)}</span>{' '}
                            <span className="text-xs font-normal text-slate-400 line-through">{money(p.priceMinor)}</span>
                          </>
                        ) : (
                          money(p.priceMinor)
                        )}
                      </p>
                    </Link>
                  ))}
                </div>
              )}
            </section>

            <aside className="space-y-6">
              <Card title="Contact">
                <p className="text-sm text-slate-600">{store.contactEmail}</p>
                {store.contactPhone && <p className="text-sm text-slate-600">{store.contactPhone}</p>}
                {store.website && (
                  <a href={store.website} className="text-sm text-belize-blue hover:underline" target="_blank" rel="noreferrer">
                    {store.website}
                  </a>
                )}
              </Card>

              {store.locations.length > 0 && (
                <Card title="Locations">
                  {store.locations.map((l, i) => (
                    <p key={i} className="text-sm text-slate-600">
                      <span className="font-medium">{l.label}</span> — {l.addressLine1}
                      {l.addressLine2 ? `, ${l.addressLine2}` : ''}, {l.city}, {l.district.replace('_', ' ')}
                    </p>
                  ))}
                </Card>
              )}

              {store.openingHours.length > 0 && (
                <Card title="Opening hours">
                  {store.openingHours.map((h) => (
                    <p key={h.dayOfWeek} className="flex justify-between text-sm text-slate-600">
                      <span>{DAYS[h.dayOfWeek]}</span>
                      <span>{h.isClosed ? 'Closed' : `${h.openTime}–${h.closeTime}`}</span>
                    </p>
                  ))}
                </Card>
              )}
            </aside>
          </div>

          <div className="mt-10">
            <Link href="/vendors" className="text-sm text-belize-blue hover:underline">
              ← All vendors
            </Link>
          </div>
        </div>
      </main>
      <Footer />
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="rounded-2xl border border-slate-200 bg-white p-4">
      <h3 className="mb-2 text-xs font-semibold uppercase text-slate-500">{title}</h3>
      {children}
    </section>
  );
}
function Badge({ children, tone = 'blue' }: { children: React.ReactNode; tone?: 'blue' | 'green' | 'slate' | 'amber' }) {
  const tones = {
    blue: 'bg-belize-blue/10 text-belize-blue',
    green: 'bg-emerald-100 text-emerald-700',
    slate: 'bg-slate-100 text-slate-500',
    amber: 'bg-amber-100 text-amber-700',
  };
  return <span className={`rounded-full px-2.5 py-0.5 font-medium ${tones[tone]}`}>{children}</span>;
}
