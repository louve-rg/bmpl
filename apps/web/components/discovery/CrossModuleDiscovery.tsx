import type { ReactNode } from 'react';
import Link from 'next/link';
import { serverGetSafe } from '../../lib/server-api';
import type { ServeCard } from '../../lib/marketing';
import type { JobCard as JobCardType } from '../../lib/jobs';
import type { PropertyCard as PropertyCardType } from '../../lib/realestate';
import { ProductRow, type ProductCardData } from './ProductCard';
import { SponsoredRow } from '../marketing/SponsoredRow';
import { JobCard } from '../jobs/JobCard';
import { PropertyCard } from '../realestate/PropertyCard';

/** How many typed cards to surface per cross-module section. */
const SECTION_LIMIT = 8;

interface DiscoveryResponse {
  featured: ProductCardData[];
  topRated: ProductCardData[];
  newArrivals: ProductCardData[];
  popular: ProductCardData[];
}

interface JobListResponse {
  items: JobCardType[];
}

interface PropertyListResponse {
  items: PropertyCardType[];
}

/** Titled "View all" link, styled like the other homepage section actions. */
function viewAll(href: string) {
  return (
    <Link href={href} className="text-sm font-semibold text-belize-blue hover:underline">
      View all →
    </Link>
  );
}

/**
 * A titled row wrapper matching ProductRow/SponsoredRow: horizontally scrollable on
 * mobile within its own container (never triggers body horizontal scroll), a responsive
 * grid on desktop. Renders nothing when empty.
 */
function CardRow({
  title,
  action,
  children,
}: {
  title: string;
  action?: ReactNode;
  children: ReactNode;
}) {
  return (
    <section aria-label={title}>
      <div className="mb-4 flex items-end justify-between gap-3">
        <h2 className="text-xl font-bold tracking-tight text-belize-navy sm:text-2xl">{title}</h2>
        {action && <div className="shrink-0">{action}</div>}
      </div>
      <div
        className="flex gap-4 overflow-x-auto pb-3 md:grid md:grid-cols-3 md:gap-5 md:overflow-visible md:pb-0 lg:grid-cols-4"
        role="list"
      >
        {children}
      </div>
    </section>
  );
}

/**
 * Marketplace cross-module discovery hub (server-rendered). A DISCOVERY LAYER: it
 * REFERENCES approved public records from other modules — it never duplicates them. The
 * four sources are fetched in parallel and each degrades independently; a section renders
 * only when it has items (no empty containers, no placeholders). Sections are kept
 * distinct and typed — sponsored content is clearly labelled and never reorders or
 * replaces the organic product grid. Every card links to its ORIGINATING module route:
 * products → /products/[slug], jobs → /jobs/[slug], properties → /properties/[slug].
 */
export async function CrossModuleDiscovery() {
  const [sponsoredRes, productsRes, jobsRes, propertiesRes] = await Promise.all([
    serverGetSafe<ServeCard[]>('/marketing/placements/MARKETPLACE'),
    serverGetSafe<DiscoveryResponse>('/marketplace/discovery'),
    serverGetSafe<JobListResponse>('/jobs'),
    serverGetSafe<PropertyListResponse>('/properties'),
  ]);

  const sponsored = sponsoredRes.ok ? sponsoredRes.data ?? [] : [];
  // "New Products" — already newest-first server-side; take the first N as-is.
  const newProducts = (productsRes.ok ? productsRes.data.newArrivals ?? [] : []).slice(0, SECTION_LIMIT);
  const jobs = (jobsRes.ok ? jobsRes.data.items ?? [] : []).slice(0, SECTION_LIMIT);
  const properties = (propertiesRes.ok ? propertiesRes.data.items ?? [] : []).slice(0, SECTION_LIMIT);

  const hasAnything =
    sponsored.length + newProducts.length + jobs.length + properties.length > 0;
  if (!hasAnything) return null;

  return (
    <section aria-labelledby="cross-module-heading" className="bg-slate-50 py-16 sm:py-20">
      <div className="container-bmpl space-y-14">
        <div className="mx-auto max-w-2xl text-center">
          <p className="bmpl-eyebrow">Explore Belize</p>
          <h2
            id="cross-module-heading"
            className="mt-2 text-3xl font-bold tracking-tight text-belize-navy sm:text-4xl"
          >
            Discover more across the marketplace
          </h2>
          <p className="mt-3 text-base text-slate-600 sm:text-lg">
            New products, open jobs, and property listings from across Belize — each opens in its
            own section of the platform.
          </p>
        </div>

        {/* Sponsored — clearly labelled, kept fully separate from the organic product grid,
            rendered only when non-empty. */}
        <SponsoredRow title="Sponsored" cardLabel="Sponsored" items={sponsored} placement="MARKETPLACE" />

        {/* New Products — newest-first; links to /products/[slug]. */}
        <ProductRow title="New products" items={newProducts} action={viewAll('/products')} />

        {/* Featured Jobs — links to /jobs/[slug]. */}
        {jobs.length > 0 && (
          <CardRow title="Featured jobs" action={viewAll('/jobs')}>
            {jobs.map((job) => (
              <div key={job.id} role="listitem" className="w-72 shrink-0 md:w-auto">
                <JobCard job={job} />
              </div>
            ))}
          </CardRow>
        )}

        {/* Featured Properties — links to /properties/[slug]. */}
        {properties.length > 0 && (
          <CardRow title="Featured properties" action={viewAll('/properties')}>
            {properties.map((property) => (
              <div key={property.id} role="listitem" className="w-72 shrink-0 md:w-auto">
                <PropertyCard property={property} />
              </div>
            ))}
          </CardRow>
        )}
      </div>
    </section>
  );
}
