import { EmptyState, ButtonLink } from '../ui';

/** Friendly state shown when the API returns 403 (not an approved property owner). */
export function PropertyOwnerGate() {
  return (
    <div className="mx-auto max-w-2xl">
      <EmptyState
        title="Property owner access required"
        description="List your property for sale or rent by applying for the Property Owner role. Once approved, your listing tools appear here."
        action={<ButtonLink href="/dashboard/roles">Apply to become a property owner</ButtonLink>}
      />
    </div>
  );
}
