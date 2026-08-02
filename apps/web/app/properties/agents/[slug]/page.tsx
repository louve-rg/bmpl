import Link from 'next/link';
import { notFound } from 'next/navigation';
import { Header } from '../../../../components/landing/Header';
import { Footer } from '../../../../components/landing/Footer';
import { serverGetSafe } from '../../../../lib/server-api';
import { Badge, Breadcrumbs, Card } from '../../../../components/ui';
import { PropertyGrid } from '../../../../components/realestate/PropertyCard';
import { type AgentPage, districtLabel, specialtyLabel } from '../../../../lib/realestate';

export const dynamic = 'force-dynamic';

export default async function AgentPublicPage({ params }: { params: { slug: string } }) {
  const res = await serverGetSafe<AgentPage>(`/properties/agents/${encodeURIComponent(params.slug)}`);
  if (!res.ok) {
    if (res.notFound) notFound();
    return (
      <>
        <Header />
        <main className="bg-slate-50 py-16">
          <div className="container-bmpl">
            <Card className="p-8 text-center text-slate-500">This agent page is temporarily unavailable.</Card>
          </div>
        </main>
        <Footer />
      </>
    );
  }

  const { agent, listings } = res.data;

  return (
    <>
      <Header />
      <main className="bg-slate-50">
        <div className="container-bmpl pt-6">
          <Breadcrumbs
            items={[
              { label: 'Real Estate', href: '/properties' },
              { label: agent.displayName },
            ]}
            className="mb-3"
          />
        </div>
        <div className="h-32 w-full bg-gradient-to-r from-belize-navy to-belize-blue sm:h-40" />

        <div className="container-bmpl -mt-12 pb-14">
          <div className="flex items-end gap-4">
            {agent.photoUrl ? (
              // eslint-disable-next-line @next/next/no-img-element
              <img
                src={agent.photoUrl}
                alt={agent.displayName}
                className="h-24 w-24 shrink-0 rounded-full border-4 border-white object-cover shadow-bmpl-md"
              />
            ) : (
              <span className="flex h-24 w-24 shrink-0 items-center justify-center rounded-full border-4 border-white bg-belize-blue text-2xl font-bold text-white shadow-bmpl-md">
                {agent.displayName.slice(0, 2).toUpperCase()}
              </span>
            )}
            <div className="pb-1">
              <h1 className="text-2xl font-bold tracking-tight text-belize-navy">{agent.displayName}</h1>
              {agent.agency && (
                <Link href={`/properties/agencies/${agent.agency.slug}`} className="text-sm font-medium text-belize-blue hover:underline">
                  {agent.agency.name}
                </Link>
              )}
            </div>
          </div>

          <div className="mt-3 flex flex-wrap gap-2">
            <Badge tone="brand">
              {agent.activeListings} active listing{agent.activeListings === 1 ? '' : 's'}
            </Badge>
            {agent.yearsExperience != null && <Badge tone="neutral">{agent.yearsExperience} yrs experience</Badge>}
            {agent.ratingCount > 0 && agent.ratingAverage != null && (
              <Badge tone="neutral">★ {agent.ratingAverage.toFixed(1)} ({agent.ratingCount})</Badge>
            )}
          </div>

          {agent.specialties.length > 0 && (
            <div className="mt-3 flex flex-wrap gap-2">
              {agent.specialties.map((s) => (
                <Badge key={s} tone="neutral">
                  {specialtyLabel(s)}
                </Badge>
              ))}
            </div>
          )}

          {agent.bio && <p className="mt-5 max-w-2xl whitespace-pre-line text-slate-600">{agent.bio}</p>}

          <div className="mt-4 flex flex-wrap gap-x-6 gap-y-1 text-sm text-slate-500">
            {agent.serviceDistricts.length > 0 && (
              <span>Serves: {agent.serviceDistricts.map((d) => districtLabel(d)).join(', ')}</span>
            )}
            {agent.phone && <span>{agent.phone}</span>}
            {agent.email && <span>{agent.email}</span>}
            {agent.website && (
              <a href={agent.website} target="_blank" rel="noreferrer" className="font-medium text-belize-blue hover:underline">
                {agent.website} ↗
              </a>
            )}
          </div>

          <section className="mt-10">
            <h2 className="mb-4 text-lg font-bold text-belize-navy">Listings</h2>
            <PropertyGrid
              properties={listings}
              emptyTitle="No active listings"
              emptyDescription="This agent has no published listings right now."
            />
            <div className="mt-6">
              <Link href="/properties" className="text-sm font-medium text-belize-blue hover:underline">
                ← Back to Real Estate
              </Link>
            </div>
          </section>
        </div>
      </main>
      <Footer />
    </>
  );
}
