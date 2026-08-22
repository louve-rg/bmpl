import { EmptyState, ButtonLink } from '../ui';

/** Friendly state shown when the marketing API returns 403 (not an approved business
 *  role). Any of VENDOR / EMPLOYER / REAL_ESTATE_AGENT / PROPERTY_OWNER unlocks the
 *  marketing tools; otherwise the user is prompted to become a business. */
export function BusinessMarketingGate() {
  return (
    <div className="mx-auto max-w-2xl">
      <EmptyState
        title="Business access required"
        description="Marketing tools are for businesses on BML. Become a vendor, employer, agency/agent, or property owner to promote your store, products, jobs, or listings. Once approved, your marketing tools appear here."
        action={<ButtonLink href="/dashboard/roles">Apply to become a business</ButtonLink>}
      />
    </div>
  );
}
