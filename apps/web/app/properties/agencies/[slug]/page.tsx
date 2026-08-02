import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '../../../../components/landing/Header';
import { Footer } from '../../../../components/landing/Footer';
import { serverGetSafe } from '../../../../lib/server-api';
import { Badge, Card } from '../../../../components/ui';
import { PropertyGrid } from '../../../../components/realestate/PropertyCard';
import { type AgencyPage, districtLabel } from '../../../../lib/realestate';

export const dynamic = 'force-dynamic';

export default async function AgencyPublicPage({ params }: { params: { slug: string } }) {
  const res = await serverGetSafe<AgencyPage>(`/properties/agencies/${encodeURIComponent(params.slug)}`);
  if (!res.ok) {
    if (res.notFound) notFound();
    return (
      <>
        <Header />
        <main className="bg-slate-50 py-16">
          <div className="container-bmpl">
            <Card className="p-8 text-center text-slate-500">This agency page is temporarily unavailable.</Card>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const { agency, listings } = res.data;

  return (
    <>
      <Header />
      <main className="bg-slate-50">
        <div className="h-32 w-full bg-gradient-to-r from-belize-navy to-belize-blue sm:h-44">
          {agency.bannerUrl && (
            // eslint-disable-next-line @next/next/no-img-element
            <img src={agency.bannerUrl} alt={`${agency.name} banner`} className="h-full w-full object-cover" />
          )}
        </div>

        <div className="container-bmpl -mt-10 pb-14">
          <div className="flex items-end gap-4">
            {agency.logoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={agency.logoUrl}
                alt={`${agency.name} logo`}
                className="h-20 w-20 shrink-0 rounded-bmpl-lg border-4 border-white object-cover shadow-bmpl-md"
              />
            ) : (
              <span className="flex h-20 w-20 shrink-0 items-center justify-center rounded-bmpl-lg border-4 border-white bg-belize-blue text-xl font-bold text-white shadow-bmpl-md">
                {agency.name.slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="pb-1">
              <h1 className="text-2xl font-bold tracking-tight text-belize-navy">{agency.name}</h1>
              <div className="mt-1 flex flex-wrap items-center gap-2 text-sm text-slate-500">
                {(agency.city || agency.district) && (
                  <span>{[agency.city, districtLabel(agency.district)].filter(Boolean).join(', ')}</span>
                )}
              </div>
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="brand">
              {agency.activeListings} active listing{agency.activeListings === 1 ? '' : 's'}
            </Badge>
          </div>

          {agency.description && (
            <p className="mt-5 max-w-2xl whitespace-pre-line text-slate-600">{agency.description}</p>
          )}

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-500">
            {agency.contactEmail && <span>{agency.contactEmail}</span>}
            {agency.contactPhone && <span>{agency.contactPhone}</span>}
            {agency.website && (
              <a href={agency.website} target="_blank" rel="noreferrer" className="font-medium text-belize-blue hover:underline">
                {agency.website} ↗
              </a>
            )}
          </div>

          {agency.agents.length > 0 && (
            <section className="mt-8">
              <h2 className="mb-3 text-lg font-bold text-belize-navy">Our agents</h2>
              <div className="flex flex-wrap gap-4">
                {agency.agents.map((a) => (
                  <Link
                    key={a.slug}
                    href={`/properties/agents/${a.slug}`}
                    className="flex items-center gap-2 rounded-bmpl-md border border-slate-200 bg-white px-3 py-2 text-sm font-medium text-belize-navy transition hover:border-belize-blue"
                  >
                    {a.photoUrl ? (
                      // eslint-disable-next-line @next/next/no-img-element
                      <img src={a.photoUrl} alt={a.displayName} className="h-8 w-8 rounded-full object-cover" />
                    ) : (
                      <span className="flex h-8 w-8 items-center justify-center rounded-full bg-belize-blue text-xs font-bold text-white">
                        {a.displayName.slice(0, 2).toUpperCase()}
                      </span>
                    )}
                    {a.displayName}
                  </Link>
                ))}
              </div>
            </section>
          )}

          <section className="mt-10">
            <h2 className="mb-4 text-lg font-bold text-belize-navy">Listings</h2>
            <PropertyGrid
              properties={listings}
              emptyTitle="No active listings"
              emptyDescription="This agency has no published listings right now."
            />
            <div className="mt-6">
              <Link href="/properties" className="text-sm font-medium text-belize-blue hover:underline">
                ← Browse all properties
              </Link>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
