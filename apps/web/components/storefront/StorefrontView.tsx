import Link from 'next/link';
import { Alert, Badge as UiBadge, EmptyState } from '../ui';
import { EnlargeableImage } from './EnlargeableImage';
import { StarRating } from '../reviews/StarRating';
import { ReviewList } from '../reviews/ReviewList';
import { SaveButton } from '../saved/SaveButton';
import { vendorClosedBadge, type VendorHoursExceptionPublic, type VendorWeeklyHour } from '../../lib/vendor-hours';

const DAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const money = (c: number) => `$${(c / 100).toFixed(2)}`;

export interface Storefront {
  businessName: string;
  slug: string;
  vendorProfileId: string;
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
  /**
   * BMPL-335. Optional: web (Vercel) and api (Railway, which runs `prisma
   * migrate deploy` first and is therefore slower) deploy independently, so
   * there is a real window after a merge like this one's own where this
   * PUBLIC, unauthenticated page (`/store/[slug]`) is live against an api
   * that doesn't send these fields yet. Absence means the same thing an
   * empty array means here — nothing configured, no badge, no card — never
   * a crash for an anonymous shopper.
   */
  openingHours?: VendorWeeklyHour[];
  /** BMPL-335: exactly the four fields the API selects — never `reason` or
   *  `createdByUserId`, see vendor.service.ts's STOREFRONT_INCLUDE. Optional
   *  for the same reason as `openingHours` above. */
  hoursExceptions?: VendorHoursExceptionPublic[];
  featuredProducts: Array<{ id: string; title: string; slug: string; priceMinor: number; salePriceMinor: number | null; category: { name: string }; primaryImageUrl: string | null }>;
  categories: Array<{ name: string; slug: string }>;
}

/**
 * The storefront presentation, shared by the public `/store/[slug]` page and the
 * vendor's owner-only `/dashboard/store/preview`. Renders the storefront body
 * only — callers provide their own page chrome (header/footer or dashboard shell).
 */
export function StorefrontView({ store }: { store: Storefront }) {
  // Read once, absence-safe: see the field's own doc comment above for why
  // `openingHours`/`hoursExceptions` can legitimately be missing rather than
  // empty. Every other use of either field in this component goes through
  // these two locals, never `store.openingHours`/`store.hoursExceptions`
  // directly, so a future addition below can't reopen the same crash.
  const openingHours = store.openingHours ?? [];
  const hoursExceptions = store.hoursExceptions ?? [];

  // Ruling 10 (BMPL-259/BMPL-335): configured hours CONSTRAIN DISPATCH, they
  // do not block ordering. Computed from BOTH the weekly pattern AND the
  // exception rows — either alone can give the wrong answer on an excepted
  // date, which is exactly the case this card was held all evening to avoid.
  // null (no configured hours at all, or currently open) means no badge —
  // not "hours unknown", nothing.
  const closedBadge = vendorClosedBadge(openingHours, hoursExceptions);

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
            {/* Floating white label — keeps the name legible over dark banner artwork.
                w-fit so the pill hugs the text instead of stretching the row. */}
            <h1 className="w-fit rounded-bmpl-lg bg-white px-4 py-2 text-2xl font-bold tracking-tight text-belize-navy shadow-bmpl-md">
              {store.businessName}
            </h1>
            <div className="mt-1.5">
              <StarRating value={store.ratingAverage} size="sm" showValue count={store.ratingCount} />
            </div>
          </div>
        </div>

        <div className="mt-3 flex flex-wrap gap-2">
          <UiBadge tone={store.storeStatus === 'OPEN' ? 'success' : 'neutral'}>{store.storeStatus}</UiBadge>
          {store.vacationMode && <UiBadge tone="warning">On vacation</UiBadge>}
          {store.pickupEnabled && <UiBadge tone="brand">Pickup</UiBadge>}
          {store.deliveryEnabled && <UiBadge tone="brand">Delivery</UiBadge>}
        </div>

        {/* Posted opening hours, not storeStatus above — a different fact.
            Never implies the order cannot be placed (ruling 10): it always
            says when the order WILL be dispatched, never that it cannot be
            placed now. */}
        {closedBadge && (
          <Alert tone="warning" className="mt-3 max-w-2xl">
            {closedBadge.message}
          </Alert>
        )}

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
                  <div key={p.id} className="relative">
                    <Link href={`/products/${p.slug}`} className="group block rounded-bmpl-lg border border-slate-200 bg-white p-4 shadow-bmpl-sm transition hover:-translate-y-0.5 hover:border-belize-light/60 hover:shadow-bmpl-md">
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
                    <div className="absolute right-6 top-6">
                      <SaveButton productId={p.id} productSlug={p.slug} className="bg-white/90 shadow-bmpl-sm backdrop-blur hover:bg-white" />
                    </div>
                  </div>
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

            {openingHours.length > 0 && (
              <Card title="Opening hours">
                {openingHours.map((h) => (
                  <p key={h.dayOfWeek} className="flex justify-between text-sm text-slate-600">
                    <span>{DAYS[h.dayOfWeek]}</span>
                    <span>{h.isClosed ? 'Closed' : `${h.openTime}–${h.closeTime}`}</span>
                  </p>
                ))}
              </Card>
            )}
          </aside>
        </div>

        <section className="mt-10">
          <h2 className="mb-4 text-lg font-bold text-belize-navy">Customer reviews</h2>
          <ReviewList subjectType="VENDOR" subjectId={store.vendorProfileId} />
        </section>
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
