import Link from 'next/link';
import { Badge as UiBadge, EmptyState } from '../ui';
import { EnlargeableImage } from './EnlargeableImage';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export interface Storefront {
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
  featuredProducts: Array<{ id: string; title: string; slug: string; priceMinor: number; salePriceMinor: number | null; category: { name: string }; primaryImageUrl: string | null }>;
  categories: Array<{ name: string; slug: string }>;
}

/**
 * The storefront presentation, shared by the public `/store/[slug]` page and the
 * vendor's owner-only `/dashboard/store/preview`. Renders the storefront body
 * only — callers provide their own page chrome (header/footer or dashboard shell).
 */
export function StorefrontView({ store }: { store: Storefront }) {
  return (
    <>
      <div className="h-40 w-full bg-gradient-to-r from-belize-navy to-belize-blue sm:h-56">
        {store.bannerUrl && (
          <EnlargeableImage
            src={store.bannerUrl}
            alt={`${store.businessName} banner`}
            label="Store banner"
            triggerClassName="block h-full w-full"
            imgClassName="h-full w-full object-cover"
          />
        )}
      </div>

      <div className="container-bmpl -mt-12 pb-12">
        <div className="flex items-end gap-4">
          {store.logoUrl ? (
            <EnlargeableImage
              src={store.logoUrl}
              alt={`${store.businessName} logo`}
              label="Store logo"
              triggerClassName="block h-24 w-24 shrink-0 overflow-hidden rounded-bmpl-lg border-4 border-white shadow-bmpl-md"
              imgClassName="h-full w-full object-cover"
            />
          ) : (
            <span className="flex h-24 w-24 items-center justify-center rounded-bmpl-lg border-4 border-white bg-belize-blue text-2xl font-bold text-white shadow-bmpl-md">
              {store.businessName.slice(0, 2).toUpperCase()}
            </span>
          )}
          <div className="pb-1">
            <h1 className="text-2xl font-bold tracking-tight text-belize-navy">{store.businessName}</h1>
            <p className="text-sm text-slate-500">
              {'★'.repeat(Math.round(store.ratingAverage))}
              {store.ratingCount > 0 ? ` (${store.ratingCount} reviews)` : ' · No reviews yet'}
            </p>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <UiBadge tone={store.storeStatus === 'OPEN' ? 'success' : 'neutral'}>{store.storeStatus}</UiBadge>
          {store.vacationMode && <UiBadge tone="warning">On vacation</UiBadge>}
          {store.pickupEnabled && <UiBadge tone="brand">Pickup</UiBadge>}
          {store.deliveryEnabled && <UiBadge tone="brand">Delivery</UiBadge>}
        </div>

        {store.description && <p className="mt-5 max-w-2xl text-slate-600">{store.description}</p>}

        <div className="mt-8 grid gap-6 md:grid-cols-3">
          <section className="md:col-span-2">
            <div className="mb-3 flex items-center justify-between">
              <h2 className="text-lg font-bold text-belize-navy">Featured products</h2>
              {store.featuredProducts.length > 0 && (
                <Link href={`/products?vendorSlug=${store.slug}`} className="text-sm font-medium text-belize-blue hover:underline">
                  View all →
                </Link>
              )}
            </div>
            {store.categories.length > 0 && (
              <div className="mb-4 flex flex-wrap gap-1.5">
                {store.categories.map((c) => (
                  <UiBadge key={c.slug} tone="brand">{c.name}</UiBadge>
                ))}
              </div>
            )}
            {store.featuredProducts.length === 0 ? (
              <EmptyState title="This storefront hasn’t listed products yet." />
            ) : (
              <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
                {store.featuredProducts.map((p) => (
                  <Link key={p.id} href={`/products/${p.slug}`} className="group rounded-bmpl-lg border border-slate-200 bg-white p-4 shadow-bmpl-sm transition hover:-translate-y-0.5 hover:border-belize-light/60 hover:shadow-bmpl-md">
                    <div className="flex aspect-square items-center justify-center overflow-hidden rounded-bmpl-lg bg-slate-100 text-sm text-slate-400">
                      {p.primaryImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.primaryImageUrl} alt={p.title} className="h-full w-full object-cover" />
                      ) : (
                        'No image'
                      )}
                    </div>
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
      </div>
    </>
  );
}

function Card({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="bmpl-card space-y-1.5 p-4">
      <h3 className="bmpl-eyebrow mb-1">{title}</h3>
      {children}
    </section>
  );
}
