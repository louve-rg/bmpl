import { serverGetSafe } from '../../lib/server-api';
import type { HomepageBundle } from '../../lib/marketing';
import { SponsoredRow } from './SponsoredRow';

/**
 * Homepage "Featured / Sponsored" band (server-rendered). Fetches the public homepage
 * promotion bundle and renders a clearly-labelled band: hero, featured businesses,
 * products, jobs, and properties — each a horizontal row of sponsored cards, shown only
 * when non-empty. Renders nothing when the feed is unavailable or entirely empty. These
 * placements are ADDITIVE and never affect the organic discovery/marketplace sections.
 */
export async function PromotedSections() {
  const res = await serverGetSafe<HomepageBundle>('/marketing/homepage');
  if (!res.ok) return null;
  const { hero, featuredBusinesses, featuredProducts, featuredJobs, featuredProperties } = res.data;

  const hasAnything =
    (hero?.length ?? 0) +
      (featuredBusinesses?.length ?? 0) +
      (featuredProducts?.length ?? 0) +
      (featuredJobs?.length ?? 0) +
      (featuredProperties?.length ?? 0) >
    0;
  if (!hasAnything) return null;

  return (
    <section aria-labelledby="promoted-heading" className="bg-slate-50 py-16 sm:py-20">
      <div className="container-bmpl space-y-14">
        <div className="mx-auto max-w-2xl text-center">
          <p className="bmpl-eyebrow">Featured &amp; Sponsored</p>
          <h2 id="promoted-heading" className="mt-2 text-3xl font-bold tracking-tight text-belize-navy sm:text-4xl">
            Spotlight
          </h2>
          <p className="mt-3 text-base text-slate-600 sm:text-lg">
            Promoted businesses, products, jobs, and properties from across Belize. Clearly marked so you always
            know what&apos;s sponsored.
          </p>
        </div>

        <SponsoredRow title="Featured" cardLabel="Featured" items={hero ?? []} placement="HOMEPAGE_HERO" />
        <SponsoredRow title="Featured businesses" items={featuredBusinesses ?? []} placement="HOMEPAGE_FEATURED_BUSINESSES" />
        <SponsoredRow title="Featured products" items={featuredProducts ?? []} placement="HOMEPAGE_FEATURED_PRODUCTS" />
        <SponsoredRow title="Featured jobs" items={featuredJobs ?? []} placement="HOMEPAGE_FEATURED_JOBS" />
        <SponsoredRow title="Featured properties" items={featuredProperties ?? []} placement="HOMEPAGE_FEATURED_PROPERTIES" />
      </div>
    </section>
  );
}
