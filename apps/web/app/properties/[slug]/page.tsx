import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '../../../components/landing/Header';
import { Footer } from '../../../components/landing/Footer';
import { serverGetSafe } from '../../../lib/server-api';
import { Badge, Card } from '../../../components/ui';
import { PropertyBadges, PropertyGrid } from '../../../components/realestate/PropertyCard';
import { PropertyGallery } from '../../../components/realestate/PropertyGallery';
import { SaveButton } from '../../../components/realestate/SaveButton';
import { PropertyContactPanel } from '../../../components/realestate/PropertyContactPanel';
import { ReportDialog } from '../../../components/realestate/ReportDialog';
import { RecentlyViewedTracker } from '../../../components/realestate/RecentlyViewedTracker';
import {
  type PropertyDetail,
  formatPrice,
  locationLabel,
  furnishingLabel,
  tenureLabel,
  areaUnitLabel,
  propertyTypeLabel,
  fmtDate,
} from '../../../lib/realestate';

export const dynamic = 'force-dynamic';

export default async function PropertyDetailPage({ params }: { params: { slug: string } }) {
  const res = await serverGetSafe<PropertyDetail>(`/properties/${encodeURIComponent(params.slug)}`);
  if (!res.ok) {
    if (res.notFound) notFound();
    return (
      <>
        <Header />
        <main className="bg-slate-50 py-16">
          <div className="container-bmpl">
            <Card className="p-8 text-center text-slate-500">
              This listing is temporarily unavailable. Please try again in a moment.
            </Card>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const p = res.data;
  const price = formatPrice(p.priceMinor, { purpose: p.purpose, rentalPeriod: p.rentalPeriod });

  return (
    <>
      <Header />
      <RecentlyViewedTracker listingId={p.id} />
      <main className="bg-slate-50 pb-16">
        <div className="container-bmpl py-8">
          <Link href="/properties" className="text-sm font-medium text-belize-blue hover:underline">
            ← All properties
          </Link>

          <div className="mt-4 grid gap-6 lg:grid-cols-[1fr_360px]">
            {/* main */}
            <div className="space-y-6">
              <PropertyGallery images={p.images} title={p.title} />

              <div>
                <div className="flex flex-wrap items-center gap-2">
                  <PropertyBadges purpose={p.purpose} propertyType={p.propertyType} />
                  {p.status === 'UNDER_OFFER' && <Badge tone="warning">Under offer</Badge>}
                  {p.authorityVerified && <Badge tone="success">Verified</Badge>}
                </div>
                <h1 className="mt-3 text-2xl font-bold tracking-tight text-belize-navy sm:text-3xl">{p.title}</h1>
                <p className="mt-1 text-slate-600">{locationLabel(p.location)}</p>
                <p className="mt-2 text-2xl font-bold text-belize-navy">
                  {price}
                  {p.negotiable && <span className="ml-2 text-sm font-medium text-slate-500">negotiable</span>}
                </p>
              </div>

              <Card className="p-5">
                <h2 className="text-lg font-bold text-belize-navy">Key facts</h2>
                <div className="mt-3 grid grid-cols-2 gap-4 sm:grid-cols-3">
                  <Fact label="Type" value={propertyTypeLabel(p.propertyType)} />
                  <Fact label="Bedrooms" value={p.bedrooms != null ? String(p.bedrooms) : null} />
                  <Fact label="Bathrooms" value={p.bathrooms != null ? String(p.bathrooms) : null} />
                  <Fact label="Half baths" value={p.halfBathrooms != null ? String(p.halfBathrooms) : null} />
                  <Fact label="Parking" value={p.parkingSpaces != null ? String(p.parkingSpaces) : null} />
                  <Fact
                    label="Property size"
                    value={p.propertySize != null ? `${p.propertySize.toLocaleString()} ${areaUnitLabel(p.areaUnit)}` : null}
                  />
                  <Fact
                    label="Land size"
                    value={p.landSize != null ? `${p.landSize.toLocaleString()} ${areaUnitLabel(p.areaUnit)}` : null}
                  />
                  <Fact label="Furnishing" value={p.furnishing ? furnishingLabel(p.furnishing) : null} />
                  <Fact label="Tenure" value={p.tenure ? tenureLabel(p.tenure) : null} />
                  <Fact label="Year built" value={p.yearBuilt != null ? String(p.yearBuilt) : null} />
                  <Fact label="Condition" value={p.condition} />
                  <Fact label="Available" value={p.availabilityDate ? fmtDate(p.availabilityDate) : null} />
                </div>
              </Card>

              <Card className="p-5">
                <h2 className="text-lg font-bold text-belize-navy">Description</h2>
                <p className="mt-2 whitespace-pre-line text-sm leading-relaxed text-slate-600">{p.description}</p>
              </Card>

              {p.amenities.length > 0 && (
                <Card className="p-5">
                  <h2 className="text-lg font-bold text-belize-navy">Amenities</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {p.amenities.map((a) => (
                      <Badge key={a} tone="neutral">
                        {a}
                      </Badge>
                    ))}
                  </div>
                </Card>
              )}

              {p.utilities.length > 0 && (
                <Card className="p-5">
                  <h2 className="text-lg font-bold text-belize-navy">Utilities</h2>
                  <div className="mt-3 flex flex-wrap gap-2">
                    {p.utilities.map((u) => (
                      <Badge key={u} tone="neutral">
                        {u}
                      </Badge>
                    ))}
                  </div>
                </Card>
              )}

              <Card className="p-5">
                <h2 className="text-lg font-bold text-belize-navy">Location</h2>
                <p className="mt-2 text-sm text-slate-600">{locationLabel(p.location)}</p>
                {p.leaseTerm && <p className="mt-1 text-sm text-slate-500">Lease term: {p.leaseTerm}</p>}
                {p.petPolicy && <p className="mt-1 text-sm text-slate-500">Pet policy: {p.petPolicy}</p>}
              </Card>

              {p.videoUrl && (
                <Card className="p-5">
                  <h2 className="text-lg font-bold text-belize-navy">Video tour</h2>
                  <a
                    href={p.videoUrl}
                    target="_blank"
                    rel="noreferrer"
                    className="mt-1 inline-block text-sm font-medium text-belize-blue hover:underline"
                  >
                    Watch video ↗
                  </a>
                </Card>
              )}
            </div>

            {/* sidebar */}
            <aside className="space-y-4 lg:sticky lg:top-24 lg:self-start">
              <Card className="space-y-3 p-5">
                <div>
                  <p className="bmpl-eyebrow">Price</p>
                  <p className="mt-0.5 text-xl font-bold text-belize-navy">{price}</p>
                  <p className="text-xs text-slate-400">Reference {p.reference}</p>
                </div>
                <SaveButton listingId={p.id} slug={p.slug} withLabel className="w-full justify-center" />
                <div className="border-t border-slate-100 pt-3">
                  <ReportDialog listingId={p.id} slug={p.slug} />
                </div>
              </Card>

              <PropertyContactPanel listingId={p.id} slug={p.slug} />

              {(p.agent || p.agency) && (
                <Card className="space-y-3 p-5">
                  <p className="bmpl-eyebrow">Listed by</p>
                  {p.agent && (
                    <div className="flex items-center gap-3">
                      {p.agent.photoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.agent.photoUrl} alt={p.agent.displayName} className="h-12 w-12 shrink-0 rounded-full object-cover" />
                      ) : (
                        <span className="flex h-12 w-12 shrink-0 items-center justify-center rounded-full bg-belize-blue text-sm font-bold text-white">
                          {p.agent.displayName.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <div>
                        <Link href={`/properties/agents/${p.agent.slug}`} className="font-semibold text-belize-navy hover:text-belize-blue">
                          {p.agent.displayName}
                        </Link>
                        {p.agent.phone && <p className="text-xs text-slate-500">{p.agent.phone}</p>}
                      </div>
                    </div>
                  )}
                  {p.agency && (
                    <div className="flex items-center gap-3 border-t border-slate-100 pt-3">
                      {p.agency.logoUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img src={p.agency.logoUrl} alt={p.agency.name} className="h-10 w-10 shrink-0 rounded-bmpl-md object-cover" />
                      ) : (
                        <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-bmpl-md bg-slate-100 text-xs font-bold text-slate-500">
                          {p.agency.name.slice(0, 2).toUpperCase()}
                        </span>
                      )}
                      <Link href={`/properties/agencies/${p.agency.slug}`} className="text-sm font-medium text-belize-navy hover:text-belize-blue">
                        {p.agency.name}
                      </Link>
                    </div>
                  )}
                </Card>
              )}
            </aside>
          </div>

          {p.moreFromAgent.length > 0 && (
            <section className="mt-12">
              <h2 className="mb-4 text-lg font-bold text-belize-navy">More from this agent</h2>
              <PropertyGrid properties={p.moreFromAgent} />
            </section>
          )}

          {p.related.length > 0 && (
            <section className="mt-12">
              <h2 className="mb-4 text-lg font-bold text-belize-navy">Similar properties</h2>
              <PropertyGrid properties={p.related} />
            </section>
          )}
        </div>
      </main>
      <Footer />
    </>
  );
}

function Fact({ label, value }: { label: string; value: string | null }) {
  if (!value) return null;
  return (
    <div>
      <p className="bmpl-eyebrow">{label}</p>
      <p className="mt-0.5 text-sm font-medium text-belize-navy">{value}</p>
    </div>
  );
}
